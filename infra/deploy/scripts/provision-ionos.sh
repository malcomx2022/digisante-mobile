#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Provisioning DigiSanté Mobile sur l'hôte IONOS PARTAGÉ (srv1.immipro.app, dérogation
# porteur 13/10/2026) — Ubuntu 26.04 LTS, PostgreSQL 18 et Valkey NATIFS déjà en place,
# Nginx déjà en service pour ImmiPro / BeninLink / supervision. Un environnement par
# exécution : DIGISANTE_ENV=preproduction|production (profil commun, sans défaut).
#
# Par défaut : --dry-run. Toutes les gardes (lecture seule) sont évaluées et chaque
# écriture est seulement AFFICHÉE. --apply est requis pour écrire.
#
#   (shell root : `sudo -i`) — secrets saisis par `read -rs` depuis le coffre, jamais sur la ligne de
#   commande (historique, `ps`) : read -rs VALKEY_PASSWORD; read -rs VALKEY_APP_PASSWORD; read -rs PG_APP_PASSWORD; read -rs PG_RUNTIME_PASSWORD; export …
#   DIGISANTE_ENV=preproduction /usr/local/lib/digisante-preprod/infra/deploy/scripts/provision-ionos.sh
#   DIGISANTE_ENV=preproduction LETSENCRYPT_EMAIL=… /usr/local/lib/digisante-preprod/infra/deploy/scripts/provision-ionos.sh --apply
#   … --verify              liste de vérification post-provisioning (lecture seule)
#   … --rollback [--apply]  retire les seuls artefacts DigiSanté sans données (vhost, cron,
#                           logrotate, service PM2) ; jamais base, rôle, Valkey, fichiers, comptes
#   … --only users,dirs     limite aux étapes nommées (users dirs pg valkey runtime secrets nginx cron)
#
# Ce script ne réinstalle JAMAIS PostgreSQL, Valkey, Node ou Nginx, ne modifie ni UFW, ni le
# fuseau, ni pg_hba, ni un vhost/conteneur/base/index d'une autre application, n'émet aucun
# FLUSHDB/FLUSHALL. Ports 3000 (ImmiPro) et 3001 (Grafana) : jamais configurés ni touchés.
# Secrets : uniquement par l'environnement (coffre opérateur), jamais en argument de
# commande ni affichés : PG_APP_PASSWORD (création du rôle PROPRIÉTAIRE/migrateur <base>),
# PG_RUNTIME_PASSWORD (rôle d'EXÉCUTION de l'API <base>_app, distinct), VALKEY_PASSWORD (administration
# Valkey de l'hôte ; VALKEY_USERNAME si ACL), VALKEY_APP_PASSWORD (utilisateur ACL de l'API, distinct),
# LETSENCRYPT_EMAIL (non secret). Le .env de l'API est lu comme DONNÉES (parseEnv).
#
# B3 : lancé par root depuis la copie root:root (install_root_scripts.sh, README §1.a),
# jamais depuis APP_DIR ; crons, Nginx, logrotate copiés depuis cette copie root.
# B4 : magasin KYC = chemin ABSOLU du .env, propriété de l'utilisateur applicatif, 0700 ;
# --verify compare les fichiers présents aux références de la base.
# ─────────────────────────────────────────────────────────────
set -euo pipefail
# xtrace (bash -x / set -x) afficherait PG_APP_PASSWORD, PG_RUNTIME_PASSWORD, VALKEY_PASSWORD et VALKEY_APP_PASSWORD en clair : refusé.
case "$-" in *x*) set +x; echo "[provision-ionos] REFUS : xtrace (bash -x) afficherait les secrets" >&2; exit 2 ;; esac

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
# >>> digisante_profile (environnement — copie IDENTIQUE dans chaque script d'exploitation ; test de non-dérive)
# DIGISANTE_ENV est OBLIGATOIRE, sans défaut : préproduction et production cohabitent sur
# l'hôte IONOS partagé, où 3000 (ImmiPro) et 3001 (Grafana) sont déjà pris. Il FIXE les
# noms PM2, les ports (mêmes valeurs que ecosystem.config.cjs, test de cohérence) et l'URL
# locale de l'API : un jeton de service ne part que vers l'API de CET environnement. Il
# donne aussi les chemins PAR DÉFAUT (utilisateur, compte sans droits des tâches, checkout,
# journaux, copie root, configuration, état, sauvegardes, base, crontab, journal
# WebSocket) ; une valeur déjà posée par l'opérateur prime pour ces chemins.
# Chaque script n'utilise qu'une partie de ces variables communes (SC2034 attendu).
# shellcheck disable=SC2034
digisante_profile() {
  local sfx
  case "${DIGISANTE_ENV:-}" in
    preproduction) sfx=-preprod; API_PORT=3101; WEB_PORT=3100; : "${DB_NAME:=digisante_preprod}" ;;
    production) sfx=; API_PORT=3201; WEB_PORT=3200; : "${DB_NAME:=digisante}" ;;
    *) echo "DIGISANTE_ENV requis : preproduction ou production (aucun défaut implicite)" >&2; return 1 ;;
  esac
  PM2_API="digisante${sfx}-api"; PM2_WEB="digisante${sfx}-web"; API_BASE="http://127.0.0.1:${API_PORT}"
  : "${APP_USER:=digisante${sfx}}" "${JOBS_USER:=digisante${sfx}-jobs}"
  : "${APP_DIR:=/var/www/digisante${sfx}}" "${APP_LOG_DIR:=/var/log/digisante${sfx}}"
  : "${ETC_DIR:=/etc/digisante${sfx}}" "${ROOT_LIB:=/usr/local/lib/digisante${sfx}}" "${STATE_DIR:=/var/lib/digisante${sfx}}"
  : "${CRON_LOG_DIR:=/var/log/digisante${sfx}-cron}" "${BACKUP_DIR:=/var/backups/digisante${sfx}}"
  : "${CRON_FILE:=/etc/cron.d/digisante${sfx}}" "${WS_LOG:=/var/log/nginx/digisante${sfx}-ws.log}"
}
# <<< digisante_profile

# ── Arguments ──
MODE=dry-run; ACTION=provision; ONLY=""
while (($#)); do
  case "$1" in
    --dry-run) MODE=dry-run ;;
    --apply) MODE=apply ;;
    --verify) ACTION=verify ;;
    --rollback) ACTION=rollback ;;
    --only) shift; ONLY="${1:?--only exige une liste d’étapes}" ;;
    -h|--help) sed -n '2,34p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "[provision-ionos] argument inconnu : $1 (--help)" >&2; exit 2 ;;
  esac
  shift
