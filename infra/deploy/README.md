# Déploiement — VPS IONOS partagé (préprod + production)

Procédure de déploiement de **DigiSanté Mobile** sur le VPS IONOS partagé `srv1.immipro.app`
(31.70.148.167, Ubuntu 26.04 LTS) — dérogation porteur 13/10/2026 (remplace le VPS Infomaniak distinct). Architecture conforme à `CLAUDE.md` §3 et §7 :

```
GitHub Actions (push main, gates) ──SSH──▶ deploy.sh
                                      ├─ maintenance + arrêt anciens workers + SHA exact
                                      ├─ pnpm install --frozen-lockfile
                                      ├─ pnpm build
                                      ├─ prisma migrate deploy   (jamais db push)
                                      └─ pm2 delete (apps arrêtées) + startOrReload ecosystem.config.cjs

Nginx (reverse proxy + SSL Certbot)
  Préprod `preprod.digisantemobile.app` :
  ├─ /        → Next.js  127.0.0.1:3100   (digisante-preprod-web, PM2 fork)
  └─ /api/*   → Fastify  127.0.0.1:3101   (digisante-preprod-api, PM2 cluster ×2)
  Prod `digisantemobile.app` :
  ├─ /        → Next.js  127.0.0.1:3200   (digisante-web, PM2 fork)
  └─ /api/*   → Fastify  127.0.0.1:3201   (digisante-api, PM2 cluster ×2)

PostgreSQL 18.6 natif partagé (bases + rôles séparés) · Valkey natif (6379, /5 préprod, /6 prod, utilisateur ACL + préfixe de clés/canaux par environnement) · cron pg_dump chiffré · réconciliation FedaPay 02:30
Ports 3000 (ImmiPro) et 3001 (Grafana) pris sur l'hôte — ne jamais les réutiliser pour DigiSanté.
```

> 🔒 Décisions verrouillées : Postgres **natif** partagé (18.6 sur l'hôte IONOS ; pas de Supabase/managé), VPS IONOS partagé
> (dérogation 13/10/2026 ; pas de Vercel/Railway), DigiSanté n'utilise **pas** Docker (Docker présent sur l'hôte pour ImmiPro). Le `docker-compose` est réservé au dev local.

---

## 1. Provisioning initial (une fois, en root)

> 🔒 **Bloquant B3 — root n'exécute JAMAIS un fichier du checkout applicatif** (`/var/www/digisante-preprod`
> ou `/var/www/digisante`). Ce checkout appartient à l'utilisateur PM2 de l'environnement (`digisante-preprod`
> / `digisante`) : une exécution de code dans l'API pourrait le réécrire — et, sur l'hôte partagé, menacer aussi
> ImmiPro/BeninLink. Tout ce que root exécute, source ou installe comme configuration (crons, sauvegarde,
> surveillance, provisioning, Nginx, logrotate, crontab) est listé dans `infra/deploy/root-scripts.list` et copié
> par `install_root_scripts.sh <SHA>` dans une copie **root:root propre à chaque environnement**, depuis un miroir
> nu **propre à root**, jamais depuis l'arbre de travail, le `.git` ni la configuration distante du checkout.
> Préprod et prod pouvant tourner des SHA différents, leurs copies root sont distinctes.
>
> 🔒 **`DIGISANTE_ENV` (preproduction | production) est OBLIGATOIRE, sans défaut**, pour `ecosystem.config.cjs`
> et chaque script d'exploitation (bloc `digisante_profile`, copie identique, test de non-dérive
> `scripts/infra/environments.test.mjs`). Il fixe noms PM2, ports (3100/3101 · 3200/3201), URL locale de l'API
> (jamais 3000/3001), et les chemins par défaut : checkout, utilisateur, journaux, copie root, `/etc`, `/var/lib`,
> sauvegardes, base, fichier `/etc/cron.d/digisante[-preprod]`. Chaque script root refuse une copie root d'un autre
> environnement ; le manifeste root inscrit l'environnement (contrôlé par `verify_deploy.sh`).

```bash
# Environnement (hôte partagé) — préprod ; prod : DIGISANTE_ENV=production SUFFIX= (vide), domaine digisantemobile.app
export DIGISANTE_ENV=preproduction SUFFIX=-preprod
SHA=<SHA_COMPLET_QUALIFIE>
# Rappel des défauts du profil, utilisés par les commandes manuelles ci-dessous :
ROOT_LIB=/usr/local/lib/digisante${SUFFIX} OPS_MIRROR=/var/lib/digisante${SUFFIX}/ops.git OPS_CONF=/etc/digisante${SUFFIX}/ops.env

# 1.a Miroir root + copie root de l'installateur (SHA complet qualifié, sur main)
sudo install -d -o root -g root -m 0700 /etc/digisante${SUFFIX} /var/lib/digisante${SUFFIX}
# Optionnel : autre source que le défaut https://github.com/malcomx2022/digisante-mobile.git
# (dépôt privé : clé de déploiement LECTURE SEULE de root + URL ssh ; aucun identifiant dans l'URL)
#   sudo sh -c "umask 077; echo 'OPS_REPO_URL=git@github.com:malcomx2022/digisante-mobile.git' > $OPS_CONF"
sudo git init --bare --quiet "$OPS_MIRROR"
sudo git --git-dir="$OPS_MIRROR" fetch --no-tags \
     https://github.com/malcomx2022/digisante-mobile.git '+refs/heads/main:refs/remotes/origin/main'
sudo sh -c "umask 077; git --git-dir='$OPS_MIRROR' show $SHA:infra/deploy/scripts/install_root_scripts.sh > /root/install_root_scripts${SUFFIX}.sh"
sudo less /root/install_root_scripts${SUFFIX}.sh            # relire avant exécution
sudo DIGISANTE_ENV="$DIGISANTE_ENV" bash /root/install_root_scripts${SUFFIX}.sh "$SHA"   # → $ROOT_LIB + manifeste (environment=)

# 1.b Provisioning de l'hôte partagé : provision-ionos.sh, depuis la COPIE ROOT (voir ci-dessous)
```

### 1.b Provisioning de l'hôte partagé — `provision-ionos.sh`

`provision.sh` cible l'ancien VPS vierge Ubuntu 22.04 / PG16 / Redis : il **refuse** désormais tout autre OS.
Sur l'hôte IONOS (Ubuntu 26.04, PostgreSQL 18.6 et Valkey **natifs déjà en place**, Nginx/Certbot/UFW/Fail2Ban
en service pour ImmiPro, BeninLink et la supervision), utiliser **`infra/deploy/scripts/provision-ionos.sh`**,
toujours depuis la copie root de l'environnement (B3). Un environnement par exécution (`DIGISANTE_ENV`).

**Ce qu'il fait** (idempotent ; `--dry-run` par défaut, `--apply` explicite) :

