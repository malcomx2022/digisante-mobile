# Revue complète vers le GO préproduction puis production — 22 octobre 2026

Branche `claude/youthful-allen-0yb5p7`, base `main` `14c3b82`. **Le code de `main` est identique à celui du candidat `ace0c689`** (`git diff ace0c689..14c3b82` ne touche que `docs/`) : les résultats ci-dessous valent pour le code déployé en préproduction.

Cette fiche est une **revue et un plan**, pas une preuve de recette. Elle n'écrit rien dans le registre L10 (`docs/preproduction/L10/evidence.json`), ni dans `docs/suivi/LOT_L10.md` ou `docs/suivi/PLAN_GO_Preprod_ace0c689.md` : ces fichiers sont tenus par la session parallèle qui inscrit les preuves opérateur (branche `claude/inspiring-shannon-6c26ex`, PR #227 ouverte pour FEDAPAY-S2 au moment de cette revue).

## 1. Tests rejoués (CI complète, en local)

Environnement : PostgreSQL 16 et Redis 7 locaux, bases neuves, `NODE_ENV=test`, Node 22 (la CI utilise Node 24 et fait foi pour le moteur), Chromium préinstallé pour Playwright. Mêmes étapes que `.github/workflows/ci.yml`.

| Étape | Résultat |
|---|---|
| `pnpm install --frozen-lockfile`, `prisma generate`, `migrate deploy` | OK, 34 migrations appliquées |
| `pnpm lint`, `pnpm typecheck` | OK |
| `pnpm test:scripts` (outillage L9/L10/infra) | **207 réussis, 1 ignoré, 0 échec** sur 208 |
| Contrôles techniques : i18n EN complet, `validation:check`, `validation:campaign:check`, `preprod:check`, plan DOCX, `bash -n` des scripts, dossier L9 DOCX | OK (100 cas L10, source `d6bfcba2…` ; snapshot L9 `3e061d52…` inchangé) |
| `pnpm test` — **unitaires + intégration** | **API 718/718** (94 fichiers), **web 155/155** (19 fichiers) |
| `pnpm build` (proxy E2E, URL d'API relative) | OK |
| `pnpm test:e2e` — **fonctionnels Playwright** | **39/39** |
| `metrics:check` | 16 compteurs / 30 mentions conformes |

Notes :
- Les compteurs documentaires (696 API + 144 web, 36 E2E) sont une **mesure statique des déclarations** ; l'exécution compte 718 + 155 + 39 (tests paramétrés et ajouts post-L10). Aucun écart à corriger.
- Premier passage de `test:scripts` : 3 échecs (`deploy-order.test.mjs`) dus à l'absence de la commande `ss` (paquet iproute2) sur le poste ; verts après installation. Les tests de déploiement dépendent de cet outil de l'hôte : à mentionner dans les prérequis locaux, sans effet en CI.

### Gates déclaratifs

| Gate | Résultat | Lecture |
|---|---|---|
| `preprod:gate --expected-sha ace0c689…` | code 1, **89 points ouverts** (88 après fusion de #227) | 11 cas inscrits : I1, I3–I9, RESEND-R6, FEDAPAY-S8, FEDAPAY-S1 |
| `validation:gate` (L9) | code 1, **15 points ouverts** | FON/YOR 866/1 098 (232 manquantes dont 6 `sos.*`), phrasier natif absent, 7 contreseings cliniques absents |

## 2. Revue du code du candidat (`ec6b0dc → ace0c689`)

Diff relu intégralement (≈ 400 lignes hors tests : correctifs post-recette C1–C7, I1, I2). Zone §5 : seul le calcul de `callback_url` change (`lib/payment-return.ts`, navigation seule, aucun effet sur HMAC/CAS/crédit wallet) ; un message d'erreur de `proofSchema` (règle inchangée). Aucun défaut bloquant.

| # | Constat | Gravité | Action proposée |
|---|---|---|---|
| R1 | `PUT /admin/integrations/:provider` : écriture, relecture (`verifyIntegrationWrite`) et audit `INTEGRATION_UPDATE` n'étaient pas dans une transaction. Si la relecture échouait (ou si l'audit échouait), le secret **restait modifié sans audit**. Deux PUT concurrents : le premier recevait un 500 sans audit alors que sa valeur avait été écrite puis écrasée. Même défaut sur `PATCH` (`INTEGRATION_TOGGLE`). | Moyenne (traçabilité §3.6 ④) | **Corrigé dans le lot post-recette (§7)**, non fusionnable avant la fin de la recette `ace0c689`. |
| R2 | Cause racine d'I2 identifiée dans le diff : le client utilisait `put` (file hors ligne possible) au lieu de `putNow`. La relecture serveur ajoutée est une détection, la correction réelle est `putNow`. | Info | Rien ; conserver les deux. |
| R3 | Liste admin `GET /admin/finance/payments` : expose `fedapayId` (identifiant opaque fournisseur) au scope `finance:read`, sans identité payeur ni donnée de santé. | Conforme | — |
| R4 | Campagne `EMAIL` : audience restreinte aux comptes ACTIFS avec e-mail, aperçu cohérent avec le fan-out. | Conforme | — |

Balayages d'invariants (CLAUDE.md §8) : 0 `window.confirm`, 0 `min-h-screen` imbriqué, 0 `text-[Npx]`, 0 `card-pagne` cliquable sans `pagne-focus`, 0 fausse horloge, 0 booléen statique `isXxxConfigured`, `/wallet/pay` absent, `enable_recording` jamais envoyé, ports 3000/3001 seulement dans les gardes. CSP : `unsafe-inline` (résiduel X8) toujours présent — arbitrage avant GO production.

## 3. Ce qui reste pour le GO préproduction (candidat `ace0c689`)

Source : `docs/suivi/PLAN_GO_Preprod_ace0c689.md` (tenu par la session parallèle). État : 11 PASS / 100, S2 en cours.

1. **Recettes rejouables immédiatement (≈ 45)** : FedaPay S3–S7, S9, S10 ; Twilio T1, T3–T6, T8–T10 ; Firebase Android F1–F8 ; Resend R1–R5 ; abonnements A2, A4, A5, A7, A9, A10, A12, A14.
2. **Modes opératoires à écrire puis exécuter (28)** : **Daily D1–D21 jamais PASS** (deux appareils + tiers, D19–D21 = bloquant B5 latence/démarrages simultanés), abonnements A1, A3, A6, A13, A16, finance F6–F7.
3. **Décisions du porteur en attente** : D-1 (voix Bénin), D-2 (T11 N/A), D-3 (wallet médecin A8), D-4/D-11 (iOS, Moov), D-5 (finance LIVE geste par geste), D-6 (ligne REQUESTED 6 560 XOF), D-7 (second admin finance), D-8 (conservation), D-9 (I2), D-10 (approbation tardive S10), D-12 (F9). D-13 et D-14 closes.
4. **Cas structurellement ouverts (13)** : I2, T2, T12, F1–F8 iPhone, A11 (échéance 21/11/2026), A15 → uniquement par décision référencée au PV, jamais PASS.
5. **PV GO/NO-GO préproduction** signé ; maintenance Nginx levée seulement après.

Plafond réaliste : ≈ 85 PASS + T11 N/A + décisions référencées pour le reste.

## 4. Ce qui reste pour le GO production

Indépendamment du GO préproduction (L11, `docs/suivi/LOT_L11.md`, tout « NON ATTESTÉ ») :

| Bloc | Restant | Propriétaire |
|---|---|---|
| **L9 humain** | Traductions FON/YOR natives (232 clés, **6 `sos.*` critiques**), phrasier natif (27 phrases), 7 contreseings cliniques sur le snapshot `3e061d52…` ; **rendu posologie** (fractions, unités, horaires/durées supposés) à corriger puis contresigner | Relecteurs natifs, professionnel de santé, porteur |
| **Hôte partagé (I2)** | Arbitrage des résiduels de `infra/deploy/README.md` : fuseau, zones Nginx, capacité 4 Go, trafic Nginx vers un port squatté (détecté seulement, §11) ; rôle PG d'exécution non propriétaire (§9) et **isolement Valkey par utilisateur ACL + préfixe (§10)** préparés dans ce lot, bascules de la préprod à exécuter (fichier ACL Valkey à déclarer par l'administrateur de l'hôte) | Porteur ; administrateur de l'hôte et opérateur pour les bascules |
| **Exploitation** | Provisioning prod (`provision-ionos.sh --apply` production, jamais exécuté), B3/B4 installés côté prod, `ALERT_CMD` d'alerte vers une adresse d'exploitation (D-13), première sauvegarde prod + **restauration indépendante base ET fichiers**, répétition de rollback | Opérateur |
| **Sécurité** | Pentest externe + re-tests, arbitrage X8 (`unsafe-inline`), Twilio Geo Permissions, hôtes FedaPay **live** jamais observés (B1 reste ouvert en live), HSTS prod après renouvellement vérifié | Prestataire, porteur |
| **Paiements live** | Bascule clé `sk_live_` + secret webhook live, recette S1/S8 en live à montant plafonné, rapprochement des issues incertaines | Porteur (§5) |
| **Recette 7 rôles** | Appareils et réseaux réels (2G/coupures), FR/EN/FON/YOR | Porteur, opérateur |
| **Décision** | PV GO/NO-GO production signé, périmètre (Android seul ? MTN seul ?) | Porteur |
| **Correctifs différés** | R1, A8 (wallet médecin) et D-10 (approbation tardive) : **préparés dans ce lot post-recette (§7–§8)**, à fusionner en **un** candidat après le PV préproduction, requalifié puis re-recetté sur les cas concernés | Développement |

## 5. Défis, compte tenu du travail parallèle

1. **Gel du code pendant la recette.** Toute fusion touchant `apps/`, `packages/`, `infra/`, `scripts/` ou un fichier de l'instantané L10/L9 crée un nouveau candidat et **périme les preuves déjà inscrites** sur `ace0c689`. Pendant que la session parallèle inscrit les cas, ne fusionner que de la documentation hors instantané ; regrouper les correctifs (R1, A8, D-10…) dans un candidat unique après la recette.
2. **Fichiers partagés.** `evidence.json`, `LOT_L10.md` et `PLAN_GO_Preprod_ace0c689.md` sont modifiés lot par lot par l'autre session : une seule session doit y écrire (celle-ci n'y touche pas). Fusions séquentielles, une PR par lot, gate rejoué sur copie à chaque fois.
3. **SHA de `main` ≠ SHA déployé.** Chaque PR documentaire crée un nouveau SHA `main` ; le candidat reste `ace0c689` tant que le code ne change pas. Avant un déploiement production depuis la tête de `main`, requalifier ce SHA exact (`preprod:qualify`) et vérifier que l'instantané L10 est inchangé.
4. **Recettes à dépendances humaines** : Daily (deux appareils + tiers, OTP sur le terminal du porteur), Moov/iOS (matériel absent), finance LIVE (feu vert par geste) — chemin critique hors code.
5. **L9 n'avance pas avec la recette L10** : les relecteurs sont identifiés depuis le 14/10 mais aucun retour n'est intégré ; le GO pilote patients réels en dépend directement (écran SOS en français pour un locuteur FON/YOR).
6. **Hôte partagé** : une décision production (Valkey dédié/ACL, rôle PG non propriétaire) peut imposer du code et donc un nouveau candidat ; à trancher **avant** la recette production pour ne pas la refaire.

