# Déploiement en préproduction de la nouvelle candidate — plan (8 novembre 2026)

**Plan, pas une preuve.** Rien de ce document n'a été exécuté sur l'hôte. Claude Code n'a aucun accès au VPS
`srv1.immipro.app` : chaque étape est à faire par l'opérateur, et chaque preuve à reporter dans `docs/suivi/LOT_L10.md`.

## 0. Candidate et décisions

| Point | Décision / état |
|---|---|
| Version à déployer | **`main` après fusion de la PR #228** (décision du porteur du 08/11/2026) : la recette L10 se fait une seule fois sur la configuration visée pour la production. |
| SHA candidat | `8ed7e540d2c5fe8724b7d9628ab1e1f4169368f8` = commit de fusion de #228 sur `main` (08/11/2026) ; CI `main` run 42442126623. |
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
| P7 | Opérateur | Copie root de la **production** à aligner sur le SHA candidat pendant la fenêtre (§3, point 4 b). Elle est installée sur l'hôte (`/usr/local/lib/digisante`, `environment=production`, `ec6b0dc…`) et le vhost `digisante` est actif : sans cet alignement, `--apply --only nginx` refuse de mettre à jour le fichier commun `conf.d/digisante-rate-limit.conf`. | `root-scripts.manifest` de la production : SHA candidat |

### 2.1 Constats sur l'hôte (12 novembre 2026, lecture seule)