| Étape (`--only`) | Effet à l'application |
|---|---|
| `users` | `digisante[-preprod]` (shell bash, groupe propre, **membre de `sshusers`**, mot de passe verrouillé) ; `digisante[-preprod]-jobs` système sans droits (B3). Jamais `docker`, `sudo`, `adm`, `disk`, `shadow`… ni règle sudoers (`sudo -l -U`, `%sshusers`) : refus si un compte existant en relève. Clé de déploiement (`DEPLOY_SSH_PUBKEY`) écrite **`restrict <clé>`** : ni redirection de ports vers Valkey/PG/3000/3001, ni agent, ni PTY |
| `dirs` | checkout `/var/www/digisante[-preprod]` et journaux (utilisateur, 0750), magasin `/var/lib/digisante[-preprod]-files` (utilisateur, **0700**, B4), `/etc/digisante[-preprod]` et `/var/backups/digisante[-preprod]` (root **0700**), journaux cron root 0750, webroot ACME `/var/www/digisante-acme` |
| `pg` | rôle `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`, base `UTF8`/`template0` dont il est propriétaire, `CONNECT` retiré à `PUBLIC`. Mot de passe : seul un **vérificateur SCRAM-SHA-256 calculé sur l'hôte** (Node) part au serveur, par `\getenv` — le mot de passe en clair n'atteint jamais PostgreSQL (journaux, `pg_stat_statements`, `pg_stat_activity`) ni `ps`. **Ne modifie jamais `pg_hba.conf`** ni un rôle/une base existants |
| `valkey` | réserve l'index (`SET digisante:owner <env> NX`) et crée/met à jour l'**utilisateur ACL de l'API** (`digisante[-preprod]`, clés et canaux `digisante[-preprod]:*` seulement, commandes de l'API seulement — bloc `valkey-acl`), `ACL SETUSER` par l'entrée standard avec l'empreinte `#SHA-256` de `VALKEY_APP_PASSWORD`, puis `ACL SAVE` — aucune autre écriture, **jamais `FLUSHDB`/`FLUSHALL`** ; mots de passe par `REDISCLI_AUTH`/environnement, jamais affichés |
| `runtime` | PM2 `7.0.4` global (seulement s'il est absent), pnpm `9.12.0` mis en **cache corepack** de l'utilisateur — `deploy.sh` place en tête du PATH un shim `pnpm` → `corepack pnpm` (version du `packageManager`, appels imbriqués comme `pnpm -r build` compris), jamais le pnpm global 12.x de l'hôte —, service `pm2-<utilisateur>` au démarrage. Node **jamais** réinstallé (24 exigé). npm/pm2/certbot ne reçoivent jamais les secrets de la session root |
| `secrets` | `backup.key` générée sur l'hôte (0400, jamais affichée), `reconcile.token` aligné sur le `RECONCILE_TOKEN` du `.env` (0400), modèle `alert.conf` |
| `nginx` | `nginx -t` vert exigé **avant** toute écriture ; instantané des fichiers DigiSanté (communs + vhost + lien) ; fichiers communs préfixés `digisante` (`conf.d/digisante-rate-limit.conf`, `snippets/digisante-{headers,hsts}.conf`, jamais réécrits si l'autre environnement est actif et qu'ils diffèrent) ; vhost HTTP d'amorçage ACME **chaque fois que le site n'est pas actif** (premier passage ou après `--rollback`) ; certificat par `certbot certonly --webroot` (**`--dry-run` Let's Encrypt d'abord**, `--cert-name` dédié, jamais `--nginx` : Certbot ne réécrit aucun vhost) ; `certbot renew --cert-name … --dry-run` ; puis HSTS et vhost TLS complet, `reload`. Tout refus de `nginx -t` **restaure l'instantané** (fichiers absents avant ⇒ retirés) puis recharge |
| `cron` | `/etc/cron.d/digisante[-preprod]` (sauvegarde 02:00 en production / 01:30 en préproduction — travaux lourds décalés, réconciliation FedaPay 02:30, healthwatch toutes les 5 min, générateurs/dispatch, renouvellement TLS limité au `--cert-name`) et `/etc/logrotate.d/digisante[-preprod]`, depuis la copie root (B3 : aucun chemin sous le checkout) |

**Gardes (lecture seule, avant toute écriture — un seul échec ⇒ rien n'est écrit)** : refus sous `bash -x`
(la trace afficherait les secrets) ; chemins **canoniques** du profil uniquement (une variable héritée `DB_NAME`,
`APP_DIR`, `APP_USER`, `CRON_FILE`… est ignorée) ; OS `ubuntu 26.04` ;
copie root de **cet** environnement ; sources (vhost, crontab, logrotate) de la copie root, vhost sans
`127.0.0.1:3000/3001` et upstreams = ports du profil ; ports 3100/3101 · 3200/3201 libres ou tenus par
l'utilisateur de l'environnement (3000/3001 : seulement signalés) ; comptes existants sans groupe privilégié
(`docker`, `sudo`, `adm`, `disk`, `shadow`…), ni uid 0, ni autorisation sudoers, groupe `sshusers` présent et
sans règle sudoers ; Node 24 + corepack ; PostgreSQL 18 ; rôle existant **sans** attribut privilégié ni
appartenance à d'autres rôles ; base existante **de ce rôle** (sinon refus : jamais une base d'ImmiPro/BeninLink) ;
`pg_hba` : une connexion **sans mot de passe** vers `127.0.0.1` (comme `DATABASE_URL`) doit être refusée faute de
mot de passe — une règle `trust` antérieure ou l'absence de règle donne **FAIL** (à corriger à la main) ; Valkey
joignable, index **vide ou déjà marqué pour cet environnement**, l'autre index jamais marqué pour lui, **aucune
éviction** (`noeviction` ou `maxmemory 0`, sinon FAIL : les verrous OTP et sessions DigiSanté seraient évincés par
la charge des voisins ; CONFIG refusé par ACL ⇒ NOTE à constater) ; Nginx et **Certbot** présents ; domaine non
déclaré par un autre vhost (liens de `sites-enabled` suivis), zones/format `digisante_*` non redéfinis ailleurs,
fichiers communs identiques à cette copie root si l'autre environnement est actif (mis à jour seulement si la
copie root de l'autre environnement porte la même source : les deux passent ensemble) ; **serveur de repli**, par
famille d'adresses (`443`/`80` et `[::]:443`/`[::]:80`, ordre de chargement réel lu par `nginx -T`) : sans
`default_server` explicite générique (une écoute liée à une adresse ou QUIC ne compte pas), DigiSanté ne doit pas
être chargé avant un vhost voisin (sinon FAIL : il deviendrait le site servi pour un accès par IP ou sans SNI) ;
aucun voisin en IPv6 ⇒ NOTE (DigiSanté y serait le repli IPv6, point 6) ; DNS A = `31.70.148.167` et aucun AAAA vers un
autre hôte (`HOST_PUBLIC_IP6` si un AAAA vise cet hôte) ; aucune planification root (crontab root, `/etc/crontab`,
`/etc/cron.d/*`, `/etc/cron.{hourly,daily,weekly,monthly}`) ne lance un chemin du checkout (B3, chemins normalisés).
Deux rôles PostgreSQL par environnement (revue GO du 22/10/2026) : `<base>` **propriétaire/migrateur** et
`<base>_app` **rôle d'exécution** de l'API (NOINHERIT, aucun privilège ni appartenance ; droits sur les tables posés
par `deploy.sh` après chaque migration : DML, `audit_logs`/`finance_entries` en INSERT/SELECT seulement).
En `--apply`, `PG_APP_PASSWORD` (propriétaire) et `PG_RUNTIME_PASSWORD` (exécution, **distinct**), si le rôle est à
créer (**24 à 256 caractères ASCII imprimables, sans
espace** — vérificateur SCRAM sans normalisation ; `openssl rand -hex 24` évite aussi l'encodage d'URL), et
`LETSENCRYPT_EMAIL` (si le certificat est à émettre) sont exigés **avant** la première écriture.

#### Vérifications sur l'hôte AVANT `--apply` (opérateur, lecture seule, aucun secret affiché)

Le dry-run les évalue, mais elles exigent l'accès à l'hôte et ne sont **pas** prouvées par cette préparation :

1. **Index Valkey 5 et 6 libres** — le dry-run interroge `DBSIZE` et le marqueur (mot de passe par
   `REDISCLI_AUTH`, saisi par `read -rs`) ; vérifier aussi (si l'ACL l'autorise) `CONFIG GET databases` ≥ 7 et qu'aucune application
   (ImmiPro, BeninLink, Grafana) n'est configurée sur `/5` ou `/6` (leurs `.env`/configurations, sans copier de
   secret). L'étape `valkey` crée l'**utilisateur ACL de l'API** de l'environnement (résiduel 2 ci-dessous) ; elle
   exige un **fichier ACL** déclaré (`CONFIG GET aclfile` non vide, sinon refus avant écriture : l'utilisateur serait
   perdu au redémarrage) et un compte d'administration Valkey (`VALKEY_PASSWORD`/`VALKEY_USERNAME`) autorisé à
   `ACL SETUSER`/`ACL SAVE`. Déclarer `aclfile` relève de l'administrateur de l'hôte (jamais `CONFIG REWRITE` du
   `valkey.conf` partagé par ce script) ; constater aussi qu'aucun utilisateur ACL `digisante`/`digisante-preprod`
   n'existe déjà avec d'autres clés (sinon refus).
2. **`pg_hba.conf`** — une ligne `host <base> <rôle> 127.0.0.1/32 scram-sha-256` (et `::1/128`) par environnement,
   ajoutée **à la main**, placée **avant** toute règle `trust`/`all` plus large (la première règle applicable
   décide), puis `SELECT pg_reload_conf()` ; le script ne touche jamais ce fichier et le vérifie par une connexion
   sans mot de passe, qui doit être refusée.
3. **Groupe `sshusers`** et `AllowGroups` de `sshd` ; **aucune règle sudoers** pour `%sshusers`
   (`grep -R sshusers /etc/sudoers /etc/sudoers.d`) ; `sshd -T -C user=digisante${SUFFIX},host=x,addr=203.0.113.1`
   → `allowtcpforwarding no` souhaité (la clé de CI est de toute façon `restrict`) ; Fail2Ban actif ; UFW :
   80/443 ouverts (jamais 3100-3201).