## 6. Ordre recommandé

1. Terminer la recette préproduction sur `ace0c689` (§3), décisions D-1 à D-12 en parallèle, sans fusion de code.
2. PV GO/NO-GO préproduction.
3. Candidat post-recette unique : R1, rôle PG non propriétaire de l'audit, préfixe/ACL Valkey si décidé, A8/D-10 si décidés ; requalification + re-recette ciblée.
4. L9 : intégration des retours natifs/cliniques et correction posologie (même candidat ou suivant, nouveau dossier à contresigner).
5. Provisioning et recette production, restauration indépendante, pentest, PV GO production.

## 7. Lot post-recette — correctif R1 (préparé le 22/10/2026, NON fusionnable pendant la recette)

**Statut : implémenté et testé localement sur la branche de cette PR ; à ne fusionner qu'après le PV GO/NO-GO préproduction de `ace0c689`.** La fusion crée un nouveau candidat applicatif : requalification CI du SHA `main` obtenu, redéploiement préproduction sous maintenance, puis rejeu ciblé des cas concernés (au minimum la saisie/rotation d'une intégration depuis `/admin/integrations` et son audit). L'instantané L10 (`d6bfcba2…`) et le snapshot L9 (`3e061d52…`) ne changent pas : aucun fichier de recette ou clinique n'est touché.