| # | Constat | Suite |
|---|---|---|
| P1 | ✅ `aclfile /etc/valkey/users.acl` déclaré dans `valkey.conf` le 08/11 (copie `valkey.conf.avant-acl-20261108` conservée), Valkey redémarré le 08/11 à 06:38 ; `CONFIG GET aclfile` répond `/etc/valkey/users.acl`. Seul l'utilisateur `default` existe : `digisante-preprod` sera créé par `--only valkey`. Valkey **9.0.4** : sans effet sur la préproduction, mais la checklist production exige ≥ 9.1 pour les ACL `db=`. | Aucune avant la fenêtre |
| P2 | ✅ Sans objet : `pg_hba.conf` (PostgreSQL 18.6, `scram-sha-256`) ne nomme aucun rôle (`host all all 127.0.0.1/32` et `::1/128` en `scram-sha-256`), aucune règle `trust` en `host`, aucune erreur de chargement. Le rôle `digisante_preprod_app` n'existe pas encore (créé par `--only pg`). | Aucune |
| P5 | ⚠️ Disque 86 Go libres ; RAM 3,8 Go dont **1,77 Go disponibles** ; swap **2,3 Go utilisés sur 4 Go** (surtout ClamAV d'ImmiPro et MySQL de BeninLink) ; 2 vCPU, charge 0,5 ; aucun OOM sur 30 jours. `deploy.sh` ne borne pas la mémoire du build Next 15. | Pendant la fenêtre, arrêter la production DigiSanté sous maintenance (`sudo -u digisante pm2 stop all`, environ 200 Mo), puis la relancer après le point 8 |
| — | La **production n'est pas absente** de l'hôte, contrairement à ce que supposait ce plan : checkout `/var/www/digisante` détaché en `ec6b0dc`, PM2 `digisante-api` ×2 et `digisante-web` en ligne (ports 3200/3201 tenus par `digisante`), `/etc/cron.d/digisante` actif depuis le 15/10, maintenance `snippets/digisante-maintenance.conf` posée, copie root `ec6b0dc`. `/var/log/digisante*/deploy_history.log` sont vides. | P7 ; statut de cette production à trancher par le porteur (hors de ce plan) |

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
   relire `install_root_scripts.sh` de `8ed7e540d2c5fe8724b7d9628ab1e1f4169368f8`, puis
   `sudo DIGISANTE_ENV=preproduction bash /root/install_root_scripts-preprod.sh 8ed7e540d2c5fe8724b7d9628ab1e1f4169368f8`.
   Contrôler que `root-scripts.manifest` porte bien `environment=preproduction` et ce SHA.

   **4 b. Copie root de la production au même SHA (P7).** Même procédure, avec le miroir de la production
   (`/var/lib/digisante/ops.git`, sans `ops.env` : source HTTPS par défaut, dépôt public) :
   ```bash
   SHA=8ed7e540d2c5fe8724b7d9628ab1e1f4169368f8
   sudo git --git-dir=/var/lib/digisante/ops.git fetch --no-tags \
        https://github.com/malcomx2022/digisante-mobile.git '+refs/heads/main:refs/remotes/origin/main'
   sudo sh -c "umask 077; git --git-dir=/var/lib/digisante/ops.git show $SHA:infra/deploy/scripts/install_root_scripts.sh > /root/install_root_scripts.sh"
   sudo less /root/install_root_scripts.sh
   sudo DIGISANTE_ENV=production bash /root/install_root_scripts.sh "$SHA"
   sudo head -2 /usr/local/lib/digisante/root-scripts.manifest   # sha=8ed7e540…, environment=production
   ```
   Seuls les fichiers de `/usr/local/lib/digisante` changent : ni la crontab, ni `/etc/cron.d/digisante`, ni le code, PM2,
   la base ou Nginx de la production. Changements constatés entre `ec6b0dc` et `8ed7e540` dans les fichiers lancés par le
   cron de production :
   - `internal_job.sh`, `fedapay_reconcile.sh`, `healthwatch.sh` : contrôle `port_owned_by` (ports 3200/3201 tenus par
     `digisante`, vérifié le 12/11) ;
   - `rate-limit.conf` : ajout des zones `digisante_rl_preprod_*`, zones de production inchangées (le vhost `digisante`
     reste valide).

   `provision-ionos.sh` et `verify_deploy.sh` ne servent qu'à la main ; `crontab.example` n'est pas réappliqué.
5. **Provisioning en dry-run d'abord**, shell root, secrets par `read -rs` (jamais en argument) :
   ```bash
   read -rs VALKEY_PASSWORD; read -rs VALKEY_APP_PASSWORD; read -rs PG_RUNTIME_PASSWORD
   export VALKEY_PASSWORD VALKEY_APP_PASSWORD PG_RUNTIME_PASSWORD DIGISANTE_ENV=preproduction
   bash "$P" --only pg,valkey,nginx,cron          # dry-run : plan relu intégralement
   bash "$P" --apply --only pg,valkey             # rôle digisante_preprod_app + utilisateur ACL (ACL SAVE)
   bash "$P" --apply --only nginx,cron            # zones Nginx préprod, vhost, /etc/cron.d (nginx -t puis reload)
   ```
   Les crons réinstallés restent **suspendus** jusqu'au point 10 : suspendre de nouveau après `--only cron`.
   Le fichier Nginx commun `conf.d/digisante-rate-limit.conf` n'est réécrit que si le vhost de la production est inactif
   ou si sa copie root porte la même source (`provision-ionos.sh`, garde des fichiers communs). La production est active
   sur l'hôte : le point 4 b est donc **obligatoire**, et le dry-run doit annoncer « mis à jour pour les deux
   environnements (copies root alignées) ». Un `FAIL` sur ce fichier ⇒ revenir au point 4 b, ne jamais l'éditer à la main.
6. **`.env` de l'API** (compte `digisante-preprod`, 0600) :
   - `DATABASE_URL=postgresql://digisante_preprod_app:<PG_RUNTIME_PASSWORD>@127.0.0.1:5432/digisante_preprod?schema=public` ;
   - `REDIS_URL=redis://digisante-preprod:<VALKEY_APP_PASSWORD>@127.0.0.1:6379/5` ;
   - `REDIS_KEY_PREFIX="digisante-preprod:"`.
   Ne rien ajouter d'autre : aucune variable fournisseur (D-14), jamais l'URL du propriétaire.
   `deploy.sh` refuse un `.env` qui contient l'URL du propriétaire.
7. **Déploiement** :
   - **Recommandé** : workflow « Préproduction L10 (manuelle) » avec `sha=8ed7e540d2c5fe8724b7d9628ab1e1f4169368f8` et `maintenance_confirmed=true`,
     après avoir posé la variable `PREPROD_DEPLOY_ENABLED=true` le temps de la fenêtre. Le workflow qualifie la CI, vérifie
     l'empreinte de l'hôte et transmet l'URL du propriétaire par l'entrée standard SSH.
   - **Variante manuelle** : README §3, `deploy.sh` de `origin/main` extrait hors du checkout, sous `digisante-preprod`,
     `MIGRATION_DATABASE_URL` par `read -rs`.
   - Attendu : `deploy_history.log` `ace0c689… -> 8ed7e540d2c5fe8724b7d9628ab1e1f4169368f8 status=SUCCESS stage=complete`. Les stades `migrate` et
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
- **Copie root de la production (point 4 b)** : elle peut rester sur le SHA candidat. Le nouveau `rate-limit.conf` est
  un sur-ensemble de l'ancien et les nouveaux contrôles de port ne visent que les ports de la production.

## 5. Gestes de recette consécutifs aux changements

1. **Comptes de recette** : chacun accepte la version courante des CGU (`TermsGate`). Admins exclus.
2. **Pharmacies de recette** : soumettre puis faire approuver un dossier KYC complet pour reposer le badge `verifiedAt`.
   Sans ce badge, les cas de délivrance échouent.
3. **OTP** : les anciens verrous et compteurs (`otp:lock:<n°>`, `otp:attempts:<n°>`) ne sont plus lus et expirent en
   30 min. Un numéro bloqué se débloque depuis la console support (nouvelle époque).
4. **Textes légaux** : bandeau « Projet de texte » attendu. Ils ne sont pas validés juridiquement.

## 6. Registre L10 de la nouvelle candidate

Fait le 08/11/2026 après la fusion de #228 :

1. ✅ **fait le 08/11/2026** : registre de `ace0c689` archivé tel quel dans
   `docs/preproduction/archive/L10-ace0c689-2026-11-08/` (15 records PASS, instantané `d6bfcba2…`, SHA-256
   `d4d3aedc…`), comme pour `ec6b0dc` ;
2. ✅ bloc candidat `8ed7e540d2c5fe8724b7d9628ab1e1f4169368f8` déclaré (CI `main` run 42442126623) avec un registre vide ; instantané L10
   `e782821d…` à jour (`preprod:check` vert) ;
3. ✅ `pnpm preprod:gate --expected-sha 8ed7e540d2c5fe8724b7d9628ab1e1f4169368f8` : bloc candidat accepté, **100 points ouverts**.

Aucune preuve de `ace0c689` ne se transfère : les **100 cas** se rejouent sur la nouvelle candidate.

Points à observer en plus des 100 cas, sans élargir le registre sans décision du porteur :
- **CSP à nonce** sur Android ancien, iPhone et WebView, Daily et FCM compris, ainsi que le shell hors ligne ;
- **OTP** : verrou par IP derrière un NAT d'opérateur, et déverrouillage par la console support ;
- **APDP** : effacement de bout en bout sur un compte synthétique ;
- **Droits** : refus de `TRUNCATE`/`UPDATE` d'audit sous le rôle d'exécution, aucune erreur `NOPERM` dans les journaux de
  l'API.