done
STEPS="users dirs pg valkey runtime secrets nginx cron"
if [[ -n "$ONLY" ]]; then
  for s in ${ONLY//,/ }; do [[ " $STEPS " == *" $s "* ]] || { echo "[provision-ionos] étape inconnue : $s (${STEPS})" >&2; exit 2; }; done
fi
want() { [[ -z "$ONLY" || ",${ONLY}," == *",$1,"* ]]; }

# ── Racine de test : arborescence temporaire, JAMAIS /, /var, /etc réels ──
# Réservée aux tests (scripts/infra/provision-ionos.test.mjs) : préfixe tous les chemins
# de fichiers ; les commandes restent celles du PATH (simulées par les tests).
TROOT="${PROVISION_TEST_ROOT:-}"
if [[ -n "$TROOT" ]]; then
  TROOT="$(readlink -f -- "$TROOT")"
  [[ -d "$TROOT" && "$TROOT" == */provision-ionos-test.* ]] || { echo "[provision-ionos] PROVISION_TEST_ROOT invalide (répertoire temporaire de test requis)" >&2; exit 2; }
  # Seuls les CHEMINS de fichiers sont préfixés : une commande modifiante réelle (useradd, psql,
  # certbot…) agirait sur l'hôte avec des gardes évaluées sur des fichiers factices. Refus si l'une
  # d'elles ne résout pas vers une simulation de la racine de test.
  for c in useradd usermod adduser createdb psql sudo valkey-cli npm pm2 corepack certbot systemctl nginx crontab openssl; do
    # valkey_cli retombe sur redis-cli quand valkey-cli est absent.
    [[ "$c" != valkey-cli ]] || command -v valkey-cli >/dev/null 2>&1 || c=redis-cli
    p="$(command -v "$c" 2>/dev/null || true)"
    [[ -z "$p" || "$p" == "$TROOT"/* ]] || { echo "[provision-ionos] PROVISION_TEST_ROOT : ${c} doit être simulé dans la racine de test (${p})" >&2; exit 2; }
  done
fi
F() { printf '%s%s' "$TROOT" "$1"; }

# ── Journal ──
FAILS=0
log() { printf '[provision-ionos] %s\n' "$*"; }
plan() { printf '[plan] %s\n' "$*"; }
pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; FAILS=$((FAILS + 1)); }
note() { printf 'NOTE  %s\n' "$*"; }
die() { printf '[provision-ionos] REFUS : %s\n' "$*" >&2; exit 1; }
# act <description> <commande…> : exécutée en --apply, affichée sinon (jamais de secret en argument).
act() {
  local desc="$1"; shift
  if [[ "$MODE" == apply ]]; then log "$desc"; "$@"; else plan "${desc} : $(printf '%q ' "$@")"; fi
}

# ── Profil et valeurs propres à l'hôte IONOS ──
# Provisioning : chemins CANONIQUES du profil uniquement. Une valeur héritée (shell root,
# `sudo -E`, autre outil) pourrait viser la base, le compte ou les fichiers d'une autre
# application de l'hôte partagé : jamais prise en compte ici.
unset APP_USER JOBS_USER APP_DIR APP_LOG_DIR ETC_DIR ROOT_LIB STATE_DIR CRON_LOG_DIR BACKUP_DIR CRON_FILE WS_LOG DB_NAME
digisante_profile || exit 1
case "$DIGISANTE_ENV" in
  preproduction) DOMAINS="preprod.digisantemobile.app"; VALKEY_DB=5; SITE=digisante-preprod ;;
  production) DOMAINS="digisantemobile.app www.digisantemobile.app"; VALKEY_DB=6; SITE=digisante ;;
esac
CERT_NAME="${DOMAINS%% *}"
DB_ROLE="$DB_NAME"
# Rôle d'EXÉCUTION de l'API (revue GO du 22/10/2026) : NON propriétaire, DML seulement ;
# DB_ROLE reste propriétaire/migrateur (deploy.sh). Droits sur les tables appliqués par
# deploy.sh après chaque migration (bloc runtime-grants.sql), jamais ici.
RUN_ROLE="${DB_NAME}_app"
STORE_DIR="/var/lib/${SITE}-files"
ACME_ROOT=/var/www/digisante-acme
NGINX_DIR=/etc/nginx
# Maintenance de CET environnement (README §3) : posée/retirée par root, incluse par le vhost.
MAINTENANCE_FILE="${NGINX_DIR}/snippets/${SITE}-maintenance.conf"
PM2_VERSION="${PM2_VERSION:-7.0.4}"
PNPM_VERSION=9.12.0
NODE_MAJOR=24
HOST_IP="${HOST_PUBLIC_IP:-31.70.148.167}"
VALKEY_PORT="${VALKEY_PORT:-6379}"
# Utilisateur ACL de l'API (revue GO du 22/10/2026, résiduel 2) : clés et canaux sous le seul
# préfixe de CET environnement (REDIS_KEY_PREFIX du .env), aucune commande d'administration.
VALKEY_APP_USER="$SITE"
VALKEY_PREFIX="${SITE}:"
ENV_FILE="${APP_DIR}/apps/api/.env"
: "${PG_APP_PASSWORD:=}" "${PG_RUNTIME_PASSWORD:=}" "${VALKEY_PASSWORD:=}" "${VALKEY_USERNAME:=}" "${VALKEY_APP_PASSWORD:=}" "${LETSENCRYPT_EMAIL:=}" "${DEPLOY_SSH_PUBKEY:=}"
[[ "$DB_NAME" =~ ^[a-z][a-z0-9_]*$ && "$APP_USER" =~ ^[a-z][a-z0-9-]*$ && "$JOBS_USER" =~ ^[a-z][a-z0-9-]*$ ]] || die "noms de base ou de comptes invalides"
[[ "$PM2_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "PM2_VERSION : version exacte attendue (x.y.z)"

# Ports de l'hôte réservés à d'autres services : jamais configurés par ce script.
RESERVED_PORTS="3000 3001"
for port in "$API_PORT" "$WEB_PORT"; do
  [[ " $RESERVED_PORTS " != *" $port "* ]] || die "port ${port} réservé (ImmiPro/Grafana) dans le profil ${DIGISANTE_ENV}"
done

# ── Exécution root, depuis une copie de confiance (B3) ──
if [[ -z "$TROOT" ]]; then
  [[ "$EUID" == 0 ]] || die "à lancer en root (sudo) ; --dry-run lit des états réservés à root"
fi
trusted_path "${BASH_SOURCE[0]}" || die "script lancé depuis un emplacement modifiable par un autre compte (APP_DIR ?) : utiliser la copie installée par install_root_scripts.sh (README §1.a)"
SELF_ROOT="$(cd "$(dirname "$(readlink -f -- "${BASH_SOURCE[0]}")")/../../.." && pwd -P)"
# Copie root de CET environnement (amorçage README §1.a puis install_root_scripts.sh).
[[ "$(readlink -f -- "$(F "$ROOT_LIB")")" == "$SELF_ROOT" ]] || { echo "[provision-ionos] ÉCHEC : copie root d'un autre environnement que ${DIGISANTE_ENV} (${ROOT_LIB} attendu)" >&2; exit 1; }
SRC_NGINX="${SELF_ROOT}/infra/deploy/nginx"
SRC_VHOST="${SRC_NGINX}/${SITE}.conf"
if [[ "$DIGISANTE_ENV" == production ]]; then SRC_CRON="${SELF_ROOT}/infra/deploy/crontab.example"; else SRC_CRON="${SELF_ROOT}/infra/deploy/crontab.preproduction.example"; fi
SRC_LOGROTATE="${SELF_ROOT}/infra/deploy/logrotate/${SITE}"
FILESTORE_MODULE="${SELF_ROOT}/scripts/preproduction/filestore-dir.mjs"

# Outils tiers (scripts d'installation npm, certbot, pm2, comptes applicatifs) : jamais les
# secrets de la session root, même si sudo conservait l'environnement.
clean_env() { env -u PG_APP_PASSWORD -u PG_RUNTIME_PASSWORD -u VALKEY_PASSWORD -u VALKEY_USERNAME -u VALKEY_APP_PASSWORD -u REDISCLI_AUTH -u VALKEYCLI_AUTH -u PG_APP_VERIFIER -u PG_RUNTIME_VERIFIER -u SCRAM_SOURCE "$@"; }
as_user() { local u="$1"; shift; clean_env sudo -u "$u" -H -- "$@"; }
pg_ro() { sudo -u postgres -H -- psql -X -A -t -q -v ON_ERROR_STOP=1 -d "${2:-postgres}" -c "$1"; }
valkey_cli() {
  local cli=valkey-cli
  command -v valkey-cli >/dev/null 2>&1 || cli=redis-cli
  # Mot de passe par l'ENVIRONNEMENT (REDISCLI_AUTH/VALKEYCLI_AUTH), jamais en argument (`ps`).
  REDISCLI_AUTH="$VALKEY_PASSWORD" VALKEYCLI_AUTH="$VALKEY_PASSWORD" "$cli" -h 127.0.0.1 -p "$VALKEY_PORT" \
    ${VALKEY_USERNAME:+--user "$VALKEY_USERNAME"} --no-auth-warning "$@"
}
# >>> valkey-acl (règles de l'utilisateur ACL de l'API ; source UNIQUE, test Redis/Valkey réel :
# apps/api/src/lib/valkey-acl.test.ts, rejoué en CI sous ces règles)
# Clés `~<préfixe>*` et canaux `&<préfixe>*` seulement ; liste POSITIVE des commandes de l'API
# (lib/redis.ts, scripts Lua de l'OTP et du rate-limit compris) : ni FLUSH*, ni KEYS/SCAN, ni
# INFO/CONFIG/ACL/CLIENT LIST, ni MONITOR/DEBUG/SWAPDB/MOVE. SELECT reste permis (index du
# profil) : les clés d'un autre index restent hors du préfixe, donc refusées.
valkey_acl_rules() {
  printf '%s\n' resetkeys "~${1}*" resetchannels "&${1}*" nocommands \
    +ping +select '+client|setname' +quit \
    +get +set +del +getdel +incr +expire +pexpire +ttl +pttl \
    +eval +evalsha +publish +subscribe +unsubscribe
}
# <<< valkey-acl
# Ligne `ACL LIST` de l'utilisateur ACL de l'environnement (vide s'il n'existe pas).
valkey_acl_line() { valkey_cli ACL LIST 2>/dev/null | grep -E "^user ${VALKEY_APP_USER} " || true; }
same_file() { [[ -f "$1" && -f "$2" ]] && cmp -s -- "$1" "$2"; }
# Vérificateur SCRAM-SHA-256 (RFC 5802/7677, format PostgreSQL) calculé ICI : le serveur
# ne reçoit jamais le mot de passe en clair (log_statement, pg_stat_statements, journaux).
# Mot de passe du coffre : ASCII imprimable sans espace, 24 à 256 caractères (sortie 3 sinon).
# Argument : nom de la variable du coffre (PG_APP_PASSWORD par défaut, PG_RUNTIME_PASSWORD).
pg_scram_verifier() {
  local source="${1:-PG_APP_PASSWORD}"
  # shellcheck disable=SC2016 # gabarits JavaScript, évalués par node et non par le shell
  SCRAM_SOURCE="${!source}" node -e '
    const c = require("node:crypto"); const pw = process.env.SCRAM_SOURCE ?? "";
    if (!/^[\x21-\x7e]{24,256}$/.test(pw)) process.exit(3);
    const salt = c.randomBytes(16), it = 4096;
    const salted = c.pbkdf2Sync(pw, salt, it, 32, "sha256");
    const hmac = (k, m) => c.createHmac("sha256", k).update(m).digest();
    const stored = c.createHash("sha256").update(hmac(salted, "Client Key")).digest();
    const server = hmac(salted, "Server Key");
    process.stdout.write(`SCRAM-SHA-256$${it}:${salt.toString("base64")}$${stored.toString("base64")}:${server.toString("base64")}`);'
}
# Lignes actives d'une crontab ; le .env de l'API désigné comme DONNÉE (B4) n'est pas un
# exécutable sous APP_DIR (même normalisation que verify_deploy.sh).
cron_active() { sed -e '/^[[:space:]]*#/d' -E -e 's/(^|[[:space:]])(API_ENV_FILE|API_DIR)=[^[:space:]]*//g' "$1"; }
# B3 : texte de planification (lignes actives) qui viserait APP_DIR. Chemins normalisés avant
# comparaison (« // », « /./ », « x/../ ») : une variante d'écriture ne contourne pas la garde.
b3_cron_hit() {
  local norm app_re
  norm="$(sed -E -e 's#/+#/#g' -e ':a' -e 's#/\./#/#g' -e 'ta' -e ':b' -e 's#/[^/[:space:]]+/\.\./#/#' -e 'tb' <<<"$1")"
  # APP_DIR canonique du profil (lettres, « / », « - ») : seul « . » serait à échapper.
  app_re="${APP_DIR%/}"; app_re="${app_re//./\\.}"
  grep -Eq "(^|[^[:alnum:]_./-])${app_re}([^[:alnum:]_.-]|$)" <<<"$norm"
}
# Lignes exécutées par ROOT dans toutes les planifications système (B3) : crontab root,
# /etc/crontab et /etc/cron.d/* (6e champ = utilisateur), scripts /etc/cron.{hourly,daily,
# weekly,monthly}. Le .env désigné comme DONNÉE n'est pas un exécutable (cron_active).
root_schedules() {
  local f
  crontab -l 2>/dev/null | sed '/^[[:space:]]*#/d' || true
  for f in "$(F /etc/crontab)" "$(F /etc/cron.d)"/*; do
    [[ -f "$f" ]] || continue
    # Affectations (J=/chemin, puis `root $J …`) gardées pour tout fichier qui a une ligne root.
    awk '/^[[:space:]]*(#|$)/ { next } /^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=/ { vars = vars $0 "\n"; next }
         $1 ~ /^@/ { if ($2 == "root") { print; r = 1 } next } $6 == "root" { print; r = 1 }
         END { if (r) printf "%s", vars }' "$f"
  done | sed -E 's/(^|[[:space:]])(API_ENV_FILE|API_DIR)=[^[:space:]]*//g'
  for f in "$(F /etc/cron.hourly)"/* "$(F /etc/cron.daily)"/* "$(F /etc/cron.weekly)"/* "$(F /etc/cron.monthly)"/*; do
    if [[ -f "$f" ]]; then sed '/^[[:space:]]*#/d' "$f"; fi
  done
}
# Nginx : écoute générique d'un port par famille (v4 : « PORT », « *:PORT », « 0.0.0.0:PORT » ;
# v6 : « [::]:PORT »), TCP seulement (QUIC = UDP). Une écoute liée à une adresse précise
# (127.0.0.1:443…) n'est jamais le serveur de repli de l'adresse générique.
listen_lines() { grep -hE '^[[:space:]]*listen[[:space:]]' -- "$1" 2>/dev/null | grep -vE '[[:space:]]quic([[:space:];]|$)' || true; }
listen_addr() { if [[ "$1" == v6 ]]; then printf '%s' '\[::\]:'; else printf '%s' '((\*|0\.0\.0\.0):)?'; fi; }
listens_on() { local a; a="$(listen_addr "$1")"; listen_lines "$3" | grep -Eq "^[[:space:]]*listen[[:space:]]+${a}${2}([[:space:]]|;)"; }
default_on() { local a; a="$(listen_addr "$1")"; listen_lines "$3" | grep -Eq "^[[:space:]]*listen[[:space:]]+${a}${2}[[:space:]][^;]*default(_server)?([[:space:]]|;)"; }
# Fichiers chargés par Nginx, dans l'ordre : marqueurs « # configuration file » de `nginx -T`
# (lecture seule ; rien d'autre n'est conservé ni affiché). Repli : nginx.conf, conf.d, sites-enabled.
nginx_load_order() {
  local out f
  out="$(nginx -T 2>/dev/null | sed -n 's/^# configuration file \(.*\):$/\1/p' || true)"
  if [[ -n "$out" ]]; then printf '%s\n' "$out"; return; fi
  printf '%s\n' "${NGINX_DIR}/nginx.conf"
  for f in "$(F "${NGINX_DIR}/conf.d")"/*.conf; do if [[ -f "$f" ]]; then printf '%s\n' "${f#"$TROOT"}"; fi; done | LC_ALL=C sort
  for f in "$(F "${NGINX_DIR}/sites-enabled")"/*; do if [[ -e "$f" ]]; then printf '%s\n' "${f#"$TROOT"}"; fi; done | LC_ALL=C sort
}
# Ordre du glob de Nginx (octets, locale C).
sorts_after() { local LC_ALL=C; [[ "$1" > "$2" ]]; }
# Domicile réel du compte applicatif (clés SSH, PM2) ; /home/<compte> s'il n'existe pas encore.
app_home() { local h; h="$(getent passwd "$APP_USER" 2>/dev/null | cut -d: -f6 || true)"; printf '%s' "${h:-/home/${APP_USER}}"; }
# Lignes de clés autorisées SANS l'option `restrict` (options = champs avant le type de clé).
unrestricted_keys() {
  awk '/^[[:space:]]*(#|$)/ { next }
    { o = ""; for (i = 1; i <= NF; i++) { if ($i ~ /^(ssh-(ed25519|rsa|dss)|ecdsa-sha2-nistp(256|384|521)|sk-(ssh-ed25519|ecdsa-sha2-nistp256)@openssh[.]com)$/) break; o = o $i " " }
      if (o !~ /(^|,)restrict(,|[[:space:]])/) print }' "$1"
}
# Comptes : autorisation sudo réelle (règles d'utilisateur, de groupe, alias), lue par sudo lui-même.
sudo_allowed() { LC_ALL=C sudo -n -l -U "$1" 2>/dev/null | grep -q 'may run the following commands'; }
# pg_hba : la PREMIÈRE règle applicable décide. Sonde de connexion SANS mot de passe vers
# 127.0.0.1 (comme DATABASE_URL), sans .pgpass : seule une demande de mot de passe est
# acceptable (« password ») ; accès accordé (« open » : trust) ou refus (« none ») ⇒ FAIL.
pg_hba_probe() {
  local out role="${1:-$DB_ROLE}"
  if out="$(clean_env env -u PGPASSWORD PGPASSFILE=/dev/null PGSERVICEFILE=/dev/null LC_ALL=C \
    psql -X -w -A -t -q "host=127.0.0.1 port=5432 dbname=${DB_NAME} user=${role} connect_timeout=5" -c 'SELECT 1' 2>&1)"; then
    echo open; return
  fi
  if [[ "$out" == *"no password supplied"* ]]; then echo password; else echo none; fi
}
# Valkey partagé : les clés de sécurité DigiSanté expirent (verrou OTP 30 min, liste des
# refresh, quotas) ; une politique d'éviction les effacerait sous la pression des voisins.
valkey_eviction_check() {
  local policy maxmem aof save
  policy="$(valkey_cli CONFIG GET maxmemory-policy 2>/dev/null | sed -n 2p || true)"
  maxmem="$(valkey_cli CONFIG GET maxmemory 2>/dev/null | sed -n 2p || true)"
  if [[ -z "$policy" || ! "$maxmem" =~ ^[0-9]+$ ]]; then
    note "Valkey : CONFIG GET refusé (ACL) — maxmemory/maxmemory-policy à constater par l'administrateur (noeviction attendu, README §1.b)"
    return
  fi
  if [[ "$policy" == noeviction || "$maxmem" == 0 ]]; then
    pass "Valkey : aucune éviction (maxmemory=${maxmem}, ${policy})"
  else
    fail "Valkey : maxmemory=${maxmem} avec ${policy} — verrous OTP et sessions DigiSanté évinçables par la charge des autres applications : noeviction ou instance dédiée (décision porteur/hôte)"
  fi
  aof="$(valkey_cli CONFIG GET appendonly 2>/dev/null | sed -n 2p || true)"
  save="$(valkey_cli CONFIG GET save 2>/dev/null | sed -n 2p || true)"
  if [[ "$aof" == yes || -n "$save" ]]; then pass "Valkey : persistance active (appendonly=${aof:-?})"; else note "Valkey sans persistance : un redémarrage de l'hôte efface verrous OTP et sessions (README, résiduels)"; fi
}

log "environnement=${DIGISANTE_ENV} · mode=${MODE} · action=${ACTION} · domaines=${DOMAINS} · ports web/api=${WEB_PORT}/${API_PORT} · base=${DB_NAME} · Valkey index ${VALKEY_DB}"

# ═════════════════════════════════════════════════════════════
# GARDES (lecture seule, évaluées dans tous les modes ; une seule suffit à refuser)
# ═════════════════════════════════════════════════════════════
guard_os() {
  local id="" version=""
  [[ -r "$(F /etc/os-release)" ]] || die "/etc/os-release illisible"
  # Lu comme DONNÉES (jamais `source`).
  id="$(sed -n 's/^ID=\"\{0,1\}\([^"]*\)\"\{0,1\}$/\1/p' "$(F /etc/os-release)")"
  version="$(sed -n 's/^VERSION_ID=\"\{0,1\}\([^"]*\)\"\{0,1\}$/\1/p' "$(F /etc/os-release)")"
  [[ "$id" == ubuntu && "$version" == 26.04 ]] || die "OS ${id:-?} ${version:-?} : ce script cible Ubuntu 26.04 (provision.sh = ancien VPS 22.04, jamais sur cet hôte)"
  pass "OS Ubuntu ${version}"
}

guard_sources() {
  local f
  for f in "$SRC_VHOST" "${SRC_NGINX}/rate-limit.conf" "${SRC_NGINX}/digisante-headers.conf" "${SRC_NGINX}/hsts-after-tls.conf" "$SRC_CRON" "$SRC_LOGROTATE"; do
    if [[ ! -f "$f" ]] || ! trusted_path "$f"; then die "source ${f#"$SELF_ROOT"/} absente ou modifiable par un autre compte (copie root incomplète)"; fi
  done
  # Aucun proxy, upstream ni écoute vers les ports réservés de l'hôte.
  if grep -Eq '(127\.0\.0\.1|localhost|\[::1\]):(3000|3001)\b|listen[^;]*\b(3000|3001)\b' "$SRC_VHOST"; then
    die "le vhost ${SITE} vise un port réservé (3000/3001)"
  fi
  if ! grep -q "127.0.0.1:${API_PORT};" "$SRC_VHOST" || ! grep -q "127.0.0.1:${WEB_PORT};" "$SRC_VHOST"; then die "vhost ${SITE} : upstreams ≠ ports du profil (${WEB_PORT}/${API_PORT})"; fi
  # B3 : le cron root n'exécute rien sous APP_DIR et ne journalise pas chez l'utilisateur applicatif.
  local active
  active="$(cron_active "$SRC_CRON")"
  if b3_cron_hit "$active"; then die "B3 : le modèle de crontab exécute un chemin sous ${APP_DIR}"; fi
  if grep -Eq ">>?[[:space:]]*${APP_LOG_DIR%/}/" <<<"$active"; then die "B3 : le modèle de crontab journalise dans ${APP_LOG_DIR} (répertoire de ${APP_USER})"; fi
  pass "sources de la copie root : vhost ${SITE}, crontab, logrotate (B3, aucun port réservé)"
}

guard_ports() {
  local port line pid owner listing
  listing="$(ss -H -ltnp 2>/dev/null || true)"
  for port in $RESERVED_PORTS; do
    grep -Eq "[:.]${port}[[:space:]]" <<<"$listing" && note "port ${port} occupé par un autre service de l'hôte : jamais touché"
  done
  for port in "$WEB_PORT" "$API_PORT"; do
    line="$(grep -E "[:.]${port}[[:space:]]" <<<"$listing" | head -1 || true)"
    [[ -z "$line" ]] && continue
    pid="$(sed -n 's/.*pid=\([0-9]*\).*/\1/p' <<<"$line" | head -1)"
    owner=""
    if [[ -n "$pid" ]]; then owner="$(ps -o user= -p "$pid" 2>/dev/null | tr -d ' ' || true)"; fi
    [[ "$owner" == "$APP_USER" ]] || die "port ${port} déjà écouté par « ${owner:-inconnu} » (≠ ${APP_USER}) : port squatté, rien n'est configuré"
  done
  pass "ports ${WEB_PORT}/${API_PORT} libres ou tenus par ${APP_USER}"
}

guard_accounts() {
  getent group sshusers >/dev/null || die "groupe sshusers absent : règle d'accès SSH de l'hôte à vérifier avant tout compte"
  local u groups
  for u in "$APP_USER" "$JOBS_USER"; do
    id "$u" >/dev/null 2>&1 || continue
    groups=" $(id -nG "$u") "
    [[ "$groups" =~ \ (docker|sudo|admin|wheel|lxd|root|adm|disk|shadow)\  ]] && die "compte ${u} membre d'un groupe privilégié (${groups# }) : jamais pour DigiSanté"
    [[ "$(id -u "$u")" != 0 ]] || die "compte ${u} d'uid 0"
    if sudo_allowed "$u"; then die "compte ${u} autorisé par sudoers (sudo -l -U) : jamais de sudo pour DigiSanté"; fi
  done
  # sshusers (accès SSH de l'hôte) ne porte AUCUNE règle sudo : le compte applicatif, qui y est
  # ajouté, en hériterait.
  # -q : statut 0 dès qu'une ligne correspond, même si /etc/sudoers.d manque (sinon statut 2).
  if grep -RqsE '^[[:space:]]*%sshusers([[:space:]]|,)' "$(F /etc/sudoers)" "$(F /etc/sudoers.d)"; then
    die "règle sudoers pour %sshusers : ${APP_USER} en hériterait (jamais de sudo pour DigiSanté)"
  fi
  if id "$JOBS_USER" >/dev/null 2>&1 && id "$APP_USER" >/dev/null 2>&1; then
    [[ "$(id -u "$JOBS_USER")" != "$(id -u "$APP_USER")" && "$(id -g "$JOBS_USER")" != "$(id -g "$APP_USER")" ]] || die "compte des tâches ${JOBS_USER} confondu avec ${APP_USER}"
  fi
  pass "comptes ${APP_USER} / ${JOBS_USER} : absents ou sans privilège ni sudo ; groupe sshusers présent, sans règle sudo"
}

guard_runtime() {
  local major
  major="$(node -v 2>/dev/null | sed -n 's/^v\([0-9]*\)\..*/\1/p')"
  [[ "$major" == "$NODE_MAJOR" ]] || die "Node ${major:-absent} ≠ ${NODE_MAJOR} (CI) : ce script n'installe jamais Node"
  command -v corepack >/dev/null 2>&1 || die "corepack absent : pnpm ${PNPM_VERSION} non installable sans changer Node"
  pass "Node ${NODE_MAJOR} et corepack présents"
}

hba_check() {
  local role
  for role in "$DB_ROLE" "$RUN_ROLE"; do
    case "$(pg_hba_probe "$role")" in
      password) pass "pg_hba : 127.0.0.1 → ${role}@${DB_NAME} exige un mot de passe (première règle applicable)" ;;
      open) fail "pg_hba : 127.0.0.1 → ${role}@${DB_NAME} ACCEPTÉ SANS mot de passe (règle trust avant celle de DigiSanté) — à corriger À LA MAIN, revue de l'hôte" ;;
      *) fail "pg_hba : aucune règle host 127.0.0.1/32 scram-sha-256 applicable à ${role}@${DB_NAME} (refus ou règle antérieure) — à ajouter À LA MAIN, revue de l'hôte" ;;
    esac
  done
}

