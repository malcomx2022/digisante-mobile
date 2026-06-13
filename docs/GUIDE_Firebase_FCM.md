# Guide d'implémentation — Firebase Cloud Messaging (FCM)

> **Destiné à Claude Code.** Ce document décrit comment terminer l'intégration des
> notifications push de DigiSanté Mobile. À lire avec `CLAUDE.md` et
> `docs/PLAYBOOK_Codage_DigiSante.md` (correspond au prompt **P4.2 — notifications**).
> Stack : PWA **Next.js 14** (réception) + **Fastify** (envoi via Firebase Admin SDK).

---

## 1. Objet & périmètre

Implémenter un canal de notifications push fiable et **multilingue** :
- côté **backend** : envoi via `firebase-admin` (API **HTTP v1**, la seule supportée),
- côté **frontend PWA** : permission, récupération du token FCM, réception premier
  plan + arrière-plan,
- **stockage** des tokens en base (multi-appareils) avec nettoyage des tokens morts,
- branchement aux **déclencheurs métier** (rappels, valeur critique labo, paiements),
- respect **APDP** (consentement loggé) et cohabitation avec le service worker offline.

Ne pas créer de logique de notification en double : centraliser dans le module
`notifications` de l'API.

## 2. Prérequis (déjà obtenus hors-code)

Les comptes et clés sont décrits dans `docs/COMPTES_ET_CLES.md`. À ce stade, ces
variables existent (sinon, le code doit fonctionner en **mode stub** sans planter) :

**Backend — `apps/api/.env`**
```
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY        # chaîne avec \n littéraux, entre guillemets doubles
```

**Frontend — `apps/web/.env.local`** (préfixe NEXT_PUBLIC_, lus dans le navigateur)
```
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
NEXT_PUBLIC_FIREBASE_VAPID_KEY     # = "Web Push certificate" de la console
```

## 3. Contraintes techniques (non négociables)

- **API HTTP v1 uniquement** (legacy FCM dépréciée) → utiliser `firebase-admin`, jamais
  l'ancienne API à clé serveur.
- **SDK web modulaire** `firebase` v11 (imports `firebase/app`, `firebase/messaging`).
- **Pas de Firebase Hosting** (hébergement sur VPS Infomaniak).
- **HTTPS obligatoire** pour le web push (OK en prod via Nginx + Certbot ; `localhost`
  toléré en dev).
- `FIREBASE_PRIVATE_KEY` : toujours appliquer `.replace(/\\n/g, '\n')` avant usage.
- **Mode dégradé** : si les variables Firebase sont absentes, l'app démarre quand même
  (les fonctions d'envoi loggent un warning et ne lèvent pas d'erreur bloquante).

---

## 4. Tâches d'implémentation

### T1 — Plugin Firebase (backend)
```bash
pnpm --filter @digisante/api add firebase-admin
```
- Ajouter au schéma de validation d'env (zod) : `FIREBASE_PROJECT_ID`,
  `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` en **optionnels**.
- Créer `apps/api/src/plugins/firebase.ts` :

```ts
import fp from 'fastify-plugin';
import admin from 'firebase-admin';
import { env } from '@/lib/env.js';

export default fp(async (app) => {
  const ready = env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY;
  if (ready && !admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey: env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
      }),
    });
  }
  app.decorate('fcm', admin.apps.length ? admin.messaging() : null);
  if (!ready) app.log.warn('FCM désactivé : variables Firebase absentes (mode stub).');
});
```

### T2 — Modèle Prisma `DeviceToken`
Ajouter au schéma puis migrer :
```prisma
model DeviceToken {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  token     String   @unique
  platform  Platform @default(WEB)   // enum existant ou à ajouter : WEB, ANDROID, IOS
  createdAt DateTime @default(now())
  lastSeenAt DateTime @default(now())

  @@index([userId])
}
```
```bash
pnpm --filter @digisante/api prisma migrate dev -n device_token
```

### T3 — Module `notifications` (API)
Endpoints (protégés par JWT) :
- `POST /api/v1/notifications/token` → body `{ token, platform }` : upsert (par token),
  rattaché à l'utilisateur courant, met à jour `lastSeenAt`.
- `DELETE /api/v1/notifications/token` → body `{ token }` : suppression (déconnexion /
  retrait du consentement).

Service d'envoi — **dans la langue de l'utilisateur**, avec nettoyage des tokens morts :
```ts
export async function sendToUser(app, userId, key, vars = {}, data = {}) {
  if (!app.fcm) return; // mode stub
  const user = await app.prisma.user.findUnique({
    where: { id: userId }, include: { deviceTokens: true },
  });
  if (!user) return;
  const { title, body } = renderI18n(key, user.language, vars); // FR/FON/YO/BAATONUM/DENDI
  for (const dt of user.deviceTokens) {
    try {
      await app.fcm.send({
        token: dt.token,
        notification: { title, body },
        data,                                  // ex. { type: 'LAB_CRITICAL', id: '...' }
        webpush: { fcmOptions: { link: data.link ?? 'https://digisante.bj' } },
      });
    } catch (e: any) {
      if (e?.errorInfo?.code === 'messaging/registration-token-not-registered') {
        await app.prisma.deviceToken.delete({ where: { token: dt.token } }).catch(() => {});
      } else { app.log.error({ e }, 'FCM send failed'); }
    }
  }
}
```
- Journaliser l'activation/désactivation des notifications dans l'**audit** (APDP).

