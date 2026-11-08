# Revue fonctionnelle et technique — reste à faire pour finir l'application (7 novembre 2026)

Base : `main` `6846fe1` (merge #231). Candidat préprod déployé : `ace0c689686204348e33c56e95cbc387d3b438b2`.
Méthode : cinq revues parallèles en lecture seule (fonctionnel 7 rôles, technique build/tests, sécurité & conformité, inventaire serveur, avancement des lots/recettes), puis contre-vérification ponctuelle des constats majeurs dans le code. **Aucun code applicatif modifié par cette revue.** Légende : **[C]** constaté dans le code ou par exécution ; **[D]** repris d'un document.

Ce document est un **état des lieux**, pas une preuve de recette ni un GO. Il ne remplace ni les fiches de lot, ni le registre L10, ni le PV L11.

---

## 1. Synthèse

| Axe | État |
|---|---|
| Code (typecheck, lint, build, migrations) | ✅ vert [C] — 34 migrations, schéma = migrations (`prisma migrate diff` vide) |
| Tests | ✅ API 718 / web 155 exécutés [C] ; ❌ `test:scripts` 3 échecs dus à `ss` absent (test non hermétique) |
| Dépendances | ❌ `pnpm audit --prod` : 65 vulnérabilités dont 6 critiques (Next 14.2.35, fast-jwt 5.0.6) [C] |
| Fonctionnel | 5 bloquants pilote + 6 majeurs constatés dans le code (§2) |
| Sécurité / conformité | Invariants contrôlés conformes ; **cadre APDP/RGPD absent** (CGU, confidentialité, effacement, registre, conservation) (§4) |
| L9 humain | Registre de preuves **vide** : 232 clés FON/YOR manquantes par langue dont 6 `sos.*`, 0 contreseing clinique [C] |
| L10 recettes | **15 PASS / 85 ouverts** sur `ace0c689` (`preprod:gate`) [C] |
| L11 GO production | 9 critères sur 9 non attestés [D] ; production **non provisionnée** (§6) |

Lots : L0–L4 livrés ; L5–L8 code livré, gates externes ouverts ; L9 technique livré, humain ouvert ; L10 outillage + préprod déployée, recette 15/100 ; L11 ouvert.

---

## 2. Reste à faire — fonctionnel (code)

Compteurs mesurés : 183 REST + 1 WS, 67 pages, 0 appel web vers une route inexistante, 2 lectures orphelines mineures (`GET /appointments/:id`, `GET /prescriptions/:id`). Écarts de l'audit d'août D1→D7 : **tous fermés** [C].

### 2.1 Bloquants pilote [C] — **corrigés dans le code le 7/11/2026, voir §8**

| # | Écart | Preuve | Action |
|---|---|---|---|
| F1 | **Notifications métier en `IN_APP` seulement** : rappels traitement/RDV/PEV/CPN, démarrage de consultation, orientation, signalement ASC, transfert diaspora ne déclenchent ni push FCM ni SMS ; le dispatch ne pousse pas les `IN_APP` | `reminders.medication.ts:96`, `appointments.service.ts:148`, `vaccinations.service.ts:163`, `maternity.service.ts:140`, `consultations.service.ts:88`, `asc.service.ts:121`, `notifications.service.ts:25-65` | Émettre `PUSH_FCM` (+ `SMS_TWILIO` pour rappels critiques) selon `fcmToken`/préférence ; langue du destinataire |
| F2 | **Signalement ASC invisible** : notification IN_APP au médecin sans écran ni route de lecture côté médecin | `asc.service.ts:120-122`, `asc.routes.ts` | File « signalements reçus » sur `/pro` (ou centre de notifications, cf. M4) |
| F3 | **SOS : « contacts prévenus » faux** — `contactNotified=true` dès la notif IN_APP du patient ou un SMS en stub, même sans contact ni `SOS_PUBLIC_NUMBER` | `sos.service.ts:79-81, 99, 107-111`, `patient/sos/page.tsx:104` | Ne compter que les SMS réellement délivrés ; afficher l'état réel |
| F4 | **Aucune habilitation pharmacie** : pas de `Pharmacy.verifiedAt`, pas d'écran KYC, pas de garde scan/délivrance/stock ; pharmacie non vérifiée visible dans « médicament près de moi » | `schema.prisma` (modèle `Pharmacy`), `kyc.service.ts:228-260`, `pharmacy.routes.ts:40` | Lot « L2-bis pharmacie » : badge + KYC + gardes + filtre recherche (migration additive) |
| F5 | **Rendu posologie non sûr** (premier entier = dose, fractions perdues, horaires/durée supposés) — déjà ouvert L9 | `packages/shared/src/posology.ts:116-146` | Corriger ou masquer les pictogrammes non sûrs, tests de limites, contreseing (périme l'instantané L9 : coordonner avec la campagne) |

### 2.2 Majeurs [C] — **corrigés dans le code le 7/11/2026, voir §9**

| # | Écart | Preuve | Action |
|---|---|---|---|
| M1 | RDV présentiel jamais clos (`COMPLETED`/`NO_SHOW` absents hors téléconsultation) ⇒ avis patient impossible | `appointments.routes.ts:51-62`, `professionals.reviews.ts:17` | `POST /appointments/:id/complete` et `/no-show` gardés par statut (`updateMany`) + boutons agenda |
| M2 | Clôture téléconsultation sans notes (UI envoie `{}`) ; aucun écran médecin de création d'entrée DMP | `pro/teleconsult/page.tsx:25`, `consultations.routes.ts:12` | Compte rendu à la clôture + ajout d'entrée sur la vue 360° (auteur serveur L1) |
| M3 | Créneaux codés en dur 8h–17h, `slotDuration` ignoré, créneaux pris non affichés | `BookingModal.tsx:30` | Endpoint créneaux libres (agenda + durée) ; plages médecin en v2 |
| M4 | Pas de centre de notifications hors espace patient | `notificationsApi` utilisé sous `/patient` seulement | Mutualiser `/notifications` dans chaque coquille |
| M5 | « Audio Fɔ̀ngbè » annoncé sans aucun fichier audio (voix `fr-FR`) | `shared/src/i18n.ts:45`, `lib/speech` | Enregistrer les contenus clés ou retirer la mention |
| M6 | Diffusion de campagne non idempotente (lecture statut → `createMany` non borné → `update`) ⇒ double envoi possible | `campaigns.service.ts:139-172` | Transition conditionnelle DRAFT→SENDING + envoi par lots |

### 2.3 Mineurs et v2

- Mineurs : `/showcase` publique en production (`app/showcase/page.tsx`) ; chaînes en dur (`admin/users/page.tsx:183-186`, `TopNav.tsx:45`, `LangSwitcher.tsx:62`) ; assurance déclarée `ACTIVE` par défaut (`schema.prisma:886`) ; export PDF patient absent (§4 annonce FHIR **et** PDF ; seul FHIR existe).
- v2 / décision produit : console SOS admin (frontière §4), payer les soins d'un proche (E3, §5), RDV au nom d'un habitant par l'ASC, assignation de relecture éducation, interprète humain, abonnements hors médecin.

---

## 3. Reste à faire — technique [C]

| Priorité | Point | Action |
|---|---|---|
| ~~Bloquant GO~~ **corrigé 08/11 (§11)** | `next@14.2.35` : 3 critiques + ~10 hautes (dont SSRF via rewrites, DoS Server Components) ; correctifs en 15.5.x | **Arbitrage porteur requis** (Next 14 verrouillé §2) : montée Next 15 ou acceptation écrite du risque avec mesures compensatoires |
| Bloquant GO | `fast-jwt@5.0.6` via `@fastify/jwt@9.1.0` : 3 critiques (confusion d'algo, secret vide…) — atténué par HS256 épinglé | Monter `@fastify/jwt` (fast-jwt ≥ 6.3.1), re-tests auth |
| Bloquant GO | `fastify@5.8.5`, `find-my-way`, `fast-uri` : hautes (contournement auth/validation, SSRF) | `pnpm update` semver (fastify ≥ 5.12.2), revue lockfile, **re-tests webhooks §5** |
| Majeur | `scripts/infra/deploy-order.test.mjs` dépend du `ss` de l'hôte (`deploy.sh:169`) | Faux `ss` dans le `bin` simulé du test |
| Majeur | **PR ouverte #228** (`claude/youthful-allen-0yb5p7`) : rôle PG non propriétaire de l'audit, ACL Valkey, port squatté, fuseau, zones Nginx, R1, A8, D-10 — non fusionnée | Revue puis fusion (ou rebase) : plusieurs points §4/§6 en dépendent |
| Majeur | CI sur `postgres:16`, cible PG 18.6 ; `verify_restore.sh:57` impose PG 16 ⇒ exercice de restauration L11 échouera tel quel | Aligner CI + script de restauration sur PG 18 |
| Majeur | Dépendances hautes transitives : `postcss`, `nanoid` (Next), `@grpc/grpc-js` (firebase), `zod` 3 | Traiter avec la montée Next / suivi |
| Mineur | Comptage statique des tests (840) ≠ exécutés (873) ; 4 `exhaustive-deps` désactivés ; Prisma 5.22 ; 25 branches distantes à nettoyer ; conteneur dev en Node 22 (dépôt ≥ 24) | Publier les deux chiffres ; revue ponctuelle |

Hygiène bonne : 0 `@ts-ignore`, 0 `any` hors tests, 0 TODO réel.

---

## 4. Reste à faire — sécurité & conformité (S1–S5 traités côté code le 7/11, voir §10)

Invariants contrôlés **conformes** [C] : gardes admin/scopes, routes publiques limitées (auth, health, crons sous `x-service-token` en temps constant), webhook FedaPay (`t=,s=`, 300 s, transition conditionnelle), `resolveDmpScope` sur toutes les lectures DMP/fichiers/export, `assertCareRelationship`, cloisonnement 404, liste positive de rejeu L3, rate-limit Redis, cookie refresh, WS chat.

| # | Manque | Niveau | Nature |
|---|---|---|---|
| S1 | Pas de politique de confidentialité / CGU / mentions légales ni consentement horodaté et versionné à l'inscription [C] | Bloquant GO | Juriste/porteur puis code |
| S2 | Pas de suppression de compte / droit à l'effacement [C] | Bloquant GO | Décision (périmètre conservé : audit, finance) puis code |
| S3 | Registre des traitements, AIPD santé, déclaration/autorisation APDP absents du dépôt [C] | Bloquant GO | Porteur / externe |
| S4 | Politique de conservation non définie (D-8) ; aucune purge (audit 5 ans, finance) [D] | Bloquant GO | Porteur puis code + cron |
| S5 | Fichiers DMP supprimés conservés sur disque et sauvegardes ; purge annoncée inexistante [C] `dmp.service.ts:222-224` | Majeur | Code + cron |
| S6 | Rôle PG d'exécution propriétaire des tables d'audit [D] (PR #228) | Bloquant GO prod | Code d'exploitation + serveur |
| S7 | Valkey partagé : mot de passe `default` = tous les index, `chat:events` commun [D] (PR #228) | Bloquant GO prod | Décision + serveur |
| S8 | Pentest externe non réalisé (X15) | Bloquant GO | Prestataire |
| S9 | CSP `unsafe-inline` non arbitrée (X8) `next.config.mjs:9,16-17` | Majeur | Nonce ou acceptation écrite |
| S10 | OTP : verrouillage d'un numéro tiers, oracles e-mail/licence, timing (X4) | Majeur | Arbitrage puis mesure en pentest |
| S11 | Résiduels de code déclarés (audit `DMP_DOCUMENT_*` après commit, réassignation labo, clé HMAC/AES commune des reçus, etc.) | Mineur | Planifier |

---

## 5. Reste à faire — non-code (humain, recettes, décisions)

### 5.1 L9 — langues natives et contenu clinique [C via `validation:gate`, 15 points ouverts]
- FON/YOR : 232 clés manquantes par langue (dont 6 `sos.*` critiques) ; 866 présentes non attestées ; phrasier : 27 phrases sans FON/YOR. **Deux relecteurs natifs distincts par langue, jamais de MT.**
- Contreseing d'un professionnel habilité sur 7 portées : triage, PEV (calendrier national consolidé à fournir), CPN, phrasier, posologie (après correction F5), constantes, éducation (inventaire réel des articles publiés).
- Le porteur doit transmettre les **références de preuve** des retours annoncés, rattachés à l'instantané `3e061d52…`.

### 5.2 L10 — 85 cas ouverts sur `ace0c689` [C via `preprod:gate`]
PASS : I1, I3–I9, FedaPay S1–S4/S7/S8, Resend R6.
- Rejouables tout de suite : FedaPay S5/S6/S9/S10 ; Twilio T1/T3–T6/T8–T10 ; Firebase Android F1–F8 ; Resend R1–R5 ; abonnements A2/A4/A5/A7/A9/A10/A12/A14.
- À préparer : Daily D1–D21 (deux appareils + tiers, proxy de latence D19–D21, **jamais passé**) ; A1/A3/A6/A13/A16 ; Finances F6/F7.
- Structurellement ouverts : I2, T2/T12 (Moov), 8 cas Firebase iPhone, A11 (échéance 21/11/2026), A15.

### 5.3 Décisions du porteur en attente
D-1 Geo Permissions voix (T7) · D-2 T11 en N/A · D-3 wallet médecin (A8) · D-4 iOS A17 · D-5 phase 2 Finances LIVE · D-6 remboursement REQUESTED 6 560 XOF · D-7 second admin finance · **D-8 conservation** · D-9 I2/hôte partagé · D-10 approbation FedaPay tardive · D-11 Moov/iOS · D-12 F9 rebuild. Plus : montée Next 15 (§3), `unsafe-inline`, ACL Valkey, `ALERT_CMD` production, cadre APDP (§4).

### 5.4 Dépendances externes
Locuteurs natifs FON/YOR · médecin signataire + référent PEV · iPhone · SIM Moov · comptes fournisseurs live (KYC marchand FedaPay) · prestataire pentest · opérateur tiers + hôte distinct (restauration) · APDP · ONMB (format CNOM).

---

## 6. Ce qui doit être fait sur le serveur (VPS IONOS `srv1.immipro.app`)

### 6.1 État constaté [D]
- **Préproduction** : provisionnée 14–15/10, déployée `ec6b0dc → ace0c689` le 21/10 (34 migrations, PM2 api×2 + web, crons, sauvegarde DB+fichiers contrôlée, chaîne d'audit intègre), **maintenance posée**. D-13 (syslog accepté en préprod) et D-14 (secrets fournisseurs retirés du `.env`) closes.
- **Production** : **non provisionnée, non déployée** — aucune preuve de checkout, PM2, certificat ou base. La mention « production encore `ec6b0dc` » de `PLAN_GO_Preprod_ace0c689.md` §1 est à corriger. Job `deploy` de `ci.yml` désactivé.

### 6.2 Préproduction — reste à faire
1. Rejouer les cas L10 ouverts (§5.2) puis `pnpm preprod:gate --expected-sha ace0c689…` sur copie, 0 refus.
2. Après chaque fusion touchant `infra/deploy/root-scripts.list` : `install_root_scripts.sh <SHA>`, puis `provision-ionos.sh --only nginx,cron` (dry-run → `--apply` → `--verify` 0 FAIL) ; contrôler `root-scripts.manifest` (SHA, `environment=preproduction`).
3. Si PR #228 fusionnée : appliquer rôle PG non propriétaire, ACL Valkey, sur nouveau candidat (nouvelle recette).
4. Exercice de restauration B5/L11 sur machine tierce — **après** alignement de `verify_restore.sh` sur PG 18.
5. Pentest externe sur la préprod synthétique ; maintenance maintenue jusqu'au PV signé.

### 6.3 Production — checklist complète (`DIGISANTE_ENV=production`, ports 3200/3201, base `digisante`, Valkey /6)
0. **Contrôles en lecture seule sur l'hôte** (README §1.b) : index Valkey /6 libre + `noeviction` + persistance + version (≥ 9.1 pour ACL `db=`) ; `pg_hba` `host digisante digisante 127.0.0.1/32 scram-sha-256` (+ `::1`) ajouté à la main avant toute règle `trust` puis `pg_reload_conf()` ; `sshusers` sans sudoers ; DNS A sans AAAA étranger ; hooks Certbot relus ; `default_server` Nginx explicite ; ports 3200/3201 libres ; fuseau ; RAM/disque/`max_connections` ; sauvegarde de `/etc/nginx`, `/etc/cron.d`, `/etc/logrotate.d`, `pg_dumpall --roles-only`.
1. Miroir `/var/lib/digisante/ops.git` + `install_root_scripts.sh <SHA>` → `/usr/local/lib/digisante` (**même SHA que la copie root préprod**, sinon fichiers Nginx communs refusés).
2. `provision-ionos.sh` en dry-run (`VALKEY_PASSWORD` par `read -rs`), relire le plan.
3. `--apply --only users,dirs,pg,valkey,runtime` : comptes `digisante` / `digisante-jobs`, clé CI `restrict`, `/var/lib/digisante-files` 0700, `/etc/digisante`, `/var/backups/digisante`, rôle + base (`PG_APP_PASSWORD` : `openssl rand -hex 24`), marqueur Valkey, PM2 7.0.4, pnpm 9.12.0, service `pm2-digisante`.
4. `--apply --only nginx` (`LETSENCRYPT_EMAIL`) : certificat webroot `digisantemobile.app` + `www` (dry-run LE d'abord), `renew --dry-run`, puis HSTS et vhost TLS. Vérifier `www` → 301 apex et un seul en-tête HSTS.
5. `--apply --only cron` : `/etc/cron.d/digisante` (rappels traitement 5 min, RDV 15 min, PEV 06:30, CPN 06:40, dispatch 2 min, `pg_dump_encrypted.sh` 02:00, réconciliation FedaPay 02:30, healthwatch 5 min, purge reçus 03:10, renouvellement certificat 03:15/15:15) + logrotate. Vérifier `sudo crontab -l` sans ligne DigiSanté.
6. Checkout `/var/www/digisante` puis **`git switch --detach <SHA qualifié>`** (sinon `deploy.sh` exige un rollback explicite) ; `apps/api/.env` 0600 (`NODE_ENV=production`, `DATABASE_URL …/digisante`, `REDIS_URL …/6`, `CORS_ORIGIN=https://digisantemobile.app`, `KYC_STORAGE_DIR=/var/lib/digisante-files`) ; **secrets neufs distincts de la préprod** : `JWT_SECRET`, `HEALTH_ENCRYPTION_KEY` (`openssl rand -base64 48`, copie hors VPS), `RECONCILE_TOKEN` (`openssl rand -hex 32`) ; `apps/web/.env.production` (API URL vide, Firebase/VAPID de **production**).
7. `--apply --only secrets` : `backup.key` 0400 (copie hors VPS), `reconcile.token` aligné, `alert.conf` avec **`ALERT_CMD` vers une adresse d'exploitation** (requis D-13).
8. `--verify` (avec `VALKEY_PASSWORD`) : 0 FAIL.
9. Poser `snippets/digisante-maintenance.conf` (IP de recette), `nginx -t`, reload.
10. Premier `deploy.sh` depuis `origin/main` extrait hors du checkout (`DEPLOY_ENVIRONMENT=production DEPLOY_MAINTENANCE_READY=1`) → `deploy_history.log` `SUCCESS stage=complete`, `pm2 status` api×2 + web, `/api/v1/ready` db/redis up ; `pm2 save`.
11. `verify_deploy.sh` (copie root, `DOMAIN=digisantemobile.app`) **sans `--run-jobs`** : tout PASS.
12. `pg_dump_encrypted.sh` une fois + `pnpm backup:check <manifeste>` (2 archives, `files_missing=0`), trio + `backup.key` hors VPS, restauration réelle sur machine tierce.
13. **Premier SUPER_ADMIN** : procédure de production **à écrire** (le seed est de démonstration, jamais en prod).
14. Intégrations saisies en base via `/admin/integrations` (rien ne se copie depuis la préprod) : Twilio (Geo Permissions BJ), Daily (domaine prod), Firebase (projet prod), Resend (SPF/DKIM/DMARC), FedaPay sandbox puis **live** selon `PLAN_Bascule_FedaPay_Live.md` (quatre yeux, `sk_live`/`pk_live`/`webhookSecret` dans le même `PUT`) ; déclarer `https://digisantemobile.app/api/v1/payments/webhook` côté FedaPay. « Tester » OK partout.
15. Secrets GitHub `VPS_HOST`, `VPS_USER=digisante`, `VPS_SSH_KEY`, `VPS_FINGERPRINT` ; `DEPLOY_ENABLED` / `DEPLOY_MAINTENANCE_READY` à `true` **seulement pendant une fenêtre autorisée** ; annuler les jobs en attente.
16. Levée de la maintenance **uniquement après PV GO L11 signé**.

### 6.4 Points à arbitrer avant GO production
I2 (hôte partagé) · rôle PG non propriétaire de l'audit · isolement Valkey · capacité 4 Go (`MemoryMax`, coupure pendant build) · port squatté / fuseau · `ALERT_CMD` · conservation (D-8) · CSP · pentest · L9 humain · Moov/iOS · hôtes FedaPay live non observés (B1 live).

### 6.5 Incohérences documentaires à corriger
1. `PLAN_GO_Preprod_ace0c689.md` §1 : production « encore `ec6b0dc` » → « non déployée ».
2. `verify_restore.sh:57` et `SUIVI_B5` : PG 16 vs hôte PG 18.6.
3. Premier déploiement prod : `git switch --detach <SHA>` non documenté.
4. `ci.yml` job `deploy` : déploie `github.sha` à chaque push sur `main` une fois les gates actifs, sans qualification de candidat ; `DEPLOY_MAINTENANCE_READY` déclaratif.
5. `SECRETS_Production.md` : variables fournisseurs marquées obligatoires dans le `.env` (contredit D-14/§3.6) ; `backup.key` « à la main » alors que `--only secrets` le génère.
6. `DEPLOIEMENT_Checklist.md` : S1–S7/D1–D18 (registre S1–S10/D1–D21), « VPS Infomaniak », « 24 e2e » (36), hôtes FedaPay sans `process.*`.
7. `SUIVI_B3` / `SUIVI_B5` : `verify_deploy.sh` / `verify_restore.sh` lancés depuis le checkout sans `DIGISANTE_ENV` (contraire B3) ; `PLAN_Bascule_FedaPay_Live.md` : nom d'archive `digisante_db_<stamp>` erroné, portes P1–P5 datées du 22/09.
8. README « Exploitation » : exemple de restauration base seule (fichiers DMP B4 absents).

---

## 7. Ordre de finalisation proposé

1. **Décisions porteur** (une séance) : Next 15 vs risque accepté, cadre APDP + conservation (D-8), I2/Valkey, D-1…D-12.
2. **Lot code « finition pilote »** (une branche par lot, §6) : F1–F4 + M1–M4 + M6 ; montée sécurité dépendances (fastify, @fastify/jwt, puis Next selon décision) avec re-tests webhooks §5 ; test `ss` hermétique ; PG 18 en CI/restauration ; fusion/rebase de #228.
3. **Lot conformité** : pages légales + consentement versionné, suppression/anonymisation de compte, purge des fichiers orphelins et rétention selon D-8, export PDF patient.
4. **F5 posologie + L9 humain** : correction puis régénération de l'instantané **après** clôture de la campagne native en cours ; contreseing.
5. **Nouveau candidat** → déploiement préprod → rejeu complet L10 (le candidat `ace0c689` ne portera pas les correctifs ci-dessus) → pentest.
6. **Production** : checklist §6.3, restauration tierce, rollback, PV GO/NO-GO L11.

*Revue générée le 7 novembre 2026 par Claude Code (revue en agents parallèles, lecture seule). Les compteurs proviennent d'exécutions locales (Node 22, PostgreSQL 16 natif) et des scripts du dépôt ; les états serveur et recettes proviennent des registres et fiches, non d'un accès à l'hôte.*

---

## 8. Correctifs appliqués le 7 novembre 2026 — bloquants F1 à F5

Même branche, tests ajoutés pour chaque correctif. **Aucune recette réelle, contreseing ni déploiement attesté.**

| # | Correctif | Fichiers clés | Preuve |
|---|---|---|---|
| F1 | Toute notification `IN_APP` part aussi en **push FCM** quand le destinataire a un appareil lié. Le texte est **générique** (`pushMirrorText`) : nom de médicament, signalement ASC ou motif ne transitent jamais par FCM ni par l'écran verrouillé (§4). Un échec du push ne fait pas échouer l'in-app. La liaison est relue avant chaque envoi et un token invalide est purgé (helper `pushToRecipient`, partagé avec le canal `PUSH_FCM`). Pas de SMS de repli ajouté pour les rappels (décision de coût à prendre). | `notifications.service.ts`, `notifications.templates.ts` | `notifications.devices.test.ts` (+2) |
| F2 | Centre de notifications du médecin `/pro/notifications`, avec une tuile et le compteur de non lus sur le tableau de bord PRO. La liste est mutualisée dans le composant `NotificationList`, partagé avec le patient. Le signalement ASC est lisible par le médecin destinataire. | `components/notifications/NotificationList.tsx`, `app/pro/notifications`, `app/pro/page.tsx` | `asc.test.ts` (lecture du signalement par le médecin) |
| F3 | SOS : `contactNotified` n'est vrai **que si au moins un SMS a été réellement livré** (ni stub, ni notification in-app du patient). L'écran distingue « SMS transmis à vos contacts » et « alerte enregistrée, personne prévenu — appelez le 112 ». Le corps de la notification du patient reflète l'état réel. | `sos.service.ts`, `patient/sos/page.tsx` | `sos.service.test.ts` (stub et absence de contact ⇒ faux) |
| F4 | Habilitation des pharmacies, migration additive `20261107120000_pharmacy_verification` (`Pharmacy.verifiedAt`, aucun badge déduit de l'historique) :<br>• scan et délivrance exigent une officine vérifiée ;<br>• « médicament près de moi » ne liste que les officines vérifiées et actives ;<br>• l'approbation KYC d'une pharmacie exige un `NATIONAL_ID` et un `PRACTICE_LICENSE` présents et toutes les pièces vérifiées, puis pose le badge ;<br>• `GET /pharmacy/me` ;<br>• écran `/pharmacie/kyc`, avec le dossier KYC mutualisé `KycDossier` partagé avec `/pro/kyc` ;<br>• bannière sur l'écran de scan. | `pharmacy.*`, `kyc.service.ts`, `schema.prisma`, `app/pharmacie/kyc` | `pharmacy.verification.test.ts` (3) + fixtures |
| F5 | Analyse de posologie conservatrice, couvrant les 14 cas à risque POS01 à POS14 de la campagne L9 :<br>• fractions conservées (½, 1/2, 0,5, « demi ») ;<br>• une teneur ou un volume (mg, mL…) n'est jamais une quantité ;<br>• quantité unique seulement : rien si elle varie selon le moment ou s'il s'agit d'une plage ;<br>• **aucun horaire ajouté** ;<br>• « par semaine », un intervalle ou des heures ne deviennent pas des prises par jour ;<br>• une contradiction entre prises et moments n'est pas résolue par le code ;<br>• une négation n'est jamais illustrée ;<br>• « pendant le repas » est représenté par la nouvelle valeur `DURING` ;<br>• une durée n'est retenue qu'en jours ou en semaines entiers.<br>Le texte original fait toujours foi. | `packages/shared/src/posology.ts`, `PrescriptionPosology.tsx` | `posology.test.ts` (+10), `clinical-review.test.mjs` |

**Conséquences L9** (décision du porteur du 7/11) :
- L'instantané passe de `3e061d52…` à `c9f0471e…` et le dossier clinique non signé est régénéré.
- L'ancien instantané et le kit de campagne `L9-2026-10-14` sont archivés tels quels dans `docs/validation/archive/L9-3e061d52-2026-11-07/`. Les retours annoncés restent liés à cette version.
- `validation:campaign:check` contrôle désormais l'intégrité de ce kit archivé. Une **nouvelle campagne**, avec un nouvel identifiant, est à préparer pour les sources corrigées.
- Les cas POS01 à POS14 portent la mention « Corrigé 07/11 (à confirmer) ». **Le contreseing clinique reste requis.**

**Dettes ouvertes par ces correctifs** :
- Nouvelles clés **critiques** `sos.sms_delivered` et `sos.no_contact_notified`, livrées en FR/EN seulement : FON/YOR retombent sur le français. Elles s'ajoutent aux 6 clés `sos.*` déjà ouvertes, soit 8 clés critiques par langue à faire relire par des natifs, jamais par traduction automatique.
- Clés non critiques à traduire en FON/YOR : `pharmacie.kyc*`, `pharmacie.not_verified` et `posology.meal.DURING`.

**Exploitation** :
- Après migration, les pharmacies existantes en préproduction ou en production deviennent **non vérifiées** : scan et délivrance sont fermés et elles disparaissent de la recherche jusqu'à une revue KYC complète.
- Prévenir les officines de recette ; ne pas remplir `verifiedAt` en SQL.
- Le seed de démonstration pose le badge de la pharmacie synthétique.

**Contrôles exécutés en local** (Node 22, PostgreSQL 16, Redis), tous verts :

| Contrôle | Résultat |
|---|---|
| Lint, typecheck | verts |
| Tests API | 95 fichiers, 734 tests |
| Tests web | 155 tests |
| `test:scripts` | 208 tests (avec un faux `ss`, cf. §3) |
| Build web | 70 pages générées |
| `prisma migrate diff` | aucune différence |
| `validation:check`, `validation:campaign:check` | verts |
| `metrics:check` | vert : 184 REST, 69 pages, 35 migrations |

---

## 9. Correctifs appliqués le 7 novembre 2026 — écarts majeurs M1 à M6

Même branche. Tests ajoutés pour chaque correctif. **Aucune recette réelle ni aucun déploiement attesté.**

| # | Correctif | Fichiers clés | Preuve |
|---|---|---|---|
| M1 | Clôture d'un RDV par son médecin, après l'heure prévue : `POST /appointments/:id/complete` (statut `COMPLETED`) ou `/no-show` (statut `NO_SHOW`).<br>• Transition conditionnelle depuis `CONFIRMED`.<br>• Refus avant l'heure, sur un RDV non confirmé, par un autre médecin ou si une téléconsultation est en cours.<br>• Aucun effet de paiement : un remboursement ne naît que d'une annulation (§5).<br>• Boutons « Terminé / Absent » dans l'agenda. Le RDV `COMPLETED` ouvre l'avis patient. | `appointments.service.ts`, `appointments.routes.ts`, `pro/agenda` | `appointments.visits.test.ts` |
| M2 | Clôture de téléconsultation avec un champ `report` : le compte rendu est enregistré comme **entrée DMP** via `createRecord`.<br>• Médecin vérifié et consentement actif requis.<br>• Contenu scellé, auteur fixé côté serveur (L1).<br>• L'entrée est créée **avant** la clôture : sans partage du patient, l'API répond 403 et la consultation reste ouverte, le texte saisi est conservé dans l'écran.<br>• Le texte n'est jamais stocké en clair dans `Consultation.notes`.<br>• La vue 360° propose « Ajouter une entrée au dossier » (diagnostic, allergie, maladie chronique, autre). L1 est respecté : l'auteur n'acquiert aucun droit de lecture sur l'entrée. | `consultations.*`, `pro/teleconsult`, `pro/patient`, `lib/api/dmp.ts` | `appointments.test.ts` (403 puis entrée créée) |
| M3 | `GET /appointments/slots?doctorId&date` donne les créneaux libres d'un médecin vérifié et actif :<br>• heure du Bénin, UTC+1, de 8 h à 17 h ;<br>• pas égal à `slotDuration` ;<br>• créneaux passés et créneaux chevauchant un RDV actif exclus, selon la même règle `overlaps` que la réservation ;<br>• aucune donnée patient renvoyée.<br>La modale de réservation n'utilise plus d'heures codées en dur et recharge la liste sur un 409. La réservation reste l'arbitre. | `appointments.rules.ts`, `BookingModal.tsx` | `appointments.rules.test.ts` (+4), `appointments.visits.test.ts` |
| M4 | Centre de notifications pour les espaces pharmacie, labo, diaspora et ASC (composant `SpaceNotifications`, réutilisant `NotificationList`). Accès par un lien sur l'accueil de chaque espace et une pastille 🔔 côté pharmacie. | `components/notifications/*`, `app/{pharmacie,labo,diaspora,asc}/notifications` | build (pages générées) |
| M5 | La mention « audio Fɔ̀ngbè » est retirée : aucun enregistrement n'existe et la lecture vocale utilise une voix fr-FR.<br>• `LANGUAGE_META.FON.hasAudio` vaut `false`, ce qui masque l'icône 🔊 dans les sélecteurs.<br>• Le bouton « Écouter en Fɔ̀ngbè » des résultats devient « Écouter ».<br>• Ne repasser à `true` qu'avec des fichiers audio natifs relus. | `packages/shared/src/i18n.ts`, `patient/results` | — |
| M6 | Diffusion de campagne **à envoi unique** : la transition `DRAFT → SENT` est conditionnelle et ouvre la transaction, le perdant reçoit 400 sans rien créer.<br>• Destinataires parcourus par curseur et notifications créées par lots de 500.<br>• Statut, notifications et audit atomiques.<br>• Modification et suppression également conditionnelles sur `DRAFT`. | `campaigns.service.ts` | `campaigns.test.ts` (+3, dont 3 envois concurrents → un seul 200) |

**Conséquences** :
- Nouvel instantané L9 `3e8e9f1a…`, le dossier clinique non signé est régénéré. Cause : nouvelles clés FR/EN dans `messages.ts`. Aucun contenu clinique n'est modifié par M1 à M6.
- **Clés FON/YOR à traduire (non critiques)** : `teleconsult.report_*` et `pro.entry_*`/`pro.add_entry`. La clé `results.audio` n'est plus utilisée.
- **Résiduels** :
  - l'API accepte encore `notes` en clair à la clôture ; l'UI ne l'envoie plus, à retirer ou chiffrer dans un lot dédié ;
  - les plages horaires par médecin restent à faire (v2) ;
  - le centre de notifications admin est hors périmètre (§4).

**Contrôles locaux**, tous verts :
- lint, typecheck ;
- 745 tests API, 155 tests web ;
- `test:scripts` : 208 tests ;
- build web : 74 pages générées ;
- `validation:check` et `validation:campaign:check` ;
- `metrics:check` : 187 REST, 73 pages.

---

## 10. Correctifs du 7 novembre 2026 : conformité APDP/RGPD (S1 à S5)

Décisions du porteur prises le 7/11 :
- **Effacement** : sur demande du titulaire, exécuté par un admin.
- **Textes légaux** : publiés comme projets marqués « à valider ».

Dossier complet : `docs/CONFORMITE_APDP_2026-11.md` (registre des traitements, trame d'AIPD, proposition de conservation pour D-8, actions du porteur).

| # | Traitement | État |
|---|---|---|
| S1 | Ajouts :<br>• pages publiques `/legal/{cgu,confidentialite,mentions}`, en **projet** ;<br>• case de consentement non cochée à l'inscription : `acceptTerms` est exigé, avec la version `TERMS_VERSION` (422 sinon) ;<br>• `User.termsVersion` et `termsAcceptedAt` ;<br>• écran de ré-acceptation `TermsGate` pour les comptes existants (jamais bloquant hors ligne ni sur SOS, fiche d'urgence ou triage ; admins exclus) ;<br>• audit `TERMS_ACCEPTED`. | Code livré. **Texte juridique à valider et champs [ ] à fournir.** |
| S2 | Ajouts :<br>• demande depuis le profil (idempotente, auditée) ;<br>• file `/admin/deletions` : lecture avec `users:read`, exécution ou refus motivé avec `users:write` ;<br>• exécution transactionnelle : santé effacée, identité anonymisée, compte fermé, fichiers supprimés après validation. | Code livré. Audit et finances **conservés pseudonymisés** en attendant D-8. |
| S3 | Projet de registre et trame d'AIPD dans le dossier de conformité. | **Porteur** : déclaration ou autorisation APDP, contrats de sous-traitance, délégué. |
| S4 | Proposition de durées (non codée). | **Porteur** : décision D-8, puis purges planifiées. |
| S5 | Le retrait d'une pièce DMP efface le fichier chiffré du disque, après la ligne en base. | Livré (`deleteEncryptedFile`). |

Migration additive `20261107140000_gdpr_terms_and_erasure` : colonnes `users.termsVersion`, `termsAcceptedAt` et `deletedAt` ; table `account_deletion_requests`.
- Aucun compte existant n'est réputé avoir accepté : la ré-acceptation est demandée à la prochaine session en ligne.
- **Préprod** : les comptes de recette verront l'écran de ré-acceptation.
- **e2e** : l'aide d'inscription coche la case (`data-testid="accept-terms"`).

**Contrôles locaux**, tous verts :
- lint, typecheck ;
- tests : 749 API, 155 web, 208 scripts ;
- build web : 78 pages générées ;
- `prisma migrate diff` : aucune différence ;
- `validation:check` : instantané L9 `393091c6…` ;
- `metrics:check` : 193 REST, 75 pages, 54 modèles, 36 migrations.

**Non exécutés en local** :
- les e2e, couverts par la CI ;
- le texte juridique et les formalités, hors code.

**Reste** :
- export PDF patient : mineur ; l'export FHIR existe ;
- purges de conservation : en attente de D-8.

---

## 11. Correctifs du 8 novembre 2026 : vulnérabilités des dépendances

Décisions du porteur : montée **Next 15.5** et **zod 4**.

`pnpm audit` passe de **65 vulnérabilités en production (6 critiques)** à **0**, dépendances de dev comprises.

| Avant | Après | Remarque |
|---|---|---|
| next 14.2.35, React 18 | next 15.5.29, React 19 | `await params` ; `ReactElement` au lieu de `JSX` |
| fastify 5.8.5, @fastify/jwt 9 (fast-jwt 5) | fastify 5.12.8, @fastify/jwt 10.2.7 (fast-jwt 6.3) | HS256 épinglé inchangé |
| zod 3.25.76 | zod 4.6.7 | `z.record` à 2 arguments ; `z.partialRecord` pour les traductions |
| vitest 2.1 (vite 5) | vitest 4.1, vite 7 | dev seulement |
| dépendances transitives | overrides pnpm bornés à leur version majeure | minimatch 11 vérifié avec lint et typedoc |

**Régression évitée** : en zod 4, `education/:id/translations` aurait rejeté tout jeu partiel de langues (422), donc cassé l'éditeur de traductions du CMS. Le test existant ne vérifiait pas le code retour ; il le vérifie désormais.

**Contrôles locaux**, tous verts :
- lint, typecheck ;
- tests : 749 API, 155 web, 208 scripts ;
- build : 78 pages générées ;
- **e2e : 39 sur 39**, en-têtes de sécurité et CSP compris ;
- scan des secrets du bundle ;
- `validation:check` et `metrics:check` ;
- `pnpm audit` : 0.

§5 : la logique de paiement n'est pas modifiée ; les tests webhooks passent.