4. **DNS** : `preprod.digisantemobile.app`, `digisantemobile.app`, `www.digisantemobile.app` → `31.70.148.167`
   (A ; pas d'AAAA vers un autre hôte — un AAAA de parking IONOS ferait échouer Let's Encrypt), avant toute
   émission de certificat.
5. **Certbot** : version et chemin (`command -v certbot` ; snap ⇒ `/snap/bin`, présent dans le PATH des crons),
   `systemctl list-timers certbot.timer` (le timer système renouvelle aussi ce certificat ; le hook de rechargement
   est enregistré dans `/etc/letsencrypt/renewal/<nom>.conf`), et **`ls -l /etc/letsencrypt/renewal-hooks/{pre,post,deploy}`** :
   les hooks globaux `pre`/`post` des autres applications s'exécutent à chaque `certbot renew --dry-run` du script ;
   les hooks `deploy` seulement au premier vrai renouvellement du certificat DigiSanté (cron ou `certbot.timer`) —
   les relire avant, et prévenir leurs responsables.
6. **Nginx** : `include /etc/nginx/conf.d/*.conf` et `sites-enabled/*` présents dans `nginx.conf` ; aucun vhost
   existant ne déclare les domaines DigiSanté ; un **`default_server` explicite** sur 443 (et le site `default`
   d'Ubuntu sur 80), sinon le dry-run échoue si DigiSanté devenait le serveur de repli ; en IPv6 (`[::]:443`), si
   aucun voisin n'y écoute, DigiSanté y deviendrait le repli : vérifier qu'aucun voisin n'est publié en AAAA sans
   écoute IPv6 (il recevrait le certificat DigiSanté), sinon `default_server` IPv6 par l'administrateur ; `nginx -t`
   vert AVANT intervention.
7. **Ports** : `ss -ltnp` — 3100/3101/3200/3201 libres ; 3000 (ImmiPro) et 3001 (Grafana) jamais touchés.
   **Node 24** installé pour tout l'hôte (`/usr/bin/node`, pas un `nvm` réservé à root) : PM2 et `deploy.sh`
   tournent sous le compte applicatif (`--verify` le contrôle sous ce compte).
8. **Fuseau** (`timedatectl`) : `Africa/Porto-Novo` attendu par `verify_deploy.sh` ; décision du porteur si
   l'hôte partagé est sur un autre fuseau (résiduel 3).
9. **Sauvegarde préalable de la configuration de l'hôte** (`/etc/nginx`, `/etc/cron.d`, `/etc/logrotate.d`,
   `pg_dumpall --roles-only`) et fenêtre de maintenance convenue avec les autres applications.
10. **Valkey** : `valkey-server --version`, `CONFIG GET maxmemory maxmemory-policy appendonly save` (si l'ACL le
    permet) — `noeviction` attendu et persistance active (sinon un redémarrage efface verrous OTP et sessions) ;
    politique d'éviction exigée par une autre application ⇒ décision porteur : instance Valkey dédiée.
11. **Capacité** (hôte 4 Go partagé) : `free -m`, swap, `df -h /var/backups /var/lib /var/www`, RSS des voisins
    (`ps -eo rss,comm --sort=-rss | head`), `SHOW max_connections` (2 environnements × 2 workers × pool Prisma) et
    `SHOW port` = 5432. PM2 redémarre un processus au-delà de 512 Mo (3 par environnement), mais ne plafonne pas la
    mémoire : un plafond systemd (`MemoryMax` sur `pm2-<utilisateur>`) relève d'une décision porteur/hôte.

#### Ordre d'exécution (par environnement : préproduction d'abord)

```bash
sudo -i                                                  # shell root : secrets jamais sur la ligne de commande
export DIGISANTE_ENV=preproduction SUFFIX=-preprod        # prod : DIGISANTE_ENV=production SUFFIX=
P=/usr/local/lib/digisante${SUFFIX}/infra/deploy/scripts/provision-ionos.sh
read -rs -p 'VALKEY_PASSWORD (coffre) : ' VALKEY_PASSWORD; echo; export VALKEY_PASSWORD
# Utilisateur ACL de l'API (distinct, 32 à 256 caractères [A-Za-z0-9._~-] : openssl rand -hex 32) ; seule
# son empreinte SHA-256 part au serveur, par l'entrée standard de valkey-cli. Facultatif si l'utilisateur
# existe déjà (règles réappliquées, mot de passe conservé) ; le fournir = rotation.
read -rs -p 'VALKEY_APP_PASSWORD (coffre) : ' VALKEY_APP_PASSWORD; echo; export VALKEY_APP_PASSWORD
# export VALKEY_USERNAME=<utilisateur ACL>               # si ACL Valkey

# 1) DRY-RUN (défaut) : gardes + plan, AUCUNE écriture. Relire le plan intégralement.
bash "$P"

# 2) APPLICATION, éventuellement par étapes (--only users,dirs puis pg,valkey …)
read -rs -p 'PG_APP_PASSWORD (coffre, 24-256 ASCII sans espace) : ' PG_APP_PASSWORD; echo; export PG_APP_PASSWORD
read -rs -p 'PG_RUNTIME_PASSWORD (coffre, distinct) : ' PG_RUNTIME_PASSWORD; echo; export PG_RUNTIME_PASSWORD
export LETSENCRYPT_EMAIL=<contact d'exploitation>
bash "$P" --apply --only users,dirs,pg,valkey,runtime
bash "$P" --apply --only nginx      # certificat : dry-run Let's Encrypt, émission, renew --dry-run, vhost TLS
bash "$P" --apply --only cron
unset PG_APP_PASSWORD PG_RUNTIME_PASSWORD

# 3) Checkout applicatif (données seulement : aucun script n'y est lancé en root) puis .env (§2)
sudo -u digisante${SUFFIX} git clone https://github.com/malcomx2022/digisante-mobile.git /var/www/digisante${SUFFIX}
# … .env de l'API et du web depuis .env.preprod.example / .env.prod.example (§2), RECONCILE_TOKEN compris
bash "$P" --apply --only secrets    # backup.key (copie HORS VPS) + reconcile.token aligné sur le .env

# 4) VÉRIFICATION post-provisioning (lecture seule) — à relancer après le premier déploiement (§3) ;
#    VALKEY_PASSWORD exigé à chaque --verify (sans lui : FAIL, marqueur/éviction non vérifiés)
bash "$P" --verify
unset VALKEY_PASSWORD
```

#### Liste de vérification post-provisioning (`--verify`, PASS/FAIL, sortie non nulle si un point échoue)

- comptes : applicatif ∈ `sshusers`, aucun groupe privilégié ni autorisation sudoers ; compte des tâches distinct
  (uid/gid) ; clés SSH de l'utilisateur toutes `restrict` ;
- répertoires : propriétaires et modes exacts (tableau ci-dessus), copie root `root 0755` ;
- PostgreSQL : rôle sans privilège ni appartenance, base du rôle, `PUBLIC` sans `CONNECT`, `pg_hba` exigeant un
  mot de passe (sonde sans mot de passe refusée) ;