Correction (`apps/api/src/lib/integrations.ts`, `apps/api/src/modules/admin/integrations.routes.ts`) :
- `setIntegration` fait upsert, **relecture dans la transaction** et audit (`writeAuditWithin`, verrou consultatif de la chaîne) dans **une seule transaction** ; tout échec annule l'écriture. Le cache Redis n'est invalidé qu'après le commit.
- Le verrou de ligne de l'upsert sérialise deux enregistrements concurrents : chacun relit sa propre valeur et reçoit son audit (avant : 500 sans audit pour le premier).
- `PATCH` passe par `toggleIntegration` (mise à jour conditionnelle + audit dans la même transaction) ; un provider sans ligne reste un 400, sans écriture ni audit.
- La relecture `verifyIntegrationWrite` (I2) devient interne (`assertStoredSecrets`) et lit la ligne dans la transaction ; message d'erreur : « rien n'a été modifié ».
- Aucun changement de la logique de paiement (§5) : FedaPay reste géré par la même route, seule l'atomicité de l'enregistrement de ses clés change.

Preuves locales :
- 4 tests d'intégration ajoutés/remplacés dans `integrations.routes.test.ts` : relecture en échec (valeur précédente conservée, pas d'audit, aucune valeur citée), audit en échec (nouvelle valeur non conservée), deux PUT concurrents (deux 200, deux audits), PATCH avec audit en échec (état inchangé). Les échecs sont simulés **dans la transaction réelle** (client transactionnel en proxy).
- **Rouges sur l'ancien code** (4 échecs, 17 réussites), verts sur le nouveau (21/21).
- `pnpm lint`, `pnpm typecheck` verts ; suite API complète **721/721** (94 fichiers) ; `preprod:check`, `validation:check` inchangés ; `metrics:check` mis à jour (699 API déclarés, 843 au total).

