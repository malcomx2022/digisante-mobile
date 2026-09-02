# Comptes & clés API — DigiSanté Mobile

> Liste des comptes externes à créer, des liens d'inscription et des clés associées.
> Ne **jamais** committer les valeurs réelles.
>
> **Depuis les Lots A–G (gestion des API tierces)**, la voie recommandée pour les clés
> d'**intégration** (FedaPay, Twilio, Daily, Firebase, Resend) est la page
> **`/admin/integrations`** (SUPER_ADMIN, scope `integrations:write`) : secrets **chiffrés
> AES-256 en base**, bascule stub→réel **dynamique sans redéploiement**, `.env` en simple
> **fallback**. Les secrets d'**infrastructure** (`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`,
> `HEALTH_ENCRYPTION_KEY`, `RECONCILE_TOKEN`) restent en `.env` **uniquement** (§3.6).
> ⚠️ Le `PUT` admin **remplace toutes les clés du provider** : toujours saisir le jeu complet.
>
> Suivi du chantier d'ouverture : `docs/SUIVI_B4_Comptes_2026-09.md`.

## Vue d'ensemble

| Catégorie | Service | Nécessaire pour |
|---|---|---|
| Paiements | FedaPay | Mobile Money, cartes, wallet diaspora |
| Vidéo | Daily.co | Téléconsultation WebRTC |
| SMS / OTP | Twilio | OTP, rappels, alertes labo, SOS |
| Push | Firebase (FCM) | Notifications mobiles/web |
| Email | Resend | Emails transactionnels |
| Hébergement | Infomaniak | VPS de production |
| Code / CI | GitHub | Dépôt + GitHub Actions |
| IA dev | Anthropic | Claude Code (CLI) |

---

## 1. FedaPay — paiements (⚠️ zone §5 : procédure encadrée)

- **Inscription :** https://www.fedapay.com (puis tableau de bord)
- **Workflow :** créer d'abord un **compte test (sandbox)**, puis un **compte live** une fois
  validé par l'équipe FedaPay.
- **Particularité Bénin :** un marchand établi au Bénin n'a pas besoin de compte bancaire pour
  démarrer ; le compte doit être vérifié avant les transactions réelles.
- **Docs :** https://docs.fedapay.com · guide interne : `docs/GUIDE_FedaPay_Paiements.md`
- **Clés à saisir dans `/admin/integrations`** (fallback `.env` entre parenthèses) :
  - `secretKey` (`FEDAPAY_SECRET_KEY`) — **obligatoire** ; l'environnement est **déduit de la
    clé** (`sk_live_…` → production, sinon sandbox). Il n'existe pas de `FEDAPAY_ENV`, c'est voulu.
  - `publicKey` (`FEDAPAY_PUBLIC_KEY`) — **obligatoire**
  - `webhookSecret` (`FEDAPAY_WEBHOOK_SECRET`) — émis par FedaPay pour l'URL
    `https://<domaine>/api/v1/payments/webhook` ; **différent entre sandbox et live** :
    le roter **avec** la clé API, sinon 401 systématique.
- Journal des webhooks FedaPay : `/admin/finance` (pas la page intégrations — §5).

## 2. Daily.co — téléconsultation vidéo

- **Inscription :** https://dashboard.daily.co/signup (free tier, sans carte bancaire)
- À l'inscription, choisir le **sous-domaine** (`xxx.daily.co`).
- **Docs :** https://docs.daily.co/get-started · guide interne : `docs/GUIDE_DailyCo_Teleconsultation.md`
- **Clés (`/admin/integrations`)** :
  - `apiKey` (`DAILY_API_KEY`) — **obligatoire** (onglet *Developers*)
  - `domain` (`DAILY_DOMAIN`) — **obligatoire** (le sous-domaine choisi, ex. `digisante`)
  - `webhookSecret` — optionnel (récepteur non branché à ce jour)

## 3. Twilio — SMS / OTP / SOS

- **Inscription :** https://www.twilio.com/try-twilio
- Acheter / configurer un **numéro expéditeur** capable d'envoyer vers **+229 (Bénin)**.
- ⚠️ **Piège Bénin (§8)** : le sender ID alphanumérique n'est pas garanti chez tous les
  opérateurs — prévoir le **numéro long** comme expéditeur.
- **Docs :** https://www.twilio.com/docs · guide interne : `docs/GUIDE_Twilio_SMS.md`
- **Clés (`/admin/integrations`)** :
  - `accountSid` (`TWILIO_ACCOUNT_SID`) — **obligatoire**
  - `authToken` (`TWILIO_AUTH_TOKEN`) — **obligatoire**
  - `fromNumber` (`TWILIO_FROM_NUMBER`) — **obligatoire** (format E.164)
  - `webhookSecret` — optionnel (récepteur non branché à ce jour)

## 4. Firebase (Google) — notifications push (FCM)

