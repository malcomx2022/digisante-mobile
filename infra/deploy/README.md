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
> Préprod et prod pouvant tourner des SHA différents, leurs copies root sont distinctes (variables ci-dessous).

```bash
# Variables de l'environnement (hôte partagé) — préprod ; prod : SUFFIX= (vide), domaine digisantemobile.app
SUFFIX=-preprod
SHA=<SHA_COMPLET_QUALIFIE>
export ROOT_LIB=/usr/local/lib/digisante${SUFFIX} OPS_MIRROR=/var/lib/digisante${SUFFIX}/ops.git \
       OPS_CONF=/etc/digisante${SUFFIX}/ops.env OPS_LOG_DIR=/var/log/digisante${SUFFIX}-cron

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
sudo --preserve-env=ROOT_LIB,OPS_MIRROR,OPS_CONF,OPS_LOG_DIR bash /root/install_root_scripts${SUFFIX}.sh "$SHA"   # → $ROOT_LIB + manifeste

# 1.b Checkout applicatif (données seulement : aucun script n'y est lancé en root)
sudo git clone https://github.com/malcomx2022/digisante-mobile.git /var/www/digisante${SUFFIX}

# 1.c Provisioning depuis la COPIE ROOT — ⚠️ à ADAPTER pour l'hôte partagé (voir ci-dessous), jamais à l'aveugle
sudo BASE_DOMAIN=preprod.digisantemobile.app   # prod : digisantemobile.app \
     DB_PASSWORD='<mot-de-passe-postgres-fort>' \
     bash "$ROOT_LIB/infra/deploy/scripts/provision.sh"
```

⚠️ **ADAPTATION REQUISE — ne pas appliquer `provision.sh` à l'aveugle sur l'hôte partagé.** Le script est écrit pour Ubuntu 22.04 / PG16 / Redis sur hôte vierge. Sur l'hôte IONOS (Ubuntu 26.04, PG 18.6 déjà installé, Valkey déjà installé, Nginx/Certbot/UFW déjà en place, ImmiPro + BeninLink en production) : ne **pas** réinstaller PG/Valkey/Nginx, ne pas toucher aux autres projets. Adapter le script pour ne créer que : rôles/bases `digisante_preprod` / `digisante`, utilisateurs applicatifs `digisante-preprod` / `digisante`, répertoires `/var/log/digisante-preprod` / `/var/log/digisante`, `/var/backups/digisante-preprod` / `/var/backups/digisante`, `/etc/digisante-preprod` / `/etc/digisante`, et PM2 (absent au 13/10).

Sur hôte vierge, le script installerait : Node 24 (aligné sur la CI), pnpm 9.12.0, PM2, PostgreSQL, Valkey, Nginx, Certbot, UFW ;
il créerait le rôle/base, l'utilisateur applicatif, les répertoires de logs/backups, et le démarrage PM2 au boot.