Limite : un échec de l'invalidation Redis **après** le commit laisse l'ancien descripteur en cache au plus 300 s (résiduel déjà documenté au §8 de CLAUDE.md) ; l'écriture et son audit, eux, sont acquis.

## 8. Lot post-recette — A8 et D-10 (préparés le 22/10/2026, NON fusionnables pendant la recette)

Décisions du porteur prises dans cette session le 22/10/2026 : **D-3/A8 → retirer le portefeuille de l'abonnement PRO** ; **D-10 → signaler l'approbation tardive, sans effet**. Elles sont à reporter dans `docs/suivi/PLAN_GO_Preprod_ace0c689.md` (§6) par la session qui tient ce plan ; cette branche n'y écrit pas.

### A8 — portefeuille retiré de l'abonnement médecin

Constat : `/pro/stats` proposait « Wallet », mais un médecin n'a pas de portefeuille (aucun créé à l'inscription, aucune recharge dans l'espace PRO) ; le choix échouait toujours et seule la branche « insuffisant » était prouvable.
- API : `subscriptions.subscribe` refuse `method: WALLET` en **400 avant toute écriture** (ni paiement, ni commande, ni débit, ni appel fournisseur) ; la branche de débit wallet est retirée. Le remboursement d'éventuels paiements historiques par wallet reste traité par `refundWithin` (inchangé).
- Web : `SUBSCRIPTION_METHODS` (`lib/subscriptions.ts`, testé) remplace `PAYMENT_METHODS` dans `/pro/stats`.
- Tests : les fichiers qui rendaient un médecin PRO par wallet utilisent une fixture « période confirmée par le fournisseur » — `apps/api/src/test/pro-fixture.ts` (passe par `activateWithin`, comme un webhook signé) et `e2e/pro-fixture.ts`. Les tests de restitution wallet d'abonnement deviennent : refus A8 avec solde suffisant, échec de révocation au remboursement (tout annulé), remboursements concurrents (un seul). Le renouvellement contigu reste couvert par l'API (`renouvellement manuel`) ; l'e2e vérifie l'absence de l'option et l'arrêt à échéance.
- Contrat L6 §3 et recette A8 mis à jour.

### D-10 — approbation FedaPay tardive (zone §5, revue + re-tests webhooks)