- Valkey : marqueur `digisante:owner` = environnement sur son index ; aucune éviction ; utilisateur ACL de l'API
  actif avec mot de passe, droits effectifs mesurés par `ACL DRYRUN` (préfixe de l'environnement seul, aucune commande
  d'administration) ; `.env` de l'API sous cet utilisateur et ce `REDIS_KEY_PREFIX` ;
- Node 24 **pour le compte applicatif**, service `pm2-<utilisateur>` activé ; `corepack pnpm --version` = 9.12.0 dans
  le checkout, hors ligne (cache de la version utilisée par le shim de `deploy.sh`) ;
- Nginx : `nginx -t`, vhost activé et **identique** à la copie root, certificat présent, maintenance signalée
  (NOTE active/inactive) ;
- cron : `/etc/cron.d/…` identique à la copie root et **sans chemin sous le checkout (B3)**, aucune autre
  planification root sous le checkout ; logrotate installé ;
- `backup.key` présente ;
- **B4** : `.env` de l'API au chemin canonique (aucun lien), fichier de l'utilisateur, jamais modifiable par le
  groupe ou les autres ; `KYC_STORAGE_DIR` présent et **absolu**, magasin accepté par `filestore-dir.mjs` (module
  exécuté par root seulement depuis une copie de confiance)
  (propriété de l'utilisateur, 0700, nom sûr), puis `files_count=<n> ≥ références=<m>` (références UUID de
  `documents`/`kyc_documents` ; reporté tant que la base n'est pas migrée).

Puis, après le premier déploiement (§3) : `verify_deploy.sh` (§ Exploitation), première sauvegarde
`pg_dump_encrypted.sh` et `check-backup.mjs <manifeste>` (deux archives, `files_missing=0`).

#### Rollback

`bash "$P" --rollback` (dry-run) puis `bash "$P" --rollback --apply` retire **seulement** les artefacts sans
données de l'environnement : vhost (`sites-enabled`/`sites-available`), fichier de maintenance de l'environnement,
fichiers Nginx communs **si l'autre environnement n'est plus actif**, `/etc/cron.d/digisante[-preprod]`, logrotate,
processus et service PM2 de l'utilisateur ; `nginx -t` puis reload. Un nouveau `--apply --only nginx` après rollback
(certificat conservé) réinstalle d'abord l'amorçage ACME, puis `renew --dry-run`, HSTS et vhost TLS. Il **conserve** comptes, base et rôle, index Valkey, magasin de fichiers,
`/etc/digisante[-preprod]`, sauvegardes et certificat : leur suppression est une décision humaine, après
sauvegarde vérifiée (`DROP DATABASE`/`DROP ROLE`, `DEL digisante:owner` sur le seul index concerné,
`certbot delete --cert-name …`, `userdel`) — jamais `FLUSHDB`/`FLUSHALL`, jamais un objet d'une autre application.
Un échec de `nginx -t` pendant l'application restaure **tous** les fichiers Nginx DigiSanté de l'étape à leur
état d'avant (fichiers absents avant ⇒ retirés) puis recharge ; en dernier recours,
`rm /etc/nginx/sites-enabled/digisante${SUFFIX} && nginx -t && systemctl reload nginx`.

Chaque script root refuse de s'exécuter depuis un emplacement modifiable par un autre
compte (`trusted_path`) ou depuis la copie root de l'autre environnement.

## 2. Secrets sur le VPS (jamais commités — `CLAUDE.md` §4)

Modèles **sans aucune valeur secrète** : `.env.preprod.example` et `.env.prod.example` (mêmes clés que
`.env.example`, test de parité). Les champs secrets y sont **vides exprès** : l'API refuse de démarrer tant qu'ils
ne sont pas renseignés depuis le coffre. Clés **distinctes par environnement** (jamais la clé de santé ni le JWT
de production en préproduction). Fournisseurs : en base chiffrée via `/admin/integrations` (prime sur le `.env`).

```bash
cd /var/www/digisante-preprod                                  # prod : /var/www/digisante, utilisateur digisante
# API : modèle de l'environnement, puis secrets du coffre (DATABASE_URL, REDIS_URL index /5 — prod /6 —,
# JWT_SECRET, HEALTH_ENCRYPTION_KEY, RECONCILE_TOKEN), saisis sur l'hôte, jamais collés dans un ticket/chat.
sudo -u digisante-preprod install -m 0600 .env.preprod.example apps/api/.env   # prod : .env.prod.example
sudo -u digisante-preprod nano apps/api/.env
# API_PORT/API_HOST du .env sont SANS EFFET en exploitation : ecosystem.config.cjs impose le port de
# l'environnement et 127.0.0.1 (l'environnement PM2 prime sur le .env ; l'API lit API_PORT, pas PORT).
# 0600 : lisible par l'utilisateur de l'environnement SEUL (deploy.sh le vérifie).

# Magasin de fichiers (KYC + pièces jointes DMP = données de santé) : KYC_STORAGE_DIR de ce
# .env, chemin ABSOLU (modèle : /var/lib/digisante[-preprod]-files, créé 0700 par provision-ionos.sh).
# La sauvegarde root le lit ICI comme donnée (B4 : util.parseEnv, jamais `source`) ; vide ⇒
# apps/api/storage/kyc, comme l'API. Valeur écrite par l'utilisateur de l'environnement ⇒ hostile
# pour root (B3) : le répertoire DOIT appartenir à digisante${SUFFIX} (APP_USER du profil, jamais root,
# jamais l'utilisateur de l'AUTRE environnement), être en 0700 (aucune écriture groupe/autres) et
# porter un nom simple (lettres, chiffres, « . _ @ + - », jamais de « - » initial) ;
# sinon la sauvegarde échoue AVANT le dump. Il est archivé SOUS L'IDENTITÉ de cet utilisateur
# (`sudo -u digisante${SUFFIX} -- tar … -- <nom>`) : un fichier que l'API ne peut pas lire
# fait échouer la sauvegarde au lieu d'être lu par root.

# Web — apps/web/.env.production (figé AU BUILD) : NEXT_PUBLIC_API_URL VIDE (même origine, Nginx)
# et les six NEXT_PUBLIC_FIREBASE_* publics ; mêmes noms que le modèle de l'environnement.
sudo -u digisante-preprod sh -c 'umask 077; grep -E "^NEXT_PUBLIC_" .env.preprod.example > apps/web/.env.production'

# Fichiers root de /etc/digisante${SUFFIX} — posés par provision-ionos.sh --only secrets (§1.b) :
#   backup.key       AES-256 des sauvegardes, générée sur l'hôte (0400) — COPIE HORS VPS obligatoire
#   reconcile.token  = RECONCILE_TOKEN du .env (0400), source des tâches cron (jamais dans la crontab) ;
#                    un écart ⇒ toutes les tâches répondent 401
#   alert.conf       destinataire des alertes healthwatch (RUNBOOK_Alertes.md), à renseigner
# Compte SANS DROITS des requêtes de tâches (B3), créé par l'étape users : digisante${SUFFIX}-jobs
# (curl et réponse de l'API sous ce compte, setpriv/no_new_privs ; ni root, ni l'utilisateur applicatif).
```

`DATABASE_URL` (PostgreSQL 18 natif partagé, TCP local — règle `pg_hba` scram-sha-256 pour **chacun** des deux rôles, §1.b),
**rôle d'exécution seulement** (`PG_RUNTIME_PASSWORD`) :
`postgresql://digisante_preprod_app:<mot de passe URL-encodé>@127.0.0.1:5432/digisante_preprod?schema=public` (préprod)
`postgresql://digisante_app:<mot de passe URL-encodé>@127.0.0.1:5432/digisante?schema=public` (prod)
L'URL du **propriétaire** (`postgresql://digisante[_preprod]:<PG_APP_PASSWORD>@…`) n'est **jamais** écrite sur l'hôte :
secret GitHub `PREPROD_DB_MIGRATION_URL` / `DB_MIGRATION_URL` (transmis par l'entrée standard SSH,
`scripts/deploy/ssh-deploy.sh`) ou saisie `read -rs` au déploiement manuel. `deploy.sh` refuse un `.env` qui la contient.
`REDIS_URL` (Valkey) : **utilisateur ACL de l'environnement** (`VALKEY_APP_PASSWORD`, jamais le mot de passe
d'administration de l'hôte) et index obligatoire ; `REDIS_KEY_PREFIX` = préfixe des clés **et** des canaux :
`REDIS_URL=redis://digisante-preprod:<VALKEY_APP_PASSWORD>@127.0.0.1:6379/5` + `REDIS_KEY_PREFIX=digisante-preprod:` (préprod)
`REDIS_URL=redis://digisante:<VALKEY_APP_PASSWORD>@127.0.0.1:6379/6` + `REDIS_KEY_PREFIX=digisante:` (prod)
`deploy.sh` refuse un autre utilisateur (dont `default`), un autre préfixe ou son absence ; l'API refuse de démarrer
en production sans préfixe.

## 3. Premier déploiement

Qualifier le SHA et vérifier la maintenance Nginx. Sauvegarde complète avant migration sur cible alimentée ; premier bootstrap vierge déclaré. Procédure préproduction L10 : `../../docs/CONTRAT_Preproduction_L10.md`.

**Maintenance Nginx (root)** — chaque vhost inclut `snippets/digisante${SUFFIX}-maintenance[.]conf`, fichier
**facultatif** (le motif tolère son absence : le vhost reste identique à la copie root et `--verify` le signale en
NOTE). Il ne concerne que le bloc HTTPS de **cet** environnement : le challenge ACME et la redirection du port 80
restent servis ; les tâches cron appellent l'API en local (127.0.0.1), hors Nginx. Les webhooks FedaPay reçoivent
403/503 pendant la fenêtre (retries FedaPay puis réconciliation 02:30).

```bash
MAINT=/etc/nginx/snippets/digisante${SUFFIX}-maintenance.conf
# Recette : seule l'IP de recette (et l'IP publique de l'hôte, pour verify_deploy.sh) passent ; si un AAAA
# vise cet hôte (HOST_PUBLIC_IP6), ajouter aussi « allow <IPv6 de l'hôte>; » (sinon verify_deploy.sh : 403).
printf 'allow %s;\nallow 31.70.148.167;\ndeny all;\n' '<IP_RECETTE>' | sudo install -o root -g root -m 0644 /dev/stdin "$MAINT"
#   (fermeture totale : printf 'return 503;\n' | sudo install … /dev/stdin "$MAINT")
sudo nginx -t && sudo systemctl reload nginx
curl -sI https://<domaine>/ | head -1        # depuis une autre IP : 403 (ou 503)
# Levée, après vérification cible et autorisation d'ouverture :
sudo rm -f "$MAINT" && sudo nginx -t && sudo systemctl reload nginx
```

```bash
# Outillage = deploy.sh de origin/main extrait HORS du checkout (comme les workflows), jamais celui
# du checkout : bash relit le fichier ouvert même après `git switch` (cf. ci-dessous).
# URL du rôle PROPRIÉTAIRE saisie DANS le shell du compte (sudo -u réinitialise l'environnement), jamais en argument.
sudo -u digisante-preprod bash -c 'read -rs -p "MIGRATION_DATABASE_URL (propriétaire, coffre) : " MIGRATION_DATABASE_URL; echo; export MIGRATION_DATABASE_URL \
  && cd /var/www/digisante-preprod && git fetch origin main \
  && M="$(git rev-parse --verify "origin/main^{commit}")" && F="$(mktemp)" \
  && git show "$M:infra/deploy/scripts/deploy.sh" > "$F" \
  && DEPLOY_TOOLING_SHA="$M" DEPLOY_REF=<SHA_COMPLET_QUALIFIE> DEPLOY_ENVIRONMENT=preproduction \
     DEPLOY_MAINTENANCE_READY=1 bash "$F"; rc=$?; rm -f "$F"; exit $rc'
# Prod : compte digisante, /var/www/digisante, DEPLOY_ENVIRONMENT=production (même forme).
```

⚠️ **Toujours le `deploy.sh` de `main` extrait hors du checkout, comme les workflows** — jamais
`bash infra/deploy/scripts/deploy.sh` depuis le checkout : bash continue de lire le fichier ouvert même après
`git switch`. Un checkout antérieur à #209 exécuterait l'ancien script (sans `pm2 delete`) : migrations
appliquées, puis app API restée sur `dist/server.js`, muette, readiness en échec.

Le déploiement accepte le SHA courant ou un descendant de ce checkout. Une CI ancienne
terminée après une version plus récente est refusée **avant l'arrêt PM2, le checkout et
les migrations**. Le verrou `deploy.lock` dans le répertoire de journaux de l'environnement
refuse aussi une invocation manuelle concurrente.

Avant l'arrêt PM2 ou une migration, le `.env` API doit cibler les services locaux du
profil : base PostgreSQL `digisante_preprod` sous le rôle d'exécution `digisante_preprod_app` et Valkey `/5` en
préproduction, `digisante`/`digisante_app` et `/6` en production (ports 5432/6379, schéma `public`) ; l'URL du
propriétaire (`MIGRATION_DATABASE_URL`, même base, rôle `<base>`, mot de passe distinct) doit être fournie par
l'environnement et ne sert qu'à `migrate deploy` puis aux droits du rôle d'exécution (stade `grants`, contrôlé :
un écart annule les droits et laisse l'API arrêtée). Elle est retirée de l'environnement avant PM2 ; `bash -x` est refusé. Les mots de passe
URL-encodés restent acceptés. Une variable héritée `NODE_ENV`, `DATABASE_URL` ou
`REDIS_URL` différente du fichier est refusée ; aucune valeur secrète n'est affichée.

Pour un retour manuel à un **ancêtre** du checkout courant, qualifier la version et
vérifier sa compatibilité avec le schéma ; si des migrations incompatibles ont été
appliquées, restaurer base **et** fichiers selon `docs/SUIVI_B5_Restauration_2026-09.md`.
La maintenance reste obligatoire et aucune migration n'est annulée par le script :

```bash
# Même forme que ci-dessus (outillage = deploy.sh de origin/main hors du checkout), cible ancêtre :
# URL du rôle PROPRIÉTAIRE saisie DANS le shell du compte (sudo -u réinitialise l'environnement), jamais en argument.
sudo -u digisante-preprod bash -c 'read -rs -p "MIGRATION_DATABASE_URL (propriétaire, coffre) : " MIGRATION_DATABASE_URL; echo; export MIGRATION_DATABASE_URL \
  && cd /var/www/digisante-preprod && git fetch origin main \
  && M="$(git rev-parse --verify "origin/main^{commit}")" && F="$(mktemp)" \
  && git show "$M:infra/deploy/scripts/deploy.sh" > "$F" \
  && DEPLOY_TOOLING_SHA="$M" DEPLOY_REF=<SHA_ANCESTRE_QUALIFIE> DEPLOY_ENVIRONMENT=preproduction \
     DEPLOY_MAINTENANCE_READY=1 DEPLOY_ALLOW_ROLLBACK=1 bash "$F"; rc=$?; rm -f "$F"; exit $rc'
```

Une cible divergente est refusée même avec `DEPLOY_ALLOW_ROLLBACK=1`. Les workflows CI
ne posent jamais ce drapeau de retour manuel.

Les workflows récupèrent `main`, relèvent son SHA exact `MAIN_SHA`, puis extraient
`deploy.sh` de **ce SHA d'outillage**. `DEPLOY_REF` reste le SHA applicatif qualifié ;
les deux références sont conservées dans le journal Actions et l'historique local
(`tooling=<SHA>` ; lancement manuel : `tooling=manual`). Ainsi une candidate historique
ne choisit pas son ancienne version de la garde.

**Installation de cette garde sur une cible existante** : maintenir les gates
`DEPLOY_ENABLED` et `PREPROD_DEPLOY_ENABLED` désactivés, annuler les anciens jobs
de déploiement en attente/en cours puis confirmer leur fin avant le premier lancement
du workflow mis à jour. GitHub conserve la définition d'un workflow déjà déclenché :
ces anciens jobs peuvent encore extraire le script historique, et la nouvelle garde
ne les protège pas rétroactivement. Pour une invocation manuelle, utiliser le script
actuel de `main` depuis un emplacement relu, et garder la candidate dans `DEPLOY_REF`.

### 3 bis. Après CHAQUE déploiement : scripts exécutés par root (B3)

`deploy.sh` tourne sous l'utilisateur de l'environnement et ne peut pas (ne doit pas) mettre à jour la copie
root ; il affiche un **AVERTISSEMENT (B3)** non bloquant si un fichier de
`infra/deploy/root-scripts.list` a changé depuis le SHA installé, et
`verify_deploy.sh` émet un **WARN** (sans échec) tant que le SHA installé diffère du SHA
déployé. Opération root, après relecture du diff de ces fichiers :

```bash
# Relecture dans le MIROIR ROOT (jamais via git en root dans APP_DIR, dont la config est hostile)
M=/var/lib/digisante${SUFFIX}/ops.git   # miroir de l'environnement (§1)
sudo git --git-dir=$M fetch --no-tags https://github.com/malcomx2022/digisante-mobile.git '+refs/heads/main:refs/remotes/origin/main'
sudo git --git-dir=$M diff <SHA_INSTALLE> <SHA_DEPLOYE> --   $(sudo git --git-dir=$M show <SHA_DEPLOYE>:infra/deploy/root-scripts.list | awk '!/^#/ && NF==2 {print $2}')
sudo DIGISANTE_ENV="$DIGISANTE_ENV" "$ROOT_LIB/infra/deploy/scripts/install_root_scripts.sh" <SHA_DEPLOYE>
cat "$ROOT_LIB/root-scripts.manifest"     # sha= + environment= + SHA-256 de chaque fichier
```

L'installateur exige un SHA complet de 40 caractères, ancêtre de `origin/main` dans le
miroir root ; il extrait chaque fichier du **commit** (`git cat-file blob`), l'installe
root:root (0755 scripts / 0644 modules et configurations) par rename atomique, vérifie
les empreintes et publie le manifeste en dernier. Il ne modifie ni `/etc/nginx`, ni `/etc/cron.d`, ni
`/etc/logrotate.d` : si le diff relu touche `infra/deploy/nginx/*`, `logrotate/*` ou `crontab*.example`,
réappliquer depuis la copie root, dans un shell root —
`bash $P --only nginx,cron` (dry-run, plan relu), puis `bash $P --apply --only nginx,cron`, puis `bash $P --verify`
(0 FAIL sur vhost, `/etc/cron.d` et logrotate). Les fichiers Nginx communs servent aussi l'autre environnement :
mettre à jour les deux copies root au même SHA (sinon le dry-run échoue, fichiers jamais écrasés). Toujours lancer
la copie **installée** de l'installateur (ou une copie extraite du miroir, §1.a), jamais
celle de APP_DIR — elle refuse d'ailleurs de s'exécuter depuis un emplacement modifiable
par un autre compte.

## 4. Nginx + SSL

Installé par `provision-ionos.sh --apply --only nginx` (§1.b), **toujours depuis la copie root** (B3) :

| Fichier hôte | Source (copie root) | Portée |
|---|---|---|
| `/etc/nginx/conf.d/digisante-rate-limit.conf` | `nginx/rate-limit.conf` | commun aux deux environnements : zones `digisante_rl_*`, format `digisante_noquery` (aucune directive globale imposée à ImmiPro/BeninLink) |
| `/etc/nginx/snippets/digisante-headers.conf` | `nginx/digisante-headers.conf` | commun : `X-Frame-Options`, `nosniff`, `Referrer-Policy` |
| `/etc/nginx/snippets/digisante-hsts.conf` | `nginx/hsts-after-tls.conf` | commun : HSTS 24 h, installé **après** émission et `renew --dry-run` réussis |
| `/etc/nginx/sites-available/digisante[-preprod]` (+ lien `sites-enabled`) | `nginx/digisante[-preprod].conf` | un vhost par environnement, `server_name` exacts, upstreams 3100/3101 · 3200/3201, `:80` = ACME + redirection, `:443` TLS Let's Encrypt, `client_max_body_size 8m` (= plus grand `bodyLimit` de l'API), `/api/v1/health` et `/api/v1/ready` non journalisés ; production : `www` → redirection 301 vers l'apex |

