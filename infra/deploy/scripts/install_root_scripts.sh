#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Installation des fichiers exécutés par ROOT — bloquant B3 (revue indépendante 13/10/2026).
#
# Problème corrigé : la crontab root lançait des scripts de APP_DIR
# (/var/www/digisante-mobile), propriété de `digisante` — l'utilisateur PM2 de l'API.
# Une exécution de code dans l'API pouvait les réécrire et devenir root en quelques
# minutes (clé de sauvegarde, jeton de service, `sudo -u postgres`).
#
# Ce script copie les fichiers de `infra/deploy/root-scripts.list` du COMMIT EXACT
# demandé vers un répertoire root:root PROPRE À L'ENVIRONNEMENT, en gardant leur chemin
# relatif. Source : un miroir nu PROPRE À ROOT (0700) alimenté depuis l'URL déclarée dans
# ops.env (root, 0600) — JAMAIS l'arbre de travail, le .git ni la configuration distante
# de APP_DIR, tous modifiables par l'utilisateur applicatif.
# DIGISANTE_ENV (obligatoire) fixe les défauts (hôte partagé : une copie par environnement) :
#   production    : /usr/local/lib/digisante, /var/lib/digisante/ops.git, /etc/digisante/ops.env
#   preproduction : /usr/local/lib/digisante-preprod, /var/lib/digisante-preprod/ops.git,
#                   /etc/digisante-preprod/ops.env
# et l'environnement est inscrit au manifeste (contrôlé par verify_deploy.sh).
#
#   sudo DIGISANTE_ENV=preproduction /usr/local/lib/digisante-preprod/infra/deploy/scripts/install_root_scripts.sh <SHA40>
#   (SHA aussi lisible dans ROOT_SCRIPTS_REF ou DEPLOY_REF)
#
# ops.env (optionnel ; AUCUN secret, aucun identifiant dans l'URL) :
#   OPS_REPO_URL=https://github.com/malcomx2022/digisante-mobile.git   # défaut
#   OPS_BRANCH=main                                                     # défaut
# Dépôt privé : clé de déploiement LECTURE SEULE de root et URL ssh (git@hôte:chemin).
#
# Garanties : root seul ; SHA complet (40 hex) ancêtre de origin/<branche> du miroir ;
# blobs ordinaires extraits par `git cat-file blob <SHA>:<chemin>` dans un répertoire
# temporaire du même système de fichiers, puis renommés un à un (rename atomique par
# fichier) ; vérification des SHA-256 installés ; manifeste (SHA + SHA-256 de chaque
# fichier) publié EN DERNIER. La crontab n'est jamais modifiée par ce script.
# Premier amorçage (copie root de l'installateur) : infra/deploy/README.md §1.
# ─────────────────────────────────────────────────────────────
set -euo pipefail
umask 022

DEFAULT_REPO_URL='https://github.com/malcomx2022/digisante-mobile.git'
LIST_PATH='infra/deploy/root-scripts.list'
MANIFEST_NAME='root-scripts.manifest'
LOG_FILE=""

log() { local line; line="[install-root] $(date -Is) $*"; printf '%s\n' "$line"; if [[ -n "$LOG_FILE" ]]; then printf '%s\n' "$line" >> "$LOG_FILE" || true; fi; }
die() { log "ÉCHEC : $*" >&2; exit 1; }

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
# donne aussi les chemins PAR DÉFAUT (utilisateur, checkout, journaux, copie root,
# configuration, état, sauvegardes, base, crontab, journal WebSocket) ; une valeur déjà
# posée par l'opérateur prime pour ces chemins.
digisante_profile() {
  local sfx
  case "${DIGISANTE_ENV:-}" in
    preproduction) sfx=-preprod; API_PORT=3101; WEB_PORT=3100; : "${DB_NAME:=digisante_preprod}" ;;
    production) sfx=; API_PORT=3201; WEB_PORT=3200; : "${DB_NAME:=digisante}" ;;
    *) echo "DIGISANTE_ENV requis : preproduction ou production (aucun défaut implicite)" >&2; return 1 ;;
  esac
  PM2_API="digisante${sfx}-api"; PM2_WEB="digisante${sfx}-web"; API_BASE="http://127.0.0.1:${API_PORT}"
  : "${APP_USER:=digisante${sfx}}" "${APP_DIR:=/var/www/digisante${sfx}}" "${APP_LOG_DIR:=/var/log/digisante${sfx}}"
  : "${ETC_DIR:=/etc/digisante${sfx}}" "${ROOT_LIB:=/usr/local/lib/digisante${sfx}}" "${STATE_DIR:=/var/lib/digisante${sfx}}"
  : "${CRON_LOG_DIR:=/var/log/digisante${sfx}-cron}" "${BACKUP_DIR:=/var/backups/digisante${sfx}}"
  : "${CRON_FILE:=/etc/cron.d/digisante${sfx}}" "${WS_LOG:=/var/log/nginx/digisante${sfx}-ws.log}"
}
# <<< digisante_profile

