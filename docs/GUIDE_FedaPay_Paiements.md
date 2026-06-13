# Guide d'implémentation — FedaPay (paiements)

> **Destiné à Claude Code.** À lire avec `CLAUDE.md` et `docs/PLAYBOOK_Codage_DigiSante.md`
> (prompt **P4.1 — paiements**). Couvre Mobile Money (MTN MoMo, Moov), cartes, **wallet
> diaspora** et **abonnements professionnels**. Stack : backend **Fastify** + Prisma.

> ⚠️ **Logique gelée** : si une logique de paiement validée existe déjà (marquée `/freeze`),
> ne la modifie pas sans accord explicite. Les paiements manipulent de l'argent réel :
> idempotence et vérification de signature sont obligatoires.

---

## 1. Objet & périmètre
- Encaisser une consultation (Mobile Money / carte) via FedaPay.
- Créditer/débiter le **wallet diaspora** (recharge €, paiement des soins de la famille en FCFA).
- Gérer les **abonnements** professionnels.
- Traiter les **webhooks signés** de façon idempotente, avec retry et réconciliation.
- Appliquer la **commission plateforme 3 %**.

## 2. Prérequis (`apps/api/.env`)
```
FEDAPAY_SECRET_KEY        # clé API secrète (sk_sandbox_… puis sk_live_…)
FEDAPAY_PUBLIC_KEY        # clé publique (pk_…)
FEDAPAY_WEBHOOK_SECRET    # secret du endpoint webhook (wh_…) — DIFFÉRENT de la clé API
FEDAPAY_ENV               # "sandbox" ou "live"
```
> Le secret de webhook se récupère dans **Dashboard → Webhooks → (endpoint) → révéler la clé**.
> Il doit être copié **exactement** : une erreur ici = échec systématique de signature.

## 3. Contraintes techniques
- SDK officiel **`fedapay`** (Node). Initialiser `FedaPay.setApiKey(...)` + `FedaPay.setEnvironment(FEDAPAY_ENV)`.
- Devise : **XOF** (`currency: { iso: 'XOF' }`). Montants en **entiers** (FCFA, sans décimales).
- Webhook : vérifier `Webhook.constructEvent(rawBody, signature, secret)` avec l'en-tête
  **`x-fedapay-signature`**. La route webhook a besoin du **corps brut** (raw body), pas du JSON parsé.
- Webhooks **asynchrones et réessayés** par FedaPay → traitement **idempotent** obligatoire.
- **Mode stub** : sans `FEDAPAY_SECRET_KEY`, l'API démarre ; les fonctions loggent un warning.

---

## 4. Tâches d'implémentation

### T1 — Installation & client
```bash
pnpm --filter @digisante/api add fedapay
```
- Ajouter au schéma d'env zod : les 4 variables ci-dessus (optionnelles).
- `apps/api/src/plugins/fedapay.ts` : initialiser le SDK si les clés existent, décorer
  l'app avec un service `payments` (sinon `null` → stub).

### T2 — Modèles Prisma
S'assurer d'avoir (ou créer) : `Payment` (id, userId, amount, currency, status, provider,
providerRef, type [CONSULTATION|SUBSCRIPTION|WALLET_TOPUP], idempotencyKey unique,
createdAt), `Wallet` (id, ownerId, balanceXof), `WalletTransaction` (walletId, amount,
direction [CREDIT|DEBIT], reason, paymentId), `Subscription` (professionalId, plan,
status, currentPeriodEnd). Migration dédiée.

### T3 — Créer une transaction (encaissement)
```ts
import { FedaPay, Transaction } from 'fedapay';

export async function createConsultationPayment(app, { user, amountXof, consultId }) {
  // 1) créer un Payment local en PENDING avec une idempotencyKey
  const payment = await app.prisma.payment.create({ data: {
    userId: user.id, amount: amountXof, currency: 'XOF',
    status: 'PENDING', provider: 'FEDAPAY', type: 'CONSULTATION',
    idempotencyKey: `consult_${consultId}`,
  }});

  // 2) créer la transaction FedaPay
  const tx = await Transaction.create({
    description: `Consultation ${consultId}`,
    amount: amountXof,
    currency: { iso: 'XOF' },
    callback_url: `${process.env.PUBLIC_WEB_URL}/paiement/retour`,
    customer: {
      firstname: user.firstName, lastname: user.lastName,
      email: user.email ?? undefined,
      phone_number: { number: user.phone, country: 'bj' },
    },
  });

  // 3) générer le token/lien de paiement (mobile money / carte)
  const { url } = await tx.generateToken();
  await app.prisma.payment.update({ where: { id: payment.id }, data: { providerRef: String(tx.id) }});
  return { paymentUrl: url, paymentId: payment.id };
}
```

