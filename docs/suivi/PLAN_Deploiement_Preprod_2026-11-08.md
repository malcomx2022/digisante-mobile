# Déploiement en préproduction de la nouvelle candidate — plan (8 novembre 2026)

**Plan, pas une preuve.** Rien de ce document n'a été exécuté sur l'hôte. Claude Code n'a aucun accès au VPS
`srv1.immipro.app` : chaque étape est à faire par l'opérateur, et chaque preuve à reporter dans `docs/suivi/LOT_L10.md`.

## 0. Candidate et décisions

| Point | Décision / état |
|---|---|
| Version à déployer | **`main` après fusion de la PR #228** (décision du porteur du 08/11/2026) : la recette L10 se fait une seule fois sur la configuration visée pour la production. |
| SHA candidat | `<SHA_CANDIDAT>` = commit de fusion de #228 sur `main`, **à renseigner après la fusion**. |
| Qualification | CI `main` réussie sur ce SHA exact, jobs `build-and-test` **et** `e2e` (`pnpm preprod:qualify` avec `CANDIDATE_SHA`, ou étape de garde du workflow `preproduction.yml`). |
| Version en service | `ace0c689` (déployée le 21/10/2026), **sous maintenance**. Sa recette L10 est abandonnée : aucune preuve ne se transfère (§6). |
| Prérequis bloquant | CI de la PR #228 verte, puis fusion par le porteur. |

## 1. Ce qui change depuis `ace0c689`

**Code (PR #232 et #233, déjà sur `main`)**

- **2 migrations additives** :
  - `20261107120000_pharmacy_verification` : `Pharmacy.verifiedAt` NULL pour toutes les officines. **Aucune pharmacie de
    recette ne peut plus scanner ni délivrer** tant qu'un nouveau dossier KYC (`NATIONAL_ID` + `PRACTICE_LICENSE`, toutes
    pièces vérifiées) n'a pas été approuvé.
  - `20261107140000_gdpr_terms_and_erasure` : version des CGU et demandes d'effacement. Chaque compte de recette existant verra
    l'écran de ré-acceptation des CGU (`TermsGate`, jamais bloquant sur SOS, fiche d'urgence ou triage).
- **Sécurité** :
  - CSP à nonce et rendu dynamique de toutes les pages ;
  - verrou OTP par couple numéro + IP ;
  - reçus de synchronisation v2 (les reçus v1 restent lisibles) ;
  - Next 15.5, zod 4, dépendances à 0 vulnérabilité.
- **Fonctionnel** :
  - clôture/absence des RDV, créneaux libres, centres de notifications, miroir push FCM générique ;
  - campagnes par lots, posologie conservatrice, compte rendu de téléconsultation vers le DMP ;
  - pages légales en **projet**.

**Infrastructure (PR #228)**

- **Base** : l'API tourne sous le rôle PostgreSQL d'exécution `digisante_preprod_app`, non propriétaire. Les migrations
  passent sous le propriétaire, dont l'URL est transmise par le secret GitHub `PREPROD_DB_MIGRATION_URL` et n'est jamais
  écrite sur l'hôte.
- **Valkey** : connexion sous l'utilisateur ACL `digisante-preprod`, préfixe `digisante-preprod:`, sans commande
  d'administration.
- **Nginx et crons** : zones Nginx propres à la préproduction, fuseau Porto-Novo garanti pour les tâches quotidiennes, garde
  du port squatté pour le jeton de service et la readiness.
- **Copie root** : nouvelle copie, avec `provision-ionos.sh`, `verify_deploy.sh`, `healthwatch.sh`, `internal_job.sh`,
  `fedapay_reconcile.sh`, les crontabs, le vhost et `rate-limit.conf` modifiés.
- **`.env` de l'API** : `DATABASE_URL` (rôle d'exécution), `REDIS_URL` (utilisateur ACL) et la nouvelle variable
  `REDIS_KEY_PREFIX="digisante-preprod:"`. `NEXT_PUBLIC_SHOWCASE` reste vide, ce qui donne une 404 sur `/showcase`.

## 2. À préparer avant la fenêtre

