#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Provisioning initial du VPS Infomaniak — DigiSanté Mobile
# Cible : Ubuntu 22.04 LTS. À exécuter UNE FOIS, en root (ou sudo).
# cf. CLAUDE.md §3 (Postgres 16 natif, pas de Docker en prod) et §7.
#
#   sudo BASE_DOMAIN=digisante.example.bj \
#        DB_PASSWORD='change-me' \
#        bash infra/deploy/scripts/provision.sh
#
# Idempotent dans la mesure du possible : relançable sans casse.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

# ── Paramètres (surcharger via variables d'environnement) ──
APP_USER="${APP_USER:-digisante}"
APP_DIR="${APP_DIR:-/var/www/digisante-mobile}"
DB_NAME="${DB_NAME:-digisante}"
DB_USER="${DB_USER:-digisante}"
DB_PASSWORD="${DB_PASSWORD:?Définir DB_PASSWORD (mot de passe Postgres applicatif)}"
NODE_MAJOR="${NODE_MAJOR:-24}"
LOG_DIR="/var/log/digisante"
BACKUP_DIR="/var/backups/digisante"

log() { printf '\033[0;32m[provision]\033[0m %s\n' "$*"; }

if [[ $EUID -ne 0 ]]; then
  echo "Ce script doit être lancé en root (sudo)." >&2
  exit 1
fi

# ── 0. Fuseau horaire : les crons (sauvegarde 02:00, réconciliation 02:30, rappels
#       06:30/06:40) sont exprimés en heure du Bénin ──
timedatectl set-timezone Africa/Porto-Novo

# ── 1. Paquets de base ──
log "Mise à jour APT et paquets de base…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg lsb-release git build-essential ufw

# ── 2. Node.js 24 (NodeSource) + pnpm via corepack ──
# ⚠️ Doit rester ALIGNÉ sur `node-version` de .github/workflows/ci.yml : sinon la
# CI valide une version de Node que la production n'exécute pas.
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt "$NODE_MAJOR" ]]; then
  log "Installation de Node.js ${NODE_MAJOR}…"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
corepack enable
corepack prepare pnpm@9.12.0 --activate
log "Node $(node -v) / pnpm $(pnpm -v)"

# ── 3. PM2 (global) ──
if ! command -v pm2 >/dev/null 2>&1; then
  log "Installation de PM2…"
  npm install -g pm2
fi

# ── 4. PostgreSQL 16 (dépôt PGDG — la 22.04 fournit la 14 par défaut) ──
if ! command -v psql >/dev/null 2>&1 || ! psql --version | grep -q ' 16'; then
  log "Installation de PostgreSQL 16 (PGDG)…"
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  apt-get update -y
  apt-get install -y postgresql-16
fi
systemctl enable --now postgresql

# ── 5. Base + rôle applicatif (idempotent) ──
# Mot de passe transmis par l'ENVIRONNEMENT (`\getenv`, psql ≥ 15) puis quoté par
# `format(%L)` : jamais interpolé dans le SQL (un `'` dans le mot de passe cassait la
# requête — injection possible), jamais en argument de commande (visible dans `ps`).
log "Configuration base/role PostgreSQL '${DB_NAME}'…"
DB_USER="$DB_USER" DB_PASSWORD="$DB_PASSWORD" sudo --preserve-env=DB_USER,DB_PASSWORD -u postgres psql -v ON_ERROR_STOP=1 <<'SQL'
\getenv db_user DB_USER
\getenv db_pw DB_PASSWORD
SELECT format('CREATE ROLE %I LOGIN', :'db_user')
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'db_user')\gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'db_user', :'db_pw')\gexec
SQL
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"
fi

# ── 6. Redis (natif) ──
if ! command -v redis-server >/dev/null 2>&1; then
  log "Installation de Redis…"
  apt-get install -y redis-server
fi
systemctl enable --now redis-server

# ── 7. Nginx + Certbot ──
if ! command -v nginx >/dev/null 2>&1; then
  log "Installation de Nginx…"
  apt-get install -y nginx
fi
if ! command -v certbot >/dev/null 2>&1; then
  log "Installation de Certbot…"
  apt-get install -y certbot python3-certbot-nginx
fi
systemctl enable --now nginx

# ── 8. Utilisateur applicatif + arborescence ──
if ! id "$APP_USER" >/dev/null 2>&1; then
  log "Création de l'utilisateur applicatif '${APP_USER}'…"
  adduser --system --group --home "/home/${APP_USER}" "$APP_USER"
fi
install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR"
# Dépôt cloné en root AVANT le provisioning (README §1) : sans chown récursif,
# deploy.sh (lancé en `digisante`) échoue sur `git fetch` / l'écriture du build.
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
install -d -o "$APP_USER" -g "$APP_USER" "$LOG_DIR"
install -d -o root        -g root  -m 0700 "$BACKUP_DIR"
# Magasin de fichiers chiffrés (KYC + pièces jointes DMP = DONNÉES DE SANTÉ) :
# 0700, propriété de l'utilisateur applicatif. = KYC_STORAGE_DIR par défaut.
install -d -o "$APP_USER" -g "$APP_USER" -m 0700 "$APP_DIR/apps/api/storage" "$APP_DIR/apps/api/storage/kyc"
# Secrets de service root-only (clé de sauvegarde, jeton des tâches internes).
install -d -o root -g root -m 0700 /etc/digisante

# ── 9. Pare-feu (UFW) ──
log "Configuration du pare-feu (UFW)…"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

# ── 10. Démarrage PM2 au boot ──
log "Configuration du démarrage PM2 au boot pour '${APP_USER}'…"
env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$APP_USER" --hp "/home/${APP_USER}" || true

cat <<'NEXT'

──────────────────────────────────────────────────────────────
Provisioning terminé. Étapes suivantes :
  1. Cloner le dépôt dans /var/www/digisante-mobile (utilisateur digisante).
  2. Créer apps/api/.env et apps/web/.env.production (jamais commités).
  3. Premier déploiement :  bash infra/deploy/scripts/deploy.sh
  4. Nginx :  cp infra/deploy/nginx/digisante.conf → sites-available, puis certbot.
  5. Jeton des tâches internes (= RECONCILE_TOKEN du .env de l'API) :
       sudo sh -c 'umask 077; printf %s "<RECONCILE_TOKEN>" > /etc/digisante/reconcile.token'
  6. Cron :  sudo crontab infra/deploy/crontab.example (aucun secret dans ce fichier).
──────────────────────────────────────────────────────────────
NEXT
