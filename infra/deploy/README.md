# Déploiement — VPS Infomaniak (production)

Procédure de mise en production de **DigiSanté Mobile** sur un VPS Infomaniak
**Ubuntu 22.04 LTS**. Architecture conforme à `CLAUDE.md` §3 et §7 :

```
GitHub Actions (push main, gates) ──SSH──▶ deploy.sh
                                      ├─ maintenance + arrêt anciens workers + SHA exact
                                      ├─ pnpm install --frozen-lockfile
                                      ├─ pnpm build
                                      ├─ prisma migrate deploy   (jamais db push)
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

Qualifier le SHA et vérifier la maintenance Nginx. Sauvegarde complète avant migration sur cible alimentée ; premier bootstrap vierge déclaré. Procédure préproduction L10 : `../../docs/CONTRAT_Preproduction_L10.md`.

```bash
sudo -u digisante DEPLOY_REF=<SHA_COMPLET_QUALIFIE> DEPLOY_ENVIRONMENT=production \
  DEPLOY_MAINTENANCE_READY=1 bash infra/deploy/scripts/deploy.sh
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
(après succès de `build-and-test` **et** `e2e`) et exécute `deploy.sh` en SSH.

Secrets à définir dans **Settings → Secrets and variables → Actions** :

| Secret | Description |
|---|---|
| `VPS_HOST` | IP ou hostname du VPS |
| `VPS_USER` | utilisateur SSH (ex. `digisante`) |
| `VPS_SSH_KEY` | clé privée SSH autorisée sur le VPS |
| `VPS_FINGERPRINT` | empreinte SHA256 de la clé d’hôte SSH (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`) — obligatoire, le job échoue sans |
| `VPS_SSH_PORT` | port SSH si ≠ 22 (optionnel) |

La clé publique correspondante doit être dans `~digisante/.ssh/authorized_keys`,
et l'utilisateur `digisante` doit pouvoir lancer `pm2`/`prisma` sans mot de passe.

Deux variables obligatoires : `DEPLOY_ENABLED=true` et `DEPLOY_MAINTENANCE_READY=true`. Cette dernière déclare une maintenance déjà posée/vérifiée, sans la créer automatiquement. Désactiver les deux hors fenêtre autorisée, remettre maintenance à false après la fenêtre. SSH bootstrap exécute le script du **github.sha exact**, jamais la tête mobile. Préproduction : workflow manuel séparé et accès/fingerprint `PREPROD_VPS_*` sur VPS **distinct**, variables et procédure dans le contrat L10. Aucun déploiement réel attesté par ces fichiers.

---

## Exploitation

```bash
pm2 status                       # état des process
pm2 logs digisante-api           # logs API
sudo DOMAIN=<DOMAINE> bash infra/deploy/scripts/verify_deploy.sh # sondes sans tâches métier

# Restaurer une sauvegarde chiffrée :
openssl enc -d -aes-256-cbc -pbkdf2 -pass file:/etc/digisante/backup.key \
  -in /var/backups/digisante/digisante_AAAAMMJJ_HHMMSS.sql.gz.enc \
  | gunzip | psql digisante
```

| Fichier | Rôle |
|---|---|
| `scripts/provision.sh` | provisioning initial du VPS (idempotent) |
| `scripts/deploy.sh` | déploiement SHA exact (arrêt → install → build → migrate → démarrage homogène) |
| `scripts/pg_dump_encrypted.sh` | DB + filestore chiffrés, snapshot DB commun/manifeste publié en dernier (02:00) |
| `scripts/fedapay_reconcile.sh` | déclencheur réconciliation FedaPay (cron 02:30) |
| `nginx/digisante.conf` | reverse proxy + SSL |
| `crontab.example` | entrées cron |
| `../../ecosystem.config.cjs` | configuration PM2 (api cluster ×2 + web) |


## Préproduction L10 — reprise (8 octobre 2026)

Base main a3f80a1 après #189 ; préparer uniquement l’outillage, accès fournis ultérieurement par le porteur. Lire contrat/suivi/revue L10, inventaire de secrets et dossier `docs/preproduction/L10`. PostgreSQL 16 et Redis restent **natifs sur cible**. Utiliser `DB_NAME=digisante_preprod` au provisioning et la crontab **crontab.preproduction.example** (DB_NAME pour backup ET diagnostics), après sauvegarde de la crontab en place. Ne pas installer la crontab prod par erreur. API.env privé NODE_ENV=production ; Firebase public/VAPID au build. Les smoke tests ordinaires ne sont jamais autorisés sur cette cible ; la configuration smoke indépendante ne purge plus Redis.

Les archives DB ET fichiers sont nécessaires à la restauration. `node scripts/preproduction/check-backup.mjs <manifest>` contrôle les deux SHA256 ; healthwatch lit seulement les métadonnées. Dump et compteurs partagent le snapshot DB ; DB et filestore ne sont pas une transaction commune. Verrou anti-concurrence, permissions privées, aucune purge sur préparation en échec, marqueur complet = manifeste. Clé/copie hors VPS et restauration réelle séparée en L11 ; exemple DB seul ci-dessus incomplet pour la restauration du DMP. `verify_deploy.sh` sans option ne lance aucun générateur/dispatch ; `--run-jobs` exige préproduction et peut envoyer aux destinataires synthétiques autorisés. Observations cron réelles et preuves fournisseurs restent à recueillir.