(( EUID == 0 )) || { echo "[install-root] ÉCHEC : à lancer en root (sudo) — les fichiers installés doivent appartenir à root." >&2; exit 1; }
trusted_path "${BASH_SOURCE[0]}" || { echo "[install-root] ÉCHEC : installateur lancé depuis un emplacement modifiable par un autre compte (APP_DIR ?) ; utiliser une copie root (README §1)." >&2; exit 1; }
digisante_profile || exit 1
OPS_MIRROR="${OPS_MIRROR:-${STATE_DIR}/ops.git}"
OPS_CONF="${OPS_CONF:-${ETC_DIR}/ops.env}"
OPS_LOG_DIR="${OPS_LOG_DIR:-${CRON_LOG_DIR}}"

(( $# <= 1 )) || die "un seul argument attendu : le SHA complet"
SHA="${1:-${ROOT_SCRIPTS_REF:-${DEPLOY_REF:-}}}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || die "SHA complet de 40 caractères hexadécimaux requis (argument, ROOT_SCRIPTS_REF ou DEPLOY_REF)"

# Journal root (répertoire root:root, jamais celui de l'utilisateur applicatif).
install -d -o root -g root -m 0750 "$OPS_LOG_DIR"
if trusted_path "$OPS_LOG_DIR"; then LOG_FILE="$OPS_LOG_DIR/install_root_scripts.log"; else log "AVERTISSEMENT : ${OPS_LOG_DIR} non fiable, journal sur la sortie standard seulement."; fi

# ── Configuration root : lue comme DONNÉES (jamais `source`), clés fermées ──
REPO_URL="$DEFAULT_REPO_URL"
BRANCH="main"
if [[ -e "$OPS_CONF" || -L "$OPS_CONF" ]]; then
  [[ -f "$OPS_CONF" && ! -L "$OPS_CONF" ]] || die "configuration ${OPS_CONF} : fichier ordinaire requis"
  trusted_path "$OPS_CONF" || die "configuration ${OPS_CONF} : doit appartenir à root et n'être modifiable par aucun autre compte"
  [[ "$(stat -c '%a' "$OPS_CONF")" =~ ^[46]00$ ]] || die "configuration ${OPS_CONF} : permissions 0600 ou 0400 requises"
  conf_re='^(OPS_REPO_URL|OPS_BRANCH)=(.*)$'; sq_re="^'(.*)'$"; dq_re='^"(.*)"$'
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*(#.*)?$ ]] && continue
    # Contenu jamais affiché : une ligne invalide pourrait contenir un secret collé par erreur.
    [[ "$line" =~ $conf_re ]] || die "configuration ${OPS_CONF} : ligne non reconnue (clés admises : OPS_REPO_URL, OPS_BRANCH)"
    key="${BASH_REMATCH[1]}"; value="${BASH_REMATCH[2]}"
    if [[ "$value" =~ $sq_re || "$value" =~ $dq_re ]]; then value="${BASH_REMATCH[1]}"; fi
    case "$key" in OPS_REPO_URL) REPO_URL="$value" ;; OPS_BRANCH) BRANCH="$value" ;; esac
  done < "$OPS_CONF"
fi

# https/ssh sans identifiants ni requête, ou file:// d'un dépôt local appartenant à root
# (jamais APP_DIR/.git : il appartient à l'utilisateur applicatif, donc refusé).
valid_url() {
  local u="$1"
  [[ "$u" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~-]+)+/?$ ]] && return 0
  [[ "$u" =~ ^ssh://git@[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~-]+)+/?$ ]] && return 0
  [[ "$u" =~ ^git@[A-Za-z0-9.-]+:[A-Za-z0-9._~-]+(/[A-Za-z0-9._~-]+)*$ ]] && return 0
  if [[ "$u" =~ ^file://(/[A-Za-z0-9._~/-]+)$ ]]; then trusted_path "${BASH_REMATCH[1]}" && return 0; fi
  return 1
}
valid_url "$REPO_URL" || die "URL du dépôt source refusée (https/ssh sans identifiants, ou file:// d'un dépôt appartenant à root)"
[[ "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] && git check-ref-format --branch "$BRANCH" >/dev/null 2>&1 || die "branche invalide"

# ── Répertoire d'installation + verrou + zone de préparation (même système de fichiers) ──
install -d -o root -g root -m 0755 "$ROOT_LIB"
[[ -d "$ROOT_LIB" && ! -L "$ROOT_LIB" ]] || die "${ROOT_LIB} : répertoire requis"
chown root:root "$ROOT_LIB"; chmod 0755 "$ROOT_LIB"
trusted_path "$ROOT_LIB" || die "${ROOT_LIB} : chemin modifiable par un autre compte"
exec 8>"$ROOT_LIB/.install.lock"
flock -n 8 || die "installation déjà en cours"
STAGE="$(mktemp -d "$ROOT_LIB/.staging.XXXXXXXX")"
trap 'rm -rf -- "$STAGE"' EXIT

# ── Miroir nu root (0700) : seule source des fichiers installés ──
export GIT_TERMINAL_PROMPT=0
G=(git -c core.hooksPath=/dev/null -c core.fsmonitor=false --git-dir="$OPS_MIRROR")
if [[ ! -e "$OPS_MIRROR" && ! -L "$OPS_MIRROR" ]]; then
  install -d -o root -g root -m 0700 "$OPS_MIRROR"
  git -c init.defaultBranch=main init --bare --quiet "$OPS_MIRROR"
fi
[[ -d "$OPS_MIRROR" && ! -L "$OPS_MIRROR" ]] || die "miroir ${OPS_MIRROR} : répertoire requis"
chown root:root "$OPS_MIRROR"; chmod 0700 "$OPS_MIRROR"
trusted_path "$OPS_MIRROR" || die "miroir ${OPS_MIRROR} : chemin modifiable par un autre compte"

log "Mise à jour du miroir root depuis ${REPO_URL} (branche ${BRANCH})…"
"${G[@]}" fetch --quiet --no-tags --prune "$REPO_URL" "+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}" \
  || die "récupération du dépôt source impossible"
resolved="$("${G[@]}" rev-parse --verify --quiet "${SHA}^{commit}" || true)"
[[ "$resolved" == "$SHA" ]] || die "commit ${SHA} absent du miroir"
"${G[@]}" merge-base --is-ancestor "$SHA" "refs/remotes/origin/${BRANCH}" \
  || die "commit ${SHA} absent de origin/${BRANCH} (non fusionné ?)"

# Blob ORDINAIRE du commit uniquement (pas de lien symbolique ni de sous-module).
entry_re=$'^(100644|100755) blob [0-9a-f]{40,64}\t(.+)$'
extract() {
  local entry
  entry="$("${G[@]}" ls-tree "$SHA" -- "$1")"
  [[ "$entry" =~ $entry_re && "${BASH_REMATCH[2]}" == "$1" ]] || die "${1} : fichier ordinaire absent du commit ${SHA}"
  "${G[@]}" cat-file blob "${SHA}:$1" > "$2"
}

# ── Liste des fichiers, lue dans le MÊME commit ──
extract "$LIST_PATH" "$STAGE/.list"
line_re='^(0755|0644) ((infra/deploy|scripts)/[A-Za-z0-9._/-]+)$'
declare -a PATHS=() MODES=() SUMS=()
declare -A SEEN=()
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" =~ ^[[:space:]]*(#.*)?$ ]] && continue
  [[ "$line" =~ $line_re ]] || die "liste ${LIST_PATH} : ligne invalide"
  mode="${BASH_REMATCH[1]}"; path="${BASH_REMATCH[2]}"
  [[ "/$path/" != */../* && "/$path/" != */./* && "$path" != *//* && "$path" != */ ]] || die "liste : chemin non canonique (${path})"
  [[ -z "${SEEN[$path]:-}" ]] || die "liste : doublon (${path})"
  SEEN[$path]=1; PATHS+=("$path"); MODES+=("$mode")
done < "$STAGE/.list"
(( ${#PATHS[@]} > 0 )) || die "liste vide"
[[ -n "${SEEN[infra/deploy/scripts/install_root_scripts.sh]:-}" ]] || die "la liste doit contenir l'installateur"

# ── Extraction complète AVANT toute modification de l'installation en place ──
for i in "${!PATHS[@]}"; do
  path="${PATHS[$i]}"
  install -d -m 0700 "$STAGE/files/$(dirname "$path")"
  extract "$path" "$STAGE/files/$path"
  chown root:root "$STAGE/files/$path"; chmod "${MODES[$i]}" "$STAGE/files/$path"
  SUMS[i]="$(sha256sum "$STAGE/files/$path" | cut -d' ' -f1)"
done

# ── Installation : répertoires root:root 0755, un rename atomique par fichier ──
for i in "${!PATHS[@]}"; do
  path="${PATHS[$i]}"; sub=""
  IFS='/' read -r -a parts <<< "$(dirname "$path")"
  for part in "${parts[@]}"; do
    sub="${sub:+$sub/}$part"; target="$ROOT_LIB/$sub"
    if [[ -L "$target" || ( -e "$target" && ! -d "$target" ) ]]; then die "${target} : répertoire attendu"; fi
    install -d -o root -g root -m 0755 "$target"
    chown root:root "$target"; chmod 0755 "$target"
  done
  [[ -L "$ROOT_LIB/$path" || ! -d "$ROOT_LIB/$path" ]] || die "${ROOT_LIB}/${path} : répertoire inattendu"
  mv -f -T -- "$STAGE/files/$path" "$ROOT_LIB/$path"
done

# Fichiers d'une installation précédente retirés de la liste : supprimés.
OLD_MANIFEST="$ROOT_LIB/$MANIFEST_NAME"
old_re='^file=((infra/deploy|scripts)/[A-Za-z0-9._/-]+) '
if [[ -f "$OLD_MANIFEST" && ! -L "$OLD_MANIFEST" ]]; then
  while IFS= read -r line; do
    [[ "$line" =~ $old_re ]] || continue
    old="${BASH_REMATCH[1]}"
    [[ "/$old/" != */../* && -z "${SEEN[$old]:-}" ]] || continue
    rm -f -- "${ROOT_LIB:?}/$old"; log "retiré (absent de la liste) : ${old}"
  done < "$OLD_MANIFEST"
fi

# Contrôle après installation : contenu, propriétaire et chemin de chaque fichier.
for i in "${!PATHS[@]}"; do
  dest="$ROOT_LIB/${PATHS[$i]}"
  [[ -f "$dest" && ! -L "$dest" && "$(stat -c '%u %a' "$dest")" == "0 ${MODES[$i]#0}" ]] || die "${PATHS[$i]} : propriétaire/permissions inattendus après installation"
  [[ "$(sha256sum "$dest" | cut -d' ' -f1)" == "${SUMS[$i]}" ]] || die "${PATHS[$i]} : empreinte différente après installation"
  trusted_path "$dest" || die "${PATHS[$i]} : chemin modifiable par un autre compte"
done

# ── Manifeste publié EN DERNIER (marqueur d'installation complète) ──
{
  echo "sha=${SHA}"
  echo "environment=${DIGISANTE_ENV}"
  echo "branch=${BRANCH}"
  echo "source=${REPO_URL}"
  echo "installed_at=$(date -Is)"
  for i in "${!PATHS[@]}"; do echo "file=${PATHS[$i]} mode=${MODES[$i]} sha256=${SUMS[$i]}"; done
} > "$STAGE/manifest"
chown root:root "$STAGE/manifest"; chmod 0644 "$STAGE/manifest"
mv -f -T -- "$STAGE/manifest" "$ROOT_LIB/$MANIFEST_NAME"

log "OK : ${#PATHS[@]} fichier(s) du commit ${SHA} installés dans ${ROOT_LIB} (manifeste ${MANIFEST_NAME})."
log "Crontab NON modifiée : comparer ${CRON_FILE} à ${ROOT_LIB}/infra/deploy/crontab*.example (environnement ${DIGISANTE_ENV}) avant tout changement."
