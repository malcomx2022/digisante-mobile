# Recette FedaPay SANDBOX — webhook et parcours financiers (B4, zone gelée §5)

> **L10, 8 octobre 2026 :** suivre d’abord `CONTRAT_Preproduction_L10.md` §3 pour les gardes obligatoires (NODE_ENV=production, préproduction isolée, SHA exact, DB *_preprod, index Redis et un seul fournisseur). Les commandes courtes ci-dessous ne suffisent plus seules. Setup smoke indépendant sans FLUSHDB/seed/migration ; aucune réception réelle attestée dans cette livraison. Résultats à référencer dans `preproduction/L10/evidence.json`.

> **Date** : 22 septembre 2026 · **Prérequis humains** : compte FedaPay **sandbox validé**,
> `secretKey` (`sk_sandbox_…`), `publicKey`, `webhookSecret` saisis ensemble dans
> `/admin/integrations` (carte **FEDAPAY**), URL **HTTPS** de recette joignable par FedaPay
> (`https://<domaine-recette>/api/v1/payments/webhook`), `RECONCILE_TOKEN` posé.
> **Règle** : un paiement n'est « réussi » que s'il passe **PENDING → COMPLETED par webhook,
> sans double crédit**. Aucune case B4 n'est cochée sans preuve observée.

## 1. Constat historique — double crédit concurrent corrigé le 22 septembre

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
| S7 | Rejeu du webhook | dashboard FedaPay → renvoyer l'événement de S1 (plusieurs fois, rapprochés) | réponse `idempotent: true` ; **aucun crédit supplémentaire** — **à observer réellement sur la candidate courante** | •••• | | | ☐ |

Critère de sortie B4 FedaPay sandbox : **S1, S2, S3, S5, S6, S7 OK** + patch §1 appliqué et revu.
Ensuite seulement : prompt 11 (bascule live, quatre yeux).

## Addendum L6 — abonnements médecin (7 octobre 2026)

Catalogue explicitement approuvé FREE + PRO 5 000 XOF/mois calendaire, renouvellement manuel. Implémentation réelle en code : SubscriptionOrder/Payment/période, webhook et réconciliation partagent activation + audit transactionnels, wallet débité atomiquement. POST SUBSCRIPTION générique fermé ; configuration absente refusée pour les abonnements. Retour navigateur non probant, abandon puis paiement tardif tracé sans droit ; remboursement interne révoque le droit, retour opérateur manuel. Lire `CONTRAT_Abonnements_L6.md`, `RECETTE_Abonnements_L6.md`, LOT_L6 et REVUE_L6 pour les contrats/preuves.

Re-tests §5 simulés et wallet/E2E synthétiques ne cochent aucune case sandbox réellement réglée. Retry ×5 côté fournisseur, aucune DLQ applicative. Recette fournisseur A5/A6/A9/A13/A14 et frais/rapprochement réels restent L10/L7. Suppression des corps d’erreur bruts et durcissements du jeton reconcile/URL des autres paiements restent L8 ; la liste d’autorités checkout L6 ne clôture pas tout ce résiduel.

## Addendum L7 — journal comptable et suivi manuel

Lire `CONTRAT_Finances_L7.md`, `RECETTE_Finances_L7.md`, LOT_L7 et sa revue §3.5. Les confirmations/restitutions/audits et écritures consultation sont transactionnels ; revenu médecin exclut topups/transferts et abonnements plateforme. REFUNDED interne ne prouve jamais le retour opérateur : demande REFUND créée avec référence fournisseur, prise en charge EXECUTING, preuve externe vérifiée et clôture déclarée distinctes. PAYOUT réserve/alloue le net avant exécution humaine ; pas d’appel externe automatique et pas de reprise d’une exécution incertaine. CSV/receipt non fiscaux approuvés. Historiques non prouvés en anomalies, aucune date/commission créée à partir de updatedAt. Les recettes fournisseur réelles et pièces restent L10/F1–F8 ; DLQ inexistante, X6 et autres résiduels L8 non clos.

