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

## 2. Prérequis — clés (⚠️ mis à jour août 2026, lot 8)

Trois secrets, gérables **soit** en base chiffrée via `/admin/integrations` (la base prime),
**soit** en `.env` (fallback) — cf. `CLAUDE.md` §3.6 :

```
FEDAPAY_SECRET_KEY        # clé API secrète (sk_sandbox_… puis sk_live_…)
FEDAPAY_PUBLIC_KEY        # clé publique (pk_…)
FEDAPAY_WEBHOOK_SECRET    # secret du endpoint webhook (wh_…) — DIFFÉRENT de la clé API
```

> **Il n'y a PAS de variable `FEDAPAY_ENV`, et il ne doit pas y en avoir.** L'environnement est
> **déduit de la clé** (`sk_live_…` → production, tout le reste → bac à sable). Les clés FedaPay
> étant auto-descriptives, dériver rend structurellement impossible la pire erreur d'exploitation
> du domaine : pointer une clé de test vers la production, ou l'inverse. Un réglage séparé aurait
> pu diverger de la clé ; ici il ne peut pas. Repli **sandbox** sur préfixe inconnu (fail-safe).
>
> **Passer en production = remplacer la clé, rien d'autre.** Aucune ligne de configuration à
> changer en parallèle, aucun redéploiement de code.

| Environnement | Base d'API utilisée |
|---|---|
| clé `sk_live_…` | `https://api.fedapay.com/v1` |
| toute autre clé | `https://sandbox-api.fedapay.com/v1` |

> Le secret de webhook se récupère dans **Dashboard → Webhooks → (endpoint) → révéler la clé**.
> Il doit être copié **exactement** : une erreur ici = échec systématique de signature.
> ⚠️ Le secret webhook du bac à sable (`wh_sandbox_…`) et celui de production sont **différents** :
> les roter **ensemble** avec la clé API, sinon les webhooks sont rejetés en 401.

## 3. Contraintes techniques (état réel de l'implémentation)
- **Pas de SDK** : `apps/api/src/services/fedapay.ts` appelle l'API HTTP v1 en `fetch` natif
  (0 dépendance ajoutée). Le SDK officiel `fedapay-node` reste la **référence de spécification**
  (c'est de lui qu'est tirée la vérification de signature ci-dessous).
- Devise : **XOF** (`currency: { iso: 'XOF' }`). Montants en **entiers** (FCFA, sans décimales).
- Encaissement en deux appels : `POST /transactions` puis `POST /transactions/{id}/token`
  → `{ token, url }`. C'est `url` qu'on renvoie au client, **et vers laquelle il faut REDIRIGER**.
- La transaction porte `callback_url` (retour du payeur), `merchant_reference` et `customer`
  (préremplit la page hébergée — sans lui, le payeur ressaisit son numéro et la conversion chute).
  ⚠️ **Aucune donnée de santé** dans ces champs (§4).
- Webhooks **asynchrones et réessayés** par FedaPay → traitement **idempotent** obligatoire.
- **Mode stub** : sans clé secrète résolue, l'API démarre ; les fonctions loggent un warning.

### 3.1 Signature de webhook — le format EXACT (⚠️ corrigé au lot 8)

L'en-tête **`x-fedapay-signature`** n'est **pas** un HMAC nu du corps. Il est composite et
horodaté, calqué sur Stripe :

```
x-fedapay-signature: t=<unix_seconds>,s=<hmac_sha256_hex>
```

- la signature porte sur **`` `${timestamp}.${rawBody}` ``**, PAS sur le corps seul ;
- algorithme **HMAC-SHA256**, sortie **hexadécimale**, comparaison à **temps constant** ;
- schéma attendu = **`s`** (et non `v1` — le commentaire du SDK dit `v1`, la constante
  `WebhookSignature.EXPECTED_SCHEME` vaut bien `'s'` ; **le code fait foi**) ;
- **tolérance 300 s** : un horodatage plus ancien est refusé (anti-rejeu). Un horodatage *futur*
  est accepté, pour ne pas perdre de paiements sur une horloge serveur légèrement en retard ;
- plusieurs `s=` peuvent coexister (rotation de secret) : il suffit qu'**une** corresponde.

> 🔴 **Défaut corrigé au lot 8** : l'implémentation précédente comparait `HMAC(rawBody)` à
> l'en-tête ENTIER. **Aucun webhook réel n'aurait jamais été accepté** — tous rejetés en 401,
> donc aucun paiement Mobile Money jamais confirmé en production. Les tests ne le voyaient pas
> parce qu'ils fabriquaient la signature avec la même formule erronée que le code vérifiait.
> Un test de non-régression refuse désormais explicitement l'ancien format, et le helper
> `buildWebhookSignatureHeader` (à côté de la vérification) empêche un test de réinventer la
> formule. Référence : `fedapay-node`, `src/Webhook.ts`.

La route webhook a besoin du **corps brut** (raw body), pas du JSON parsé — c'est le rôle du
`addContentTypeParser` encapsulé dans `payments.routes.ts`.

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

## Addendum L6 — abonnements médecin (7 octobre 2026)

Catalogue explicitement approuvé FREE + PRO 5 000 XOF/mois calendaire, renouvellement manuel. Implémentation réelle en code : SubscriptionOrder/Payment/période, webhook et réconciliation partagent activation + audit transactionnels, wallet débité atomiquement. POST SUBSCRIPTION générique fermé ; configuration absente refusée pour les abonnements. Retour navigateur non probant, abandon puis paiement tardif tracé sans droit ; remboursement interne révoque le droit, retour opérateur manuel. Lire `CONTRAT_Abonnements_L6.md`, `RECETTE_Abonnements_L6.md`, LOT_L6 et REVUE_L6 pour les contrats/preuves.

Re-tests §5 simulés et wallet/E2E synthétiques ne cochent aucune case sandbox réellement réglée. Retry ×5 côté fournisseur, aucune DLQ applicative. Recette fournisseur A5/A6/A9/A13/A14 et frais/rapprochement réels restent L10/L7. Suppression des corps d’erreur bruts et durcissements du jeton reconcile/URL des autres paiements restent L8 ; la liste d’autorités checkout L6 ne clôture pas tout ce résiduel.

## Addendum L7 — journal comptable et suivi manuel

Lire `CONTRAT_Finances_L7.md`, `RECETTE_Finances_L7.md`, LOT_L7 et sa revue §3.5. Les confirmations/restitutions/audits et écritures consultation sont transactionnels ; revenu médecin exclut topups/transferts et abonnements plateforme. REFUNDED interne ne prouve jamais le retour opérateur : demande REFUND créée avec référence fournisseur, prise en charge EXECUTING, preuve externe vérifiée et clôture déclarée distinctes. PAYOUT réserve/alloue le net avant exécution humaine ; pas d’appel externe automatique et pas de reprise d’une exécution incertaine. CSV/receipt non fiscaux approuvés. Historiques non prouvés en anomalies, aucune date/commission créée à partir de updatedAt. Les recettes fournisseur réelles et pièces restent L10/F1–F8 ; DLQ inexistante, X6 et autres résiduels L8 non clos.
