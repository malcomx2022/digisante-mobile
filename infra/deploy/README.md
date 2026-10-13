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

```bash
git clone https://github.com/malcomx2022/digisante-mobile.git /var/www/digisante-preprod   # préprod (ou /var/www/digisante pour la prod)
cd /var/www/digisante-preprod

sudo BASE_DOMAIN=preprod.digisantemobile.app   # prod : digisantemobile.app \
     DB_PASSWORD='<mot-de-passe-postgres-fort>' \
     bash infra/deploy/scripts/provision.sh
```

⚠️ **ADAPTATION REQUISE — ne pas appliquer `provision.sh` à l'aveugle sur l'hôte partagé.** Le script est écrit pour Ubuntu 22.04 / PG16 / Redis sur hôte vierge. Sur l'hôte IONOS (Ubuntu 26.04, PG 18.6 déjà installé, Valkey déjà installé, Nginx/Certbot/UFW déjà en place, ImmiPro + BeninLink en production) : ne **pas** réinstaller PG/Valkey/Nginx, ne pas toucher aux autres projets. Adapter le script pour ne créer que : rôles/bases `digisante_preprod` / `digisante`, utilisateurs applicatifs `digisante-preprod` / `digisante`, répertoires `/var/log/digisante-preprod` / `/var/log/digisante`, `/var/backups/digisante-preprod` / `/var/backups/digisante`, `/etc/digisante-preprod` / `/etc/digisante`, et PM2 (absent au 13/10).

Sur hôte vierge, le script installerait : Node 24 (aligné sur la CI), pnpm 9.12.0, PM2, PostgreSQL, Valkey, Nginx, Certbot, UFW ;
il créerait le rôle/base, l'utilisateur applicatif, les répertoires de logs/backups, et le démarrage PM2 au boot.

Le script règle aussi le fuseau `Africa/Porto-Novo` (crons à l'heure du Bénin), crée
`/etc/digisante-preprod` (0700, préprod ; `/etc/digisante` en prod), le magasin de fichiers `apps/api/storage/kyc` (0700) et rend
l'utilisateur de l'environnement propriétaire du dépôt cloné.

## 2. Secrets sur le VPS (jamais commités — `CLAUDE.md` §4)

```bash
# API — variables d'environnement de production
sudo -u digisante-preprod cp .env.example apps/api/.env   # préprod (prod : sudo -u digisante)
sudo -u digisante-preprod nano apps/api/.env          # DATABASE_URL, REDIS_URL, JWT_SECRET, clés FedaPay/Twilio/…
sudo chmod 600 apps/api/.env                  # secrets : lisible par l'utilisateur de l'environnement SEUL (deploy.sh le vérifie)

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

## 4. Nginx + SSL

```bash
# Zones de rate-limit + format de log sans query (requis par digisante.conf, sinon `nginx -t` échoue)
sudo cp infra/deploy/nginx/rate-limit.conf /etc/nginx/conf.d/digisante-rate-limit.conf
# Un vhost par environnement (ne pas écraser les vhosts ImmiPro/BeninLink ; ne pas supprimer le default) :
sudo cp infra/deploy/nginx/digisante.conf /etc/nginx/sites-available/digisante-preprod
sudo ln -sf /etc/nginx/sites-available/digisante-preprod /etc/nginx/sites-enabled/digisante-preprod
# Remplacer le domaine par preprod.digisantemobile.app et les ports par 3100/3101, puis :
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d preprod.digisantemobile.app   # prod : -d digisantemobile.app -d www.digisantemobile.app, vhost digisante, ports 3200/3201
```

Certbot ajoute lui-même le bloc `443` + la redirection `80 → 443`.

## 5. Crons (backup + réconciliation + renouvellement SSL)

```bash
sudo crontab infra/deploy/crontab.example
sudo crontab -l         # vérifier
```

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
sudo DOMAIN=<DOMAINE> bash infra/deploy/scripts/verify_deploy.sh # sondes sans tâches métier

# Restaurer une sauvegarde chiffrée :
openssl enc -d -aes-256-cbc -pbkdf2 -pass file:/etc/digisante-preprod/backup.key \
  -in /var/backups/digisante-preprod/digisante_AAAAMMJJ_HHMMSS.sql.gz.enc \
  | gunzip | psql digisante_preprod   # préprod (prod : /etc/digisante/backup.key, /var/backups/digisante, psql digisante)
```

| Fichier | Rôle |
|---|---|
| `scripts/provision.sh` | provisioning initial du VPS (idempotent) — ⚠️ à adapter pour l'hôte IONOS partagé (voir §1), jamais appliqué à l'aveugle |
| `scripts/deploy.sh` | déploiement SHA exact (arrêt → install → build → migrate → démarrage homogène) |
| `scripts/pg_dump_encrypted.sh` | DB + filestore chiffrés, snapshot DB commun/manifeste publié en dernier (02:00) |
| `scripts/fedapay_reconcile.sh` | déclencheur réconciliation FedaPay (cron 02:30) |
| `nginx/digisante.conf` | reverse proxy + SSL |
| `crontab.example` | entrées cron |
| `../../ecosystem.config.cjs` | configuration PM2 (api cluster ×2 + web) |


## Préproduction L10 — reprise (8 octobre 2026)

Base main a3f80a1 après #189 ; préparer uniquement l’outillage, accès fournis ultérieurement par le porteur. Lire contrat/suivi/revue L10, inventaire de secrets et dossier `docs/preproduction/L10`. PostgreSQL 16 et Redis restent **natifs sur cible**. Utiliser `DB_NAME=digisante_preprod` au provisioning et la crontab **crontab.preproduction.example** (DB_NAME pour backup ET diagnostics), après sauvegarde de la crontab en place. Ne pas installer la crontab prod par erreur. API.env privé NODE_ENV=production ; Firebase public/VAPID au build. Les smoke tests ordinaires ne sont jamais autorisés sur cette cible ; la configuration smoke indépendante ne purge plus Redis.

Les archives DB ET fichiers sont nécessaires à la restauration. `node scripts/preproduction/check-backup.mjs <manifest>` contrôle les deux SHA256 ; healthwatch lit seulement les métadonnées. Dump et compteurs partagent le snapshot DB ; DB et filestore ne sont pas une transaction commune. Verrou anti-concurrence, permissions privées, aucune purge sur préparation en échec, marqueur complet = manifeste. Clé/copie hors VPS et restauration réelle séparée en L11 ; exemple DB seul ci-dessus incomplet pour la restauration du DMP. `verify_deploy.sh` sans option ne lance aucun générateur/dispatch ; `--run-jobs` exige préproduction et peut envoyer aux destinataires synthétiques autorisés. Observations cron réelles et preuves fournisseurs restent à recueillir.

> **Addendum 13/10/2026 (porteur, dérogation cible).** Préprod et prod sur le VPS IONOS partagé
> `srv1.immipro.app` (dérogation vs VPS Infomaniak distinct) ; préprod `preprod.digisantemobile.app`
> (web 3100 / api 3101, `/var/www/digisante-preprod`, `/etc/digisante-preprod`, `DB_NAME=digisante_preprod`,
> Valkey /5), prod `digisantemobile.app` (web 3200 / api 3201, `/var/www/digisante`, `/etc/digisante`, Valkey /6).
> PG 18.6 natif partagé, Valkey au lieu de Redis, Ubuntu 26.04. `provision.sh` à adapter (voir §1).
> B3 + B4 obligatoires avant tout déploiement sur l'hôte partagé. Cas I2 « VPS distinct » non conforme,
> dérogation à arbitrer en L11.
