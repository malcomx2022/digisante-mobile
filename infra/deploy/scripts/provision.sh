#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Provisioning initial du VPS Infomaniak — DigiSanté Mobile
# Cible : Ubuntu 22.04 LTS. À exécuter UNE FOIS, en root (ou sudo).
# cf. CLAUDE.md §3 (Postgres 16 natif, pas de Docker en prod) et §7.
#
# B3 : lancé depuis la copie INSTALLÉE root:root (install_root_scripts.sh, amorçage
# README §1), jamais depuis APP_DIR — qui appartient à `digisante` après ce script :
#   sudo BASE_DOMAIN=digisante.example.bj \
#        DB_PASSWORD='change-me' \
#        bash /usr/local/lib/digisante/infra/deploy/scripts/provision.sh
#
# Idempotent dans la mesure du possible : relançable sans casse.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

# >>> trusted_path (B3 — copie IDENTIQUE dans chaque script exécuté par root ; test de non-dérive)
# Vrai si le chemin résolu ET tous ses ancêtres appartiennent à root (ou à l'utilisateur
# courant) et ne sont modifiables par aucun autre compte (seule exception : répertoire
# sticky appartenant à root, ex. /tmp). Root n'exécute ni ne lit comme code un fichier
# que l'utilisateur applicatif pourrait réécrire.
trusted_path() {
  local p owner mode
  p="$(readlink -f -- "$1")" && [[ -e "$p" ]] || return 1
  while :; do
    read -r owner mode < <(stat -c '%u %a' -- "$p") || return 1
    [[ "$owner" == 0 || "$owner" == "$EUID" ]] || return 1
    if (( 8#$mode & 8#022 )); then [[ "$owner" == 0 && -d "$p" && -k "$p" ]] || return 1; fi
    [[ "$p" == / ]] && return 0
    p="$(dirname -- "$p")"
  done
}
# <<< trusted_path

# ── Paramètres (surcharger via variables d'environnement) ──
APP_USER="${APP_USER:-digisante}"
APP_DIR="${APP_DIR:-/var/www/digisante-mobile}"
DB_NAME="${DB_NAME:-digisante}"
DB_USER="${DB_USER:-digisante}"
DB_PASSWORD="${DB_PASSWORD:?Définir DB_PASSWORD (mot de passe Postgres applicatif)}"
NODE_MAJOR="${NODE_MAJOR:-24}"
[[ "$DB_NAME" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] || { echo "Nom de base invalide" >&2; exit 1; }
LOG_DIR="/var/log/digisante"
BACKUP_DIR="/var/backups/digisante"

log() { printf '\033[0;32m[provision]\033[0m %s\n' "$*"; }

if [[ $EUID -ne 0 ]]; then
  echo "Ce script doit être lancé en root (sudo)." >&2
  exit 1
fi
trusted_path "${BASH_SOURCE[0]}" || { echo "Script lancé depuis un emplacement modifiable par un autre compte (APP_DIR ?) : utiliser la copie installée par install_root_scripts.sh (README §1)." >&2; exit 1; }
SELF_ROOT="$(cd "$(dirname "$(readlink -f -- "${BASH_SOURCE[0]}")")/../../.." && pwd -P)"
ROOT_LIB="${ROOT_LIB:-/usr/local/lib/digisante}"
CRON_LOG_DIR="/var/log/digisante-cron"

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
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d v)" != "$NODE_MAJOR" ]]; then
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
# Checkout de l'APPLICATION : propriété de `digisante` (deploy.sh y fait git fetch/build).
# Un ancien clone root y est ramené ; root n'y exécute plus rien (B3).
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
install -d -o "$APP_USER" -g "$APP_USER" "$LOG_DIR"
# B3 — fichiers exécutés par root : copie root:root (install_root_scripts.sh), miroir nu
# root et journaux des tâches root HORS des répertoires de l'utilisateur applicatif.
install -d -o root -g root -m 0755 "$ROOT_LIB"
install -d -o root -g root -m 0750 "$CRON_LOG_DIR"
install -d -o root        -g root  -m 0700 "$BACKUP_DIR"
# Magasin de fichiers chiffrés (KYC + pièces jointes DMP = DONNÉES DE SANTÉ) :
# 0700, propriété de l'utilisateur applicatif. = KYC_STORAGE_DIR par défaut.
# Créé SOUS SON IDENTITÉ : root n'opère jamais sous APP_DIR, où un lien symbolique
# planté détournerait chown/chmod vers un fichier système lors d'une relance (B3).
sudo -u "$APP_USER" install -d -m 0700 "$APP_DIR/apps/api/storage" "$APP_DIR/apps/api/storage/kyc"
# Secrets de service root-only (clé de sauvegarde, jeton des tâches internes, alertes).
install -d -o root -g root -m 0700 /etc/digisante
# État de la surveillance (healthwatch.sh), miroir nu root des scripts d'exploitation
# (/var/lib/digisante/ops.git) + rotation des journaux (14 j).
install -d -o root -g root -m 0700 /var/lib/digisante
# Configuration logrotate exécutée par root : prise dans la MÊME copie root que ce
# script, jamais dans APP_DIR (une directive postrotate y serait exécutée en root).
LOGROTATE_SRC="${SELF_ROOT}/infra/deploy/logrotate/digisante"
if [[ -f "$LOGROTATE_SRC" ]] && trusted_path "$LOGROTATE_SRC"; then
  install -o root -g root -m 0644 "$LOGROTATE_SRC" /etc/logrotate.d/digisante
else
  log "AVERTISSEMENT : configuration logrotate absente de la copie root (${LOGROTATE_SRC}) ; non installée."
fi
# Installation/mise à jour des scripts root si un SHA qualifié est fourni.
if [[ -n "${ROOT_SCRIPTS_REF:-}" ]]; then
  log "Installation des scripts exécutés par root (${ROOT_SCRIPTS_REF})…"
  ROOT_LIB="$ROOT_LIB" bash "${SELF_ROOT}/infra/deploy/scripts/install_root_scripts.sh" "$ROOT_SCRIPTS_REF"
fi

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
  1. Dépôt applicatif cloné dans /var/www/digisante-mobile avant ce script (README §1.b),
     désormais propriété de digisante : root n'y exécute JAMAIS rien (B3).
  2. Créer apps/api/.env (0600) et apps/web/.env.production (jamais commités).
     KYC_STORAGE_DIR : chemin ABSOLU conseillé ; la sauvegarde le lit dans ce .env.
  3. Maintenance puis déploiement (utilisateur digisante) : DEPLOY_REF=<SHA complet qualifié> DEPLOY_ENVIRONMENT=<preproduction|production> DEPLOY_MAINTENANCE_READY=1 bash infra/deploy/scripts/deploy.sh
  4. Scripts root au MÊME SHA (après chaque déploiement qui les modifie) :
       sudo /usr/local/lib/digisante/infra/deploy/scripts/install_root_scripts.sh <SHA>
  5. Nginx : copier depuis /usr/local/lib/digisante/infra/deploy/nginx/ → sites-available, puis certbot.
  6. Jeton des tâches internes (= RECONCILE_TOKEN du .env de l'API) :
       sudo sh -c 'umask 077; printf %s "<RECONCILE_TOKEN>" > /etc/digisante/reconcile.token'
  7. Alertes : sudo sh -c 'umask 077; echo "ALERT_CMD=\"mail -s [DigiSanté] ops@<domaine>\"" > /etc/digisante/alert.conf'
  8. Cron : relire/sauvegarder la crontab ; template /usr/local/lib/digisante/infra/deploy/crontab.preproduction.example en L10, crontab.example en production (aucun secret, aucun chemin /var/www).
──────────────────────────────────────────────────────────────
NEXT