Constat : un `approved` reçu pour un paiement déjà FAILED/CANCELLED était ignoré en silence alors que le payeur a pu être débité.
- `applyPaymentStatus` : statut **inchangé**, aucun crédit/activation/capture ; `flagLateApproval` écrit l'audit `PAYMENT_LATE_APPROVAL` **une seule fois par paiement** (`writeAuditOnceWithin`, recherche sous le verrou de la chaîne d'audit) et journalise l'identifiant seul. Couvre aussi l'approbation qui perd la course face à un échec concurrent. COMPLETED/REFUNDED rejoués : inchangés.
- `finance.anomalies` liste ces paiements pour un remboursement opérateur **manuel** (aucun transfert automatique).
- HMAC, CAS `status ∉ terminaux`, crédit de recharge, capture L7 et activation L6 inchangés. Réponse webhook 200 (`idempotent`), donc pas de rejeu FedaPay infini.
- Recette S10 mise à jour avec le comportement attendu.

### Preuves locales du lot (R1 + A8 + D-10)

- Tests D-10 (`payments.test.ts`) : refus puis approbation (×5, dont 4 simultanées) → FAILED, solde inchangé, 0 `PAYMENT_CONFIRMED`, 1 `PAYMENT_LATE_APPROVAL`, présent dans les anomalies ; annulation puis approbation → aucune écriture financière ; échec ∥ approbation → une seule issue ; confirmé rejoué jamais signalé. **3 rouges sur l'ancien code**, le 4ᵉ est une non-régression.
- Re-tests webhooks §5 : suites `payments*`, `subscriptions*`, `finance*`, `wallet` complètes (HMAC valide/invalide, rejeux concurrents, réconciliation, remboursements).
- Instantané L10 régénéré : source `397411aa…` (seules les recettes A8 et S10 changent ; `d6bfcba2…` reste celle de `ace0c689`). Le registre `evidence.json` du candidat en cours n'est pas touché : après fusion, le nouveau candidat aura son propre registre et la recette se rejouera sur les cas concernés (au moins A8, S10, A5/A10, F1–F4, saisie d'intégration).
- Compteurs : 701 API + 145 web déclarés (846).

## 9. Lot post-recette — rôle PostgreSQL d'exécution non propriétaire (préparé le 22/10/2026, NON fusionnable pendant la recette)

Résiduel 5 de `infra/deploy/README.md`. Décision du porteur dans cette session : l'URL du rôle propriétaire reste **hors disque** et n'est fournie qu'au déploiement.

