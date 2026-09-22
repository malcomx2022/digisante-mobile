# Déploiement — VPS Infomaniak (production)

Procédure de mise en production de **DigiSanté Mobile** sur un VPS Infomaniak
**Ubuntu 22.04 LTS**. Architecture conforme à `CLAUDE.md` §3 et §7 :

```
GitHub Actions (push main) ──SSH──▶ deploy.sh
                                      ├─ pnpm install --frozen-lockfile
                                      ├─ prisma migrate deploy   (jamais db push)
                                      ├─ pnpm build
                                      └─ pm2 startOrReload ecosystem.config.cjs

Nginx (reverse proxy + SSL Certbot)
  ├─ /        → Next.js  127.0.0.1:3000   (digisante-web, PM2 fork)
  └─ /api/*   → Fastify  127.0.0.1:3001   (digisante-api, PM2 cluster ×2)

PostgreSQL 16 natif · Redis natif · cron pg_dump chiffré 02:00 · réconciliation FedaPay 02:30
```

> 🔒 Décisions verrouillées : Postgres 16 **natif** (pas de Supabase/managé), VPS Infomaniak
> (pas de Vercel/Railway), aucun Docker en prod. Le `docker-compose` est réservé au dev local.

---

## 1. Provisioning initial (une fois, en root)

```bash
git clone https://github.com/malcomx2022/digisante-mobile.git /var/www/digisante-mobile
cd /var/www/digisante-mobile

sudo BASE_DOMAIN=digisante.example.bj \
     DB_PASSWORD='<mot-de-passe-postgres-fort>' \
     bash infra/deploy/scripts/provision.sh
```

Installe : Node 24 (aligné sur la CI), pnpm, PM2, PostgreSQL 16 (PGDG), Redis, Nginx, Certbot, UFW ;
crée le rôle/base `digisante`, l'utilisateur applicatif, `/var/log/digisante`,
`/var/backups/digisante`, et le démarrage PM2 au boot.

Le script règle aussi le fuseau `Africa/Porto-Novo` (crons à l'heure du Bénin), crée
`/etc/digisante` (0700), le magasin de fichiers `apps/api/storage/kyc` (0700) et rend
l'utilisateur `digisante` propriétaire du dépôt cloné.

## 2. Secrets sur le VPS (jamais commités — `CLAUDE.md` §4)

```bash
# API — variables d'environnement de production
sudo -u digisante cp .env.example apps/api/.env
sudo -u digisante nano apps/api/.env          # DATABASE_URL, REDIS_URL, JWT_SECRET, clés FedaPay/Twilio/…
sudo chmod 600 apps/api/.env                  # secrets : lisible par digisante SEUL (deploy.sh le vérifie)

# Web — URL publique de l'API (lue au build Next.js)
echo 'NEXT_PUBLIC_API_URL=https://digisante.example.bj' \
  | sudo -u digisante tee apps/web/.env.production

# Clé de chiffrement des sauvegardes (AES-256) — À SAUVEGARDER HORS VPS
sudo install -d -m 0700 /etc/digisante
sudo sh -c 'openssl rand -base64 48 > /etc/digisante/backup.key'
sudo chmod 0400 /etc/digisante/backup.key

# Jeton de service des tâches internes (réconciliation FedaPay ET générateurs/dispatch
# lancés par cron via internal_job.sh) — SOURCE UNIQUE, jamais écrite dans la crontab.
sudo sh -c 'umask 077; openssl rand -hex 32 > /etc/digisante/reconcile.token'
sudo chmod 0400 /etc/digisante/reconcile.token
# … puis reporter EXACTEMENT cette valeur dans RECONCILE_TOKEN= de apps/api/.env
# (sans l'afficher à l'écran partagé) ; sinon toutes les tâches répondent 401.
```

`DATABASE_URL` de prod (Postgres natif, socket local) :
`postgresql://digisante:<password>@localhost:5432/digisante?schema=public`

## 3. Premier déploiement

```bash
sudo -u digisante bash infra/deploy/scripts/deploy.sh
```

## 4. Nginx + SSL

```bash
# Zones de rate-limit + format de log sans query (requis par digisante.conf, sinon `nginx -t` échoue)
sudo cp infra/deploy/nginx/rate-limit.conf /etc/nginx/conf.d/digisante-rate-limit.conf
sudo cp infra/deploy/nginx/digisante.conf /etc/nginx/sites-available/digisante
sudo ln -sf /etc/nginx/sites-available/digisante /etc/nginx/sites-enabled/digisante
sudo rm -f /etc/nginx/sites-enabled/default
# Remplacer digisante.example.bj par le domaine réel dans le fichier, puis :
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d digisante.example.bj -d www.digisante.example.bj
```

Certbot ajoute lui-même le bloc `443` + la redirection `80 → 443`.

## 5. Crons (backup + réconciliation + renouvellement SSL)

```bash
sudo crontab infra/deploy/crontab.example
sudo crontab -l         # vérifier
```

## 6. Déploiement continu (GitHub Actions)

Le job `deploy` de `.github/workflows/ci.yml` se déclenche sur **push `main`**
(après succès de `build-and-test`) et exécute `deploy.sh` en SSH.

Secrets à définir dans **Settings → Secrets and variables → Actions** :

| Secret | Description |
|---|---|
| `VPS_HOST` | IP ou hostname du VPS |
| `VPS_USER` | utilisateur SSH (ex. `digisante`) |
| `VPS_SSH_KEY` | clé privée SSH autorisée sur le VPS |
| `VPS_SSH_PORT` | port SSH si ≠ 22 (optionnel) |

La clé publique correspondante doit être dans `~digisante/.ssh/authorized_keys`,
et l'utilisateur `digisante` doit pouvoir lancer `pm2`/`prisma` sans mot de passe.

---

## Exploitation

```bash
pm2 status                       # état des process
pm2 logs digisante-api           # logs API
pm2 reload ecosystem.config.cjs  # reload zero-downtime

# Restaurer une sauvegarde chiffrée :
openssl enc -d -aes-256-cbc -pbkdf2 -pass file:/etc/digisante/backup.key \
  -in /var/backups/digisante/digisante_AAAAMMJJ_HHMMSS.sql.gz.enc \
  | gunzip | psql digisante
```

| Fichier | Rôle |
|---|---|
| `scripts/provision.sh` | provisioning initial du VPS (idempotent) |
| `scripts/deploy.sh` | déploiement (pull → install → migrate → build → reload) |
| `scripts/pg_dump_encrypted.sh` | sauvegarde Postgres chiffrée AES-256 (cron 02:00) |
| `scripts/fedapay_reconcile.sh` | déclencheur réconciliation FedaPay (cron 02:30) |
| `nginx/digisante.conf` | reverse proxy + SSL |
| `crontab.example` | entrées cron |
| `../../ecosystem.config.cjs` | configuration PM2 (api cluster ×2 + web) |