guard_pg() {
  local version rows owner attrs
  version="$(pg_ro 'SHOW server_version_num' 2>/dev/null || true)"
  [[ "$version" =~ ^18[0-9]{4}$ ]] || die "PostgreSQL ${version:-injoignable} : 18.x natif attendu (jamais réinstallé ici)"
  attrs="$(pg_ro "SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls FROM pg_roles WHERE rolname = '${DB_ROLE}'")"
  case "$attrs" in
    "") note "rôle ${DB_ROLE} absent : créé à l'application (PG_APP_PASSWORD requis)" ;;
    f)
      # Héritage de droits (pg_read_all_data, rôle d'une autre application…) : refusé.
      [[ "$(pg_ro "SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = '${DB_ROLE}'")" == 0 ]] || die "rôle ${DB_ROLE} membre d'autres rôles (droits hérités) : jamais pour DigiSanté"
      pass "rôle ${DB_ROLE} présent, sans privilège ni appartenance" ;;
    *) die "rôle ${DB_ROLE} existant avec des privilèges (superuser/createrole/createdb/replication/bypassrls)" ;;
  esac
  attrs="$(pg_ro "SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls FROM pg_roles WHERE rolname = '${RUN_ROLE}'")"
  case "$attrs" in
    "") note "rôle d'exécution ${RUN_ROLE} absent : créé à l'application (PG_RUNTIME_PASSWORD requis)" ;;
    f)
      [[ "$(pg_ro "SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = '${RUN_ROLE}'")" == 0 ]] || die "rôle ${RUN_ROLE} membre d'autres rôles (droits hérités, propriétaire compris) : jamais pour l'API"
      pass "rôle d'exécution ${RUN_ROLE} présent, sans privilège ni appartenance" ;;
    *) die "rôle ${RUN_ROLE} existant avec des privilèges (superuser/createrole/createdb/replication/bypassrls)" ;;
  esac
  rows="$(pg_ro "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = '${DB_NAME}'")"
  owner="${rows:-}"
  if [[ -z "$owner" ]]; then
    note "base ${DB_NAME} absente : créée à l'application"
  elif [[ "$owner" == "$DB_ROLE" ]]; then
    pass "base ${DB_NAME} propriété de ${DB_ROLE}"
  else
    die "base ${DB_NAME} existe déjà avec un autre propriétaire (${owner}) : jamais réutilisée"
  fi
  # pg_hba : jamais modifié par ce script ; la première règle applicable doit exiger un mot de passe.
  hba_check
}

guard_valkey() {
  [[ -n "${VALKEY_PASSWORD:-}" ]] || die "VALKEY_PASSWORD (coffre) requis pour vérifier l'index ${VALKEY_DB} (jamais affiché)"
  local pong size marker other_db
  pong="$(valkey_cli PING 2>/dev/null || true)"
  [[ "$pong" == PONG ]] || die "Valkey 127.0.0.1:${VALKEY_PORT} injoignable ou authentification refusée"
  size="$(valkey_cli -n "$VALKEY_DB" DBSIZE 2>/dev/null || true)"
  [[ "$size" =~ ^[0-9]+$ ]] || die "Valkey : index ${VALKEY_DB} inaccessible (databases trop bas ?)"
  marker="$(valkey_cli -n "$VALKEY_DB" GET digisante:owner 2>/dev/null || true)"
  if [[ "$size" == 0 ]]; then
    note "Valkey index ${VALKEY_DB} vide : réservé à ${DIGISANTE_ENV} à l'application (marqueur digisante:owner)"
  elif [[ "$marker" == "$DIGISANTE_ENV" ]]; then
    pass "Valkey index ${VALKEY_DB} déjà réservé à ${DIGISANTE_ENV}"
  else
    die "Valkey index ${VALKEY_DB} non vide (${size} clés) sans marqueur ${DIGISANTE_ENV} : propriétaire inconnu, jamais utilisé ni vidé"
  fi
  # L'autre environnement ne doit pas partager l'index.
  other_db=$(( VALKEY_DB == 5 ? 6 : 5 ))
  [[ "$(valkey_cli -n "$other_db" GET digisante:owner 2>/dev/null || true)" != "$DIGISANTE_ENV" ]] || die "marqueur ${DIGISANTE_ENV} présent dans l'index ${other_db} : indexes croisés"
  valkey_eviction_check
  guard_valkey_acl
}