Constat : un seul rôle par environnement (propriétaire de la base, migrateur et identité de l'API). Un propriétaire peut `ALTER TABLE audit_logs DISABLE TRIGGER USER` puis modifier ou vider le registre d'audit et le registre financier : une injection SQL ou une prise de contrôle de l'API suffisait.

Correction :
- **Deux rôles** : `<base>` propriétaire (migrations + droits) et `<base>_app` exécution (NOINHERIT, aucun privilège ni appartenance). `provision-ionos.sh` crée le second (`PG_RUNTIME_PASSWORD` distinct, vérificateur SCRAM local, `CONNECT`), sonde `pg_hba` pour les deux, et `--verify` contrôle droits et `.env`.
- **Droits** (`deploy.sh`, bloc `runtime-grants.sql`, après chaque migration, sous le propriétaire, en une transaction) : DML sur toutes les tables et séquences et droits par défaut identiques ; `audit_logs`/`finance_entries` en INSERT/SELECT ; `_prisma_migrations` fermé ; pas de CREATE. Le contrôle final annule tout et laisse l'API arrêtée en cas d'écart.
- **`deploy.sh`** : `MIGRATION_DATABASE_URL` lu par l'environnement puis retiré de l'environnement exporté. Il est refusé s'il est absent, mal ciblé, a le même mot de passe que l'API ou figure dans le `.env`. Le `.env` doit viser `<base>_app`. `bash -x` est refusé, et PM2 ne voit jamais le secret.
- **Workflows** : `scripts/deploy/ssh-deploy.sh` remplace `appleboy/ssh-action`, dont les `envs` sont recopiés dans la commande distante, lisible par tous les comptes de l'hôte partagé. Le secret passe par l'entrée standard SSH et la clé d'hôte n'est acceptée que si son empreinte égale `VPS_FINGERPRINT`. Nouveaux secrets : `PREPROD_DB_MIGRATION_URL`, `DB_MIGRATION_URL`.
- `verify_deploy.sh` contrôle le rôle du `.env` ; modèles `.env`, README (procédure de bascule de la préprod existante), secrets, checklist et `CLAUDE.md` mis à jour.

Preuves locales :
- `apps/api/src/lib/runtime-role.test.ts` sur **PostgreSQL réel**, avec le SQL extrait de `deploy.sh` : idempotent ; l'audit s'écrit par `writeAudit` sous le rôle d'exécution ; UPDATE/DELETE/TRUNCATE/`DISABLE TRIGGER` sur les deux registres, lecture des migrations et CREATE TABLE sont **refusés par les droits** ; un rôle privilégié fait échouer le contrôle. 13/13.
- **Suite API complète sous le rôle d'exécution** : 723 tests verts sur 94 fichiers (hors test du rôle, qui exige le propriétaire). Ajoutée en CI (`build-and-test`).
- Tests d'outillage : `deploy-order` 12/12 (rôle par migrate, ordre migrate → droits → PM2, aucune fuite vers PM2, refus d'URL, échec `grants`, `bash -x`) ; `provision-ionos` 43/43 (le test a révélé une fuite, corrigée : `PG_RUNTIME_PASSWORD` restait dans l'environnement de `psql` à la création du rôle propriétaire) ; `ssh-deploy` 4/4 (`ssh-keygen` réel ; secret jamais en argument, empreinte, entrées non sûres, workflows).
- Vérification réelle : `prisma migrate deploy` utilise le `DATABASE_URL` de l'environnement plutôt que celui du `.env` (contrôlé sur PostgreSQL).
- `operations.test.mjs` (L10) : 41/41, fixtures passées aux deux rôles ; `verify_deploy.sh` refuse une API sous le propriétaire ou une URL de migration dans le `.env` (nom attendu dérivé du profil canonique, jamais d'un `DB_NAME` surchargé).
- CI complète en local sur la tête du lot : lint, typecheck, `test:scripts` 217 (1 ignoré), contrôles L9/L10/DOCX, **API 736 + web 156**, étape « suite API sous le rôle d'exécution » 723/723, build, **E2E 39/39**. Instantané L10 régénéré : `d5fbbbd9…`.
- Intermittence observée, sans lien établi avec ce lot : sur un premier passage E2E, `auth-session-race` (« refresh A refusé ») a dépassé 60 s sur `waitForLoadState('networkidle')`, alors que la session B était déjà affichée. Relancé seul : 5/5 en 18 s ; série complète relancée : 39/39. Le test attend un réseau inactif, ce qui le rend fragile sous charge. À surveiller en CI, sans retry ni désactivation.

Limites :
- Pendant un déploiement, l'URL du propriétaire est dans l'environnement des processus du compte applicatif ; l'API est alors arrêtée.
- La bascule de la préproduction existante est une opération humaine (README résiduel 5) : règle `pg_hba` éventuelle à la main, `.env`, secret GitHub.
- Un nouveau registre append-only devra être ajouté au bloc.

## 10. Lot post-recette — isolement Valkey par environnement (préparé le 22/10/2026, NON fusionnable pendant la recette)

Résiduel 2 de `infra/deploy/README.md`. `CLAUDE.md` §2 verrouille un Valkey 6379 partagé avec les index /5 et /6 : la correction reste dans ce cadre. Une instance dédiée aurait été une dérogation à faire valider par le porteur.

Constat : les index séparaient les données, pas l'accès. Chaque `.env` contenait le mot de passe `default` de l'hôte, qui ouvre tous les index (ImmiPro, BeninLink, l'autre environnement) et les commandes `FLUSHALL`, `CONFIG` et `ACL`. Le canal `chat:events` était commun aux deux environnements. Une prise de contrôle de l'API DigiSanté donnait donc la main sur le Valkey de l'hôte.

Correction :
- **API** : `REDIS_KEY_PREFIX` (`digisante-preprod:` / `digisante:`), obligatoire en production (`env.ts`). Une fabrique unique, `lib/redis.ts`, sert la connexion principale, l'abonné pub/sub et le magasin du rate-limit. Elle pose le préfixe sur toutes les clés et désactive `CLIENT SETINFO` et la vérification `INFO`, toutes deux refusées. Le canal est préfixé par `redisChannel()`, car le `keyPrefix` d'ioredis ne s'applique pas aux canaux (constaté sur Redis réel). Le test de l'annuaire purgeait le cache par `KEYS` ; il supprime désormais des clés nommées.
- **Utilisateur ACL par environnement** (`provision-ionos.sh`, bloc `valkey-acl`, source unique). Clés `~<préfixe>*`, canaux `&<préfixe>*`, et une liste positive limitée aux commandes de l'API, scripts Lua de l'OTP et du rate-limit compris. Le compte est créé par `ACL SETUSER` sur l'entrée standard avec l'empreinte `#SHA-256` de `VALKEY_APP_PASSWORD` : ce secret est distinct du mot de passe d'administration et n'est jamais transmis au serveur. La persistance passe par `ACL SAVE`.
- **Gardes avant écriture** : fichier ACL déclaré, sans jamais de `CONFIG REWRITE` du `valkey.conf` partagé. Un utilisateur de même nom hors préfixe est refusé, tout comme `nopass`, un mot de passe faible ou identique à celui d'administration. Sans mot de passe, les règles sont réappliquées en conservant le mot de passe existant.
- **`--verify`** mesure les droits effectifs par `ACL DRYRUN`. 2 commandes doivent passer et 15 être refusées, dont FLUSH\*, KEYS, SCAN, INFO, CONFIG, ACL, CLIENT, SWAPDB, MOVE, les clés et canaux hors préfixe et ceux de l'autre environnement. Il contrôle aussi l'utilisateur et le préfixe du `.env`.
- **`deploy.sh`** refuse un `REDIS_URL` sous un autre utilisateur, `default` compris, un préfixe absent ou différent, ou une valeur héritée divergente. `verify_deploy.sh` contrôle la même chose.
- La CI rejoue toute la suite API sous l'utilisateur ACL et le rôle PostgreSQL d'exécution (`scripts/infra/valkey-acl-user.mjs`). `REDIS_ADMIN_URL` ne sert qu'à la purge initiale.
- Mis à jour : modèles `.env`, README (prérequis, procédure de bascule, résiduel 2), secrets, checklist, contrat L10 et `CLAUDE.md`.

Preuves locales :
- `apps/api/src/lib/valkey-acl.test.ts`, sur **Redis 7.0 réel**, avec les règles extraites de `provision-ionos.sh` (16/16). Passent : les commandes de l'API, les scripts Lua (OTP, rate-limit Fastify) et le pub/sub préfixé, la clé étant réellement préfixée côté serveur. Refusés : FLUSH\*, KEYS, SCAN, INFO, CONFIG, ACL LIST, CLIENT LIST, SWAPDB, DBSIZE, RANDOMKEY, ainsi que les clés et canaux hors préfixe, y compris après `SELECT` d'un autre index. Les sondes `ACL DRYRUN` de `--verify` donnent le même verdict.
- **Suite API complète sous l'utilisateur ACL + préfixe ET le rôle PostgreSQL d'exécution** : 740/740 sur 95 fichiers. Après le passage, `ACL LOG` ne contient aucun refus pour cet utilisateur.
- CI complète en local sur la tête du lot : lint, typecheck, `test:scripts` 221 (1 ignoré), contrôles L9/L10/DOCX, **API 753 + web 156**, étape « suite API sous le rôle d'exécution et l'utilisateur ACL Valkey » 740/740, build, **E2E 39/39**. Instantané L10 régénéré : `4f98d36b…` ; compteurs 710 API + 145 web (`metrics:check`).
- Tests d'outillage : `provision-ionos` 46/46 (+3 : création par stdin et `#SHA-256` sans secret transmis, réapplication et production ; refus avant écriture ; `--verify` par `DRYRUN` et `.env`), `deploy-order` 12/12 (+6 cas refusés), `operations` 42/42 (+1 `verify_deploy`), `environments` 9/9 (préfixe = utilisateur = `SITE`). Syntaxe `ACL SETUSER` par l'entrée standard de `redis-cli` vérifiée sur Redis réel.

Limites :
- L'utilisateur `default` de l'hôte garde l'accès complet ; cela relève de son administrateur, et le provisioning le signale en NOTE.
- La mémoire, l'éviction et la persistance restent communes. `--verify` exige `noeviction` ; seule une instance dédiée séparerait les ressources (décision du porteur).
- Prérequis sur l'hôte, non constatés : Valkey ≥ 7 avec `ACL DRYRUN` (Ubuntu 26.04 : 9.0.x) et un fichier ACL déclaré par l'administrateur.
- Bascule de la préproduction existante (README résiduel 2) : les clés non préfixées deviennent inaccessibles. Les sessions sont à rouvrir et les OTP à redemander ; les anciennes clés expirent seules, jamais de `FLUSHDB`.
- Toute nouvelle commande Redis utilisée par l'API doit être ajoutée au bloc `valkey-acl` dans le même lot. La CI le détecte.


## 11. Lot post-recette — port squatté (préparé le 23/10/2026, NON fusionnable pendant la recette)

Résiduel 1 de `infra/deploy/README.md`. La correction reste dans le cadre : ports 3100/3101/3200/3201 en TCP local. Passer à des sockets Unix changerait les ports documentés, et `next start` ne les prend pas en charge.

Constat : quand un environnement est entièrement arrêté (déploiement, crash en boucle, démarrage de l'hôte), n'importe quel compte local de l'hôte partagé peut écouter sur son port. Il recevait alors :
- le **jeton de service** des tâches cron (`internal_job.sh`, `fedapay_reconcile.sh`) ;
- la **readiness** de `deploy.sh` et de healthwatch, à laquelle il pouvait répondre « ready » et valider ainsi un déploiement échoué ;
- le trafic Nginx.

Correction :
- **Bloc `port_owner`** (`port_owned_by <port> <compte>`), identique dans cinq scripts (test de non-dérive). Un port n'est accepté que si **tous** ses écouteurs appartiennent à l'utilisateur de l'environnement. Le contrôle lit l'uid du socket noté par le noyau (`ss -Htlne`), lisible sans privilège et indépendant d'un pid. `ss` n'affiche pas l'uid 0 : un écouteur root est donc refusé. Constaté sur le système : uid affiché pour un écouteur `nobody`, absent pour root, lisible par un compte non privilégié.
- **Tâches** : sans port tenu par l'API, le jeton n'est jamais envoyé (« ÉCHEC … jeton non envoyé », relevé par la sonde `cron`).
- **`deploy.sh`** : chaque tentative de readiness exige d'abord que les ports API **et** web soient tenus par l'utilisateur. Sinon le déploiement finit en `FAILED` (stade `readiness`, « port squatté ? »).
- **healthwatch** : nouvelle sonde `ports` ; `/ready` n'est pas interrogé sur un port étranger. **`verify_deploy.sh`** : PASS/FAIL par port. Runbook des alertes, checklist, contrat L10, README et `CLAUDE.md` mis à jour.

Preuves locales :
- `root-scripts.test.mjs` (10/10) : non-dérive du bloc ; ordre contrôle → jeton et contrôle → readiness ; `port_owned_by` sur un **écouteur réel** avec le vrai `ss` (écouteur root refusé, autre compte refusé, port libre refusé).
- Le cas « compte courant non privilégié accepté » n'est exécuté qu'en CI (non-root). En local, en root, il a été vérifié à la main avec un écouteur `nobody`.
- `operations.test.mjs` 43/43 (+1). Squat, port libre ou autre uid : aucune requête ni jeton pour les deux tâches. `deploy.sh` en `FAILED` sans readiness. Alerte `ports` et readiness non interrogée. FAIL de `verify_deploy.sh`.
- `deploy-order` 12/12 et `reconcile-alert` 2/2, avec simulation `ss -e`.
- `test:scripts` 224 (1 ignoré), lint, typecheck, contrôles L9/L10/DOCX, `metrics:check`. Instantané L10 régénéré : `0b806239…`.
- Ni l'API ni le web ne sont modifiés ; les suites API/web/E2E de la tête précédente (`baf1fe1`) restent valables.

Limites :
- Nginx ne vérifie pas le propriétaire de l'upstream. Pendant un **déploiement**, la maintenance (obligatoire) ne relaie rien. Pendant un **crash** ou au **démarrage de l'hôte**, un squatteur recevrait le trafic jusqu'à l'alerte `ports` (≤ 5 min), puis jusqu'à l'intervention humaine.
- Course résiduelle entre le contrôle et la connexion si l'API tombe dans l'intervalle ; le port n'est alors repris qu'après la chute.
- La parade complète (sockets Unix dans un répertoire `digisante[-preprod]:www-data 0750`) relève d'une décision du porteur.
