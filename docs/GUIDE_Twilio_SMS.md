# Guide d'implémentation — Twilio (SMS, OTP, SOS)

> **Destiné à Claude Code.** À lire avec `CLAUDE.md` et `docs/PLAYBOOK_Codage_DigiSante.md`
> (prompts **P2.2 — auth OTP** et **P4.2 — notifications**). Stack : backend **Fastify**.

---

## 1. Objet & périmètre
Deux usages distincts :
1. **OTP de connexion** (et OTP **vocal**) → via **Twilio Verify** (gère génération,
   expiration, rate-limit, livraison SMS/voix). Utilisé par le module `auth`.
2. **Messages applicatifs** dont le **contenu est rédigé par nous, dans la langue de
   l'utilisateur** (rappels, alertes labo, **SOS**) → via l'**API Messaging** (`messages.create`).

> Pourquoi deux mécanismes : Verify est idéal pour l'OTP (sécurité clé en main) mais ne
> permet pas un texte libre multilingue ; le SOS et les alertes en **Fɔ̀ngbè/Yorùbá/…**
> nécessitent l'API Messaging avec notre propre texte traduit.

## 2. Prérequis (`apps/api/.env`)
```
TWILIO_ACCOUNT_SID          # AC…
TWILIO_AUTH_TOKEN
TWILIO_VERIFY_SERVICE_SID   # VA… (service Verify créé dans la console)
TWILIO_FROM_NUMBER          # numéro expéditeur (E.164) pour l'API Messaging
```
Numéros toujours en **format E.164** (ex. `+22996xxxxxx`).

## 3. Contraintes techniques
- SDK officiel **`twilio`** (Node).
- **Verify** : `client.verify.v2.services(SID).verifications.create({ to, channel })` puis
  `…​.verificationChecks.create({ to, code })`. Canaux : `sms`, `call` (voix).
- **Messaging** : `client.messages.create({ to, from, body })`.
- **Compte d'essai** : ne peut envoyer qu'à des numéros **vérifiés** ; passer en compte
  payant pour la production. Tester l'envoi vers le Bénin (+229).
- **OTP vocal Fɔ̀ngbè** : Verify lit le code via une voix dans une langue **supportée par
  Twilio** ; le fɔ̀ngbè n'est pas une locale TTS standard. Option : utiliser le canal `call`
  avec la langue disponible la plus proche, OU implémenter un appel TwiML personnalisé avec
  un fichier audio pré-enregistré en fɔ̀ngbè (amélioration ultérieure). Documenter le choix.
- **Mode stub** : sans clés Twilio, l'API démarre ; OTP et SMS loggés en console (dev).

---

## 4. Tâches d'implémentation

### T1 — Plugin Twilio
```bash
pnpm --filter @digisante/api add twilio
```
- `apps/api/src/plugins/twilio.ts` : instancier `twilio(SID, TOKEN)` si les clés existent,
  décorer `app.twilio` (sinon `null`).

### T2 — OTP via Verify (module auth)
```ts
// envoi
export async function sendOtp(app, phone, channel: 'sms' | 'call' = 'sms') {
  if (!app.twilio) { app.log.warn(`[stub] OTP ${channel} -> ${phone}`); return; }
  await app.twilio.verify.v2.services(process.env.TWILIO_VERIFY_SERVICE_SID)
    .verifications.create({ to: phone, channel });
}
// vérification
export async function checkOtp(app, phone, code): Promise<boolean> {
  if (!app.twilio) return code === '424242'; // code de dev en stub
  const r = await app.twilio.verify.v2.services(process.env.TWILIO_VERIFY_SERVICE_SID)
    .verificationChecks.create({ to: phone, code });
  return r.status === 'approved';
}
```
- Brancher sur les endpoints d'authentification (P2.2) ; conserver le **verrouillage
  30 min après 5 échecs** côté application (journalisé `AUTH_FAIL`).