# Utilisateur ACL de l'API : persistance par fichier ACL (ACL SAVE), jamais CONFIG REWRITE du
# valkey.conf partagé ; un utilisateur de même nom hors du préfixe n'est jamais modifié.
guard_valkey_acl() {
  local aclfile line patterns
  aclfile="$(valkey_cli CONFIG GET aclfile 2>/dev/null | sed -n 2p || true)"
  [[ -n "$aclfile" ]] || die "Valkey : aclfile non configuré (ou CONFIG GET refusé) — l'utilisateur ACL ${VALKEY_APP_USER} serait perdu au redémarrage ; faire déclarer un fichier ACL par l'administrateur de l'hôte (README §1.b), jamais de CONFIG REWRITE du valkey.conf partagé"
  pass "Valkey : fichier ACL déclaré (ACL SAVE possible)"
  if [[ -n "$VALKEY_APP_PASSWORD" ]]; then
    [[ "$VALKEY_APP_PASSWORD" =~ ^[A-Za-z0-9._~-]{32,256}$ ]] || die "VALKEY_APP_PASSWORD : 32 à 256 caractères [A-Za-z0-9._~-] (sans encodage dans REDIS_URL ; openssl rand -hex 32)"
    [[ "$VALKEY_APP_PASSWORD" != "$VALKEY_PASSWORD" ]] || die "VALKEY_APP_PASSWORD identique au mot de passe d'administration Valkey de l'hôte : deux secrets distincts requis"
  fi
  line="$(valkey_acl_line)"
  if [[ -z "$line" ]]; then
    note "utilisateur ACL ${VALKEY_APP_USER} absent : créé à l'application (clés et canaux ${VALKEY_PREFIX}*)"
    return 0
  fi
  patterns="$(tr ' ' '\n' <<<"$line" | grep -E '^(~|%R~|%W~|%RW~|allkeys$)' | tr '\n' ' ' || true)"
  [[ "$patterns" == "~${VALKEY_PREFIX}* " ]] || die "utilisateur ACL ${VALKEY_APP_USER} existant avec d'autres clés (${patterns:-aucune}) : propriétaire inconnu, jamais modifié"
  if [[ -z "$VALKEY_APP_PASSWORD" && " $line " == *" nopass "* ]]; then die "utilisateur ACL ${VALKEY_APP_USER} sans mot de passe (nopass) : VALKEY_APP_PASSWORD requis"; fi
  pass "utilisateur ACL ${VALKEY_APP_USER} déjà limité à ${VALKEY_PREFIX}*"
}

