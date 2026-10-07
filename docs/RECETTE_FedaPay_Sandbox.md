# Recette FedaPay SANDBOX — webhook et parcours financiers (B4, zone gelée §5)

> **Date** : 22 septembre 2026 · **Prérequis humains** : compte FedaPay **sandbox validé**,
> `secretKey` (`sk_sandbox_…`), `publicKey`, `webhookSecret` saisis ensemble dans
> `/admin/integrations` (carte **FEDAPAY**), URL **HTTPS** de recette joignable par FedaPay
> (`https://<domaine-recette>/api/v1/payments/webhook`), `RECONCILE_TOKEN` posé.
> **Règle** : un paiement n'est « réussi » que s'il passe **PENDING → COMPLETED par webhook,
> sans double crédit**. Aucune case B4 n'est cochée sans preuve observée.

## 1. 🔴 Constat bloquant — double crédit sur livraisons concurrentes (patch EN ATTENTE)

**Reproduit le 22/09/2026, 5 exécutions sur 5** (pile réelle PostgreSQL 16 + Redis) : 5 livraisons
**simultanées** du même webhook signé de recharge ⇒ **4 à 5 crédits** du portefeuille (une recharge
de 10 € créditée jusqu'à 5 fois). Même motif sur le remboursement admin (double reversal).

- **Cause** : `applyPaymentStatus` contrôle l'idempotence sur une **lecture préalable** du statut,
  puis fait un `update` **non conditionnel** et un crédit **hors transaction**. Deux livraisons qui
  lisent `PENDING` en même temps passent toutes deux. Motif identique au débit wallet corrigé par
  l'audit CSO (TOCTOU), resté ouvert ici.
- **Quand ça arrive en réel** : retries FedaPay d'un webhook lent à acquitter, webhook **∥**
  réconciliation de 02:30 sur le même paiement, les 2 workers PM2 recevant chacun une livraison.
- **✅ Correctif APPLIQUÉ le 22/09/2026 sur autorisation explicite du porteur** (§5) : transition
  **conditionnelle** (`updateMany … where status ∉ terminaux` — PostgreSQL ré-évalue la condition
  après le verrou de ligne, une seule livraison gagne) et crédit/reversal **dans la même
  transaction** (`creditWithin` / `refundWithin`) ; test `payments.concurrency.test.ts`.
- **Preuve** : sans le correctif, le test reproduit le défaut (**4 crédits** pour 5 webhooks
  simultanés, **4 reversals** pour 4 remboursements simultanés) ; avec, **1 et 1**, vert **10/10**
  exécutions répétées. Re-tests webhooks §5 verts (378 tests API) : HMAC ✓/✗, ancien format
  refusé, corps falsifié, en-tête malformé, anti-rejeu, rotation de secret, idempotence, crédit
  wallet, remboursement, secret base > `.env`, réconciliation.
- **Reste à faire en bac à sable** : rejouer le contrôle **S7** ci-dessous avec de vraies
  livraisons FedaPay (exige une clé sandbox — chantier B4).

## 2. Autres constats

- **« DLQ » : n'existe pas dans le dépôt.** CLAUDE.md §3.5 cite « HMAC, retry ×5, DLQ,
  réconciliation » : le *retry ×5* est côté **FedaPay** (rejeu d'un webhook non acquitté) ; il n'y a
  **aucune file de lettres mortes** côté API. Le filet réel est la **réconciliation** (cron 02:30,
  `POST /payments/reconcile`, paiements PENDING/PROCESSING > 1 h). Un webhook rejeté (401 : secret désynchronisé)
  n'est rattrapé que par ce cron. Aucune modification faite (zone gelée) ; décision produit à prendre.
- **Préflight sans clé** (22/09) : `source=env · activé=false · clés présentes=aucune` → B4 FedaPay
  entièrement ouvert, comme attendu.

## 3. Re-tests automatisés (exécutés le 22/09/2026 — sans clé réelle)

| Contrôle | Test | Résultat |
|---|---|---|
| HMAC valide / invalide / secret ou en-tête manquant / en-tête malformé / corps falsifié | `fedapay.test.ts` | ✓ |
| Ancien schéma (HMAC nu du corps) refusé | `fedapay.test.ts` | ✓ |
| Anti-rejeu (horodatage > 300 s refusé), horloge en retard tolérée, rotation (2 signatures) | `fedapay.test.ts` | ✓ |
| Webhook 401 sur signature invalide + idempotence d'un rejeu **séquentiel** | `payments.test.ts` | ✓ |
| Montant de consultation **imposé serveur**, IDOR 403, double paiement 400 | `payments.test.ts` | ✓ |
| Paiement WALLET (débit atomique, solde insuffisant sans orphelin) | `payments.test.ts`, `wallet.test.ts` | ✓ |
| Remboursement idempotent (séquentiel) + reversal recharge | `payments.test.ts` | ✓ |
| Secret webhook en **base** prime sur le `.env` | `payments.test.ts` | ✓ |
| Réconciliation (balayage, jeton de service) | `payments.reconcile.test.ts` | ✓ |
| Livraisons **concurrentes** / remboursements concurrents | patch `payments.concurrency.test.ts` | ✗ sans patch · ✓ avec patch |
| Retry ×5 / DLQ | — | côté FedaPay / **inexistant** (cf. §2) |

## 4. Préflight (opt-in, lecture seule, aucune transaction)

```bash
SMOKE_FEDAPAY=1 pnpm --filter @digisante/api test:smoke -- fedapay
```

Vérifie clés présentes (noms seulement), environnement **sandbox** déduit de la clé (clé live
refusée), URL de webhook HTTPS, clé acceptée par l'API sandbox (`GET /transactions`). Sortie
publiable : `[preflight:fedapay] source=db · activé=true · clés présentes=publicKey,secretKey,webhookSecret`.

## 5. Recette guidée — preuves à collecter (ID masqué, statut, heure, preuve non sensible)

Pour chaque étape : **ID FedaPay masqué** (4 derniers caractères), **statut avant/après**,
**heure**, et une preuve **non sensible** (capture du statut dans `/admin/finance`, ligne d'audit
`PAYMENT_CONFIRMED`/`PAYMENT_REFUND`, **jamais** un numéro de carte/téléphone complet).

| # | Parcours | Étapes | Attendu | ID | Avant → après | Heure | OK |
|---|---|---|---|---|---|---|---|
| S1 | Recharge wallet (diaspora) | `/diaspora/wallet` → recharger 10 € carte test → **redirection** vers la page FedaPay → payer | PENDING → **COMPLETED par webhook** ; solde +6 560 XOF **une fois** ; audit `PAYMENT_CONFIRMED source=webhook` | •••• | | | ☐ |
| S2 | Consultation Mobile Money | patient → RDV confirmé → payer MTN MoMo (numéro de test sandbox) | montant = tarif médecin (serveur) ; COMPLETED par webhook | •••• | | | ☐ |
| S3 | Paiement WALLET | patient avec solde → payer un RDV par portefeuille | COMPLETED **immédiat**, sans transaction FedaPay ; solde débité une fois | — | | | ☐ |
| S4 | Webhook rejeté | temporairement, secret webhook FedaPay ≠ base (ou rejeu manuel altéré) | **401**, audit `AUTH_FAIL source=fedapay_webhook`, statut inchangé | •••• | | | ☐ |
| S5 | Réconciliation manuelle | paiement laissé PENDING ou PROCESSING > 1 h puis `curl -X POST -H "x-service-token: $RECONCILE_TOKEN" https://<recette>/api/v1/payments/reconcile` | statut résolu ; relancer : **aucun** changement (idempotent) | •••• | | | ☐ |
| S6 | Remboursement admin | `/admin/finance` → rembourser S1 (scope `finance:write`) | COMPLETED → REFUNDED ; reversal −6 560 **une fois** ; audit `PAYMENT_REFUND` ; 2ᵉ clic = idempotent | •••• | | | ☐ |
| S7 | Rejeu du webhook | dashboard FedaPay → renvoyer l'événement de S1 (plusieurs fois, rapprochés) | réponse `idempotent: true` ; **aucun crédit supplémentaire** — ⚠️ **à rejouer après application du patch §1** | •••• | | | ☐ |

Critère de sortie B4 FedaPay sandbox : **S1, S2, S3, S5, S6, S7 OK** + patch §1 appliqué et revu.
Ensuite seulement : prompt 11 (bascule live, quatre yeux).

## Addendum L6 — abonnements médecin (7 octobre 2026)

Catalogue explicitement approuvé FREE + PRO 5 000 XOF/mois calendaire, renouvellement manuel. Implémentation réelle en code : SubscriptionOrder/Payment/période, webhook et réconciliation partagent activation + audit transactionnels, wallet débité atomiquement. POST SUBSCRIPTION générique fermé ; configuration absente refusée pour les abonnements. Retour navigateur non probant, abandon puis paiement tardif tracé sans droit ; remboursement interne révoque le droit, retour opérateur manuel. Lire `CONTRAT_Abonnements_L6.md`, `RECETTE_Abonnements_L6.md`, LOT_L6 et REVUE_L6 pour les contrats/preuves.

Re-tests §5 simulés et wallet/E2E synthétiques ne cochent aucune case sandbox réellement réglée. Retry ×5 côté fournisseur, aucune DLQ applicative. Recette fournisseur A5/A6/A9/A13/A14 et frais/rapprochement réels restent L10/L7. Suppression des corps d’erreur bruts et durcissements du jeton reconcile/URL des autres paiements restent L8 ; la liste d’autorités checkout L6 ne clôture pas tout ce résiduel.

## Addendum L7 — journal comptable et suivi manuel

Lire `CONTRAT_Finances_L7.md`, `RECETTE_Finances_L7.md`, LOT_L7 et sa revue §3.5. Les confirmations/restitutions/audits et écritures consultation sont transactionnels ; revenu médecin exclut topups/transferts et abonnements plateforme. REFUNDED interne ne prouve jamais le retour opérateur : demande REFUND créée avec référence fournisseur, prise en charge EXECUTING, preuve externe vérifiée et clôture déclarée distinctes. PAYOUT réserve/alloue le net avant exécution humaine ; pas d’appel externe automatique et pas de reprise d’une exécution incertaine. CSV/receipt non fiscaux approuvés. Historiques non prouvés en anomalies, aucune date/commission créée à partir de updatedAt. Les recettes fournisseur réelles et pièces restent L10/F1–F8 ; DLQ inexistante, X6 et autres résiduels L8 non clos.