- L'écran D-02 propose « recevoir par appel vocal » → `channel: 'call'`.

### T3 — SMS applicatifs (Messaging), multilingue
```ts
export async function sendSms(app, to: string, body: string) {
  if (!app.twilio) { app.log.warn(`[stub] SMS -> ${to}: ${body}`); return; }
  await app.twilio.messages.create({ to, from: process.env.TWILIO_FROM_NUMBER, body });
}
```
- Le **texte** provient des fichiers i18n selon la langue de l'utilisateur (jamais en dur).
- Intégrer au module `notifications` à côté de FCM/email (un même événement peut partir en
  push **et** SMS selon la criticité).

### T4 — SOS (priorité absolue, hors-ligne)
- L'endpoint SOS envoie un **SMS au(x) contact(s) d'urgence dans leur langue** + alerte le
  service compétent, avec la **géolocalisation**.
- Le SOS doit rester déclenchable **hors-ligne** côté PWA : si l'API est injoignable, repli
  sur l'app SMS native du téléphone (déjà prévu dans la maquette D-07) ; sinon, l'API relaie
  via Twilio dès reconnexion.
- Journaliser chaque déclenchement (audit `SOS_TRIGGERED`).

### T5 — Tests (Vitest)
- envoi/vérif OTP (mock `verify`),
- `checkOtp` renvoie true seulement si `status === 'approved'`,
- `sendSms` appelle `messages.create` avec le bon `from`,
- mode stub (pas de clés → pas d'erreur, code dev accepté).

---

## 5. Critères d'acceptation
- [ ] OTP SMS reçu et vérifiable ; canal `call` fonctionnel.
- [ ] Verrouillage après 5 échecs, journalisé.
- [ ] SMS applicatifs partent dans la **langue de l'utilisateur**.
- [ ] SOS : SMS au contact d'urgence + géoloc + audit ; repli hors-ligne documenté.
- [ ] Sans clés, l'API démarre en mode stub (codes/dev loggés).

## 6. Sécurité & conformité
- `TWILIO_AUTH_TOKEN` jamais exposé au frontend.
- Ne pas logguer les codes OTP en production.
- Numéros = données personnelles (APDP) : minimiser, sécuriser, tracer les usages SOS.

## 7. Prompt prêt à coller
```
Lis CLAUDE.md, docs/PLAYBOOK_Codage_DigiSante.md et docs/GUIDE_Twilio_SMS.md.
Implémente l'intégration Twilio : plugin (mode stub si clés absentes), OTP via Verify
(canaux sms et call) branché sur l'auth avec verrouillage après 5 échecs, envoi de SMS
applicatifs multilingues via l'API Messaging, flux SOS (SMS contact d'urgence dans sa
langue + géoloc + audit, repli hors-ligne), et tests. Documente le choix pour l'OTP vocal
en fɔ̀ngbè. Commit : "feat: Twilio OTP, SMS multilingues, SOS".
```

## Reprise L8 — réponses OTP et Geo Permissions

Inscription/demande publiques génériques : 201/200 ne prouvent ni existence de compte ni livraison SMS. Numéro inconnu : quota/état de vérification sans SMS payant ; compte existant : profil intact. devCode réservé à NODE_ENV=test ; aucun code/contenu stub en logs dev/prod. Empreinte HMAC, renvoi obligatoire après bascule depuis SHA256 ou rotation JWT_SECRET. Les cinq échecs incluent code absent/expiré. Voir CONTRAT_Securite_L8 pour l’impact support/KYC et le résiduel timings réels.

Geo Permissions SMS ET Voice : preuve console L10, conserver seulement pays attendus (Bénin pour OTP local, diaspora selon besoin validé). Ne pas marquer le réglage effectué sans accès réel ni bloquer arbitrairement tous les numéros diaspora dans le code. Test autorisé coût/quota/livraison/SOS et UX avant GO L11. Le lot local ne contacte pas Twilio.