### T4 — Webhook signé (idempotent)
- Route **dédiée** `POST /api/v1/payments/webhook` configurée pour recevoir le **raw body**
  (désactiver le parsing JSON sur cette route uniquement, p. ex. `addContentTypeParser`).
```ts
import { Webhook } from 'fedapay';

app.post('/api/v1/payments/webhook', async (req, reply) => {
  const sig = req.headers['x-fedapay-signature'];
  let event;
  try {
    event = Webhook.constructEvent(req.rawBody, sig, process.env.FEDAPAY_WEBHOOK_SECRET);
  } catch (e) { return reply.code(400).send('signature invalide'); }

  // idempotence : ignorer un event déjà traité (table ProcessedWebhook)
  switch (event.name) {
    case 'transaction.approved': /* marquer Payment PAID + créditer wallet/consult */ break;
    case 'transaction.canceled':
    case 'transaction.declined': /* marquer Payment FAILED */ break;
  }
  return reply.code(200).send();
});
```
- En cas de webhook approved : appliquer la **commission 3 %**, créditer le bénéficiaire
  (médecin) ou le wallet, journaliser dans l'audit (`PAYMENT_APPROVED`).

### T5 — Wallet diaspora & abonnements
- Recharge wallet = un `Payment` de type `WALLET_TOPUP` → à l'approbation, `WalletTransaction`
  CREDIT. Paiement d'une consultation depuis le wallet = `DEBIT` (vérifier le solde, transaction
  atomique Prisma `$transaction`).
- Abonnement pro = `Payment` type `SUBSCRIPTION` → met à jour `Subscription.currentPeriodEnd`.

### T6 — Réconciliation
- Cron quotidien : pour chaque `Payment` PENDING de plus de N minutes, interroger l'API
  FedaPay (statut réel) et réconcilier. Idempotent.

### T7 — Tests (Vitest)
- signature valide / invalide,
- idempotence (même event reçu 2× → un seul effet),
- débit wallet refusé si solde insuffisant,
- mode stub (pas de clés → pas d'erreur).

---

## 5. Critères d'acceptation
- [ ] Création d'une transaction → URL de paiement renvoyée.
- [ ] Webhook avec signature invalide rejeté (400).
- [ ] `transaction.approved` → Payment PAID, commission appliquée, audit écrit.
- [ ] Re-livraison du même webhook → aucun double effet.
- [ ] Recharge puis paiement wallet cohérents (solde exact).
- [ ] Sans clés, l'API démarre en mode stub.

## 6. Sécurité
- Ne jamais exposer `FEDAPAY_SECRET_KEY` côté frontend (seule `FEDAPAY_PUBLIC_KEY` est publique).
- Restreindre la route webhook au raw body + vérification de signature ; éventuellement
  filtrer par IP FedaPay.
- HTTPS + TLS 1.2/1.3 (OK via Nginx).
- Tout montant et statut viennent **du webhook signé**, jamais du `callback_url` (manipulable).

## 7. Prompt prêt à coller
```
Lis CLAUDE.md, docs/PLAYBOOK_Codage_DigiSante.md et docs/GUIDE_FedaPay_Paiements.md.
Implémente le module payments décrit : client fedapay (mode stub si clés absentes),
modèles Prisma Payment/Wallet/WalletTransaction/Subscription, création de transaction,
webhook signé idempotent (raw body, x-fedapay-signature) avec commission 3 % et audit,
wallet diaspora (recharge/débit atomique), abonnements, cron de réconciliation, tests.
NE modifie aucune logique de paiement déjà gelée sans me prévenir.
Commit : "feat(api): FedaPay, wallet diaspora, abonnements".
```