## Addendum B1/B2 — 13 octobre 2026 (revue indépendante)

Trois relevés bloquants (S8–S10) complètent S1 et S7 ; sans eux, B1/B2 restent ouverts. Preuves non sensibles uniquement : hôte, forme des champs, types — jamais de jeton, de numéro ou de corps complet publiés.

| # | Relevé | Méthode | Attendu / décision | Constaté | OK |
|---|---|---|---|---|---|
| S8 | Hôte exact de `token.url` en bac à sable (B1) | **avant S1** : sonde `SMOKE_FEDAPAY_S8=1` (§ « S8 — mode opératoire » ci-dessous) — une transaction bac à sable de 100 XOF jamais payée, seuls l’**hôte** et la forme du chemin sont affichés ; puis S1 pour la redirection effective | verdict `HOTE_AUTORISE` (`sandbox-process.fedapay.com` ou `sandbox-checkout.fedapay.com`) puis redirection effective en S1. Tout autre code = FAIL (S1 répondrait 502) : **ne pas élargir** ; consigner l’hôte, revue §5 puis ajout de l’hôte exact seulement | | ☐ |
| S9 | Forme réelle d’une livraison webhook (B2) | journal de livraison du tableau de bord FedaPay pour `transaction.approved`, puis `transaction.declined`/`canceled` (le corps n’est jamais journalisé côté API) | transaction dans `entity` (objet), `entity.id` = id FedaPay stocké, `entity.status` textuel ; noter la présence/le type d’un `id` racine et de `name`. Réponse 200 `processed` puis `idempotent` au rejeu ; un `customer.*` → 200 `ignored` | | ☐ |
| S10 | Transaction refusée puis approuvée (B2) | refuser un paiement test puis réessayer sur le même lien si FedaPay le permet | consigner si le même `entity.id` passe `declined` → `approved` : FAILED/CANCELLED étant terminaux ici, une approbation tardive est ignorée — arbitrage porteur requis avant GO | | ☐ |

Le live (`process.fedapay.com`) n’est attesté que par des fixtures simulées des SDK : confirmer l’hôte au premier paiement réel encadré (prompt 11) ou par écrit auprès du support FedaPay.

## S8 — mode opératoire (hôte du lien de paiement, B1)

**Pourquoi une sonde.** Pendant S1, l’API ne transmet le lien que si son hôte figure dans la liste blanche
(`FEDAPAY_CHECKOUT_HOSTS`, contrôle `isFedapayCheckoutUrl` lié à l’environnement de la clé). Sinon elle répond
**502 sans afficher l’hôte** : S1 seul ne peut pas dire *quel* hôte FedaPay a renvoyé. La sonde S8 révèle cet
hôte **avant** S1, sans toucher à la logique de paiement (§5 : `createTransaction` et la liste blanche restent
inchangés).

**Ce que fait la sonde** (`scripts/preproduction/fedapay-s8.mjs`, lancée par `apps/api/src/services/fedapay-s8.smoke.test.ts`) :
- refuse **avant tout réseau** une clé live, inconnue ou incomplète, une intégration désactivée, et toute exécution
  hors des gardes L10 (`NODE_ENV=production`, préproduction déclarée, SHA exact, base `*_preprod`, index Redis, un
  seul opt-in) ; recontrôle la clé avant chaque appel ;
- crée **une** transaction bac à sable de **100 XOF** (`merchant_reference` = `ds-recette-s8-<horodatage>-<4 hex>`,
  aucune donnée de client), demande son lien (`POST /transactions/{id}/token`), puis s’arrête : deux requêtes vers
  `https://sandbox-api.fedapay.com/v1` uniquement, sans redirection, 15 s au plus chacune ;