guard_nginx() {
  command -v nginx >/dev/null 2>&1 || die "Nginx absent (jamais installé ici)"
  command -v certbot >/dev/null 2>&1 || die "Certbot absent du PATH (jamais installé ici ; paquet apt ou snap /snap/bin)"
  [[ -d "$(F "${NGINX_DIR}/sites-available")" && -d "$(F "${NGINX_DIR}/sites-enabled")" && -d "$(F "${NGINX_DIR}/conf.d")" ]] || die "arborescence Nginx Ubuntu (sites-available/enabled, conf.d) absente"
  local d f
  # Un domaine DigiSanté déjà servi par un AUTRE fichier : jamais de doublon de server_name.
  for d in $DOMAINS; do
    while IFS= read -r f; do
      [[ -z "$f" ]] && continue
      [[ "$(basename -- "$f")" == "$SITE" ]] && continue
      die "domaine ${d} déjà déclaré par ${f#"$TROOT"} (autre vhost) : rien n'est modifié"
    # -R : sites-enabled contient des LIENS vers sites-available (disposition Ubuntu) ; -r les ignorerait.
    done < <(grep -RlE "server_name[^;]*[[:space:]]${d//./\\.}([[:space:]]|;)" "$(F "${NGINX_DIR}/sites-enabled")" "$(F "${NGINX_DIR}/conf.d")" 2>/dev/null || true)
  done
  # Zones/format DigiSanté définis ailleurs ⇒ `nginx -t` échouerait pour tout l'hôte.
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    [[ "$f" == "$(F "${NGINX_DIR}/conf.d/digisante-rate-limit.conf")" ]] && continue
    die "zone ou format digisante_* déjà défini dans ${f#"$TROOT"}"
  done < <(grep -RlE 'limit_req_zone[^;]*zone=digisante_rl_|log_format[[:space:]]+digisante_noquery' "$(F "${NGINX_DIR}/nginx.conf")" "$(F "${NGINX_DIR}/conf.d")" "$(F "${NGINX_DIR}/sites-enabled")" "$(F "${NGINX_DIR}/snippets")" 2>/dev/null || true)
  # Fichiers communs aux deux environnements : la copie root de CET environnement (SHA
  # peut-être différent) ne réécrit jamais ceux qu'utilise l'autre environnement actif.
  local other_site other_src src dest
  if [[ "$SITE" == digisante ]]; then other_site=digisante-preprod; else other_site=digisante; fi
  if [[ -e "$(F "${NGINX_DIR}/sites-enabled/${other_site}")" ]]; then
    for src in rate-limit.conf:conf.d/digisante-rate-limit.conf digisante-headers.conf:snippets/digisante-headers.conf hsts-after-tls.conf:snippets/digisante-hsts.conf; do
      dest="$(F "${NGINX_DIR}/${src#*:}")"
      if [[ ! -e "$dest" ]] || same_file "${SRC_NGINX}/${src%%:*}" "$dest"; then continue; fi
      # Mise à jour d'un fichier commun : seulement si la copie root de l'AUTRE environnement (de
      # confiance) porte la même source — les deux environnements passent alors ensemble au nouveau fichier.
      other_src="$(F "/usr/local/lib/${other_site}")/infra/deploy/nginx/${src%%:*}"
      if [[ -f "$other_src" ]] && trusted_path "$other_src" && same_file "${SRC_NGINX}/${src%%:*}" "$other_src"; then
        note "${NGINX_DIR}/${src#*:} mis à jour pour les deux environnements (copies root alignées)"
      else
        fail "${NGINX_DIR}/${src#*:} diffère de la copie root ${DIGISANTE_ENV} alors que ${other_site} est actif et que sa copie root n'est pas alignée : installer le même SHA dans les deux copies root (install_root_scripts.sh) — jamais écrasé sinon"
      fi
    done
  fi
  # Serveur de repli : sans `default_server` explicite, Nginx sert un nom inconnu (accès par IP,
  # sonde sans SNI, srv1…) avec le PREMIER serveur chargé sur le port (conf.d/*.conf puis
  # sites-enabled/*, ordre alphabétique). Activer DigiSanté ne change jamais celui des voisins.
  local port
  for port in 443 80; do guard_default_server "$port"; done
  # DNS : informatif (l'émission du certificat échouerait).
  local v6
  for d in $DOMAINS; do
    if getent ahostsv4 "$d" 2>/dev/null | awk '{print $1}' | grep -qx "$HOST_IP"; then pass "DNS ${d} → ${HOST_IP}"; else fail "DNS ${d} ne résout pas vers ${HOST_IP} (émission Let's Encrypt impossible)"; fi
    # Let's Encrypt valide aussi en IPv6 : un AAAA vers un autre hôte ferait échouer l'émission.
    v6="$(getent ahostsv6 "$d" 2>/dev/null | awk '{print $1}' | grep -v '^::ffff:' | sort -u | tr '\n' ' ' || true)"
    v6="${v6% }"
    if [[ -n "$v6" && "$v6" != "${HOST_PUBLIC_IP6:-}" ]]; then fail "DNS ${d} : AAAA ${v6} — Let's Encrypt valide en IPv6 : le retirer ou le faire viser cet hôte (HOST_PUBLIC_IP6)"; fi
  done
}

guard_default_server() { # guard_default_server <port>
  local port="$1" f name fam label first foreign dflt site_path="${NGINX_DIR}/sites-enabled/${SITE}"
  local -a order=() placed=()
  mapfile -t order < <(nginx_load_order)
  # ${SITE} à sa place s'il n'est pas encore actif : avant la première entrée de sites-enabled qui
  # le suit dans le tri du glob, sinon après la dernière.
  if [[ " ${order[*]} " != *" ${site_path} "* ]]; then
    local inserted=0 last=-1 i
    for f in "${order[@]}"; do
      if (( ! inserted )) && [[ "$f" == "${NGINX_DIR}/sites-enabled/"* ]] && sorts_after "$(basename -- "$f")" "$SITE"; then placed+=("$site_path"); inserted=1; fi
      placed+=("$f")
      if [[ "$f" == "${NGINX_DIR}/sites-enabled/"* ]]; then last=$(( ${#placed[@]} - 1 )); fi
    done
    if (( ! inserted )); then
      if (( last >= 0 )); then placed=("${placed[@]:0:last+1}" "$site_path" "${placed[@]:last+1}"); else placed+=("$site_path"); fi
    fi
    order=("${placed[@]}")
  fi
  for fam in v4 v6; do
    if [[ "$fam" == v4 ]]; then label="$port"; else label="[::]:${port}"; fi
    first=""; foreign=""; dflt=""
    for f in "${order[@]}"; do
      if [[ "$f" == "$site_path" ]]; then [[ -n "$first" ]] || first="$SITE"; continue; fi
      [[ -f "$(F "$f")" ]] || continue
      if default_on "$fam" "$port" "$(F "$f")"; then dflt="$f"; break; fi
      listens_on "$fam" "$port" "$(F "$f")" || continue
      name="$(basename -- "$f")"
      if [[ "$f" == "${NGINX_DIR}/sites-enabled/digisante" || "$f" == "${NGINX_DIR}/sites-enabled/digisante-preprod" ]]; then [[ -n "$first" ]] || first="$name"; continue; fi
      [[ -n "$foreign" ]] || foreign="$f"
      [[ -n "$first" ]] || first="$name"
    done
    if [[ -n "$dflt" ]]; then
      pass "Nginx :${label} : default_server explicite (${dflt}) — DigiSanté jamais serveur de repli"
    elif [[ -z "$foreign" && "$fam" == v6 ]]; then
      note "Nginx :${label} : aucun voisin n'y écoute — DigiSanté y serait le serveur de repli IPv6 (un voisin publié en AAAA sans écoute IPv6 recevrait le certificat DigiSanté) : à constater (README §1.b, point 6)"
    elif [[ -z "$foreign" ]]; then
      note "Nginx :${label} : aucun autre serveur ; ${first} serait le serveur de repli"
    elif [[ "$first" == digisante || "$first" == digisante-preprod ]]; then
      fail "Nginx :${label} : aucun default_server explicite et ${first} serait chargé avant ${foreign} : DigiSanté deviendrait le serveur de repli de l'hôte (accès par IP, sans SNI) — faire déclarer « listen ${label} … default_server » par l'administrateur de l'hôte (jamais par ce script)"
    else
      pass "Nginx :${label} : serveur de repli inchangé (${first})"
    fi
  done
}

guard_cron() {
  # B3 : une planification root existante (crontab root, /etc/crontab, /etc/cron.d, cron.daily…)
  # qui lance APP_DIR — ancienne installation, ligne ajoutée à la main — est refusée.
  if b3_cron_hit "$(root_schedules)"; then die "B3 : une planification root (crontab root, /etc/crontab, /etc/cron.d, /etc/cron.{hourly,daily,weekly,monthly}) lance un chemin sous ${APP_DIR} : la retirer avant tout provisioning"; fi
  pass "planifications root sans chemin sous ${APP_DIR}"
}

# --apply : tout secret ou paramètre requis est contrôlé AVANT la première écriture.
preflight_apply() {
  [[ "$MODE" == apply ]] || return 0
  if want valkey && [[ -z "$VALKEY_APP_PASSWORD" && -z "$(valkey_acl_line)" ]]; then
    die "VALKEY_APP_PASSWORD (coffre, 32 à 256 caractères [A-Za-z0-9._~-]) requis pour créer l'utilisateur ACL ${VALKEY_APP_USER} — rien n'a été écrit"
  fi
  if want pg && [[ "$(pg_ro "SELECT 1 FROM pg_roles WHERE rolname = '${DB_ROLE}'")" != 1 ]] && ! pg_scram_verifier >/dev/null; then
    die "PG_APP_PASSWORD (coffre, ≥ 24 caractères ASCII imprimables, sans espace) requis pour créer ${DB_ROLE} — rien n'a été écrit"
  fi
  if want pg && [[ "$(pg_ro "SELECT 1 FROM pg_roles WHERE rolname = '${RUN_ROLE}'")" != 1 ]] && ! pg_scram_verifier PG_RUNTIME_PASSWORD >/dev/null; then
    die "PG_RUNTIME_PASSWORD (coffre, ≥ 24 caractères ASCII imprimables, sans espace) requis pour créer ${RUN_ROLE} — rien n'a été écrit"
  fi
  if want pg && [[ -n "$PG_APP_PASSWORD" && "$PG_APP_PASSWORD" == "$PG_RUNTIME_PASSWORD" ]]; then
    die "PG_RUNTIME_PASSWORD identique à PG_APP_PASSWORD : deux secrets distincts requis (propriétaire / exécution) — rien n'a été écrit"
  fi
  if want nginx && [[ ! -f "$(F "/etc/letsencrypt/live/${CERT_NAME}/fullchain.pem")" ]] && [[ ! "$LETSENCRYPT_EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; then
    die "LETSENCRYPT_EMAIL requis pour émettre ${CERT_NAME} — rien n'a été écrit"
  fi
}

run_guards() {
  guard_os
  guard_sources
  guard_ports
  if want users || [[ "$ACTION" != provision ]]; then guard_accounts; fi
  if want runtime; then guard_runtime; fi
  if want pg; then guard_pg; fi
  if want valkey; then guard_valkey; fi
  if want nginx; then guard_nginx; fi
  if want cron; then guard_cron; fi
}

# ═════════════════════════════════════════════════════════════
# ÉTAPES (écrivent seulement en --apply)
# ═════════════════════════════════════════════════════════════
step_users() {
  log "── utilisateurs"
  if ! id "$APP_USER" >/dev/null 2>&1; then
    # Connexion SSH par clé seulement (déploiement), membre de sshusers, ni docker ni sudo.
    act "création de ${APP_USER} (shell bash, groupe propre, sshusers)" useradd --create-home --shell /bin/bash --user-group --groups sshusers "$APP_USER"
    act "mot de passe verrouillé pour ${APP_USER} (clé SSH seulement)" usermod --lock "$APP_USER"
  elif [[ " $(id -nG "$APP_USER") " != *" sshusers "* ]]; then
    act "ajout de ${APP_USER} au groupe sshusers" usermod --append --groups sshusers "$APP_USER"
  else
    pass "compte ${APP_USER} présent"
  fi
  if ! id "$JOBS_USER" >/dev/null 2>&1; then
    # B3 : requêtes des tâches cron (internal_job / fedapay_reconcile) sous ce compte.
    act "création du compte sans droits ${JOBS_USER}" adduser --system --group --no-create-home --home /nonexistent --shell /usr/sbin/nologin "$JOBS_USER"
  else
    pass "compte ${JOBS_USER} présent"
  fi
  if [[ -n "${DEPLOY_SSH_PUBKEY:-}" ]]; then
    [[ "$DEPLOY_SSH_PUBKEY" =~ ^(ssh-ed25519|ecdsa-sha2-nistp256|ssh-rsa)\ [A-Za-z0-9+/=]{40,}(\ [[:graph:]]{1,64})?$ ]] || die "DEPLOY_SSH_PUBKEY : clé PUBLIQUE OpenSSH sur une ligne attendue"
    # `restrict` : commandes seulement (déploiement) — ni redirection de ports vers Valkey/PG/3000/3001
    # de l'hôte partagé, ni agent, ni X11, ni PTY, si la clé de CI fuitait.
    local keys core key_line; keys="$(app_home)/.ssh/authorized_keys"; key_line="restrict ${DEPLOY_SSH_PUBKEY}"
    core="$(cut -d ' ' -f 1,2 <<<"$DEPLOY_SSH_PUBKEY")"
    if grep -qF -- "$core" "$(F "$keys")" 2>/dev/null; then
      if grep -F -- "$core" "$(F "$keys")" | unrestricted_keys /dev/stdin | grep -q .; then
        fail "clé de déploiement déjà présente SANS restrict dans ${keys} : retirer cette ligne à la main (sshd retient la première)"
      else
        pass "clé de déploiement présente (restrict)"
      fi
    else
      # shellcheck disable=SC2016 # "$1"/"$2" évalués par sh -c, à dessein
      act "clé publique de déploiement (restrict) ajoutée à ${keys}" as_user "$APP_USER" sh -c 'umask 077; mkdir -p "${1%/*}" && printf "%s\n" "$2" >> "$1"' _ "$(F "$keys")" "$key_line"
    fi
  else
    note "DEPLOY_SSH_PUBKEY absent : clé de déploiement GitHub à ajouter (README, étape SSH)"
  fi
}

ensure_dir() { # ensure_dir <chemin> <propriétaire> <mode>
  local path="$1" owner="$2" mode="$3" target
  target="$(F "$path")"
  if [[ -L "$target" ]]; then die "${path} est un lien symbolique : refusé"; fi
  if [[ -d "$target" ]] && [[ "$(stat -c '%U:%a' -- "$target")" == "${owner}:${mode#0}" ]]; then pass "${path} (${owner} ${mode})"; return; fi
  act "répertoire ${path} (${owner}:${owner} ${mode})" install -d -o "$owner" -g "$owner" -m "$mode" -- "$target"
}

step_dirs() {
  log "── répertoires"
  ensure_dir "$APP_DIR" "$APP_USER" 0750
  ensure_dir "$APP_LOG_DIR" "$APP_USER" 0750
  # Magasin KYC + pièces DMP (données de santé) : HORS du checkout, à l'utilisateur, 0700 (B4).
  ensure_dir "$STORE_DIR" "$APP_USER" 0700
  ensure_dir "$CRON_LOG_DIR" root 0750
  ensure_dir "$ETC_DIR" root 0700
  ensure_dir "$BACKUP_DIR" root 0700
  ensure_dir "$STATE_DIR" root 0700
  ensure_dir "$ROOT_LIB" root 0755
  ensure_dir "$ACME_ROOT" root 0755
}

step_pg() {
  log "── PostgreSQL (rôle et base ${DB_NAME})"
  local exists
  exists="$(pg_ro "SELECT 1 FROM pg_roles WHERE rolname = '${DB_ROLE}'")"
  if [[ "$exists" != 1 ]]; then
    if [[ "$MODE" == apply ]]; then
      local verifier
      verifier="$(pg_scram_verifier)" || die "PG_APP_PASSWORD (coffre, ≥ 24 caractères ASCII imprimables, sans espace) requis pour créer ${DB_ROLE}"
      log "création du rôle ${DB_ROLE} (LOGIN, aucun privilège ; vérificateur SCRAM calculé localement, mot de passe jamais transmis ni affiché)"
      # Seul le VÉRIFICATEUR SCRAM part au serveur, par l'environnement de psql (\\getenv), jamais en argument (`ps`).
      env -u PG_APP_PASSWORD -u PG_RUNTIME_PASSWORD -u VALKEY_PASSWORD -u VALKEY_APP_PASSWORD -u REDISCLI_AUTH -u VALKEYCLI_AUTH DB_ROLE="$DB_ROLE" PG_APP_VERIFIER="$verifier" \
        sudo --preserve-env=DB_ROLE,PG_APP_VERIFIER -u postgres -H -- psql -X -q -v ON_ERROR_STOP=1 -d postgres <<'SQL'
\getenv db_role DB_ROLE
\getenv db_pw PG_APP_VERIFIER
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', :'db_role', :'db_pw')
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'db_role')\gexec
SQL
      unset verifier
    else
      # Seule la PRÉSENCE du mot de passe est indiquée, jamais sa valeur.
      local provided="à fournir à l'application"
      [[ -z "${PG_APP_PASSWORD}" ]] || provided="fourni"
      plan "création du rôle ${DB_ROLE} : CREATE ROLE … LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD (vérificateur SCRAM-SHA-256 calculé localement depuis PG_APP_PASSWORD, ${provided})"
    fi
  else
    pass "rôle ${DB_ROLE} présent (mot de passe jamais modifié par ce script)"
  fi
  exists="$(pg_ro "SELECT 1 FROM pg_roles WHERE rolname = '${RUN_ROLE}'")"
  if [[ "$exists" != 1 ]]; then
    if [[ "$MODE" == apply ]]; then
      local run_verifier
      run_verifier="$(pg_scram_verifier PG_RUNTIME_PASSWORD)" || die "PG_RUNTIME_PASSWORD (coffre, ≥ 24 caractères ASCII imprimables, sans espace) requis pour créer ${RUN_ROLE}"
      log "création du rôle d'exécution ${RUN_ROLE} (LOGIN, aucun privilège ni appartenance ; vérificateur SCRAM calculé localement)"
      env -u PG_APP_PASSWORD -u PG_RUNTIME_PASSWORD -u VALKEY_PASSWORD -u VALKEY_APP_PASSWORD -u REDISCLI_AUTH -u VALKEYCLI_AUTH RUN_ROLE="$RUN_ROLE" PG_RUNTIME_VERIFIER="$run_verifier" \
        sudo --preserve-env=RUN_ROLE,PG_RUNTIME_VERIFIER -u postgres -H -- psql -X -q -v ON_ERROR_STOP=1 -d postgres <<'SQL'
\getenv db_role RUN_ROLE
\getenv db_pw PG_RUNTIME_VERIFIER
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD %L', :'db_role', :'db_pw')
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'db_role')\gexec
SQL
      unset run_verifier
    else
      local run_provided="à fournir à l'application"
      [[ -z "${PG_RUNTIME_PASSWORD}" ]] || run_provided="fourni"
      plan "création du rôle d'exécution ${RUN_ROLE} : CREATE ROLE … LOGIN NOSUPERUSER … NOINHERIT PASSWORD (vérificateur SCRAM-SHA-256 calculé localement depuis PG_RUNTIME_PASSWORD, ${run_provided})"
    fi
  else
    pass "rôle d'exécution ${RUN_ROLE} présent (mot de passe jamais modifié par ce script)"
  fi
  if [[ "$(pg_ro "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'")" != 1 ]]; then
    act "création de la base ${DB_NAME} (propriétaire ${DB_ROLE}, UTF8, template0)" sudo -u postgres -H -- createdb --owner="$DB_ROLE" --encoding=UTF8 --template=template0 -- "$DB_NAME"
  else
    pass "base ${DB_NAME} présente"
  fi
  act "accès à ${DB_NAME} réservé à ${DB_ROLE} et ${RUN_ROLE} (REVOKE PUBLIC, GRANT CONNECT[/TEMPORARY])" sudo -u postgres -H -- psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "REVOKE ALL ON DATABASE \"${DB_NAME}\" FROM PUBLIC; GRANT CONNECT, TEMPORARY ON DATABASE \"${DB_NAME}\" TO \"${DB_ROLE}\"; GRANT CONNECT ON DATABASE \"${DB_NAME}\" TO \"${RUN_ROLE}\";"
  log "droits de ${RUN_ROLE} sur les tables : appliqués et contrôlés par deploy.sh après chaque migration (audit_logs/finance_entries en INSERT/SELECT)"
}

step_valkey() {
  log "── Valkey (index ${VALKEY_DB})"
  # SET NX : n'écrase jamais ; aucune autre écriture, jamais FLUSH*.
  if [[ "$MODE" == apply ]]; then
    valkey_cli -n "$VALKEY_DB" SET digisante:owner "$DIGISANTE_ENV" NX >/dev/null
    [[ "$(valkey_cli -n "$VALKEY_DB" GET digisante:owner)" == "$DIGISANTE_ENV" ]] || die "marqueur Valkey non posé"
    log "index ${VALKEY_DB} réservé à ${DIGISANTE_ENV}"
  else
    plan "index ${VALKEY_DB} réservé : SET digisante:owner ${DIGISANTE_ENV} NX (mot de passe par REDISCLI_AUTH)"
  fi
  # Utilisateur ACL : par l'ENTRÉE STANDARD de valkey-cli (jamais en argument, `ps`) et sous
  # forme d'empreinte SHA-256 calculée ici (`#…`) : le mot de passe ne part jamais au serveur.
  local rules out hash
  rules="$(valkey_acl_rules "$VALKEY_PREFIX" | tr '\n' ' ')"
  if [[ "$MODE" == apply ]]; then
    if [[ -n "$VALKEY_APP_PASSWORD" ]]; then
      hash="$(printf '%s' "$VALKEY_APP_PASSWORD" | sha256sum | cut -d ' ' -f 1)"
      out="$(printf 'ACL SETUSER %s reset on #%s %s\n' "$VALKEY_APP_USER" "$hash" "$rules" | valkey_cli 2>&1 || true)"
      unset hash
    else
      # Rotation non demandée : mots de passe conservés, règles réappliquées.
      out="$(printf 'ACL SETUSER %s on %s\n' "$VALKEY_APP_USER" "$rules" | valkey_cli 2>&1 || true)"
    fi
    [[ "$out" == OK ]] || die "ACL SETUSER ${VALKEY_APP_USER} refusé (réponse non affichée) : droits d'administration Valkey requis"
    out="$(valkey_cli ACL SAVE 2>&1 || true)"
    [[ "$out" == OK ]] || die "ACL SAVE refusé : utilisateur ${VALKEY_APP_USER} actif mais NON persistant — à corriger avant tout redémarrage de Valkey"
    log "utilisateur ACL ${VALKEY_APP_USER} : ${rules}(persistant, ACL SAVE)"
  else
    plan "utilisateur ACL ${VALKEY_APP_USER} : ACL SETUSER ${VALKEY_APP_USER} $([[ -n "$VALKEY_APP_PASSWORD" ]] && echo 'reset on #<SHA-256 de VALKEY_APP_PASSWORD, calculée ici>' || echo 'on (mots de passe conservés)') ${rules}par l'entrée standard, puis ACL SAVE"
  fi
  note "REDIS_URL du .env : redis://${VALKEY_APP_USER}:<VALKEY_APP_PASSWORD>@127.0.0.1:${VALKEY_PORT}/${VALKEY_DB} et REDIS_KEY_PREFIX=${VALKEY_PREFIX}"
}

# Droits EFFECTIFS de l'utilisateur ACL, mesurés par ACL DRYRUN (sans son mot de passe), et
# .env de l'API sous cet utilisateur et ce préfixe.
verify_valkey_acl() {
  local line probe allowed denied
  line="$(valkey_acl_line)"
  if [[ -z "$line" ]]; then fail "utilisateur ACL ${VALKEY_APP_USER} absent (--apply --only valkey, VALKEY_APP_PASSWORD)"; return 0; fi
  if [[ " $line " == *" on "* && " $line " != *" nopass "* ]]; then pass "utilisateur ACL ${VALKEY_APP_USER} actif, avec mot de passe"; else fail "utilisateur ACL ${VALKEY_APP_USER} inactif ou sans mot de passe"; fi
  allowed=0; denied=0
  local other_prefix words
  if [[ "$DIGISANTE_ENV" == production ]]; then other_prefix=digisante-preprod:; else other_prefix=digisante:; fi
  for probe in "GET ${VALKEY_PREFIX}probe" "PUBLISH ${VALKEY_PREFIX}chat:events x"; do
    read -r -a words <<<"$probe"
    if [[ "$(valkey_cli ACL DRYRUN "$VALKEY_APP_USER" "${words[@]}" 2>/dev/null)" == OK ]]; then allowed=$((allowed + 1)); else fail "ACL ${VALKEY_APP_USER} : « ${probe} » refusé (l'API en a besoin)"; fi
  done
  for probe in FLUSHALL FLUSHDB 'KEYS *' 'SCAN 0' 'CONFIG GET maxmemory' INFO 'ACL LIST' 'CLIENT LIST' MONITOR 'SWAPDB 5 6' \
    'GET otp:probe' "GET ${other_prefix}probe" 'PUBLISH chat:events x' "SUBSCRIBE ${other_prefix}chat:events" "MOVE ${VALKEY_PREFIX}probe 0"; do
    # Mots de la sonde sans expansion de chemin (« KEYS * »).
    read -r -a words <<<"$probe"
    if [[ "$(valkey_cli ACL DRYRUN "$VALKEY_APP_USER" "${words[@]}" 2>/dev/null)" == OK ]]; then fail "ACL ${VALKEY_APP_USER} : « ${probe} » PERMIS (hors périmètre de l'environnement)"; else denied=$((denied + 1)); fi
  done
  (( allowed == 2 && denied == 15 )) && pass "ACL ${VALKEY_APP_USER} : préfixe ${VALKEY_PREFIX} seul, aucune commande d'administration (ACL DRYRUN)"
  note "utilisateur default (mot de passe d'administration de l'hôte) : accès à TOUS les index (ImmiPro, BeninLink, DigiSanté) — réservé à l'administrateur, jamais dans un .env"
  if [[ -f "$(F "$ENV_FILE")" ]]; then
    local url user prefix rc=0
    url="$(env_value REDIS_URL)" || rc=$?
    user="${url#*://}"; user="${user%%[:@]*}"; unset url
    if (( rc == 0 )) && [[ "$user" == "$VALKEY_APP_USER" ]]; then pass "API (.env) sous l'utilisateur ACL ${VALKEY_APP_USER}"; else fail "API (.env) sous l'utilisateur Valkey « ${user:-default} » au lieu de ${VALKEY_APP_USER}"; fi
    rc=0; prefix="$(env_value REDIS_KEY_PREFIX)" || rc=$?
    if (( rc == 0 )) && [[ "$prefix" == "$VALKEY_PREFIX" ]]; then pass "REDIS_KEY_PREFIX=${VALKEY_PREFIX}"; else fail "REDIS_KEY_PREFIX absent ou différent de ${VALKEY_PREFIX} (.env de l'API)"; fi
  fi
}

step_runtime() {
  log "── Node / pnpm / PM2"
  local global pm2_pkg
  global="$(npm root -g 2>/dev/null || true)"
  pm2_pkg="${global:+$(F "$global")/pm2/package.json}"
  if [[ -n "$pm2_pkg" && -f "$pm2_pkg" ]]; then
    note "PM2 $(node -p 'require(process.argv[1]).version' "$pm2_pkg" 2>/dev/null || echo '?') déjà installé (jamais remplacé automatiquement)"
  else
    act "installation de PM2 ${PM2_VERSION} (global, version exacte)" clean_env npm install --global "pm2@${PM2_VERSION}"
  fi
  # Cache corepack de l'utilisateur : deploy.sh lance `corepack pnpm` (version du packageManager),
  # jamais le pnpm global de l'hôte partagé.
  act "pnpm ${PNPM_VERSION} mis en cache corepack pour ${APP_USER} (deploy.sh : corepack pnpm)" as_user "$APP_USER" env COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack install --global "pnpm@${PNPM_VERSION}"
  if systemctl is-enabled "pm2-${APP_USER}" >/dev/null 2>&1; then
    pass "service pm2-${APP_USER} activé"
  else
    act "démarrage PM2 au boot pour ${APP_USER} (service pm2-${APP_USER})" clean_env pm2 startup systemd -u "$APP_USER" --hp "$(app_home)" --service-name "pm2-${APP_USER}"
  fi
}

# Valeur d'une clé du .env de l'API, lue comme DONNÉES (util.parseEnv) ; écrite sur stdout,
# jamais en argument d'une autre commande. Fichier de CET environnement seulement : chemin
# canonique (aucun lien, même parent — apps/api lié vers l'autre checkout ferait recopier
# le jeton de production en préproduction), fichier ordinaire du compte applicatif, jamais
# modifiable par le groupe ou les autres. Sorties : 3 fichier refusé, 4 clé absente.
env_value() {
  local uid
  uid="$(id -u "$APP_USER" 2>/dev/null)" || return 3
  node -e '
    const fs = require("node:fs"); const { parseEnv } = require("node:util");
    const [file, key, uid] = process.argv.slice(1);
    try { if (fs.realpathSync(file) !== file) process.exit(3); } catch { process.exit(3); }
    let fd; try { fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); } catch { process.exit(3); }
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.uid !== Number(uid) || (st.mode & 0o022) !== 0) process.exit(3);
    const v = parseEnv(fs.readFileSync(fd, "utf8"))[key];
    if (v === undefined) process.exit(4);
    process.stdout.write(v);' "$(F "$ENV_FILE")" "$1" "$uid"
}

step_secrets() {
  log "── fichiers de service root (${ETC_DIR})"
  local key token_file
  key="$(F "${ETC_DIR}/backup.key")"
  if [[ -s "$key" ]]; then pass "backup.key présent (jamais affiché)"; else
    # shellcheck disable=SC2016 # "$1" évalué par sh -c, à dessein
    act "clé de sauvegarde générée sur l'hôte (0400, jamais affichée ; copie HORS VPS par l'opérateur)" sh -c 'umask 077; openssl rand -base64 48 > "$1" && chmod 0400 "$1"' _ "$key"
  fi
  token_file="$(F "${ETC_DIR}/reconcile.token")"
  if [[ -f "$(F "$ENV_FILE")" ]]; then
    local token rc=0
    token="$(env_value RECONCILE_TOKEN)" || rc=$?
    if (( rc == 3 )); then
      fail "${ENV_FILE} refusé : lien symbolique dans le chemin, propriétaire ≠ ${APP_USER} ou modifiable par d'autres (jeton non recopié)"
    elif (( rc == 0 )) && [[ ${#token} -ge 32 ]]; then
      if [[ -f "$token_file" ]] && [[ "$(cat -- "$token_file")" == "$token" ]]; then pass "reconcile.token = RECONCILE_TOKEN du .env"; else
        if [[ "$MODE" == apply ]]; then (umask 077; printf '%s' "$token" > "$token_file"); chmod 0400 "$token_file"; log "reconcile.token aligné sur le .env (jamais affiché)"; else plan "reconcile.token ← RECONCILE_TOKEN du .env (0400, jamais affiché)"; fi
      fi
    else
      fail "RECONCILE_TOKEN absent ou < 32 caractères dans ${ENV_FILE}"
    fi
    unset token
  else
    note "${ENV_FILE} absent : reconcile.token à aligner après création du .env (relancer --only secrets)"
  fi
  if [[ ! -f "$(F "${ETC_DIR}/alert.conf")" ]]; then
    # shellcheck disable=SC2016 # "$1" évalué par sh -c, à dessein
    act "alert.conf modèle (0600, destinataire à renseigner)" sh -c 'umask 077; printf "%s\n" "# Destinataire des alertes healthwatch (RUNBOOK_Alertes.md) — à renseigner :" "# ALERT_CMD='"'"'mail -s \"[DigiSanté] alerte\" ops@<domaine>'"'"'" > "$1"' _ "$(F "${ETC_DIR}/alert.conf")"
  fi
}

install_file() { # install_file <source> <destination> <mode>
  local src="$1" dest="$2" mode="$3"
  if same_file "$src" "$(F "$dest")"; then pass "${dest} à jour"; return; fi
  act "installation de ${dest} (root:root ${mode})" install -o root -g root -m "$mode" -- "$src" "$(F "$dest")"
}

nginx_reload() {
  if [[ "$MODE" == apply ]]; then
    nginx -t >/dev/null 2>&1 || return 1
    systemctl reload nginx
  else
    plan "nginx -t puis systemctl reload nginx"
  fi
}

# Fichiers Nginx gérés par ce script pour CET environnement (communs + vhost + lien).
nginx_managed() {
  printf '%s\n' "${NGINX_DIR}/conf.d/digisante-rate-limit.conf" "${NGINX_DIR}/snippets/digisante-headers.conf" \
    "${NGINX_DIR}/snippets/digisante-hsts.conf" "${NGINX_DIR}/sites-available/${SITE}" "${NGINX_DIR}/sites-enabled/${SITE}"
}
# Instantané avant la première écriture Nginx ; restauré à l'identique si `nginx -t` refuse
# une étape (fichier absent avant ⇒ retiré) : l'hôte n'est jamais laissé invalide.
NGINX_SNAP=""
nginx_snapshot() {
  [[ "$MODE" == apply && -z "$NGINX_SNAP" ]] || return 0
  NGINX_SNAP="$(mktemp -d)"; chmod 0700 "$NGINX_SNAP"
  local p i=0
  while IFS= read -r p; do
    i=$((i + 1))
    if [[ -e "$(F "$p")" || -L "$(F "$p")" ]]; then cp -P -p -- "$(F "$p")" "${NGINX_SNAP}/${i}"; fi
  done < <(nginx_managed)
}
nginx_restore_or_die() { # nginx_restore_or_die <message>
  local p i=0
  while IFS= read -r p; do
    i=$((i + 1))
    rm -f -- "$(F "$p")"
    if [[ -e "${NGINX_SNAP}/${i}" || -L "${NGINX_SNAP}/${i}" ]]; then cp -P -p -- "${NGINX_SNAP}/${i}" "$(F "$p")"; fi
  done < <(nginx_managed)
  rm -rf -- "$NGINX_SNAP"; NGINX_SNAP=""
  if nginx -t >/dev/null 2>&1; then systemctl reload nginx; die "$1 : fichiers Nginx DigiSanté restaurés à l'état d'avant (nginx -t vert)"; fi
  die "$1 : fichiers Nginx DigiSanté restaurés, mais nginx -t échoue encore — vérifier l'hôte À LA MAIN"
}
nginx_apply_reload() { # nginx_apply_reload <message d'échec>
  if [[ "$MODE" == apply ]]; then nginx_reload || nginx_restore_or_die "$1"; else nginx_reload; fi
}

step_nginx() {
  log "── Nginx + TLS (${DOMAINS})"
  local site_av site_en cert d certbot_domains=()
  site_av="${NGINX_DIR}/sites-available/${SITE}"; site_en="${NGINX_DIR}/sites-enabled/${SITE}"
  cert="/etc/letsencrypt/live/${CERT_NAME}/fullchain.pem"
  for d in $DOMAINS; do certbot_domains+=(-d "$d"); done
  if [[ "$MODE" == apply ]]; then
    nginx -t >/dev/null 2>&1 || die "nginx -t échoue AVANT toute modification : configuration de l'hôte à corriger d'abord (rien n'est modifié)"
  else
    plan "nginx -t vert exigé avant toute modification"
  fi
  nginx_snapshot
  # Fichiers communs : jamais écrasés par la copie root de cet environnement quand l'autre est
  # actif (garde guard_nginx) ; installés s'ils sont absents ou si l'autre environnement est inactif.
  install_file "${SRC_NGINX}/rate-limit.conf" "${NGINX_DIR}/conf.d/digisante-rate-limit.conf" 0644
  install_file "${SRC_NGINX}/digisante-headers.conf" "${NGINX_DIR}/snippets/digisante-headers.conf" 0644
  # 1. Aucun vhost DigiSanté actif pour cet environnement (premier passage, ou après --rollback
  #    avec certificat conservé) : amorçage HTTP seul pour servir le challenge ACME.
  if [[ ! -e "$(F "$site_en")" ]]; then
    local boot
    boot="$(mktemp)"
    cat > "$boot" <<CONF
# Généré par provision-ionos.sh — amorçage ACME (HTTP seul) de ${SITE}, remplacé par le vhost TLS.
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAINS};
    server_tokens off;
    access_log /var/log/nginx/${SITE}-access.log digisante_noquery;
    error_log /dev/null;
    location ^~ /.well-known/acme-challenge/ {
        root ${ACME_ROOT};
        default_type text/plain;
    }
    location / {
        return 404;
    }
}
CONF
    install_file "$boot" "$site_av" 0644
    rm -f -- "$boot"
    act "activation de ${SITE} (amorçage ACME)" ln -sfn -- "$site_av" "$(F "$site_en")"
  fi
  nginx_apply_reload "nginx -t refuse les fichiers communs ou l'amorçage ACME de ${SITE}"
  if [[ ! -f "$(F "$cert")" ]]; then
    [[ -n "${LETSENCRYPT_EMAIL:-}" || "$MODE" != apply ]] || nginx_restore_or_die "LETSENCRYPT_EMAIL requis pour l'émission"
    # 2. Let's Encrypt : essai à blanc d'abord, webroot (Certbot ne réécrit aucun vhost). Les hooks
    #    pre/post de /etc/letsencrypt/renewal-hooks (hôte) s'exécutent comme au vrai renouvellement :
    #    l'essai les inclut pour valider le chemin réel avant HSTS (README §1.b, vérification Certbot).
    act "certificat ${CERT_NAME} — essai à blanc (staging)" clean_env certbot certonly --webroot -w "$ACME_ROOT" --cert-name "$CERT_NAME" "${certbot_domains[@]}" --non-interactive --agree-tos -m "${LETSENCRYPT_EMAIL:-<LETSENCRYPT_EMAIL>}" --dry-run
    act "certificat ${CERT_NAME} — émission" clean_env certbot certonly --webroot -w "$ACME_ROOT" --cert-name "$CERT_NAME" "${certbot_domains[@]}" --non-interactive --agree-tos -m "${LETSENCRYPT_EMAIL:-<LETSENCRYPT_EMAIL>}" --deploy-hook "systemctl reload nginx"
  else
    pass "certificat ${CERT_NAME} présent"
  fi
  act "renouvellement ${CERT_NAME} — essai à blanc (seul ce certificat ; hooks pre/post de l'hôte exécutés, comme le vrai renouvellement)" clean_env certbot renew --cert-name "$CERT_NAME" --dry-run
  # 3. HSTS (24 h) et vhost TLS complet seulement après certificat + renouvellement validés.
  install_file "${SRC_NGINX}/hsts-after-tls.conf" "${NGINX_DIR}/snippets/digisante-hsts.conf" 0644
  if ! same_file "$SRC_VHOST" "$(F "$site_av")" || [[ ! -L "$(F "$site_en")" ]]; then
    act "vhost TLS ${SITE} : ${SRC_VHOST#"$SELF_ROOT"/} → ${site_av}" install -o root -g root -m 0644 -- "$SRC_VHOST" "$(F "$site_av")"
    act "activation de ${SITE}" ln -sfn -- "$site_av" "$(F "$site_en")"
    nginx_apply_reload "nginx -t refuse le vhost TLS ${SITE}"
    [[ "$MODE" != apply ]] || log "vhost ${SITE} TLS actif"
  else
    pass "vhost ${SITE} à jour"
  fi
  if [[ -n "$NGINX_SNAP" ]]; then rm -rf -- "$NGINX_SNAP"; NGINX_SNAP=""; fi
}

step_cron() {
  log "── crons et rotation (B3 : copie root uniquement)"
  install_file "$SRC_CRON" "$CRON_FILE" 0644
  install_file "$SRC_LOGROTATE" "/etc/logrotate.d/${SITE}" 0644
  note "jeton des tâches : ${ETC_DIR}/reconcile.token (étape secrets) ; compte des tâches ${JOBS_USER} (étape users)"
}

# ═════════════════════════════════════════════════════════════
# VÉRIFICATION POST-PROVISIONING (lecture seule)
# ═════════════════════════════════════════════════════════════
check_dir() { # check_dir <chemin> <propriétaire> <mode>
  local t; t="$(F "$1")"
  if [[ -d "$t" && ! -L "$t" && "$(stat -c '%U:%a' -- "$t")" == "${2}:${3#0}" ]]; then pass "${1} ${2} ${3}"; else fail "${1} : attendu ${2} ${3}, trouvé $(stat -c '%U %a' -- "$t" 2>/dev/null || echo absent)"; fi
}

# Rôle d'exécution : existence, aucun privilège/appartenance/objet, CONNECT, et — une fois
# les migrations appliquées — registres append-only en INSERT/SELECT seulement (droits posés
# par deploy.sh). Le .env de l'API doit viser CE rôle, jamais le propriétaire.
verify_runtime_role() {
  local state
  state="$(pg_ro "/* runtime_role_check */ SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${RUN_ROLE}') THEN 'absent'
    WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${RUN_ROLE}' AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls))
      OR EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = '${RUN_ROLE}') THEN 'privilege'
    WHEN NOT has_database_privilege('${RUN_ROLE}', current_database(), 'CONNECT') THEN 'connect'
    WHEN to_regclass('public.audit_logs') IS NULL OR to_regclass('public.finance_entries') IS NULL THEN 'schema'
    WHEN EXISTS (SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = '${RUN_ROLE}')
      OR has_schema_privilege('${RUN_ROLE}', 'public', 'CREATE')
      OR has_any_column_privilege('${RUN_ROLE}', 'public.audit_logs', 'UPDATE') OR has_table_privilege('${RUN_ROLE}', 'public.audit_logs', 'DELETE') OR has_table_privilege('${RUN_ROLE}', 'public.audit_logs', 'TRUNCATE')
      OR has_any_column_privilege('${RUN_ROLE}', 'public.finance_entries', 'UPDATE') OR has_table_privilege('${RUN_ROLE}', 'public.finance_entries', 'DELETE') OR has_table_privilege('${RUN_ROLE}', 'public.finance_entries', 'TRUNCATE') THEN 'audit'
    WHEN NOT has_table_privilege('${RUN_ROLE}', 'public.audit_logs', 'INSERT') THEN 'grants'
    ELSE 'ok' END" "$DB_NAME" 2>/dev/null || true)"
  case "$state" in
    ok) pass "rôle d'exécution ${RUN_ROLE} : non propriétaire, audit_logs/finance_entries en INSERT/SELECT seulement" ;;
    schema) note "schéma non migré : droits de ${RUN_ROLE} sur les registres vérifiés après le premier deploy.sh" ;;
    grants) fail "rôle ${RUN_ROLE} sans droits sur les tables : relancer deploy.sh (étape grants)" ;;
    audit) fail "rôle ${RUN_ROLE} : objet possédé, CREATE sur public ou UPDATE/DELETE/TRUNCATE sur un registre append-only" ;;
    absent) fail "rôle d'exécution ${RUN_ROLE} absent (--apply --only pg, PG_RUNTIME_PASSWORD)" ;;
    *) fail "rôle d'exécution ${RUN_ROLE} : privilégié, membre d'un autre rôle, sans CONNECT ou état illisible (${state:-?})" ;;
  esac
  if [[ -f "$(F "$ENV_FILE")" ]]; then
    local url user rc=0
    url="$(env_value DATABASE_URL)" || rc=$?
    user="${url#*://}"; user="${user%%[:@]*}"; unset url
    if (( rc == 0 )) && [[ "$user" == "$RUN_ROLE" ]]; then pass "API (.env) sous ${RUN_ROLE}"; else fail "API (.env) sous ${user:-?} au lieu de ${RUN_ROLE} (rôle propriétaire = migrations seulement)"; fi
    rc=0; env_value MIGRATION_DATABASE_URL >/dev/null || rc=$?
    if (( rc == 4 )); then pass "aucune URL du propriétaire dans le .env de l'API"; else fail "MIGRATION_DATABASE_URL dans le .env de l'API (ou fichier refusé) : la retirer"; fi
  fi
}