| # | Qui | Action | Preuve attendue |
|---|---|---|---|
| P1 | Administrateur de l'hôte | Fichier ACL Valkey déclaré (`CONFIG GET aclfile` non vide) et chargé selon la procédure de l'hôte. Sans lui, `ACL SAVE` échoue. | Sortie de `CONFIG GET aclfile` (chemin seulement) |
| P2 | Administrateur de l'hôte | Si `pg_hba.conf` nomme les rôles : ajouter à la main `host digisante_preprod digisante_preprod_app 127.0.0.1/32 scram-sha-256` (et `::1/128`) **avant** toute règle `trust` plus large, puis `SELECT pg_reload_conf()`. | Ligne ajoutée (sans secret) |
| P3 | Porteur | Générer dans le coffre deux secrets **distincts** de ceux de la production et de tout autre projet : `PG_RUNTIME_PASSWORD` et `VALKEY_APP_PASSWORD` (`openssl rand -hex 24`). | Entrées du coffre (noms seulement) |
| P4 | Porteur | Secret GitHub `PREPROD_DB_MIGRATION_URL` = `postgresql://digisante_preprod:<PG_APP_PASSWORD>@127.0.0.1:5432/digisante_preprod?schema=public` (le propriétaire existant ; son mot de passe ne change pas). | Secret présent (Settings → Secrets) |
| P5 | Opérateur | Capacité : mémoire, swap et disque libres (le build passe pendant le déploiement, à côté d'ImmiPro et de BeninLink). | Relevé `free -m`, `df -h` |
| P6 | Porteur | Fenêtre convenue avec les autres applications de l'hôte ; IP de recette connue. | — |

## 3. Fenêtre de déploiement (ordre strict)

`SUFFIX=-preprod`, `DIGISANTE_ENV=preproduction`, `ROOT_LIB=/usr/local/lib/digisante-preprod`, `P=$ROOT_LIB/infra/deploy/scripts/provision-ionos.sh`.

1. **Maintenance** : le fichier `snippets/digisante-preprod-maintenance.conf` est déjà posé (IP de recette + IP de l'hôte).
   La revérifier : `curl -sI https://preprod.digisantemobile.app/` depuis une autre IP doit répondre 403 ou 503.
2. **Crons mutateurs suspendus** (contrat L10 §2) : sauvegarder puis neutraliser `/etc/cron.d/digisante-preprod`, et
   consigner l'heure.
3. **Sauvegarde préalable** : `sudo DIGISANTE_ENV=preproduction $ROOT_LIB/infra/deploy/scripts/pg_dump_encrypted.sh`, puis
   `pnpm backup:check <manifeste>` (trio complet, `files_missing=0`). Copie du trio **hors VPS**.
   C'est le seul retour arrière possible, car les migrations sont à sens unique.
4. **Copie root au SHA candidat** (README §1.a) : mettre à jour le miroir `/var/lib/digisante-preprod/ops.git`, extraire et
   relire `install_root_scripts.sh` de `<SHA_CANDIDAT>`, puis
   `sudo DIGISANTE_ENV=preproduction bash /root/install_root_scripts-preprod.sh <SHA_CANDIDAT>`.
   Contrôler que `root-scripts.manifest` porte bien `environment=preproduction` et ce SHA.
5. **Provisioning en dry-run d'abord**, shell root, secrets par `read -rs` (jamais en argument) :
   ```bash
   read -rs VALKEY_PASSWORD; read -rs VALKEY_APP_PASSWORD; read -rs PG_RUNTIME_PASSWORD
   export VALKEY_PASSWORD VALKEY_APP_PASSWORD PG_RUNTIME_PASSWORD DIGISANTE_ENV=preproduction
   bash "$P" --only pg,valkey,nginx,cron          # dry-run : plan relu intégralement
   bash "$P" --apply --only pg,valkey             # rôle digisante_preprod_app + utilisateur ACL (ACL SAVE)
   bash "$P" --apply --only nginx,cron            # zones Nginx préprod, vhost, /etc/cron.d (nginx -t puis reload)
   ```
   Les crons réinstallés restent **suspendus** jusqu'au point 10 : suspendre de nouveau après `--only cron`.
   Le fichier Nginx commun n'est écrit que si la copie root de la production est absente ou alignée ; la production n'est
   pas installée à ce jour.
6. **`.env` de l'API** (compte `digisante-preprod`, 0600) :
   - `DATABASE_URL=postgresql://digisante_preprod_app:<PG_RUNTIME_PASSWORD>@127.0.0.1:5432/digisante_preprod?schema=public` ;
   - `REDIS_URL=redis://digisante-preprod:<VALKEY_APP_PASSWORD>@127.0.0.1:6379/5` ;
   - `REDIS_KEY_PREFIX="digisante-preprod:"`.
   Ne rien ajouter d'autre : aucune variable fournisseur (D-14), jamais l'URL du propriétaire.
   `deploy.sh` refuse un `.env` qui contient l'URL du propriétaire.
7. **Déploiement** :
   - **Recommandé** : workflow « Préproduction L10 (manuelle) » avec `sha=<SHA_CANDIDAT>` et `maintenance_confirmed=true`,
     après avoir posé la variable `PREPROD_DEPLOY_ENABLED=true` le temps de la fenêtre. Le workflow qualifie la CI, vérifie
     l'empreinte de l'hôte et transmet l'URL du propriétaire par l'entrée standard SSH.
   - **Variante manuelle** : README §3, `deploy.sh` de `origin/main` extrait hors du checkout, sous `digisante-preprod`,
     `MIGRATION_DATABASE_URL` par `read -rs`.
   - Attendu : `deploy_history.log` `ace0c689… -> <SHA_CANDIDAT> status=SUCCESS stage=complete`. Les stades `migrate` et
     `grants` passent sous le propriétaire, et l'API démarre sous `digisante_preprod_app`.
8. **Vérifications** :
   - `bash "$P" --verify` (avec `VALKEY_PASSWORD`) : **0 FAIL**, y compris les sondes `ACL DRYRUN` et les deux rôles PG ;
   - `sudo DIGISANTE_ENV=preproduction DOMAIN=preprod.digisantemobile.app $ROOT_LIB/infra/deploy/scripts/verify_deploy.sh`
     **sans** `--run-jobs` : tout PASS, ports 3100/3101 tenus par `digisante-preprod` seul ;
   - `/api/v1/ready` : `db: up, redis: up` ; `pm2 status` : `digisante-preprod-api` ×2 et `digisante-preprod-web` online ;
   - en-tête CSP d'une page : `script-src 'self' 'nonce-…' 'strict-dynamic'`, nonce différent à chaque requête ;
   - `/showcase` : 404.
9. **Sauvegarde post-déploiement** : nouveau trio, `backup:check`, copie hors VPS.
10. **Reprise des crons** et consignation de l'heure. Observer ensuite au moins une exécution réelle de chaque tâche
    (contrat L10 §4) : une ligne installée ne prouve pas l'exécution.
11. Remettre `PREPROD_DEPLOY_ENABLED` à `false`. La **maintenance reste posée** jusqu'au nouveau PV GO/NO-GO préprod.

## 4. Retour arrière

- **Échec avant migration** : `deploy.sh` s'arrête sans rollback automatique. Corriger et relancer sur le même SHA.
- **Échec après migration** : le code `ace0c689` ne connaît ni les deux nouvelles tables/colonnes ni le rôle d'exécution.
  Revenir en arrière demande :
  1. de restaurer **base et fichiers** du point 3 (README d'exploitation : restauration sous le rôle propriétaire, puis droits
     réappliqués) ;
  2. de remettre l'ancien `.env` (`DATABASE_URL` propriétaire, `REDIS_URL` sans utilisateur ACL, sans `REDIS_KEY_PREFIX`) ;
  3. de lancer un `deploy.sh` vers `ace0c689` avec `DEPLOY_ALLOW_ROLLBACK=1`.
  Le rôle `digisante_preprod_app` et l'utilisateur ACL peuvent rester en place.

## 5. Gestes de recette consécutifs aux changements

1. **Comptes de recette** : chacun accepte la version courante des CGU (`TermsGate`). Admins exclus.
2. **Pharmacies de recette** : soumettre puis faire approuver un dossier KYC complet pour reposer le badge `verifiedAt`.
   Sans ce badge, les cas de délivrance échouent.
3. **OTP** : les anciens verrous et compteurs (`otp:lock:<n°>`, `otp:attempts:<n°>`) ne sont plus lus et expirent en
   30 min. Un numéro bloqué se débloque depuis la console support (nouvelle époque).
4. **Textes légaux** : bandeau « Projet de texte » attendu. Ils ne sont pas validés juridiquement.

## 6. Registre L10 de la nouvelle candidate

Après la fusion de #228 (Claude Code le prépare dans cette PR) :

1. ✅ **fait le 08/11/2026** : registre de `ace0c689` archivé tel quel dans
   `docs/preproduction/archive/L10-ace0c689-2026-11-08/` (15 records PASS, instantané `d6bfcba2…`, SHA-256
   `d4d3aedc…`), comme pour `ec6b0dc`. Le registre courant n'est pas encore remplacé : il le sera au point 2 ;
2. déclarer le bloc candidat `<SHA_CANDIDAT>` (CI qualifiée) avec un registre vide, puis `pnpm preprod:prepare` et
   `pnpm preprod:check` ;
3. `pnpm preprod:gate --expected-sha <SHA_CANDIDAT>` : 100 points ouverts attendus.

Aucune preuve de `ace0c689` ne se transfère : les **100 cas** se rejouent sur la nouvelle candidate.

Points à observer en plus des 100 cas, sans élargir le registre sans décision du porteur :
- **CSP à nonce** sur Android ancien, iPhone et WebView, Daily et FCM compris, ainsi que le shell hors ligne ;
- **OTP** : verrou par IP derrière un NAT d'opérateur, et déverrouillage par la console support ;
- **APDP** : effacement de bout en bout sur un compte synthétique ;
- **Droits** : refus de `TRUNCATE`/`UPDATE` d'audit sous le rôle d'exécution, aucune erreur `NOPERM` dans les journaux de
  l'API.