Certificat : `certbot certonly --webroot -w /var/www/digisante-acme --cert-name <domaine> -d <domaine> [-d www.<domaine>]`,
précédé d'un `--dry-run` Let's Encrypt, via un vhost HTTP d'amorçage (ACME seul, `404` ailleurs) remplacé ensuite par le
vhost complet. **Jamais `certbot --nginx`** : Certbot ne réécrit aucun vhost (ni le nôtre, ni ceux d'ImmiPro/BeninLink).
Renouvellement limité au `--cert-name` de l'environnement (crontab §5, et le timer `certbot.timer` du système s'il est
actif), hook `systemctl reload nginx`. `nginx -t` précède chaque rechargement ; s'il refuse une étape, les fichiers
Nginx DigiSanté sont restaurés à leur état d'avant et le script s'arrête. Ne jamais supprimer `default` ni éditer un
vhost voisin. L'API (helmet) pose son propre HSTS (180 j + `includeSubDomains`) et le navigateur ne retient que le
premier en-tête : le vhost le masque (`proxy_hide_header Strict-Transport-Security`), seule la politique L8 (24 h)
est servie — contrôle : `curl -sI https://<domaine>/api/v1/health | grep -ci '^strict-transport-security'` = 1.
Maintenance : fichier facultatif `snippets/digisante${SUFFIX}-maintenance.conf` (§3).