Le script règle aussi le fuseau `Africa/Porto-Novo` (crons à l'heure du Bénin), crée
`/etc/digisante-preprod` (0700, préprod ; `/etc/digisante` en prod), le magasin de fichiers `apps/api/storage/kyc` (0700), rend
l'utilisateur de l'environnement propriétaire du dépôt cloné, et prépare les répertoires root
`$ROOT_LIB` (0755), `/var/lib/digisante[-preprod]` (0700) et `/var/log/digisante[-preprod]-cron`
(0750, journaux des tâches root). La configuration logrotate est prise dans la copie root.
Chaque script root refuse de s'exécuter depuis un emplacement modifiable par un autre
compte (`trusted_path`).

## 2. Secrets sur le VPS (jamais commités — `CLAUDE.md` §4)

```bash
# API — variables d'environnement de production
sudo -u digisante-preprod cp .env.example apps/api/.env   # préprod (prod : sudo -u digisante)
sudo -u digisante-preprod nano apps/api/.env          # DATABASE_URL, REDIS_URL, JWT_SECRET, clés FedaPay/Twilio/…
sudo chmod 600 apps/api/.env                  # secrets : lisible par l'utilisateur de l'environnement SEUL (deploy.sh le vérifie)

# Magasin de fichiers (KYC + pièces jointes DMP = données de santé) : KYC_STORAGE_DIR de ce
# .env, chemin ABSOLU conseillé. La sauvegarde root le lit ICI comme donnée (B4 :
# util.parseEnv, jamais `source`) ; vide ⇒ apps/api/storage/kyc, comme l'API.
# Valeur écrite par digisante ⇒ hostile pour root (B3) : le répertoire DOIT appartenir à
# digisante (APP_USER, jamais root), être en 0700 (aucune écriture groupe/autres) et
# porter un nom simple (lettres, chiffres, « . _ @ + - », jamais de « - » initial) ;
# sinon la sauvegarde échoue AVANT le dump. Il est archivé SOUS L'IDENTITÉ digisante
# (`sudo -u digisante -- tar … -- <nom>`) : un fichier que l'API ne peut pas lire fait
# échouer la sauvegarde au lieu d'être lu par root.
#   sudo -u digisante install -d -m 0700 /chemin/du/magasin   # si déplacé

# Web — URL publique de l'API (lue au build Next.js)
echo 'NEXT_PUBLIC_API_URL=https://preprod.digisantemobile.app' \
  | sudo -u digisante-preprod tee apps/web/.env.production   # prod : https://digisantemobile.app, utilisateur digisante

# Clé de chiffrement des sauvegardes (AES-256) — À SAUVEGARDER HORS VPS
sudo install -d -m 0700 /etc/digisante-preprod   # prod : /etc/digisante
sudo sh -c 'openssl rand -base64 48 > /etc/digisante-preprod/backup.key'
sudo chmod 0400 /etc/digisante-preprod/backup.key

# Jeton de service des tâches internes (réconciliation FedaPay ET générateurs/dispatch
# lancés par cron via internal_job.sh) — SOURCE UNIQUE, jamais écrite dans la crontab.
sudo sh -c 'umask 077; openssl rand -hex 32 > /etc/digisante-preprod/reconcile.token'   # prod : /etc/digisante/reconcile.token
sudo chmod 0400 /etc/digisante-preprod/reconcile.token
# … puis reporter EXACTEMENT cette valeur dans RECONCILE_TOKEN= de apps/api/.env
# (sans l'afficher à l'écran partagé) ; sinon toutes les tâches répondent 401.
```

`DATABASE_URL` (Postgres natif partagé, socket local) :
`postgresql://digisante_preprod:<password>@localhost:5432/digisante_preprod?schema=public` (préprod)
`postgresql://digisante:<password>@localhost:5432/digisante?schema=public` (prod)

## 3. Premier déploiement

Qualifier le SHA et vérifier la maintenance Nginx. Sauvegarde complète avant migration sur cible alimentée ; premier bootstrap vierge déclaré. Procédure préproduction L10 : `../../docs/CONTRAT_Preproduction_L10.md`.

```bash
sudo -u digisante-preprod DEPLOY_REF=<SHA_COMPLET_QUALIFIE> DEPLOY_ENVIRONMENT=preproduction \
  DEPLOY_MAINTENANCE_READY=1 bash infra/deploy/scripts/deploy.sh   # préprod, depuis /var/www/digisante-preprod
# Prod (depuis /var/www/digisante) : sudo -u digisante DEPLOY_REF=<SHA> DEPLOY_ENVIRONMENT=production DEPLOY_MAINTENANCE_READY=1 bash infra/deploy/scripts/deploy.sh
```

### 3 bis. Après CHAQUE déploiement : scripts exécutés par root (B3)

`deploy.sh` tourne en `digisante` et ne peut pas (ne doit pas) mettre à jour la copie
root ; il affiche un **AVERTISSEMENT (B3)** non bloquant si un fichier de
`infra/deploy/root-scripts.list` a changé depuis le SHA installé, et
`verify_deploy.sh` émet un **WARN** (sans échec) tant que le SHA installé diffère du SHA
déployé. Opération root, après relecture du diff de ces fichiers :

```bash
# Relecture dans le MIROIR ROOT (jamais via git en root dans APP_DIR, dont la config est hostile)
M=/var/lib/digisante/ops.git
sudo git --git-dir=$M fetch --no-tags https://github.com/malcomx2022/digisante-mobile.git '+refs/heads/main:refs/remotes/origin/main'
sudo git --git-dir=$M diff <SHA_INSTALLE> <SHA_DEPLOYE> --   $(sudo git --git-dir=$M show <SHA_DEPLOYE>:infra/deploy/root-scripts.list | awk '!/^#/ && NF==2 {print $2}')
sudo /usr/local/lib/digisante/infra/deploy/scripts/install_root_scripts.sh <SHA_DEPLOYE>
cat /usr/local/lib/digisante/root-scripts.manifest     # sha= + SHA-256 de chaque fichier
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

```bash
# Configurations lues par le maître Nginx (root) : TOUJOURS depuis la copie root (B3).
R="$ROOT_LIB/infra/deploy/nginx"   # copie root de l'environnement
# Zones de rate-limit + format de log sans query (requis par digisante.conf, sinon `nginx -t` échoue)
sudo cp "$R/rate-limit.conf" /etc/nginx/conf.d/digisante-rate-limit.conf
# Un vhost par environnement (ne pas écraser les vhosts ImmiPro/BeninLink ; ne pas supprimer le default) :
sudo cp "$R/digisante.conf" /etc/nginx/sites-available/digisante-preprod
sudo ln -sf /etc/nginx/sites-available/digisante-preprod /etc/nginx/sites-enabled/digisante-preprod
# Remplacer le domaine par preprod.digisantemobile.app et les ports par 3100/3101, puis :
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d preprod.digisantemobile.app   # prod : -d digisantemobile.app -d www.digisantemobile.app, vhost digisante, ports 3200/3201
```

Certbot ajoute lui-même le bloc `443` + la redirection `80 → 443`.

## 5. Crons (backup + réconciliation + renouvellement SSL)

```bash
sudo sh -c 'crontab -l > /root/crontab.avant.$(date +%F)' # sauvegarde de l'existant
# ⚠️ Hôte partagé : `crontab <fichier>` REMPLACE toute la crontab root (tâches ImmiPro/BeninLink comprises).
#    Fusionner les lignes DigiSanté de l'environnement dans la crontab existante (ou un fichier /etc/cron.d dédié),
#    avec les chemins de SA copie root et ses journaux — jamais d'écrasement.
sudo crontab "$ROOT_LIB/infra/deploy/crontab.example"   # hôte DÉDIÉ uniquement
sudo crontab -l         # vérifier : aucun chemin /var/www, journaux dans /var/log/digisante-cron
```

Les tâches lancent uniquement les scripts de `/usr/local/lib/digisante` et journalisent
dans `/var/log/digisante-cron` (root:root 0750) : un journal root dans le répertoire de
`digisante` pourrait être remplacé par un lien vers un fichier système (ex.
`/root/.ssh/authorized_keys`). **Migration d'un VPS existant** : installer les scripts
root (§3 bis), créer `/var/log/digisante-cron`, réinstaller la crontab, puis déplacer les
anciens journaux root (`sudo mv /var/log/digisante/{med_reminders,appt_reminders,vaccination_reminders,maternity_reminders,notify_dispatch,reconcile,pg_dump,healthwatch,sync_receipts}.log* /var/log/digisante-cron/`)
et réinstaller `/etc/logrotate.d/digisante` depuis la copie root (rotation du répertoire
applicatif désormais sous l'identité `digisante`). Contrôler enfin le magasin de fichiers
(`sudo stat -c '%U %a %n' <KYC_STORAGE_DIR>` ⇒ `digisante 700`, fichiers lisibles par
`digisante`) : un magasin créé par root, ouvert en écriture ou contenant un fichier
illisible par l'API fait désormais échouer la sauvegarde (B4) — corriger par
`chown -R digisante:digisante` + `chmod 0700` après vérification, jamais en relâchant le
contrôle.

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

Deux variables obligatoires : `DEPLOY_ENABLED=true` et `DEPLOY_MAINTENANCE_READY=true`. Cette dernière déclare une maintenance déjà posée/vérifiée, sans la créer automatiquement. Désactiver les deux hors fenêtre autorisée, remettre maintenance à false après la fenêtre. SSH bootstrap exécute le script du **github.sha exact**, jamais la tête mobile. Préproduction : workflow manuel séparé et accès/fingerprint `PREPROD_VPS_*` (utilisateur `digisante-preprod`) sur le **même hôte IONOS** (dérogation 13/10/2026), variables et procédure dans le contrat L10. Aucun déploiement réel attesté par ces fichiers.

---

## Exploitation

```bash
pm2 status                       # état des process
pm2 logs digisante-preprod-api   # logs API préprod (prod : digisante-api)
sudo DOMAIN=<DOMAINE> APP_DIR=/var/www/digisante-preprod APP_USER=digisante-preprod ROOT_LIB=/usr/local/lib/digisante-preprod \
     /usr/local/lib/digisante-preprod/infra/deploy/scripts/verify_deploy.sh # sondes sans tâches métier
# ⚠️ deploy.sh / healthwatch.sh / verify_deploy.sh attendent encore les noms PM2 `digisante-api/web` et le port API 3001 :
#    à paramétrer pour la préprod (noms `digisante-preprod-*`, ports 3100/3101) avant tout usage sur l'hôte partagé.

# Restaurer une sauvegarde chiffrée :
openssl enc -d -aes-256-cbc -pbkdf2 -pass file:/etc/digisante-preprod/backup.key \
  -in /var/backups/digisante-preprod/digisante_AAAAMMJJ_HHMMSS.sql.gz.enc \
  | gunzip | psql digisante_preprod   # préprod (prod : /etc/digisante/backup.key, /var/backups/digisante, psql digisante)
```

| Fichier | Rôle |
|---|---|
| `scripts/provision.sh` | provisioning initial du VPS (idempotent) — lancé depuis la copie root ; ⚠️ à adapter pour l'hôte IONOS partagé (voir §1), jamais appliqué à l'aveugle |
| `scripts/install_root_scripts.sh` | B3 : copie root:root des fichiers de `root-scripts.list` d'un SHA exact de main, depuis le miroir root (une copie par environnement sur l'hôte partagé) |
| `root-scripts.list` | B3 : liste fermée des fichiers exécutés/sourcés/installés par root |
| `scripts/deploy.sh` | déploiement SHA exact (arrêt → install → build → migrate → démarrage homogène), utilisateur de l'environnement (`digisante-preprod` / `digisante`) |
| `scripts/pg_dump_encrypted.sh` | DB + filestore chiffrés, snapshot DB commun/manifeste publié en dernier (02:00) ; magasin résolu depuis le `.env` de l'API (propriété de `APP_USER`, 0700, nom sans « - » initial), archivé sous l'identité `APP_USER`, fichiers référencés comptés (B4) |
| `scripts/fedapay_reconcile.sh` | déclencheur réconciliation FedaPay (cron 02:30) |
| `nginx/digisante.conf` | reverse proxy + SSL |
| `crontab.example` | entrées cron (copies root uniquement) |
| `../../ecosystem.config.cjs` | configuration PM2 (api cluster ×2 + web) |


## Préproduction L10 — reprise (8 octobre 2026)

Base main a3f80a1 après #189 ; préparer uniquement l’outillage, accès fournis ultérieurement par le porteur. Lire contrat/suivi/revue L10, inventaire de secrets et dossier `docs/preproduction/L10`. PostgreSQL 16 et Redis restent **natifs sur cible**. Utiliser `DB_NAME=digisante_preprod` au provisioning et la crontab **crontab.preproduction.example** (DB_NAME pour backup ET diagnostics), après sauvegarde de la crontab en place. Ne pas installer la crontab prod par erreur. API.env privé NODE_ENV=production ; Firebase public/VAPID au build. Les smoke tests ordinaires ne sont jamais autorisés sur cette cible ; la configuration smoke indépendante ne purge plus Redis.

Les archives DB ET fichiers sont nécessaires à la restauration. `sudo node $ROOT_LIB/scripts/preproduction/check-backup.mjs <manifest>` contrôle les deux SHA256 et la complétude du magasin (`files_count` ≥ `files_expected`, `files_missing=0`, B4) ; healthwatch lit seulement les métadonnées (dont la complétude). Dump et compteurs partagent le snapshot DB ; DB et filestore ne sont pas une transaction commune. Verrou anti-concurrence, permissions privées, aucune purge sur préparation en échec, marqueur complet = manifeste. Clé/copie hors VPS et restauration réelle séparée en L11 ; exemple DB seul ci-dessus incomplet pour la restauration du DMP. `verify_deploy.sh` sans option ne lance aucun générateur/dispatch ; `--run-jobs` exige préproduction et peut envoyer aux destinataires synthétiques autorisés. Observations cron réelles et preuves fournisseurs restent à recueillir.

> **Addendum 13/10/2026 (porteur, dérogation cible).** Préprod et prod sur le VPS IONOS partagé
> `srv1.immipro.app` (dérogation vs VPS Infomaniak distinct) ; préprod `preprod.digisantemobile.app`
> (web 3100 / api 3101, `/var/www/digisante-preprod`, `/etc/digisante-preprod`, `DB_NAME=digisante_preprod`,
> Valkey /5), prod `digisantemobile.app` (web 3200 / api 3201, `/var/www/digisante`, `/etc/digisante`, Valkey /6).
> PG 18.6 natif partagé, Valkey au lieu de Redis, Ubuntu 26.04. `provision.sh` à adapter (voir §1).
> B3 + B4 (livrés sur main par #193) obligatoires avant tout déploiement sur l'hôte partagé, installés par environnement. Cas I2 « VPS distinct » non conforme,
> dérogation à arbitrer en L11.
