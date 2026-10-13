# Déploiement — VPS IONOS partagé (préprod + production)

Procédure de déploiement de **DigiSanté Mobile** sur le VPS IONOS partagé `srv1.immipro.app`
(31.70.148.167, Ubuntu 26.04 LTS) — dérogation porteur 13/10/2026 (remplace le VPS Infomaniak distinct). Architecture conforme à `CLAUDE.md` §3 et §7 :

```
GitHub Actions (push main, gates) ──SSH──▶ deploy.sh
                                      ├─ maintenance + arrêt anciens workers + SHA exact
                                      ├─ pnpm install --frozen-lockfile
                                      ├─ pnpm build
                                      ├─ prisma migrate deploy   (jamais db push)
                                      └─ pm2 startOrReload ecosystem.config.cjs

Nginx (reverse proxy + SSL Certbot)
  Préprod `preprod.digisantemobile.app` :
  ├─ /        → Next.js  127.0.0.1:3100   (digisante-preprod-web, PM2 fork)
  └─ /api/*   → Fastify  127.0.0.1:3101   (digisante-preprod-api, PM2 cluster ×2)
  Prod `digisantemobile.app` :
  ├─ /        → Next.js  127.0.0.1:3200   (digisante-web, PM2 fork)
  └─ /api/*   → Fastify  127.0.0.1:3201   (digisante-api, PM2 cluster ×2)

PostgreSQL 18.6 natif partagé (bases + rôles séparés) · Valkey natif (6379, auth, /5 préprod, /6 prod) · cron pg_dump chiffré · réconciliation FedaPay 02:30
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
| `users` | `digisante[-preprod]` (shell bash, groupe propre, **membre de `sshusers`**, mot de passe verrouillé) ; `digisante[-preprod]-jobs` système sans droits (B3). Jamais `docker`, `sudo`, `adm`… : refus si un compte existant en fait partie |
| `dirs` | checkout `/var/www/digisante[-preprod]` et journaux (utilisateur, 0750), magasin `/var/lib/digisante[-preprod]-files` (utilisateur, **0700**, B4), `/etc/digisante[-preprod]` et `/var/backups/digisante[-preprod]` (root **0700**), journaux cron root 0750, webroot ACME `/var/www/digisante-acme` |
| `pg` | rôle `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS` (mot de passe lu par `\getenv` sur l'entrée standard de `psql`, jamais dans le SQL ni dans `ps`), base `UTF8`/`template0` dont il est propriétaire, `CONNECT` retiré à `PUBLIC`. **Ne modifie jamais `pg_hba.conf`** ni un rôle/une base existants |
| `valkey` | réserve l'index (`SET digisante:owner <env> NX`) — aucune autre écriture, **jamais `FLUSHDB`/`FLUSHALL`** ; mot de passe par `REDISCLI_AUTH`, jamais affiché |
| `runtime` | PM2 `7.0.4` global (seulement s'il est absent), pnpm `9.12.0` via corepack pour l'utilisateur (le projet l'exige ; l'hôte a 12.x), service `pm2-<utilisateur>` au démarrage. Node **jamais** réinstallé (24 exigé) |
| `secrets` | `backup.key` générée sur l'hôte (0400, jamais affichée), `reconcile.token` aligné sur le `RECONCILE_TOKEN` du `.env` (0400), modèle `alert.conf` |
| `nginx` | fichiers communs préfixés `digisante` (`conf.d/digisante-rate-limit.conf`, `snippets/digisante-{headers,hsts}.conf`) ; certificat par `certbot certonly --webroot` (**`--dry-run` Let's Encrypt d'abord**, `--cert-name` dédié, jamais `--nginx` : Certbot ne réécrit aucun vhost) ; `certbot renew --cert-name … --dry-run` ; puis vhost TLS complet, `nginx -t` (version précédente restaurée en cas de refus), `reload` |
| `cron` | `/etc/cron.d/digisante[-preprod]` (sauvegarde 02:00 en production / 01:30 en préproduction — travaux lourds décalés, réconciliation FedaPay 02:30, healthwatch toutes les 5 min, générateurs/dispatch, renouvellement TLS limité au `--cert-name`) et `/etc/logrotate.d/digisante[-preprod]`, depuis la copie root (B3 : aucun chemin sous le checkout) |

**Gardes (lecture seule, avant toute écriture — un seul échec ⇒ rien n'est écrit)** : OS `ubuntu 26.04` ;
copie root de **cet** environnement ; sources (vhost, crontab, logrotate) de la copie root, vhost sans
`127.0.0.1:3000/3001` et upstreams = ports du profil ; ports 3100/3101 · 3200/3201 libres ou tenus par
l'utilisateur de l'environnement (3000/3001 : seulement signalés) ; comptes existants sans groupe privilégié ni
uid 0, groupe `sshusers` présent ; Node 24 + corepack ; PostgreSQL 18 ; rôle existant **sans** attribut
privilégié ; base existante **de ce rôle** (sinon refus : jamais une base d'ImmiPro/BeninLink) ; règle `pg_hba`
locale par mot de passe pour ce rôle (sinon **FAIL** : à ajouter à la main) ; Valkey joignable, index **vide ou
déjà marqué pour cet environnement** et l'autre index jamais marqué pour lui ; domaine non déclaré par un autre
vhost, zones/format `digisante_*` non redéfinis ailleurs ; DNS A = `31.70.148.167` ; crontab root sans chemin du
checkout (B3). En `--apply`, `PG_APP_PASSWORD` (≥ 24 caractères, si le rôle est à créer) et `LETSENCRYPT_EMAIL`
(si le certificat est à émettre) sont exigés **avant** la première écriture.

#### Vérifications sur l'hôte AVANT `--apply` (opérateur, lecture seule, aucun secret affiché)

Le dry-run les évalue, mais elles exigent l'accès à l'hôte et ne sont **pas** prouvées par cette préparation :

1. **Index Valkey 5 et 6 libres** — le dry-run interroge `DBSIZE` et le marqueur (mot de passe par
   `REDISCLI_AUTH`, saisi par `read -rs`) ; vérifier aussi (si l'ACL l'autorise) `CONFIG GET databases` ≥ 7 et qu'aucune application
   (ImmiPro, BeninLink, Grafana) n'est configurée sur `/5` ou `/6` (leurs `.env`/configurations, sans copier de
   secret). Une ACL Valkey par environnement (`VALKEY_USERNAME`) est recommandée (résiduel 2 ci-dessous).
2. **`pg_hba.conf`** — une ligne `host <base> <rôle> 127.0.0.1/32 scram-sha-256` (et `::1/128`) par environnement,
   ajoutée **à la main** puis `SELECT pg_reload_conf()` ; le script ne touche jamais ce fichier.
3. **Groupe `sshusers`** et `AllowGroups` de `sshd` ; Fail2Ban actif ; UFW : 80/443 ouverts (jamais 3100-3201).
4. **DNS** : `preprod.digisantemobile.app`, `digisantemobile.app`, `www.digisantemobile.app` → `31.70.148.167`
   (A ; pas d'AAAA vers un autre hôte), avant toute émission de certificat.
5. **Certbot** : version, `systemctl list-timers certbot.timer` (le timer système renouvelle aussi ce certificat ;
   le hook de rechargement est enregistré dans `/etc/letsencrypt/renewal/<nom>.conf`).
6. **Nginx** : `include /etc/nginx/conf.d/*.conf` et `sites-enabled/*` présents dans `nginx.conf` ; aucun vhost
   existant ne déclare les domaines DigiSanté ; `nginx -t` vert AVANT intervention.
7. **Ports** : `ss -ltnp` — 3100/3101/3200/3201 libres ; 3000 (ImmiPro) et 3001 (Grafana) jamais touchés.
8. **Fuseau** (`timedatectl`) : `Africa/Porto-Novo` attendu par `verify_deploy.sh` ; décision du porteur si
   l'hôte partagé est sur un autre fuseau (résiduel 3).
9. **Sauvegarde préalable de la configuration de l'hôte** (`/etc/nginx`, `/etc/cron.d`, `/etc/logrotate.d`,
   `pg_dumpall --roles-only`) et fenêtre de maintenance convenue avec les autres applications.

#### Ordre d'exécution (par environnement : préproduction d'abord)

```bash
sudo -i                                                  # shell root : secrets jamais sur la ligne de commande
export DIGISANTE_ENV=preproduction SUFFIX=-preprod        # prod : DIGISANTE_ENV=production SUFFIX=
P=/usr/local/lib/digisante${SUFFIX}/infra/deploy/scripts/provision-ionos.sh
read -rs -p 'VALKEY_PASSWORD (coffre) : ' VALKEY_PASSWORD; echo; export VALKEY_PASSWORD
# export VALKEY_USERNAME=<utilisateur ACL>               # si ACL Valkey

# 1) DRY-RUN (défaut) : gardes + plan, AUCUNE écriture. Relire le plan intégralement.
bash "$P"

# 2) APPLICATION, éventuellement par étapes (--only users,dirs puis pg,valkey …)
read -rs -p 'PG_APP_PASSWORD (coffre, ≥ 24) : ' PG_APP_PASSWORD; echo; export PG_APP_PASSWORD
export LETSENCRYPT_EMAIL=<contact d'exploitation>
bash "$P" --apply --only users,dirs,pg,valkey,runtime
bash "$P" --apply --only nginx      # certificat : dry-run Let's Encrypt, émission, renew --dry-run, vhost TLS
bash "$P" --apply --only cron
unset PG_APP_PASSWORD

# 3) Checkout applicatif (données seulement : aucun script n'y est lancé en root) puis .env (§2)
sudo -u digisante${SUFFIX} git clone https://github.com/malcomx2022/digisante-mobile.git /var/www/digisante${SUFFIX}
# … .env de l'API et du web depuis .env.preprod.example / .env.prod.example (§2), RECONCILE_TOKEN compris
bash "$P" --apply --only secrets    # backup.key (copie HORS VPS) + reconcile.token aligné sur le .env

# 4) VÉRIFICATION post-provisioning (lecture seule) — à relancer après le premier déploiement (§3)
bash "$P" --verify
unset VALKEY_PASSWORD
```

#### Liste de vérification post-provisioning (`--verify`, PASS/FAIL, sortie non nulle si un point échoue)

- comptes : applicatif ∈ `sshusers`, aucun groupe privilégié ; compte des tâches distinct (uid/gid) ;
- répertoires : propriétaires et modes exacts (tableau ci-dessus), copie root `root 0755` ;
- PostgreSQL : rôle sans privilège, base du rôle, `PUBLIC` sans `CONNECT` ;
- Valkey : marqueur `digisante:owner` = environnement sur son index ;
- Node 24, service `pm2-<utilisateur>` activé ;
- Nginx : `nginx -t`, vhost activé et **identique** à la copie root, certificat présent ;
- cron : `/etc/cron.d/…` identique à la copie root et **sans chemin sous le checkout (B3)** ; logrotate installé ;
- `backup.key` présente ;
- **B4** : `KYC_STORAGE_DIR` présent et **absolu** dans le `.env`, magasin accepté par `filestore-dir.mjs`
  (propriété de l'utilisateur, 0700, nom sûr), puis `files_count=<n> ≥ références=<m>` (références UUID de
  `documents`/`kyc_documents` ; reporté tant que la base n'est pas migrée).

Puis, après le premier déploiement (§3) : `verify_deploy.sh` (§ Exploitation), première sauvegarde
`pg_dump_encrypted.sh` et `check-backup.mjs <manifeste>` (deux archives, `files_missing=0`).

#### Rollback

`bash "$P" --rollback` (dry-run) puis `bash "$P" --rollback --apply` retire **seulement** les artefacts sans
données de l'environnement : vhost (`sites-enabled`/`sites-available`), fichiers Nginx communs **si l'autre
environnement n'est plus actif**, `/etc/cron.d/digisante[-preprod]`, logrotate, processus et service PM2 de
l'utilisateur ; `nginx -t` puis reload. Il **conserve** comptes, base et rôle, index Valkey, magasin de fichiers,
`/etc/digisante[-preprod]`, sauvegardes et certificat : leur suppression est une décision humaine, après
sauvegarde vérifiée (`DROP DATABASE`/`DROP ROLE`, `DEL digisante:owner` sur le seul index concerné,
`certbot delete --cert-name …`, `userdel`) — jamais `FLUSHDB`/`FLUSHALL`, jamais un objet d'une autre application.
Un échec de `nginx -t` pendant l'application restaure la version précédente du vhost ; en dernier recours,
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
# l'environnement et 127.0.0.1 (l'environnement PM2 prime sur --env-file ; l'API lit API_PORT, pas PORT).
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

`DATABASE_URL` (PostgreSQL 18 natif partagé, TCP local — règle `pg_hba` scram-sha-256 par rôle, §1.b) :
`postgresql://digisante_preprod:<mot de passe URL-encodé>@127.0.0.1:5432/digisante_preprod?schema=public` (préprod)
`postgresql://digisante:<mot de passe URL-encodé>@127.0.0.1:5432/digisante?schema=public` (prod)
`REDIS_URL` (Valkey) : `redis://:<mot de passe URL-encodé>@127.0.0.1:6379/5` (préprod) · `/6` (prod) — l'index est obligatoire.

## 3. Premier déploiement

Qualifier le SHA et vérifier la maintenance Nginx. Sauvegarde complète avant migration sur cible alimentée ; premier bootstrap vierge déclaré. Procédure préproduction L10 : `../../docs/CONTRAT_Preproduction_L10.md`.

```bash
sudo -u digisante-preprod DEPLOY_REF=<SHA_COMPLET_QUALIFIE> DEPLOY_ENVIRONMENT=preproduction \
  DEPLOY_MAINTENANCE_READY=1 bash infra/deploy/scripts/deploy.sh   # préprod, depuis /var/www/digisante-preprod
# Prod (depuis /var/www/digisante) : sudo -u digisante DEPLOY_REF=<SHA> DEPLOY_ENVIRONMENT=production DEPLOY_MAINTENANCE_READY=1 bash infra/deploy/scripts/deploy.sh
```

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
les empreintes et publie le manifeste en dernier. Il ne modifie jamais la crontab : si
`crontab*.example` a changé, la réinstaller depuis la copie root (§5). Toujours lancer
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
actif), hook `systemctl reload nginx`. `nginx -t` précède chaque rechargement ; s'il refuse le vhost, la version
précédente est restaurée et le script s'arrête. Ne jamais supprimer `default` ni éditer un vhost voisin.

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

La clé publique correspondante doit être dans `~digisante/.ssh/authorized_keys` (prod ; préprod : `~digisante-preprod/.ssh/authorized_keys`, secrets `PREPROD_VPS_*`),
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
pm2 status                       # état des process
pm2 logs digisante-preprod-api   # logs API préprod (prod : digisante-api)
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

Base main a3f80a1 après #189 ; préparer uniquement l’outillage, accès fournis ultérieurement par le porteur. Lire contrat/suivi/revue L10, inventaire de secrets et dossier `docs/preproduction/L10`. PostgreSQL 16 et Redis restent **natifs sur cible**. Utiliser `DB_NAME=digisante_preprod` au provisioning et la crontab **crontab.preproduction.example**, installée en `/etc/cron.d/digisante-preprod` (son `DIGISANTE_ENV=preproduction` fixe base, chemins et ports pour la sauvegarde ET les diagnostics). Ne pas installer la crontab prod par erreur. API.env privé NODE_ENV=production ; Firebase public/VAPID au build. Les smoke tests ordinaires ne sont jamais autorisés sur cette cible ; la configuration smoke indépendante ne purge plus Redis.

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
> 1. *Port libre squatté* : tout compte local peut écouter sur 127.0.0.1:3100/3101/3200/3201 quand le processus de
>    l'environnement est entièrement arrêté (déploiement, crash en boucle, démarrage de l'hôte). Il recevrait alors le
>    trafic Nginx et, des tâches cron, le jeton de service. Détection actuelle : sonde `pm2` de healthwatch (0/2 en
>    ligne). Parade possible : vérifier l'uid du socket à l'écoute avant d'envoyer le jeton, ou socket Unix 0750.
> 2. *Valkey partagé* : les index /5 et /6 séparent les données, PAS l'accès ni le pub/sub. Le canal `chat:events` est
>    commun aux deux environnements (sans effet fonctionnel : identifiants d'utilisateurs distincts, contenu re-lu en
>    REST) et un même mot de passe ouvre les deux index. Parade : un utilisateur ACL Valkey par environnement et un
>    préfixe de clés/canaux par environnement.
> 3. *Fuseau horaire* : cron n'a pas de fuseau par fichier ; `verify_deploy.sh` exige `Africa/Porto-Novo` pour l'hôte
>    entier, qui est aussi celui d'ImmiPro/BeninLink. Constater `timedatectl` ; changer ou recaler les horaires est une
>    décision du porteur.
> 4. *Zones de limitation Nginx communes* (choix assumé) : une même IP partage ses quotas entre préproduction et production.
