# Guide d'implémentation — Resend (email transactionnel)

> **Destiné à Claude Code.** À lire avec `CLAUDE.md` et `docs/PLAYBOOK_Codage_DigiSante.md`
> (prompt **P4.2 — notifications**). Stack : backend **Fastify**.

---

## 1. Objet & périmètre
Envoyer les emails transactionnels **multilingues** : reçus de paiement, confirmations de
RDV, export de dossier (lien), notifications administratives. L'email est un canal
**secondaire** (push + SMS d'abord, selon la criticité) car de nombreux utilisateurs n'ont
pas d'adresse email.

## 2. Prérequis (`apps/api/.env`)
```
RESEND_API_KEY        # re_…
RESEND_FROM           # ex. "DigiSanté <no-reply@digisante.bj>"
```
- **Domaine vérifié** requis dans Resend (enregistrements DNS **SPF / DKIM / DMARC**) avant
  d'envoyer depuis `@digisante.bj`. En dev, l'expéditeur de test `onboarding@resend.dev` est utilisable.

## 3. Contraintes techniques
- SDK officiel **`resend`** (Node) : `new Resend(apiKey)` puis `resend.emails.send(...)`.
- Le champ `from` doit utiliser le **domaine vérifié**.
- Email **optionnel** par utilisateur : n'envoyer que si une adresse existe.
- **Mode stub** : sans `RESEND_API_KEY`, l'API démarre ; les emails sont loggés (dev).

---

## 4. Tâches d'implémentation

### T1 — Plugin Resend
```bash
pnpm --filter @digisante/api add resend
```
- `apps/api/src/plugins/resend.ts` : instancier `new Resend(RESEND_API_KEY)` si présent,
  décorer `app.resend` (sinon `null`).

### T2 — Service d'envoi (multilingue)
```ts
export async function sendEmail(app, { to, lang, templateKey, vars }) {
  if (!to) return;                                  // pas d'email -> on saute
  const { subject, html } = renderEmail(templateKey, lang, vars); // i18n
  if (!app.resend) { app.log.warn(`[stub] EMAIL ${templateKey} -> ${to}`); return; }
  const { error } = await app.resend.emails.send({
    from: process.env.RESEND_FROM, to, subject, html,
  });
  if (error) app.log.error({ error }, 'Resend send failed');
}
```
- Gabarits par langue (FR/FON/YO/BAATONUM/DENDI) dans les fichiers i18n ou des composants
  **React Email** (le SDK accepte `react:` à la place de `html:`).

### T3 — Brancher aux événements (module notifications)
- `payment.approved` → reçu de paiement.
- `appointment.confirmed` → confirmation de RDV.
- `dmp.export` → lien d'export du dossier (portabilité APDP).
- Centraliser dans `notifications` : un événement choisit ses canaux (push / SMS / email)
  selon la criticité et les coordonnées disponibles.

### T4 — Tests (Vitest)
- `sendEmail` n'appelle pas Resend si `to` est vide,
- `from` = `RESEND_FROM`,
- sujet/HTML rendus dans la bonne langue,
- mode stub (pas de clé → pas d'erreur).

---

## 5. Critères d'acceptation
- [ ] Email reçu depuis le domaine vérifié (pas en spam) en production.
- [ ] Contenu dans la **langue de l'utilisateur**.
- [ ] Aucun envoi si l'utilisateur n'a pas d'email.
- [ ] Sans clé, l'API démarre en mode stub (emails loggés).

## 6. Sécurité & délivrabilité
- `RESEND_API_KEY` jamais exposée au frontend.
- Configurer **SPF, DKIM, DMARC** pour la délivrabilité et éviter l'usurpation.
- Ne pas inclure de données médicales sensibles dans le corps de l'email ; privilégier un
  **lien sécurisé** vers l'app (APDP).

## 7. Prompt prêt à coller
```
Lis CLAUDE.md, docs/PLAYBOOK_Codage_DigiSante.md et docs/GUIDE_Resend_Email.md.
Implémente l'intégration Resend : plugin (mode stub si clé absente), service sendEmail
multilingue (saute si pas d'email), gabarits par langue, branchement aux événements
(reçu de paiement, confirmation de RDV, export DMP) dans le module notifications, et tests.
N'inclure aucune donnée médicale sensible dans le corps des emails (lien sécurisé).
Commit : "feat: emails transactionnels Resend".
```