verify_all() {
  log "── vérification post-provisioning (${DIGISANTE_ENV})"
  local u groups
  for u in "$APP_USER" "$JOBS_USER"; do
    if id "$u" >/dev/null 2>&1; then
      groups=" $(id -nG "$u") "
      if [[ "$groups" =~ \ (docker|sudo|admin|wheel|lxd|root|adm|disk|shadow)\  ]]; then fail "${u} membre d'un groupe privilégié"; else pass "${u} sans groupe privilégié"; fi
    else fail "compte ${u} absent"; fi
  done
  if id "$APP_USER" >/dev/null 2>&1 && [[ " $(id -nG "$APP_USER") " == *" sshusers "* ]]; then pass "${APP_USER} ∈ sshusers"; else fail "${APP_USER} hors sshusers"; fi
  for u in "$APP_USER" "$JOBS_USER"; do
    if id "$u" >/dev/null 2>&1 && sudo_allowed "$u"; then fail "${u} autorisé par sudoers"; fi
  done
  if id "$JOBS_USER" >/dev/null 2>&1 && id "$APP_USER" >/dev/null 2>&1 && [[ "$(id -u "$JOBS_USER")" != "$(id -u "$APP_USER")" && "$(id -g "$JOBS_USER")" != "$(id -g "$APP_USER")" ]]; then pass "${JOBS_USER} distinct de ${APP_USER} (uid/gid)"; else fail "${JOBS_USER} absent ou confondu avec ${APP_USER}"; fi
  local keys; keys="$(app_home)/.ssh/authorized_keys"
  if [[ -f "$(F "$keys")" ]]; then
    if unrestricted_keys "$(F "$keys")" | grep -q .; then fail "${keys} : clé sans restrict (redirection de ports vers les services de l'hôte possible)"; else pass "clés SSH de ${APP_USER} toutes restreintes (restrict)"; fi
  fi
  check_dir "$APP_DIR" "$APP_USER" 0750; check_dir "$APP_LOG_DIR" "$APP_USER" 0750; check_dir "$STORE_DIR" "$APP_USER" 0700
  check_dir "$CRON_LOG_DIR" root 0750; check_dir "$ETC_DIR" root 0700; check_dir "$BACKUP_DIR" root 0700
  check_dir "$STATE_DIR" root 0700; check_dir "$ROOT_LIB" root 0755; check_dir "$ACME_ROOT" root 0755
  # PostgreSQL : rôle sans privilège, base au rôle, PUBLIC sans CONNECT.
  if [[ "$(pg_ro "SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls FROM pg_roles WHERE rolname = '${DB_ROLE}'" 2>/dev/null)" == f ]] \
    && [[ "$(pg_ro "SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = '${DB_ROLE}'" 2>/dev/null)" == 0 ]]; then pass "rôle ${DB_ROLE} sans privilège ni appartenance"; else fail "rôle ${DB_ROLE} absent, privilégié ou membre d'autres rôles"; fi
  if [[ "$(pg_ro "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = '${DB_NAME}'" 2>/dev/null)" == "$DB_ROLE" ]]; then pass "base ${DB_NAME} → ${DB_ROLE}"; else fail "base ${DB_NAME} absente ou d'un autre propriétaire"; fi
  if [[ "$(pg_ro "SELECT has_database_privilege('public', '${DB_NAME}', 'CONNECT')" 2>/dev/null)" == f ]]; then pass "PUBLIC sans CONNECT sur ${DB_NAME}"; else fail "PUBLIC peut se connecter à ${DB_NAME}"; fi
  verify_runtime_role
  hba_check
  # Valkey : marqueur de l'environnement.
  if [[ -n "${VALKEY_PASSWORD:-}" ]]; then
    if [[ "$(valkey_cli -n "$VALKEY_DB" GET digisante:owner 2>/dev/null)" == "$DIGISANTE_ENV" ]]; then pass "Valkey index ${VALKEY_DB} → ${DIGISANTE_ENV}"; else fail "Valkey index ${VALKEY_DB} sans marqueur ${DIGISANTE_ENV}"; fi
    valkey_eviction_check
    verify_valkey_acl
  else fail "VALKEY_PASSWORD absent : marqueur, éviction et utilisateur ACL Valkey NON vérifiés (read -rs VALKEY_PASSWORD; export VALKEY_PASSWORD)"; fi
  # Runtime.
  # Node du COMPTE applicatif (PM2, deploy.sh) : un Node réservé à root (nvm sous /root) ne lui sert à rien.
  if [[ "$(as_user "$APP_USER" node -v 2>/dev/null | sed -n 's/^v\([0-9]*\)\..*/\1/p')" == "$NODE_MAJOR" ]]; then pass "Node ${NODE_MAJOR} (compte ${APP_USER})"; else fail "Node ${NODE_MAJOR} introuvable pour ${APP_USER} (Node de root seulement ?)"; fi
  if systemctl is-enabled "pm2-${APP_USER}" >/dev/null 2>&1; then pass "service pm2-${APP_USER} activé"; else fail "service pm2-${APP_USER} non activé"; fi
  # pnpm de deploy.sh : `corepack pnpm` dans le checkout, depuis le cache (aucun téléchargement ici).
  if [[ -f "$(F "${APP_DIR}/package.json")" ]]; then
    local pnpm_v
    # shellcheck disable=SC2016 # "$1" évalué par sh -c, à dessein
    pnpm_v="$(as_user "$APP_USER" env COREPACK_ENABLE_NETWORK=0 COREPACK_ENABLE_DOWNLOAD_PROMPT=0 sh -c 'cd "$1" && corepack pnpm --version' _ "$(F "$APP_DIR")" 2>/dev/null | tail -n 1 || true)"
    if [[ "$pnpm_v" == "$PNPM_VERSION" ]]; then pass "pnpm ${PNPM_VERSION} (corepack, cache de ${APP_USER})"; else fail "corepack pnpm → ${pnpm_v:-indisponible hors ligne} (≠ ${PNPM_VERSION}) : relancer --apply --only runtime"; fi
  else
    note "${APP_DIR} sans checkout : version pnpm (corepack) vérifiée après le clone"
  fi
  # Nginx / TLS.
  if nginx -t >/dev/null 2>&1; then pass "nginx -t"; else fail "nginx -t"; fi
  if [[ -L "$(F "${NGINX_DIR}/sites-enabled/${SITE}")" ]] && same_file "$SRC_VHOST" "$(F "${NGINX_DIR}/sites-available/${SITE}")"; then pass "vhost ${SITE} TLS actif et conforme"; else fail "vhost ${SITE} absent, inactif ou différent de la copie root"; fi
  if [[ -f "$(F "/etc/letsencrypt/live/${CERT_NAME}/fullchain.pem")" ]]; then pass "certificat ${CERT_NAME}"; else fail "certificat ${CERT_NAME} absent"; fi
  if [[ -e "$(F "$MAINTENANCE_FILE")" ]]; then note "maintenance ACTIVE (${MAINTENANCE_FILE}) : à retirer après recette (README §3)"; else note "maintenance inactive"; fi
  # Crons (B3).
  if same_file "$SRC_CRON" "$(F "$CRON_FILE")"; then pass "${CRON_FILE} = modèle de la copie root"; else fail "${CRON_FILE} absent ou différent"; fi
  if [[ -f "$(F "$CRON_FILE")" ]] && ! b3_cron_hit "$(cron_active "$(F "$CRON_FILE")")"; then pass "B3 : ${CRON_FILE} sans chemin sous ${APP_DIR}"; else fail "B3 : ${CRON_FILE} absent ou lance un chemin sous ${APP_DIR}"; fi
  if b3_cron_hit "$(root_schedules)"; then fail "B3 : une planification root (crontab root, /etc/crontab, /etc/cron.d, cron.daily…) lance un chemin sous ${APP_DIR}"; else pass "B3 : aucune planification root sous ${APP_DIR}"; fi
  if same_file "$SRC_LOGROTATE" "$(F "/etc/logrotate.d/${SITE}")"; then pass "logrotate ${SITE}"; else fail "logrotate ${SITE} absent ou différent"; fi
  # Fichiers de service root.
  if [[ -s "$(F "${ETC_DIR}/backup.key")" && "$(stat -c '%U' -- "$(F "${ETC_DIR}/backup.key")")" == root ]]; then pass "backup.key (root)"; else fail "backup.key absent"; fi
  verify_store
}