- **Console :** https://console.firebase.google.com (compte Google requis)
- Créer un projet → *Paramètres du projet* → *Comptes de service* → **générer une clé privée**
  (JSON) ; côté web, ajouter une **application Web** au projet pour la config publique.
- **Docs :** https://firebase.google.com/docs/cloud-messaging · guide interne : `docs/GUIDE_Firebase_FCM.md`
- **Côté serveur (`/admin/integrations`)** — envoi HTTP v1, sans `firebase-admin` :
  - `projectId` (`FIREBASE_PROJECT_ID`) — **obligatoire**
  - `clientEmail` (`FIREBASE_CLIENT_EMAIL`) — **obligatoire**
  - `privateKey` (`FIREBASE_PRIVATE_KEY`) — **obligatoire** ; coller la clé **en une ligne
    avec des `\n` littéraux** (reconvertis au démarrage, piège §8)
- **Côté web — `.env` du build UNIQUEMENT** (config **publique**, inlinée au build : elle ne
  passe **pas** par l'admin ; à poser dans `apps/web/.env.production` **avant** `pnpm build`) :
  - `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`,
    `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`,
    `NEXT_PUBLIC_FIREBASE_APP_ID`, `NEXT_PUBLIC_FIREBASE_VAPID_KEY` (clé VAPID :
    *Cloud Messaging* → *Certificats push Web*)

## 5. Resend — email transactionnel

- **Inscription :** https://resend.com/signup
- Vérifier le **domaine d'envoi** (enregistrements DNS SPF/DKIM sur `digisante.bj`).
- **Docs :** https://resend.com/docs · guide interne : `docs/GUIDE_Resend_Email.md`
- **Clés (`/admin/integrations`)** :
  - `apiKey` (`RESEND_API_KEY`) — **obligatoire**
  - `fromEmail` (`RESEND_FROM_EMAIL`) — optionnel (défaut : `DigiSanté <no-reply@digisante.bj>`)
  - `webhookSecret` — optionnel (récepteur non branché à ce jour)

## 6. Infomaniak — hébergement (production)

- **VPS :** https://www.infomaniak.com/fr/hebergement/vps (Ubuntu 22.04)
- Héberge : PostgreSQL 16 natif, Redis, Nginx, PM2 (cf. `docs/DEPLOIEMENT_Checklist.md`).
- Pas de clé applicative — accès **SSH** (clé publique/privée).
- Prévoir un **nom de domaine** : `digisante.bj` (+ `www`) pour le SSL Certbot.
- **Clé de sauvegarde :** `/etc/digisante/backup.key` (AES-256, copiée **hors VPS**).

## 7. GitHub — dépôt & CI/CD

- **Secrets Actions** (Settings → Secrets → Actions) : `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`
  (+ `VPS_SSH_PORT` si non standard).
- **Variable** : `DEPLOY_ENABLED=true` pour armer le job `deploy`.

## 8. Anthropic — Claude Code (CLI)

- **Console :** https://console.anthropic.com — développement assisté
  (voir `docs/PLAYBOOK_Codage_DigiSante.md`).

---

## Où saisir quoi — récapitulatif

| Secret | Où | Quand |
|---|---|---|
| Intégrations (FedaPay, Twilio, Daily, Firebase serveur, Resend) | **`/admin/integrations`** (chiffré en base) — `.env` en fallback | App déployée, compte SUPER_ADMIN |
| Infra (`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `HEALTH_ENCRYPTION_KEY`, `RECONCILE_TOKEN`) | `apps/api/.env` **uniquement** | Au déploiement (B3) |
| Firebase **web** (`NEXT_PUBLIC_FIREBASE_*`) | `apps/web/.env.production` — **inliné au build** | Avant `pnpm build` |
| Déploiement (`VPS_*`, `DEPLOY_ENABLED`) | Secrets/variables GitHub Actions | Armement du CD (B3) |

Le modèle `.env` de référence est **`.env.example` à la racine** (79 lignes, ports dev
**5434/6380** — cf. piège §8 « une seule source ») : `cp .env.example apps/api/.env`.

## Ordre de priorité

1. **Développement local :** aucun compte requis — tout fonctionne en **mode stub**.
2. **Chantier B4 (maintenant) :** ouvrir les comptes — FedaPay (**sandbox**), Daily.co
   (free tier), Twilio, Firebase, Resend — et récupérer les clés ci-dessus.
3. **Mise en production (B3) :** Infomaniak (VPS + domaine), secrets GitHub ; puis saisie des
   clés via `/admin/integrations`, recette sandbox FedaPay, et **seulement ensuite** le passage
   FedaPay en live (remplacer la clé + roter le secret webhook, rien d'autre).

> ⚠️ Les liens et conditions des fournisseurs peuvent évoluer. Vérifier les pages
> officielles au moment de la création des comptes.