## 5. Crons (backup + réconciliation + renouvellement SSL)

```bash
# Hôte partagé : un fichier /etc/cron.d PAR ENVIRONNEMENT (DIGISANTE_ENV déclaré en tête). JAMAIS
# `crontab <fichier>`, qui REMPLACERAIT la crontab root d'ImmiPro/BeninLink.
CRON_SRC="$ROOT_LIB/infra/deploy/crontab.preproduction.example"   # prod : crontab.example
sudo install -o root -g root -m 0644 "$CRON_SRC" /etc/cron.d/digisante${SUFFIX}
sudo grep -E '^DIGISANTE_ENV=' /etc/cron.d/digisante${SUFFIX}   # vérifier l'environnement déclaré
sudo crontab -l         # crontab root : aucune ligne DigiSanté résiduelle (sinon la retirer, sans toucher au reste)
```

Les tâches lancent uniquement les scripts de la copie root de l'environnement
(`/usr/local/lib/digisante[-preprod]`) et journalisent dans `/var/log/digisante[-preprod]-cron`
(root:root 0750) : un journal root dans le répertoire de l'utilisateur applicatif pourrait être remplacé par un lien vers un fichier système (ex.
`/root/.ssh/authorized_keys`). **Migration d'un VPS existant** : installer les scripts
root (§3 bis), créer `/var/log/digisante${SUFFIX}-cron` (l'installateur le fait), installer le fichier `/etc/cron.d`, retirer les anciennes lignes DigiSanté de la crontab root, puis déplacer les
anciens journaux root (`sudo mv /var/log/digisante/{med_reminders,appt_reminders,vaccination_reminders,maternity_reminders,notify_dispatch,reconcile,pg_dump,healthwatch,sync_receipts}.log* /var/log/digisante-cron/`)
et installer `/etc/logrotate.d/digisante${SUFFIX}` depuis `$ROOT_LIB/infra/deploy/logrotate/digisante${SUFFIX}`
(rotation du répertoire applicatif sous l'identité de l'utilisateur de l'environnement). Contrôler enfin le magasin de fichiers
(`sudo stat -c '%U %a %n' <KYC_STORAGE_DIR>` ⇒ `digisante${SUFFIX} 700`, fichiers lisibles par
`digisante${SUFFIX}`) : un magasin créé par root, ouvert en écriture ou contenant un fichier
illisible par l'API fait désormais échouer la sauvegarde (B4) — corriger par
`chown -R digisante${SUFFIX}:digisante${SUFFIX}` + `chmod 0700` après vérification, jamais en
relâchant le contrôle ni en donnant le magasin à l'utilisateur de l'autre environnement.

## 6. Déploiement continu (GitHub Actions)

Le job `deploy` de `.github/workflows/ci.yml` se déclenche sur **push `main`**
(après succès de `build-and-test` **et** `e2e`) et exécute `deploy.sh` en SSH.

Secrets à définir dans **Settings → Secrets and variables → Actions** :

| Secret | Description |
|---|---|
| `VPS_HOST` | IP ou hostname du VPS |
| `VPS_USER` | utilisateur SSH (ex. `digisante`) |
| `VPS_SSH_KEY` | clé privée SSH autorisée sur le VPS |
| `VPS_FINGERPRINT` | empreinte SHA256 de la clé d’hôte SSH (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`) — obligatoire, le job échoue sans |
| `VPS_SSH_PORT` | port SSH si ≠ 22 (optionnel) |

La clé publique correspondante est installée par `provision-ionos.sh --apply --only users` (`DEPLOY_SSH_PUBKEY`), écrite **`restrict <clé>`** dans `~digisante/.ssh/authorized_keys` (prod ; préprod : `~digisante-preprod/.ssh/authorized_keys`, secrets `PREPROD_VPS_*`) ; ajoutée à la main, elle doit porter l'option `restrict` (sinon `--verify` : FAIL),
et l'utilisateur de l'environnement doit pouvoir lancer `pm2`/`prisma` sans mot de passe.

Le job `deploy` de `ci.yml` et le workflow `preproduction.yml` partagent le groupe de concurrence
`deploy-ionos-srv1` : un seul build/déploiement DigiSanté à la fois sur l'hôte partagé (4 Go de RAM avec
ImmiPro, BeninLink, PG, Valkey, Grafana ; deux `pnpm build` simultanés exposaient les voisins à l'OOM killer).
Effet de bord GitHub : un seul run EN ATTENTE par groupe — un déploiement plus récent mis en file annule un
run en attente plus ancien (ex. une préproduction lancée à la main), qu'il faut alors relancer.

Deux variables obligatoires : `DEPLOY_ENABLED=true` et `DEPLOY_MAINTENANCE_READY=true`. Cette dernière déclare une maintenance déjà posée/vérifiée, sans la créer automatiquement. Désactiver les deux hors fenêtre autorisée, remettre maintenance à false après la fenêtre. SSH bootstrap exécute le script du **github.sha exact**, jamais la tête mobile. Préproduction : workflow manuel séparé et accès/fingerprint `PREPROD_VPS_*` (utilisateur `digisante-preprod`) sur le **même hôte IONOS** (dérogation 13/10/2026), variables et procédure dans le contrat L10. Aucun déploiement réel attesté par ces fichiers.

---

## Exploitation

```bash
# PM2 tourne SOUS LE COMPTE DE L'ENVIRONNEMENT (démon propre) : jamais `pm2` en root ni depuis un compte admin.
sudo -u digisante-preprod pm2 status                       # prod : sudo -u digisante pm2 status
sudo -u digisante-preprod pm2 logs digisante-preprod-api   # prod : digisante-api
# Démarrage MANUEL (hors deploy.sh), maintenance posée : `pm2 start`/`startOrReload` sur une app EXISTANTE
# gardent son ancien script et ses node_args — supprimer puis recréer depuis l'ecosystem du checkout
# (entrée API = dist/main.js). Arrêter aussi tout écouteur de diagnostic resté sur 3101/3100.
# Une suppression PAR app (`pm2 delete a b` s'arrête au premier nom absent et garde le suivant) :
for a in digisante-preprod-api digisante-preprod-web; do sudo -u digisante-preprod pm2 delete "$a" || true; done
sudo -u digisante-preprod env DIGISANTE_ENV=preproduction pm2 start /var/www/digisante-preprod/ecosystem.config.cjs
sudo -u digisante-preprod pm2 save
curl -fsS http://127.0.0.1:3101/api/v1/ready   # {"status":"ready","db":"up","redis":"up"}
# « waiting restart » = échec de démarrage relancé à délai croissant (≤ 15 s) : cause dans les logs (base,
# Valkey, .env) ; l'API repart seule. `pm2 restart`/`reload` ÉCHOUENT sur une instance dans cet état
# (« Process with pid … already exists », PM2 7.0.4) : pour relancer tout de suite, `pm2 stop` puis `pm2 start`.
# prod : compte digisante, /var/www/digisante/ecosystem.config.cjs, apps digisante-api/web, DIGISANTE_ENV=production, port 3201
sudo DIGISANTE_ENV=preproduction DOMAIN=preprod.digisantemobile.app \
     /usr/local/lib/digisante-preprod/infra/deploy/scripts/verify_deploy.sh   # sondes sans tâches métier
# prod : sudo DIGISANTE_ENV=production DOMAIN=digisantemobile.app /usr/local/lib/digisante/infra/deploy/scripts/verify_deploy.sh

# Restaurer une sauvegarde chiffrée :
openssl enc -d -aes-256-cbc -pbkdf2 -pass file:/etc/digisante-preprod/backup.key \
  -in /var/backups/digisante-preprod/digisante_AAAAMMJJ_HHMMSS.sql.gz.enc \
  | gunzip | psql digisante_preprod   # préprod (prod : /etc/digisante/backup.key, /var/backups/digisante, psql digisante)
```

| Fichier | Rôle |
|---|---|
| `scripts/provision-ionos.sh` | provisioning de l'hôte IONOS partagé, un environnement par exécution : dry-run par défaut, `--apply`, `--verify`, `--rollback`, `--only` ; gardes OS/ports/conflits/B3, B4 vérifié (§1.b) |
| `scripts/provision.sh` | ancien VPS vierge Ubuntu 22.04 / PG16 / Redis — refuse tout autre OS ; **jamais** sur l'hôte IONOS |
| `scripts/install_root_scripts.sh` | B3 : copie root:root des fichiers de `root-scripts.list` d'un SHA exact de main, depuis le miroir root (une copie par environnement sur l'hôte partagé) |
| `root-scripts.list` | B3 : liste fermée des fichiers exécutés/sourcés/installés par root |
| `scripts/deploy.sh` | déploiement SHA exact (arrêt → install → build → migrate → démarrage homogène), utilisateur de l'environnement (`digisante-preprod` / `digisante`) |
| `scripts/pg_dump_encrypted.sh` | DB + filestore chiffrés, snapshot DB commun/manifeste publié en dernier (02:00) ; magasin résolu depuis le `.env` de l'API (propriété de `APP_USER`, 0700, nom sans « - » initial), archivé sous l'identité `APP_USER`, fichiers référencés comptés (B4) |
| `scripts/fedapay_reconcile.sh` | déclencheur réconciliation FedaPay (cron 02:30) |
| `nginx/digisante.conf` · `nginx/digisante-preprod.conf` | reverse proxy + TLS Let's Encrypt (webroot), un vhost par environnement (identiques hors marqueurs et bloc `www` de production) ; `nginx/rate-limit.conf`, `nginx/digisante-headers.conf`, `nginx/hsts-after-tls.conf` communs à l'hôte |
| `../../.env.preprod.example` · `../../.env.prod.example` | modèles `.env` par environnement : noms seulement, secrets vides (parité avec `.env.example`) |
| `crontab.example` · `crontab.preproduction.example` | fichiers `/etc/cron.d/digisante` · `/etc/cron.d/digisante-preprod` (copies root uniquement, `DIGISANTE_ENV` déclaré) |
| `logrotate/digisante` · `logrotate/digisante-preprod` | rotation des journaux par environnement |
| `../../ecosystem.config.cjs` | configuration PM2 (api cluster ×2 + web) — `DIGISANTE_ENV` obligatoire, écoute 127.0.0.1 |


## Préproduction L10 — reprise (8 octobre 2026)

Base main a3f80a1 après #189 ; préparer uniquement l’outillage, accès fournis ultérieurement par le porteur. Lire contrat/suivi/revue L10, inventaire de secrets et dossier `docs/preproduction/L10`. Base et cache restent **natifs sur cible** (sur l'hôte IONOS : PostgreSQL 18.6 et Valkey partagés, cf. addendum ci-dessous). Provisioning : `DIGISANTE_ENV=preproduction` (base `digisante_preprod` fixée par le profil ; `DB_NAME` hérité ignoré) et la crontab **crontab.preproduction.example**, installée en `/etc/cron.d/digisante-preprod` (son `DIGISANTE_ENV=preproduction` fixe base, chemins et ports pour la sauvegarde ET les diagnostics). Ne pas installer la crontab prod par erreur. API.env privé NODE_ENV=production ; Firebase public/VAPID au build. Les smoke tests ordinaires ne sont jamais autorisés sur cette cible ; la configuration smoke indépendante ne purge plus Redis.

Les archives DB ET fichiers sont nécessaires à la restauration. `sudo node $ROOT_LIB/scripts/preproduction/check-backup.mjs <manifest>` contrôle les deux SHA256 et la complétude du magasin (`files_count` ≥ `files_expected`, `files_missing=0`, B4) ; healthwatch lit seulement les métadonnées (dont la complétude). Dump et compteurs partagent le snapshot DB ; DB et filestore ne sont pas une transaction commune. Verrou anti-concurrence, permissions privées, aucune purge sur préparation en échec, marqueur complet = manifeste. Clé/copie hors VPS et restauration réelle séparée en L11 ; exemple DB seul ci-dessus incomplet pour la restauration du DMP. `verify_deploy.sh` sans option ne lance aucun générateur/dispatch ; `--run-jobs` exige préproduction et peut envoyer aux destinataires synthétiques autorisés. Observations cron réelles et preuves fournisseurs restent à recueillir.

> **Addendum 13/10/2026 (porteur, dérogation cible).** Préprod et prod sur le VPS IONOS partagé
> `srv1.immipro.app` (dérogation vs VPS Infomaniak distinct) ; préprod `preprod.digisantemobile.app`
> (web 3100 / api 3101, `/var/www/digisante-preprod`, `/etc/digisante-preprod`, `DB_NAME=digisante_preprod`,
> Valkey /5), prod `digisantemobile.app` (web 3200 / api 3201, `/var/www/digisante`, `/etc/digisante`, Valkey /6).
> PG 18.6 natif partagé, Valkey au lieu de Redis, Ubuntu 26.04. Provisioning par `provision-ionos.sh` (§1.b), jamais `provision.sh`.
> Scripts d'exploitation, `ecosystem.config.cjs`, crontabs `/etc/cron.d`, vhosts Nginx et logrotate sont pilotés
> par `DIGISANTE_ENV` (obligatoire, sans défaut) ; cohérence vérifiée par `scripts/infra/environments.test.mjs`.
> B3 + B4 (livrés sur main par #193) obligatoires avant tout déploiement sur l'hôte partagé, installés par environnement. Cas I2 « VPS distinct » non conforme,
> dérogation à arbitrer en L11.
>
> **Résiduels de l'hôte partagé, à arbitrer avec I2 (L11)** — consignés par la revue du 13/10/2026, non corrigés par le code :
> 1. *Port libre squatté* — **traité le 23/10/2026 (revue GO) pour le jeton et la readiness, détecté pour Nginx** :
>    tout compte local peut écouter sur 127.0.0.1:3100/3101/3200/3201 quand l'environnement est entièrement arrêté
>    (déploiement, crash en boucle, démarrage de l'hôte). Un bloc **`port_owner`** identique (`port_owned_by`, test de
>    non-dérive) n'accepte un port que si **tous** ses écouteurs appartiennent à l'utilisateur de l'environnement
>    (uid du socket noté par le noyau, `ss -Htlne`, lisible sans privilège ; un écouteur root est refusé) :
>    - `internal_job.sh` / `fedapay_reconcile.sh` : **jeton de service jamais envoyé** sinon (`ÉCHEC … jeton non
>      envoyé`, sonde `cron`) ;
>    - `deploy.sh` : la readiness n'est **jamais crue** tant que les ports API et web ne sont pas tenus par l'utilisateur
>      (sinon `FAILED`, stade `readiness`, « port squatté ? ») — un squatteur ne peut plus valider un déploiement ;
>    - `healthwatch.sh` : sonde **`ports`** (ALERTE si un port est libre ou tenu par un autre compte) et readiness non
>      interrogée sur un port qui n'est pas celui de l'API ; `verify_deploy.sh` : PASS/FAIL par port.
>    Preuves : `scripts/preproduction/root-scripts.test.mjs` (non-dérive, ordre contrôle → jeton/readiness, `ss` réel sur
>    un écouteur réel), `operations.test.mjs` (squat, port libre, autre uid : aucune requête ni jeton ; deploy FAILED ;
>    alerte healthwatch ; FAIL verify). **Limites restantes** : Nginx ne vérifie pas le propriétaire de l'upstream —
>    pendant un **déploiement** la maintenance (obligatoire, README §3) ne relaie rien ; pendant un **crash** ou au
>    **démarrage de l'hôte**, un squatteur recevrait le trafic jusqu'à l'alerte `ports` (≤ 5 min) puis l'intervention
>    humaine. Course résiduelle entre contrôle et connexion si l'API tombe dans l'intervalle. La seule parade complète
>    (sockets Unix dans un répertoire `digisante[-preprod]:www-data 0750`) changerait les ports documentés et n'est pas
>    prise en charge par `next start` : décision du porteur.
> 2. *Valkey partagé* — **traité le 22/10/2026 (revue GO), dans le code et le provisioning** : chaque environnement
>    se connecte sous **son utilisateur ACL** (`digisante-preprod` / `digisante`), limité aux clés `~<préfixe>*` et
>    aux canaux `&<préfixe>*` (`REDIS_KEY_PREFIX` : `digisante-preprod:` / `digisante:`, posé par l'API sur toute clé
>    — ioredis `keyPrefix` — et sur le canal `chat:events`), avec une liste **positive** des seules commandes de l'API
>    (bloc `valkey-acl` de `provision-ionos.sh`, source unique) : ni `FLUSH*`, ni `KEYS`/`SCAN`/`DBSIZE`, ni
>    `INFO`/`CONFIG`/`ACL`/`CLIENT LIST`/`MONITOR`/`SWAPDB`/`MOVE`. Le canal n'est plus commun ; un `SELECT` d'un autre
>    index ne donne accès à aucune clé (hors préfixe). Le mot de passe d'administration de l'hôte n'est plus dans
>    aucun `.env` (`deploy.sh` refuse `default`). Mot de passe envoyé sous forme d'empreinte `#SHA-256` par l'entrée
>    standard ; persistance `ACL SAVE` (fichier ACL obligatoire). Preuves : `apps/api/src/lib/valkey-acl.test.ts`
>    (Redis réel : commandes de l'API, scripts Lua OTP/rate-limit et pub/sub permis ; administration, clés et canaux
>    hors préfixe refusés, y compris après `SELECT` ; sondes `ACL DRYRUN` de `--verify` au même verdict), suite API
>    complète rejouée en CI sous l'utilisateur ACL **et** le rôle PostgreSQL d'exécution, `provision-ionos`/
>    `deploy-order`/`operations` (tests). **Limites restantes** (hôte, décision porteur) : l'utilisateur `default`
>    de l'hôte garde l'accès complet (affaire de son administrateur) ; mémoire, éviction et persistance restent
>    communes (`--verify` exige `noeviction` ; sans persistance, un redémarrage efface verrous OTP et sessions) ;
>    `CLIENT SETNAME`/`SELECT` permis ; une instance dédiée reste la seule séparation de ressources.
>    **Bascule d'un environnement déjà en service sous `default`** (la préproduction du 15/10/2026), en maintenance :
>    1. administrateur de l'hôte : fichier ACL déclaré (`aclfile`) et rechargé selon sa procédure ;
>    2. root, copie root au SHA qui porte ce changement : `read -rs VALKEY_PASSWORD; read -rs VALKEY_APP_PASSWORD;
>       export …` puis `provision-ionos.sh --apply --only valkey` (crée l'utilisateur, `ACL SAVE`) ;
>    3. compte applicatif : `apps/api/.env` → `REDIS_URL=redis://<utilisateur>:<VALKEY_APP_PASSWORD>@127.0.0.1:6379/<index>`
>       et `REDIS_KEY_PREFIX=<utilisateur>:` (0600) ;
>    4. déploiement (workflow ou §3) puis `provision-ionos.sh --verify` et `verify_deploy.sh` verts.
>    Effets : les anciennes clés non préfixées de l'index deviennent inaccessibles à l'API — sessions (refresh)
>    à rouvrir, codes OTP à redemander, compteurs de limitation remis à zéro ; elles expirent seules (TTL), ne
>    jamais vider l'index (`FLUSHDB` interdit sur l'hôte partagé). Retour arrière : seul un `deploy.sh` antérieur
>    accepte l'ancien `REDIS_URL` (rollback explicite) ; l'utilisateur ACL peut rester en place.
> 3. *Fuseau horaire* : cron n'a pas de fuseau par fichier ; `verify_deploy.sh` exige `Africa/Porto-Novo` pour l'hôte
>    entier, qui est aussi celui d'ImmiPro/BeninLink. Constater `timedatectl` ; changer ou recaler les horaires est une
>    décision du porteur.
> 4. *Zones de limitation Nginx communes* (choix assumé) : une même IP partage ses quotas entre préproduction et production.
> 5. *Rôle PostgreSQL unique, propriétaire des tables d'audit* — **traité le 22/10/2026 (revue GO)** : l'API tourne sous
>    `<base>_app` (NOINHERIT, ni privilège, ni appartenance, aucun objet possédé, pas de CREATE), les registres
>    append-only `audit_logs` et `finance_entries` sont en INSERT/SELECT seulement et `_prisma_migrations` est fermé ;
>    le propriétaire `<base>` ne sert qu'aux migrations et aux droits (stade `grants` de `deploy.sh`, bloc
>    `runtime-grants.sql`, contrôlé et transactionnel). Son URL n'est jamais sur l'hôte (cf. §2). Preuves :
>    `apps/api/src/lib/runtime-role.test.ts` (PostgreSQL réel : UPDATE/DELETE/TRUNCATE/DISABLE TRIGGER refusés par les
>    DROITS), suite API complète rejouée en CI sous ce rôle, `deploy-order`/`provision-ionos`/`ssh-deploy` (tests).
>    Limite : pendant un déploiement, l'URL du propriétaire existe dans l'environnement des processus du compte
>    applicatif (API arrêtée) ; un compte applicatif compromis AVANT le déploiement pourrait la capturer à ce moment.
>    **Bascule d'un environnement déjà provisionné avec un rôle unique** (la préproduction du 15/10/2026), dans une
>    fenêtre de maintenance :
>    1. root, copie root mise à jour au SHA qui porte ce changement : `read -rs PG_RUNTIME_PASSWORD; export …` puis
>       `provision-ionos.sh --apply --only pg` (crée `<base>_app` + CONNECT ; le propriétaire et son mot de passe ne
>       changent pas). Si `pg_hba.conf` nomme les rôles, ajouter **à la main** la règle `host <base> <base>_app
>       127.0.0.1/32 scram-sha-256` (le script ne touche jamais `pg_hba` ; `--verify` sonde les deux rôles) ;
>    2. compte applicatif : `apps/api/.env` → `DATABASE_URL` sous `<base>_app` (0600) ;
>    3. GitHub : secret `PREPROD_DB_MIGRATION_URL` (prod : `DB_MIGRATION_URL`) = URL du propriétaire ;
>    4. déploiement (workflow ou §3) : `deploy.sh` migre sous le propriétaire, applique et contrôle les droits, puis
>       démarre l'API sous `<base>_app` ; `provision-ionos.sh --verify` et `verify_deploy.sh` doivent être verts.
>    Retour arrière : remettre l'ancien `DATABASE_URL` dans le `.env` n'est accepté que par un `deploy.sh` antérieur
>    (rollback explicite, schéma compatible) ; le rôle `<base>_app` peut rester en place.
> 6. *Capacité de l'hôte (4 Go)* : 3 processus PM2 par environnement à 512 Mo de seuil de redémarrage (non un
>    plafond), plus le build pendant un déploiement, à côté de PostgreSQL, Valkey, ImmiPro, BeninLink et Grafana.
>    Constater mémoire, swap et disque avant `--apply` (§1.b, point 11) ; un `MemoryMax` systemd sur
>    `pm2-<utilisateur>` (l'OOM resterait dans le périmètre DigiSanté) relève d'une décision porteur/hôte.