- juge le lien avec le **contrôle de production** et n’affiche que l’hôte (une étiquette de plus de 24 caractères,
  où un jeton pourrait se loger, réduite à sa forme), la forme du chemin (longueur et classes de caractères), le
  nombre de paramètres de requête, les codes HTTP, la forme de la réponse de création (enveloppe `v1/transaction`
  ou objet plat) et ses noms de champs, l’hôte d’un éventuel `payment_url` et l’identifiant masqué
  (4 derniers caractères) ;
- relève **sans les afficher** : chemin égal à `/<jeton>`, jeton JWT dont `sub` désigne la transaction, durée de
  validité arrondie en heures (24 h attendues) ;
- convertit toute panne de transport en code `CREATION_RESEAU` / `TOKEN_RESEAU` (nom d’erreur seul, jamais son
  message, qui peut recopier des en-têtes) ; la référence de recette est affichée **avant** tout appel réseau.

**Ce qu’elle ne fait jamais** : payer, ouvrir le lien, écrire un `Payment` ou une ligne d’audit locale, appeler
l’API live, afficher le lien complet, le jeton, la clé ou l’identifiant entier.

### Pré-requis
- Candidate qualifiée déployée sur la préproduction isolée (`CONTRAT_Preproduction_L10.md` §3), SHA complet connu.
- Intégration **FEDAPAY** saisie et activée dans `/admin/integrations` : `secretKey` `sk_sandbox_…`,
  `publicKey` `pk_sandbox_…`, `webhookSecret`.
- Préflight `SMOKE_FEDAPAY=1` (§4) vert **juste avant**, sur le même SHA.
- Opérateur nommé, accès au tableau de bord **sandbox** FedaPay pour retrouver la transaction de recette.

### Commande (sur la cible, une seule exécution suffit)
```bash
cd /var/www/digisante-preprod/apps/api
# Même mode que le préflight : secrets lus depuis le .env privé, métadonnées publiques ci-dessous.
NODE_ENV=production SMOKE_ENVIRONMENT=preproduction \
SMOKE_EXPECTED_SHA=<SHA_COMPLET_QUALIFIE> SMOKE_DATABASE_NAME=digisante_preprod \
SMOKE_REDIS_DB=5 SMOKE_FEDAPAY_S8=1 \
node --env-file=.env node_modules/vitest/vitest.mjs run --config vitest.smoke.config.ts
```
`SMOKE_FEDAPAY_S8=1` est **exclusif** : retirer `SMOKE_FEDAPAY` et tout autre opt-in hérité (la garde refuse deux
fournisseurs dans la même commande). Ne pas relancer en boucle : chaque exécution crée une transaction de plus.

### Lecture du résultat
Exemple de sortie conforme (valeurs synthétiques) :
```text
[s8:fedapay] verdict=PASS · code=HOTE_AUTORISE · référence=ds-recette-s8-20261013090000-ab12 · transaction=••••8301
[s8:fedapay] création HTTP 201 (forme : racine ; champs : amount,…,id,reference,status) · lien HTTP 200 (champs : token,url)
[s8:fedapay] lien https://sandbox-process.fedapay.com chemin /<160 car. a-z,A-Z,0-9,autres> · identifiants=non · paramètres de requête=0 · fragment=non
[s8:fedapay] chemin = /<jeton> : oui · jeton JWT : oui (sub = transaction : oui, validité ≈ 24 h)
[s8:fedapay] décision : PASS : hôte autorisé pour la clé bac à sable. Poursuivre S1 (redirection effective dans le navigateur) ; consigner l’hôte observé.
```
Le test échoue (code de sortie ≠ 0) pour tout verdict autre que `PASS`. Décision par code :