# B4 : KYC_STORAGE_DIR absolu dans le .env, résolu comme l'API et la sauvegarde, puis
# chaque référence distincte de la base applicative doit désigner un fichier ordinaire
# du magasin. Des fichiers orphelins ne compensent jamais une référence manquante.
verify_store() {
  if [[ ! -f "$(F "$ENV_FILE")" ]]; then note "${ENV_FILE} absent : magasin KYC (B4) non vérifié"; return; fi
  local raw store tables refs ref uid expected=0 missing=0
  local rc=0
  raw="$(env_value KYC_STORAGE_DIR)" || rc=$?
  if (( rc == 3 )); then fail "B4 : ${ENV_FILE} refusé (lien dans le chemin, propriétaire ≠ ${APP_USER} ou modifiable par d'autres)"; return; fi
  if (( rc != 0 )); then fail "B4 : KYC_STORAGE_DIR absent du .env"; return; fi
  [[ "$raw" == /* ]] || { fail "B4 : KYC_STORAGE_DIR doit être un chemin ABSOLU"; return; }
  uid="$(id -u "$APP_USER" 2>/dev/null || echo 0)"
  # Module exécuté par root : copie de confiance seulement (B3, comme pg_dump_encrypted.sh).
  if [[ ! -f "$FILESTORE_MODULE" ]] || ! trusted_path "$FILESTORE_MODULE"; then fail "B4 : ${FILESTORE_MODULE} absent ou modifiable par un autre compte : jamais exécuté par root"; return; fi
  if ! store="$(API_ENV_FILE="$(F "$ENV_FILE")" API_DIR="$(F "${APP_DIR}/apps/api")" FILESTORE_OWNER_UID="$uid" node "$FILESTORE_MODULE" 2>/dev/null)"; then
    fail "B4 : magasin KYC refusé (propriétaire ${APP_USER}, 0700, nom sûr requis — cf. filestore-dir.mjs)"; return
  fi
  pass "B4 : magasin KYC ${raw} (absolu, ${APP_USER}, résolu comme l'API)"
  if ! tables="$(pg_ro "SELECT (to_regclass('public.documents') IS NOT NULL)::int + (to_regclass('public.kyc_documents') IS NOT NULL)::int" "$DB_NAME" 2>/dev/null)"; then
    fail "B4 : lecture des tables applicatives impossible dans ${DB_NAME}"; return
  fi
  if [[ "$tables" == 0 ]]; then note "B4 : base ${DB_NAME} sans tables applicatives (avant migration) : comparaison des fichiers reportée"; return; fi
  if [[ "$tables" != 2 ]]; then fail "B4 : tables applicatives incomplètes dans ${DB_NAME}"; return; fi
  if ! refs="$(pg_ro "SELECT ref FROM (SELECT \"encryptedUrl\" AS ref FROM public.documents UNION SELECT \"fileUrl\" FROM public.kyc_documents) AS refs WHERE ref ~ '^[0-9a-f-]{36}\$'" "$DB_NAME" 2>/dev/null)"; then
    fail "B4 : lecture des références de fichiers impossible dans ${DB_NAME}"; return
  fi
  while IFS= read -r ref; do
    [[ -n "$ref" ]] || continue
    # Même définition du magasin que la sauvegarde/restauration ; aucune URL seed ni
    # donnée SQL inattendue ne devient un chemin. Aucun identifiant affiché dans le bilan.
    if [[ ! "$ref" =~ ^[0-9a-f-]{36}$ ]]; then fail "B4 : résultat des références de fichiers invalide dans ${DB_NAME}"; return; fi
    expected=$((expected + 1))
    if [[ ! -f "$store/${ref}.bin" || -L "$store/${ref}.bin" ]]; then missing=$((missing + 1)); fi
  done <<<"$refs"
  if (( missing == 0 )); then pass "B4 : ${expected} référence(s) du magasin vérifiée(s), aucun fichier manquant"; else fail "B4 : ${missing} fichier(s) référencé(s) absent(s) ou non ordinaire(s) sur ${expected}"; fi
}

# ═════════════════════════════════════════════════════════════
# ROLLBACK (artefacts sans données uniquement)
# ═════════════════════════════════════════════════════════════
rollback_all() {
  log "── rollback ${DIGISANTE_ENV} : vhost, crons, rotation, service PM2 — JAMAIS base, rôle, Valkey, magasin, comptes ni certificat"
  local other_site
  if [[ "$SITE" == digisante ]]; then other_site=digisante-preprod; else other_site=digisante; fi
  [[ -e "$(F "${NGINX_DIR}/sites-enabled/${SITE}")" ]] && act "désactivation du vhost ${SITE}" rm -f -- "$(F "${NGINX_DIR}/sites-enabled/${SITE}")"
  [[ -e "$(F "${NGINX_DIR}/sites-available/${SITE}")" ]] && act "retrait de ${NGINX_DIR}/sites-available/${SITE}" rm -f -- "$(F "${NGINX_DIR}/sites-available/${SITE}")"
  [[ -e "$(F "$MAINTENANCE_FILE")" ]] && act "retrait de ${MAINTENANCE_FILE}" rm -f -- "$(F "$MAINTENANCE_FILE")"
  if [[ ! -e "$(F "${NGINX_DIR}/sites-enabled/${other_site}")" ]]; then
    for f in conf.d/digisante-rate-limit.conf snippets/digisante-headers.conf snippets/digisante-hsts.conf; do
      [[ -e "$(F "${NGINX_DIR}/${f}")" ]] && act "retrait de ${NGINX_DIR}/${f} (plus aucun vhost DigiSanté)" rm -f -- "$(F "${NGINX_DIR}/${f}")"
    done
  else
    note "fichiers Nginx communs conservés : ${other_site} reste actif"
  fi
  nginx_reload || die "nginx -t refuse l'état après retrait : vérifier à la main (aucun autre vhost modifié)"
  [[ -e "$(F "$CRON_FILE")" ]] && act "retrait de ${CRON_FILE}" rm -f -- "$(F "$CRON_FILE")"
  [[ -e "$(F "/etc/logrotate.d/${SITE}")" ]] && act "retrait de /etc/logrotate.d/${SITE}" rm -f -- "$(F "/etc/logrotate.d/${SITE}")"
  if systemctl is-enabled "pm2-${APP_USER}" >/dev/null 2>&1; then
    act "arrêt des processus PM2 de ${APP_USER}" as_user "$APP_USER" pm2 kill
    act "retrait du service pm2-${APP_USER}" clean_env pm2 unstartup systemd -u "$APP_USER" --hp "$(app_home)" --service-name "pm2-${APP_USER}"
  fi
  note "conservés (décision humaine, sauvegarde préalable) : comptes ${APP_USER}/${JOBS_USER}, base/rôle ${DB_NAME}, index Valkey ${VALKEY_DB}, ${STORE_DIR}, ${ETC_DIR}, ${BACKUP_DIR}, certificat ${CERT_NAME} (certbot delete --cert-name ${CERT_NAME})"
}

# ═════════════════════════════════════════════════════════════
case "$ACTION" in
  verify)
    guard_os
    verify_all
    if (( FAILS == 0 )); then log "vérification : tout est conforme"; else log "vérification : ${FAILS} point(s) en échec"; exit 1; fi
    ;;
  rollback)
    guard_os
    rollback_all
    ;;
  provision)
    run_guards
    (( FAILS == 0 )) || die "${FAILS} garde(s) en échec : corriger avant toute application (rien n'a été écrit)"
    preflight_apply
    for s in $STEPS; do want "$s" && "step_${s}"; done
    if [[ "$MODE" == apply ]]; then
      log "provisioning appliqué ; lancer --verify, puis déploiement (README) et --verify à nouveau"
    else
      log "dry-run terminé : aucune écriture. Relancer avec --apply après relecture du plan."
    fi
    (( FAILS == 0 )) || exit 1
    ;;
esac
