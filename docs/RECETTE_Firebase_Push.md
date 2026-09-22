# Recette Firebase FCM — serveur, navigateur et service worker (B4)

> **Prérequis humains** : projet Firebase, **compte de service** (`projectId`, `clientEmail`,
> `privateKey`) saisi dans `/admin/integrations` (carte **FIREBASE**), **application web** +
> **clé VAPID**, un **Android** (Chrome) et un **iPhone iOS ≥ 16.4** (push web uniquement pour
> une PWA **installée** sur l'écran d'accueil). Ne cocher B4 qu'après notification **reçue**.

## 0. Deux configurations distinctes — ne pas les confondre

| | Serveur (envoi) | Web (réception) |
|---|---|---|
| Valeurs | `projectId`, `clientEmail`, `privateKey` | `NEXT_PUBLIC_FIREBASE_API_KEY`, `_AUTH_DOMAIN` (opt.), `_PROJECT_ID`, `_MESSAGING_SENDER_ID`, `_APP_ID`, `_VAPID_KEY` |
| Nature | **SECRETS** — chiffrés en base (`/admin/integrations`) ou `.env` | **publiques** (visibles par tout navigateur) |
| Changement | immédiat, sans redéploiement | ⚠️ **inlinées au BUILD** : changer une valeur exige **`pnpm build` + déploiement** |

Garde-fous : `push.test.ts` (aucune variable serveur ni clé PEM dans `apps/web/src|public`),
`scripts/check-web-bundle-secrets.mjs` (scan du bundle construit — étape de `release:check`),
`validateSecretsShape` (le `PUT` FIREBASE refuse un `clientEmail` hors
`…iam.gserviceaccount.com`, une `privateKey` non PEM, un `projectId` mal formé — sans jamais
reprendre la valeur dans l'erreur). **Aucune configuration Firebase réelle n'est commitée.**

## 1. Corrigé le 22/09/2026 (constaté dans le code, avant toute recette)

1. 🔴 **Le SW FCM ne pouvait pas démarrer** : la CSP globale (`script-src 'self'`) était aussi
   servie avec `/firebase-messaging-sw.js`, dont les `importScripts` viennent de
   `www.gstatic.com` ⇒ aucune notification en arrière-plan. CSP dédiée au SW
   (`next.config.mjs`) + `Cache-Control: no-cache` Nginx.
2. 🔴 **Déconnexion sans purge du token** : sur un appareil partagé, les notifications du compte
   continuaient d'arriver après déconnexion. `auth.logout` remet `fcmToken` à `null` (test).
3. 🟠 **Rotation jamais propagée** : le token n'était envoyé qu'à la connexion OTP. Il l'est
   aussi à chaque reprise de session (sans redemander la permission).
4. 🟠 **Clic sans effet** et **rien au premier plan** : handler `notificationclick` (ramène/ouvre
   l'app sur un chemin **interne** seulement) + relais `onMessage` → notification système.

## 2. Smoke test serveur (opt-in)

```bash
SMOKE_FCM=1 SMOKE_FCM_TOKEN='<token de l’appareil de recette>' \
  pnpm --filter @digisante/api test:smoke -- firebase
```

Obtenir le token : se connecter sur l'appareil de recette avec un **compte synthétique**, puis le
lire en base de **recette** uniquement (`SELECT "fcmToken" FROM users WHERE phone = '<numéro de
recette>'`) — ne jamais le copier dans un ticket ni un document.
Sortie publiable : `[smoke:fcm] accepté=true · message ••••1234 · token invalide=false`.

## 3. Recette PWA (Android puis iPhone installé)

| # | Scénario | Attendu | Android | iPhone |
|---|---|---|---|---|
| F1 | Connexion OTP, permission **refusée** | aucune erreur ; l'app fonctionne ; pas de token enregistré | ☐ | ☐ |
| F2 | Réautoriser (réglages) puis reconnexion | invite de permission ; token enregistré | ☐ | ☐ |
| F3 | App **au premier plan** + smoke test | notification système affichée | ☐ | ☐ |
| F4 | App **en arrière-plan / fermée** + smoke test | notification reçue (SW) | ☐ | ☐ |
| F5 | **Clic** sur la notification | l'app s'ouvre / revient au premier plan | ☐ | ☐ |
| F6 | **Rotation** : effacer les données du site, se reconnecter | nouveau token enregistré ; l'ancien, réutilisé par le smoke, est **rejeté** (`token invalide=true`) — le dispatch réel le purgerait (`UNREGISTERED`) | ☐ | ☐ |
| F7 | **Déconnexion** puis smoke vers l'ancien token du compte | le compte n'a plus de token (rien n'est envoyé) | ☐ | ☐ |
| F8 | Reprise de session sans reconnexion (rouvrir l'app) | aucune invite de permission ; token rafraîchi en silence | ☐ | ☐ |
| F9 | Changement d'une `NEXT_PUBLIC_FIREBASE_*` | pris en compte **seulement après rebuild** | ☐ | — |

Critère de sortie B4 Firebase : **F3, F4, F5, F7 OK sur Android ET iPhone installé**.

## 4. Rollback

Serveur : `/admin/integrations` → **FIREBASE** → **Désactiver** (push en stub, immédiat).
Web : retirer les `NEXT_PUBLIC_FIREBASE_*` puis rebuild — le client ne demande plus de permission.
Clé de compte de service compromise : la **révoquer dans Google Cloud IAM**, en générer une
nouvelle, `PUT` du jeu complet.