| Code | Décision |
|---|---|
| `HOTE_AUTORISE` | PASS : hôte autorisé pour la clé bac à sable. Poursuivre S1 (redirection effective dans le navigateur) ; consigner l’hôte observé. |
| `HOTE_LIVE` | FAIL : une clé bac à sable renvoie un hôte LIVE. Arrêter la recette FedaPay, ne rien élargir, signaler au porteur et à FedaPay. |
| `HOTE_NON_LISTE` | FAIL : hôte absent de la liste blanche (S1 répondrait 502). Ne pas élargir ; consigner l’hôte exact, revue §5 puis ajout de CET hôte seul, avec tests. |
| `FORME_REFUSEE` | FAIL : hôte listé mais lien refusé par le contrôle de production (schéma, port, identifiants ou caractères). Consigner la forme, revue §5 avant toute modification. |
| `URL_INVALIDE` | FAIL : réponse sans lien exploitable. Consigner les champs reçus et les codes HTTP ; ne pas poursuivre S1. |
| `CREATION_HTTP` | FAIL : création de transaction refusée par l’API bac à sable. Vérifier la clé, le compte sandbox et le montant ; aucun lien obtenu. |
| `CREATION_RESEAU` | FAIL : création sans réponse exploitable (délai ou réseau). Rechercher la référence dans le tableau de bord sandbox AVANT toute relance ; une transaction a pu être créée. |
| `ID_INVALIDE` | FAIL : transaction créée sans identifiant valide. Consigner les champs de la réponse ; aucun lien demandé. |
| `TOKEN_HTTP` | FAIL : génération du lien refusée par l’API bac à sable. Consigner le code HTTP et l’identifiant masqué. |
| `TOKEN_RESEAU` | FAIL : demande de lien sans réponse exploitable (délai ou réseau). La transaction existe : la retrouver par sa référence, consigner l’identifiant masqué, relancer une seule fois. |

Un FAIL `HOTE_NON_LISTE` ou `FORME_REFUSEE` **bloque S1, S2, S6 et S7** (ils passent par le lien) : aucun
élargissement par joker ou suffixe. Correctif éventuel = PR dédiée (§5) ajoutant l’hôte **exact** constaté à
`FEDAPAY_CHECKOUT_HOSTS.sandbox`, tests du contrôle et re-tests webhooks, nouvelle qualification, puis S8 rejoué.

### Après la sonde
1. **S1** : lancer la recharge ; la page FedaPay doit s’ouvrir sur **le même hôte** que celui relevé par la sonde
   (barre d’adresse : ne noter que l’hôte). C’est la preuve de « redirection effective ».
2. **Transaction de recette** : la retrouver dans le tableau de bord sandbox (https://sandbox.fedapay.com,
   « Collectes ») par sa `merchant_reference` ; **ne pas la payer** (aucun `Payment` local ne lui correspond). La
   supprimer tant qu’elle est en attente (« Supprimer ») ou la laisser expirer : une collecte en attente expire
   d’elle-même après 24 h (doc FedaPay « Gestion des collectes »).
3. **Webhook** : la création émet `transaction.created` vers l’URL de webhook bac à sable déclarée. Le récepteur
   répond **200 `ignored` (« paiement inconnu »)**, sans effet ni audit de paiement ; une expiration ultérieure
   donne 200 « statut non géré ». Dans « Évènements »/« Logs » du tableau de bord, consigner l’événement reçu et la
   réponse 200 ; un **401** signale un secret webhook désynchronisé (corriger avant S1).
4. **Décision porteur** : l’hôte observé éclaire le maintien ou non de l’autre hôte bac à sable de la liste ; aucun
   retrait automatique. L’hôte **live** reste à confirmer au premier paiement réel encadré (prompt 11).

### Preuve à consigner
- **Note privée** (hors dépôt) : date et heure UTC, SHA de la candidate, opérateur, référence `ds-recette-s8-…`,
  transaction masquée, lignes `[s8:fedapay]` complètes, réponse du webhook `transaction.created`, hôte vu en S1,
  suppression ou expiration de la transaction de recette.
- **Registre** `docs/preproduction/L10/evidence.json` : enregistrement `caseId: "FEDAPAY-S8"`, `result` `PASS` ou
  `FAIL`, SHA et empreinte de l’instantané courants, `evidenceRef` = référence opaque de la note privée.
- **Jamais** : lien complet, jeton, capture de la barre d’adresse entière, clé, identifiant complet de transaction.