### T4 — Frontend PWA (réception)
```bash
pnpm --filter @digisante/web add firebase
```
- `apps/web/src/lib/firebase.ts` : init `initializeApp(config)` + `getMessaging` gardé
  par `isSupported()`.
- Fonction `enablePush()` appelée **après connexion** (jamais au 1er chargement brutal) :
```ts
import { getToken, onMessage } from 'firebase/messaging';

export async function enablePush(jwt: string) {
  const messaging = await getMessagingIfSupported();
  if (!messaging) return;
  if ((await Notification.requestPermission()) !== 'granted') return;

  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  const token = await getToken(messaging, {
    vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
    serviceWorkerRegistration: registration,
  });

  await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/notifications/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ token, platform: 'web' }),
  });

  onMessage(messaging, (payload) => {/* toast in-app dans la langue de l'UI */});
}
```
- Brancher un **toggle « Notifications »** dans l'écran Profil & paramètres (**D-12**) :
  activer → `enablePush()` ; désactiver → `DELETE /notifications/token`.

### T5 — Service worker FCM + cohabitation offline
- Créer `apps/web/public/firebase-messaging-sw.js` :
```js
importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-messaging-compat.js');
firebase.initializeApp({ /* mêmes valeurs publiques que le frontend */ });
firebase.messaging().onBackgroundMessage(({ notification }) => {
  self.registration.showNotification(notification.title, {
    body: notification.body, icon: '/icon-192.png',
  });
});
```
- **Cohabitation** avec le SW offline-first existant : conserver **deux SW séparés**
  (scopes distincts). Si `next-pwa` génère son propre SW, alors **fusionner** en
  important la logique Firebase via `importScripts(...)` dans le SW principal et passer
  ce `serviceWorkerRegistration` à `getToken`. Documenter le choix retenu.

### T6 — Brancher les déclencheurs métier
Appeler `sendToUser(...)` aux bons endroits (clés i18n dédiées) :
- **Rappels de traitement** (module reminders) → `notif.reminder`.
- **Valeur critique labo** (module laboratory) → `notif.labCritical` (prioritaire,
  type `LAB_CRITICAL`, doublé d'un SMS Twilio).
- **Paiement / wallet** (module payments) → `notif.paymentReceived`.
- **RDV** (confirmation, rappel) → `notif.appointment`.

### T7 — Tests (Vitest)
- upsert/suppression de token (T3),
- envoi : sélection de la langue de l'utilisateur, multi-appareils,
- nettoyage d'un token `not-registered` (mock de `app.fcm.send` qui rejette),
- mode stub : `app.fcm === null` → `sendToUser` ne lève pas.

---

## 5. Critères d'acceptation

- [ ] `pnpm build` + `pnpm typecheck` OK sur web et api.
- [ ] Sans variables Firebase, l'API démarre et logge « FCM désactivé ».
- [ ] Avec variables, un token web s'enregistre via `POST /notifications/token`.
- [ ] Un message test (console Firebase → Messaging) est reçu onglet ouvert (`onMessage`)
      et onglet fermé (service worker).
- [ ] Un résultat labo critique déclenche un push **dans la langue du médecin**.
- [ ] Un token invalide est supprimé automatiquement.
- [ ] Activation/désactivation loggée dans l'audit.
- [ ] Les deux service workers (FCM + offline) cohabitent sans conflit.

## 6. Sécurité & APDP

- Ne **jamais** committer le JSON de compte de service ni `.env` (déjà dans `.gitignore`).
- Le consentement aux notifications fait partie des préférences utilisateur ; tracer
  l'opt-in / opt-out (Loi N°2017-20).
- Si une clé privée a été exposée, la **révoquer** (console → Comptes de service →
  supprimer la clé → en générer une nouvelle).
- Distinguer projets `digisante-dev` et `digisante-prod` (tokens séparés).

---

## 7. Prompt prêt à coller dans Claude Code

```
Lis CLAUDE.md, docs/PLAYBOOK_Codage_DigiSante.md et docs/GUIDE_Firebase_FCM.md.
Implémente l'intégration Firebase Cloud Messaging décrite dans ce guide : plugin
firebase-admin (HTTP v1, mode stub si variables absentes), modèle Prisma DeviceToken
+ migration, endpoints POST/DELETE /api/v1/notifications/token, service sendToUser
multilingue avec nettoyage des tokens morts et journalisation d'audit, réception
frontend (lib/firebase.ts, enablePush, onMessage), service worker
firebase-messaging-sw.js avec cohabitation du SW offline, toggle Notifications dans
l'écran Profil (D-12), branchement aux déclencheurs (rappels, valeur critique labo,
paiements) et tests Vitest. Respecte les critères d'acceptation du guide.
Commit : "feat: notifications push FCM (multilingue, multi-appareils)".
```
