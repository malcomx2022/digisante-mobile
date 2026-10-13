# Revue indépendante des lots L0–L10 (13 octobre 2026)

> Revue demandée par le porteur : « revue complète en prenant en compte le code généré par Codex en parallèle ».
> Base revue : `main` `901c598` (PR #178 → #190 fusionnées, CI main 37767901218 verte). Les fiches `REVUE_Lx` existantes
> sont des **auto-revues** de l’agent auteur ; celle-ci est une relecture **indépendante** (autre agent, autre méthode).
> Elle ne vaut ni recette fournisseur (L10), ni validation clinique/native (L9), ni GO de mise en production.

## 1. Méthode

1. **Mesure de la base** sur pile locale PostgreSQL 16 + Redis (même configuration que la CI) avant toute modification.
2. **Six relectures adversariales en parallèle**, une par domaine, sur le code de `main` (et non seulement les diffs) :
   L1/L2 (DMP, laboratoire) · L3/L4 (rejeu, coffre, service worker) · L5/L0 (téléconsultation, réservation, authentification) ·
   L6/L7 (abonnements, finances, paiements §5) · L8 (OTP, audit, journaux, CSP, FCM, Nginx) · L9/L10 (validation, déploiement, sauvegarde).
   Consigne commune : tracer chaque constat d’un appelant réel jusqu’à la base, écarter ce qui n’est pas démontrable.
3. **Contre-vérification personnelle** de chaque constat retenu (lecture du chemin complet, et documentation officielle Daily / FedaPay pour les contrats fournisseurs).
4. **Correctifs limités** aux défauts confirmés, sûrs et dans le cadre (§3/§5 respectés) ; **chaque correctif porte un test qui échoue sur l’ancien code** (vérifié en remettant l’ancien fichier).
5. Les constats qui touchent la zone gelée §5, une décision produit ou l’exploitation du VPS sont **documentés, non modifiés** (§4 ci-dessous).

## 2. État mesuré de la base `901c598`

| Contrôle | Résultat |
|---|---|
| `pnpm lint` · `pnpm typecheck` | verts |
| Tests unitaires/intégration | **605/605 API**, **121/121 web** |
| `pnpm test:scripts` (L9/L10) | 65/65 |
| E2E Playwright (pile réelle, proxy de production) | **24/24** |
| Dérive `schema.prisma` ↔ 34 migrations (`prisma migrate diff`) | aucune (migration vide) |
| `metrics:check` | 16 compteurs conformes |
| `validation:check`, `preprod:check`, validateurs DOCX | verts |

Le socle livré par Codex est **cohérent, testé et globalement solide** : les invariants majeurs (portée DMP par entrée, verrous
transactionnels, idempotence webhook atomique, coffre AES-GCM/PBKDF2, CSP sans `unsafe-eval`, chaîne d’audit) ont été vérifiés
corrects (§5). Les défauts trouvés sont des **angles morts entre lots** et des **contrats fournisseurs non éprouvés**, pas des
erreurs de conception.

## 3. Corrections appliquées (branche `claude/brave-gates-fapfam`)

| # | Gravité | Lot | Constat | Correctif | Preuve (échoue avant) |
|---|---|---|---|---|---|
| C1 | **Majeur** (§4) | L1 | La relation de soin (`lib/care.ts`) lisait encore `Consent.expiresAt`, que L1 déclare non autoritatif. **Fail-open** : après retrait d’un partage, le médecin gardait jusqu’à 30 j le droit de prescrire, commander une analyse, ouvrir un chat (nom du patient), programmer des SMS. **Fail-closed** : un lien expiré ramenait le parent dans le passé et bloquait un médecin dont une autre entrée était valide. | La branche « consentement » compte un `ConsentRecord` actif (`expiresAt > now`, consentement non révoqué, entrée du patient) — même règle que `resolveDmpScope`. | `dmp.entry-scope.test.ts` « relation de soin… » : `expected true to be false` sur l’ancien code |
| C2 | Majeur (§4, UI) | L1 | `/patient/dmp` affichait « Accès révoqué » pour tout consentement **inactif** et masquait « Révoquer ». Depuis L1 (liens expirés/historiques NULL), le patient se croyait protégé alors que le médecin pouvait réclamer un QR futur. | Libellé et bouton selon `revokedAt` ; inactif non révoqué = « Le partage n’est plus valide » + Révoquer + Ré-autoriser ; `pagne-focus` (WCAG 2.4.7). **Aucune nouvelle clé i18n** (cf. §6). | revue de code (pas de test de rendu dans le dépôt, §8) |
| C3 | **Majeur** | L5 | Une consultation passée en CHAT ne pouvait plus être clôturée : `applyMode` redirigeait vers la messagerie **dès le join**, et « Terminer » n’existe que dans la salle ⇒ médecin renvoyé en boucle, consultation ACTIVE et RDV CONFIRMED indéfiniment. L’e2e passait car la page médecin sans Daily ne sonde pas. | Redirection automatique seulement lors d’une **transition** vécue dans la salle ; au join en CHAT, carte CHAT + barre de contrôle (Terminer). | `private-teleconsultation.spec.ts` : rechargement médecin en CHAT puis clôture — rouge sur l’ancien composant (`toHaveURL` : médecin éjecté) |
| C4 | **Majeur** (contrat fournisseur) | L5 | `roomProperties` envoyait `enable_recording: false` et `inspectRoom` exigeait de relire `false`. La documentation Daily ne l’accepte qu’en **chaîne/liste** (`cloud`, `local`, `raw-tracks`, `cloud-audio-only`) ; l’absence vaut « pas d’enregistrement ». Risque : 400 à la création ou 502 « non conforme » à chaque join ⇒ aucune vidéo réelle. | Propriété retirée ; toute valeur relue autre qu’absente/`false`/`null` ⇒ salle non conforme. | `daily.test.ts` : propriété absente + refus de `cloud`/`local`/`['raw-tracks']` |
| C5 | Mineur → réel | L0 (hérité) | `confirm`/`cancel` d’un RDV : lecture puis `update` non conditionnel. Une confirmation concurrente **ressuscitait un RDV annulé** (jetons Daily émis sur un RDV annulé, chevauchement possible) ; une annulation pouvait écraser COMPLETED et déclencher un remboursement. | `updateMany` gardé (`PENDING` ; `notIn [CANCELLED, COMPLETED]`) + contrôle du compte, comme `end`. | `appointments.concurrency.test.ts` : `expected 'CONFIRMED' to be 'CANCELLED'` (2/2 exécutions) |
| C6 | Mineur → réel | L8 (périmètre KYC) | Deux décisions KYC médecin simultanées : dossier `REJECTED` avec badge `verifiedAt` posé et deux revues contradictoires. | Transition conditionnelle `UNDER_REVIEW → décision` en tête de transaction ; la seconde décision échoue (403) et n’écrit rien. | même fichier : 2 revues au lieu d’1 sur l’ancien code |
| C7 | **Majeur** (usage par défaut) | L3/L4 | Sans coffre (cas par défaut), **tout** ticket `onlineOnly` bloquait les mutations couvertes : le ticket **en vol** d’un accusé de lecture refusait le message chat suivant (« Action précédente à vérifier… ») ; un **refus 4xx définitif** (ex. grossesse déjà suivie) bloquait tout jusqu’à une action manuelle ailleurs ; un `flush` concurrent pouvait vérifier un ticket non commité, obtenir 404 et l’archiver à tort. | Tickets en vol exclus du blocage et du `flush` (id réservé **avant** l’écriture IndexedDB, sans fenêtre) ; 4xx définitif au **premier** envoi ⇒ ticket sans corps retiré (effet et reçu annulés ensemble côté serveur) ; avant une nouvelle saisie couverte, la file existante est vidée en FIFO (un reçu déjà commité débloque seul). | `client.vault.test.ts` : 2 nouveaux tests rouges sur l’ancien code |
| C8 | **Majeur** (doublon) | L4 | Coffre ouvert : après 5xx/réseau/401/coffre verrouillé au premier envoi, l’erreur remontait à l’interface alors que le corps scellé restait en file ⇒ « Renvoyer » (nouvelle clé) **+** rejeu de l’original = **deux effets**. Le risque déclaré fermé dans `REVUE_L4` ne l’était que sans coffre. | Échec non définitif avec corps scellé ⇒ `{ queued: true }` (même clé, rejeu garanti), jamais une invitation à ressaisir. Contrat L4 amendé en conséquence. | `client.sync.test.ts` « 503 avec coffre… aucun doublon » : 3 clés distinctes → 2 attendues |
| C9 | Mineur (sécurité) | L8 | Redirection ouverte du service worker FCM : `/.//evil.example` (ou `/a/..//x`, `/%2e//x`) passait le contrôle brut puis se normalisait en `//evil.example` (relatif au protocole) transmis à `openWindow`/`navigate`. | Refus après parsing si le chemin commence par `//`. | `fcm-worker.test.ts` : 3 cas ajoutés, rouges sur l’ancien SW |
| C10 | Majeur (sauvegarde, hérité) | — | `KYC_STORAGE_DIR=""` (valeur de `.env.example`) : `"" ?? 'storage/kyc'` gardait `""` ⇒ `resolve('')` = **répertoire courant** du processus : pièces KYC/DMP (données de santé) écrites hors du chemin sauvegardé. | Valeur vide/blanche ⇒ défaut `storage/kyc` (`resolveStorageDir`). | `filestore.test.ts` |
| C11 | Majeur (déploiement) | L10 | Le déploiement **production** appelait `ssh-action` sans `fingerprint` : aucune vérification de la clé d’hôte (la préproduction l’imposait déjà). | Garde « accès complets » + `fingerprint: VPS_FINGERPRINT` obligatoire ; README/checklist/SECRETS mis à jour. Le job reste inactif tant que `DEPLOY_ENABLED` n’est pas posé. | revue + YAML validé |
| C12 | Mineur (exploitation) | L10 | La purge L3 (`sync_receipts.log`, 03:10) n’était pas surveillée par `healthwatch.sh`. | Journal ajouté à `JOB_LOGS`. | `bash -n` |

Après correctifs : **612/612 API**, **124/124 web**, 65/65 scripts, lint/typecheck verts, **e2e 24/24** sur build fraîche du code final.

## 4. Constats NON corrigés — à trancher (priorité décroissante)

### 4.1 Bloquants avant toute recette réelle / GO

| # | Domaine | Constat | Pourquoi non corrigé ici | Action proposée |
|---|---|---|---|---|
| B1 | **FedaPay §5** (L8) | La liste blanche du lien de paiement (`checkout` / `sandbox-checkout.fedapay.com`) n’a **aucune preuve** publique. La seule trouvée — fixture de test du SDK officiel `fedapay` (`TransactionTest.ts`) — donne `https://process.fedapay.com/<token>` ; le README de `fedapay-cli` montre un lien court `fpay.li`. Si l’hôte réel diffère, **chaque** paiement opérateur (consultation, recharge, PRO) répond 502 après création de la transaction. | Zone gelée §5 ; le contrat L8 exige une « preuve officielle » pour toute extension. | Recette S1 sandbox : relever `token.url` réel, n’ajouter que les hôtes **exacts** constatés (jamais de joker), re-tests webhooks. |
| B2 | **Webhook FedaPay §5** (hérité, conditionne L6/L7) | `fedapayId = event.fedapayId ?? event.id ?? event.entity?.id` : si FedaPay envoie l’identifiant **d’événement** en `id` racine (usage courant), il est pris à la place de la transaction ; un entier fait lever Prisma (500, retries vains). Confirmations, CAPTURE L7, activation PRO L6 et crédits ne passeraient que par la réconciliation de 02:30 (≤ 26 h). Les tests n’envoient jamais d’`id` racine — même angle mort que l’ancien bug de signature. | §5 + format non publié par FedaPay. | Capturer un payload réel en sandbox ; corriger en `String(entity.id ?? object_id)` validé, jamais `event.id` ; test avec `id` d’événement numérique. Ajouter un try/catch **par paiement** dans la réconciliation (une exception stoppe aujourd’hui tout le lot). |
| B3 | Infra (L10, hérité) | **Escalade vers root** : la crontab root exécute `internal_job.sh`, `healthwatch.sh` (qui lance `node check-backup.mjs`), `pg_dump_encrypted.sh` depuis `APP_DIR`, que `provision.sh` attribue récursivement à `digisante`. Une exécution de code dans l’API devient root en ≤ 2 min (clé de sauvegarde, jeton, `sudo -u postgres`). | Change la topologie de déploiement : décision d’exploitation. | Installer les scripts lancés par root dans un répertoire `root:root 0755` (copie relue par root à chaque déploiement) ; `internal_job` sous un utilisateur sans droits. |
| B4 | Sauvegarde (L10) | `pg_dump_encrypted.sh` lit `KYC_STORAGE_DIR` dans l’**environnement cron**, pas dans le `.env` de l’API : un magasin déplacé (recommandé par `SECRETS_Preproduction_L10`) laisse sauvegarder le répertoire par défaut **vide** ; `files_count=0` est accepté par `check-backup`. (Le cas `""` est corrigé par C10.) | Script d’exploitation + manifeste : à valider avec la recette L11. | Lire la valeur via `parseEnv` du `.env` (comme `deploy.sh`), exiger un chemin absolu, comparer `files_count` au nombre de `Document`/`KycDocument`. |
| B5 | Daily (L5) | Création de la salle `consult-<rdvId>` (nom déterministe) **dans** la transaction : un rollback la laisse orpheline ; le nouvel essai dépend d’un 409 non documenté (Daily renvoie probablement 400) ⇒ 502 permanent pour ce RDV. Les appels réseau (2 × 8 s) se font sous `appointments FOR UPDATE` + `doctors FOR SHARE` ⇒ réservations chez ce médecin en P2028 pendant un démarrage lent. | Refonte du flux `start` ; doit être conçue avec la recette fournisseur. | `SMOKE_DAILY=1` avant recette ; salle créée hors transaction puis insertion conditionnelle, `deleteRoom` en cas d’échec. |

### 4.2 Majeurs / mineurs à arbitrer

- **Déploiement (L10)** : un job de déploiement d’un SHA plus ancien peut passer **après** un plus récent (fin de CI désordonnée) et remettre l’ancien code sur un schéma déjà migré — exiger `merge-base --is-ancestor <déployé> <cible>` sauf rollback explicite ; `DEPLOY_MAINTENANCE_READY` est une variable **permanente**, pas une confirmation par déploiement (préférer un environnement GitHub à relecteur) ; `DEPLOY_ENVIRONMENT=preproduction` non vérifié sur la cible (exiger une base `*_preprod`) ; `adduser --system` ⇒ shell `nologin` incompatible avec `VPS_USER=digisante` documenté ; `appleboy/ssh-action@v1` à épingler par SHA ; `read` du snapshot sans délai (`read -t 60`).
- **OTP / inscription (L8)** : 5 `verify` sur le numéro d’une victime **sans OTP en attente** la verrouillent 30 min, gratuitement et indéfiniment (compteur volontairement indépendant de l’OTP pour l’anti-énumération : arbitrage à faire) ; un conflit d’**e-mail ou de licence** supprime l’envoi du SMS ⇒ oracle d’existence ; énumération du numéro par le **temps** de réponse (Twilio sauté) — déjà ouvert X15.
- **Nginx (L8)** : le bloc `:80` généré par `certbot --nginx` n’hérite pas du format `noquery` — déclarer `log_format`/`access_log` au niveau `http{}`.
- **Client paiement (L8)** : `paymentOutcome` (consultations, recharges) ne réutilise pas `isFedapayCheckoutUrl` (seuls les abonnements le font).
- **Finances (L6/L7)** : appels FedaPay sous `doctors FOR UPDATE` lors d’une commande PRO (réservations patients en P2028 si FedaPay est lent) ; paiement de consultation confirmé **après** annulation médecin ⇒ CAPTURE sans REFUND, absent de `anomalies()` et compté dans le disponible ; `currentPeriodEnd` ignore les trous de période (affiche PRO alors que `requireProWithin` refuse) ; statistiques en REPEATABLE READ avec `FOR SHARE` ⇒ 40001 transitoire ; FK `subscription_orders` en `ON DELETE CASCADE` (contredit « pas de FK destructive » L7 ; à revoir en L11) ; `revokeWithin` écrase la date d’abandon ; refund admin sans relecture du profil sous verrou (§5).
- **Téléconsultation (L5)** : `Consultation.notes` (≤ 5 000 car., notes cliniques) **en clair** au repos, contraire au §4 (aucune UI n’écrit le champ aujourd’hui) ; échéance absolue comparée à l’horloge du téléphone (avance > 15 min ⇒ accès impossible) ; `allow` sans `autoplay` (son distant possiblement bloqué — recette L10) ; annuler un RDV en pleine consultation ne clôt ni la consultation ni la salle.
- **Rejeu / coffre (L3/L4)** : la date de la clé vient de l’horloge de l’appareil (avance > 5 min ⇒ 400 sur chaque mutation couverte) ; purge des lectures au changement de compte dépendante de `lastOwner` en mémoire (perdu au rechargement ; B ne peut pas déchiffrer A) ; même clé dérivée pour le HMAC d’empreinte et l’AES-GCM des reçus, sans AAD liant `userId|route|clé` ; vérification **inter-onglets** d’un ticket encore en vol (résiduel de C7) ; un message chat mis en file après 5xx avec coffre s’affiche « envoyé » jusqu’au rejeu (cosmétique — `ChatRoom.tsx` est dans l’instantané L9, cf. §6).
- **DMP / laboratoire (L1/L2)** : oracle 404/403 sur entrée/document d’autrui (identifiants non énumérables, impact faible) ; `DMP_SHARE_REVOKE` sans `ip` ; `DMP_DOCUMENT_ADD/REMOVE` écrits après commit ; coche de pièce et `saveIdentity` KYC labo non audités ; fichier KYC labo écrit sous verrou `User` (orphelin chiffré si rollback — arbitrage avec les orphelins des requêtes refusées) ; commande ciblée vers un labo suspendu bloquée sans flux de réassignation (impact patient à décrire).

## 5. Vérifié correct (couverture)

- **DMP L1** : liste/détail/export/pièces passent tous par `resolveDmpScope` (`expiresAt > now` strict, NULL refusé, `revokedAt` ferme tout) ; verrou `dmp-consent:` dans la même transaction pour partage/réclamation/retrait/révocation/ré-octroi, audits inclus ; auteur issu de `request.user` ; migrations additives.
- **Laboratoire L2** : `authorizedLaboratory` sous `FOR UPDATE` pour chaque acte ; claim conditionnel ; résultat/transition/notifications/audit atomiques ; pool sans identité patient ; identité figée, pièces exigées, coches effacées à chaque soumission ; politique KYC médecin inchangée.
- **Rejeu L3** : 8 routes via `mutateOnce`, verrou `User`, contrôles avant déchiffrement, effet + reçu en une transaction, index unique, même clé/autre corps ⇒ 409, TTL cohérents, purge planifiée ; liste positive partagée cohérente, aucun paiement/SOS/auth/consentement en file.
- **Coffre L4** : PBKDF2-SHA256 600 000, AES-256-GCM, IV aléatoire, AAD compte/id/dates/clé, clé non exportable, verrouillages, garde owner/génération dans la transaction, TTL 24 h/6 h/+5 min, migration v3→v4 sans attribution ; SW : jamais d’API/RSC/`_rsc`, navigation réseau d’abord, cache limité au public.
- **Téléconsultation L5** : contrôles de `join`, jeton `is_owner:false` ≤ 15 min borné salle/début, aucun accès fictif, `load` sans jeton puis `join` sur la même instance, no-referrer, destruction, CSP cohérente ; **L0** : réservation `FOR UPDATE` + chevauchement + insertion dans une transaction READ COMMITTED ; `authenticate` relit statut/rôle à chaque requête, refus si DB indisponible.
- **Abonnements/finances L6/L7** : droit PRO par `requireProWithin` uniquement ; mois calendaires vérifiés (31/01, bissextile, décembre) ; idempotence `requestId` ; `applyPaymentStatus` transition conditionnelle + effets dans la même transaction ; journal CAPTURE/REFUND, allocations sous verrou, machine d’état, CSV neutralisé `=+-@`.
- **Sécurité L8** : OTP HMAC séparé, `timingSafeEqual`, compteur avant comparaison ; TTL refresh aligné JWT/cookie/Redis ; chaîne d’audit (verrou 4021957, tri cohérent avec `verify-chain.mjs`, `tx` transmis partout) ; validateur FedaPay robuste à 18 contournements ; CSP production sans `unsafe-eval`.
- **Outillage L9/L10** : `deploy.sh` (`set -euo pipefail`, SHA validé, arrêt/contrôle PM2 avant checkout, trap FAILED) ; snapshot PostgreSQL tenu ouvert pendant dump et comptages ; aucun clair temporaire ; jeton par `curl --config -` ; portes L9/L10 refusant registre vide/JSON invalide/SHA différent ; import i18n sans piège `$`, CSV strict, deux relecteurs critiques.

## 6. Décision de périmètre : instantané L9 préservé

L’instantané L9 (`docs/validation/L9/snapshot.json`, SHA `4a8a1596…`) couvre `messages.ts` et `ChatRoom.tsx`, et l’empreinte de relecture native UI est calculée sur les textes FR/EN. Le porteur a annoncé des retours natifs/cliniques **validés sur cet instantané**, références à venir. Pour ne pas invalider leur rattachement, cette revue **n’ajoute aucune clé i18n et ne modifie aucune source de l’instantané** (C2 réutilise `dmp.revoked_desc`). `validation:check` et `validate-l9-dossier.py` restent verts sur l’empreinte d’origine.

L’instantané **L10** (`docs/preproduction/L10/snapshot.json`), dont le registre de preuves est **vide**, a en revanche été régénéré par `pnpm preprod:prepare` : seules les empreintes de `ci.yml`, `healthwatch.sh` et `infra/deploy/README.md` changent (source `510553fe…`) ; `evidence.json` n’est jamais écrasé.

## 7. Preuves et limites

- Base : CI locale identique à `ci.yml` (PostgreSQL 16 natif, Redis 7, `NODE_ENV=test`), e2e en build `E2E_API_PROXY` ; Node 22 local (CI : Node 24).
- Chaque correctif C1, C3–C10 a un test rejoué contre l’ancien fichier (rouge) puis le nouveau (vert). C2/C11/C12 : revue de code/YAML/`bash -n`.
- **Non attesté** : aucun appel réel Daily/FedaPay/Twilio/Firebase/Resend, aucun VPS, aucune validation clinique ou native. B1/B2/B5 ne peuvent être tranchés que par la recette sandbox L10.
- Revue réalisée par Claude Code (agents de revue + vérification) ; ce n’est ni un audit externe ni un pentest.
