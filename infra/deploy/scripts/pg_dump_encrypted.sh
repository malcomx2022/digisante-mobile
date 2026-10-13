#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Sauvegarde nocturne CHIFFRÉE de PostgreSQL — DigiSanté Mobile
# cf. CLAUDE.md §4 (chiffrement au repos AES-256) et §7 (cron 02:00).
# Exécuté par cron en root (accès lecture base + dossier /var/backups), depuis la copie
# INSTALLÉE root:root (/usr/local/lib/digisante, install_root_scripts.sh — B3), jamais
# depuis APP_DIR.
#
# Chiffrement : AES-256 via openssl (PBKDF2). La passphrase est lue dans
# un fichier root-only HORS dépôt :  /etc/digisante/backup.key
#   sudo install -d -m 0700 /etc/digisante
#   sudo sh -c 'openssl rand -base64 48 > /etc/digisante/backup.key'
#   sudo chmod 0400 /etc/digisante/backup.key
# ⚠️ Sauvegarder cette clé hors VPS : sans elle, les dumps sont irrécupérables.
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
trusted_path "${BASH_SOURCE[0]}" || { echo "[pg_dump] ÉCHEC : script lancé depuis un emplacement modifiable par un autre compte ; utiliser la copie installée par install_root_scripts.sh" >&2; exit 1; }
SELF_ROOT="$(cd "$(dirname "$(readlink -f -- "${BASH_SOURCE[0]}")")/../../.." && pwd -P)"

DB_NAME="${DB_NAME:-digisante}"
DB_USER="${DB_USER:-digisante}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/digisante}"
KEY_FILE="${BACKUP_KEY_FILE:-/etc/digisante/backup.key}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
# Magasin de fichiers chiffrés (lib/filestore) : pièces KYC ET, depuis août 2026,
# PIÈCES JOINTES DU DMP — donc des DONNÉES DE SANTÉ. Il ne vit PAS dans PostgreSQL :
# une restauration du seul dump laisserait des entrées de dossier pointant vers des
# fichiers disparus.
# B4 : résolu EXACTEMENT comme l'API (scripts/preproduction/filestore-dir.mjs) —
# KYC_STORAGE_DIR explicite non vide de l'environnement, sinon celui du .env de l'API
# lu comme DONNÉES (util.parseEnv, jamais `source`) ; vide ⇒ storage/kyc ; relatif ⇒
# depuis le cwd PM2 de l'API (= répertoire du .env). Répertoire réel exigé (pas de lien).
# Ce .env appartient à l'utilisateur applicatif : sa valeur est HOSTILE pour root (B3).
# Le magasin doit appartenir à APP_USER (jamais root), sans écriture groupe/autres, et
# porter un nom qui ne peut pas être lu comme une option ; il est ensuite archivé SOUS
# L'IDENTITÉ APP_USER (sudo -u, opérande après `--`) : root ne lit jamais, à la place de
# l'utilisateur applicatif, un répertoire que celui-ci a désigné.
API_ENV_FILE="${API_ENV_FILE:-/var/www/digisante-mobile/apps/api/.env}"
API_DIR="${API_DIR:-$(dirname "$API_ENV_FILE")}"
APP_USER="${APP_USER:-digisante}"
FILESTORE_MODULE="${SELF_ROOT}/scripts/preproduction/filestore-dir.mjs"
SAFE_STORE_NAME='^[A-Za-z0-9._][A-Za-z0-9._@+-]*$'

umask 077
[[ "$DB_NAME" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] || { echo "[pg_dump] ÉCHEC : nom de base invalide" >&2; exit 1; }
[[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || { echo "[pg_dump] ÉCHEC : rétention invalide" >&2; exit 1; }
[[ "$APP_USER" =~ ^[A-Za-z_][A-Za-z0-9._-]*$ ]] && APP_UID="$(id -u -- "$APP_USER" 2>/dev/null)" && [[ "$APP_UID" =~ ^[0-9]+$ && "$APP_UID" != 0 ]] \
  || { echo "[pg_dump] ÉCHEC : utilisateur applicatif (APP_USER) introuvable ou root" >&2; exit 1; }
trusted_path "$FILESTORE_MODULE" || { echo "[pg_dump] ÉCHEC : module de résolution du magasin absent ou modifiable par un autre compte" >&2; exit 1; }
FILESTORE_DIR="$(KYC_STORAGE_DIR="${KYC_STORAGE_DIR:-}" API_ENV_FILE="$API_ENV_FILE" API_DIR="$API_DIR" FILESTORE_OWNER_UID="$APP_UID" node "$FILESTORE_MODULE")" \
  || { echo "[pg_dump] ÉCHEC : magasin de fichiers absent, indéterminable ou refusé ; aucune sauvegarde complète possible" >&2; exit 1; }
# Défense en profondeur (le module l'exige déjà) : chemin absolu, répertoire réel de
# APP_USER, nom qui ne peut jamais devenir une option de tar.
STORE_BASE="$(basename -- "$FILESTORE_DIR")"
STORE_PARENT="$(dirname -- "$FILESTORE_DIR")"
[[ "$FILESTORE_DIR" == /* && "$STORE_PARENT" == /* && "$STORE_BASE" =~ $SAFE_STORE_NAME && -d "$FILESTORE_DIR" && ! -L "$FILESTORE_DIR" && "$(stat -c %u -- "$FILESTORE_DIR")" == "$APP_UID" ]] \
  || { echo "[pg_dump] ÉCHEC : magasin de fichiers absent ou refusé ; aucune sauvegarde complète possible" >&2; exit 1; }
[[ -f "$KEY_FILE" && ! -L "$KEY_FILE" && -s "$KEY_FILE" && "$(stat -c %u "$KEY_FILE")" == "$EUID" && "$(stat -c %a "$KEY_FILE")" =~ ^(400|600)$ ]] || { echo "[pg_dump] ÉCHEC : clé privée absente ou permissions/propriétaire invalides" >&2; exit 1; }
install -d -m 0700 "$BACKUP_DIR"
exec 9>"$BACKUP_DIR/.backup.lock"
flock -n 9 || { echo "[pg_dump] ÉCHEC : sauvegarde déjà en cours" >&2; exit 1; }
STAMP="$(date +%Y%m%d_%H%M%S)"
OUT="${BACKUP_DIR}/digisante_${STAMP}.sql.gz.enc"
OUT_FILES="${BACKUP_DIR}/digisante_files_${STAMP}.tar.gz.enc"
# Manifeste NON chiffré (aucune donnée personnelle : noms de tables, comptages, empreintes)
# — référence de la restauration (verify_restore.sh compare la base restaurée à ce relevé).
OUT_MANIFEST="${BACKUP_DIR}/digisante_manifest_${STAMP}.txt"

log() { printf '[pg_dump] %s %s\n' "$(date -Is)" "$*"; }
# Lignes de l'index tar qui ne sont pas des entrées du magasin (diagnostics tar/sudo),
# recopiées au journal root : bornées, caractères de contrôle neutralisés.
tar_diagnostics() {
  [[ -f "$WORK/files.index" ]] || return 0
  STORE_PREFIX="${STORE_BASE}/" awk 'index($0, ENVIRON["STORE_PREFIX"]) != 1 { gsub(/[[:cntrl:]]/, "?"); print "[pg_dump] tar : " substr($0, 1, 300); if (++n == 20) exit }' \
    "$WORK/files.index" >&2 || true
}

# Préparer dans le même filesystem. Le manifeste final est le marqueur de fin.
for target in "$OUT" "$OUT_FILES" "$OUT_MANIFEST"; do
  [[ ! -e "$target" ]] || { log "ÉCHEC : horodatage déjà publié ; aucun écrasement."; exit 1; }
done
WORK="$(mktemp -d "$BACKUP_DIR/.backup.XXXXXXXX")"
PUBLISHING=0; COMMITTED=0; SNAP_PID=""
cleanup() {
  local code=$?
  if [[ -n "$SNAP_PID" ]]; then kill "$SNAP_PID" 2>/dev/null || true; wait "$SNAP_PID" 2>/dev/null || true; fi
  if (( code != 0 )); then
    log "ÉCHEC : sauvegarde incomplète, aucun succès annoncé." >&2
    if (( PUBLISHING == 1 && COMMITTED == 0 )); then rm -f -- "$OUT" "$OUT_FILES" "$OUT_MANIFEST"; fi
  fi
  rm -rf -- "$WORK"
}
trap cleanup EXIT
# Une seule vue DB pour dump ET comptages/tête audit, même sous écritures concurrentes.
# Les fichiers restent une copie séparée : leur restauration doit être éprouvée en L11.
coproc SNAPSHOT_PSQL { sudo -u postgres psql -X -qAt -d "$DB_NAME" -v ON_ERROR_STOP=1; }
SNAP_PID="$SNAPSHOT_PSQL_PID"
exec {SNAP_IN}>&"${SNAPSHOT_PSQL[1]}"
exec {SNAP_OUT}<&"${SNAPSHOT_PSQL[0]}"
printf 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT pg_export_snapshot();\n' >&"$SNAP_IN"
IFS= read -r SNAPSHOT_ID <&"$SNAP_OUT"
[[ "$SNAPSHOT_ID" =~ ^[0-9a-fA-F-]+$ ]] || { log "ÉCHEC : snapshot PostgreSQL invalide."; exit 1; }

log "Démarrage du dump chiffré de la base '${DB_NAME}'…"
# pg_dump → gzip → openssl AES-256 (PBKDF2). pipefail garantit l'échec si un maillon casse.
sudo -u postgres pg_dump --no-owner --no-privileges --snapshot "$SNAPSHOT_ID" "$DB_NAME" \
  | gzip -9 \
  | openssl enc -aes-256-cbc -pbkdf2 -salt -pass "file:${KEY_FILE}" \
  > "$WORK/db"

chmod 0400 "$WORK/db"
SIZE="$(du -h "$WORK/db" | cut -f1)"
log "Archive base préparée : ${OUT} (${SIZE})"

# ── Magasin de fichiers (KYC + pièces jointes DMP) ──────────────────────────
# Chiffré une seconde fois à la même clé : les fichiers sont DÉJÀ chiffrés au repos
# (AES-256-GCM), mais la sauvegarde quitte le VPS — on ne relâche pas la protection
# en transit/au stockage distant sous prétexte qu'elle existe en amont.
# L'index (entrées réellement archivées) sert au contrôle de complétude B4 ci-dessous.
# B3/B4 : tar s'exécute SOUS L'IDENTITÉ APP_USER (sudo -u, depuis /) et reçoit le nom
# APRÈS `--` (nom déjà restreint, sans « - » initial) : une valeur hostile du .env ne
# peut ni devenir une option exécutée par root, ni faire lire par root un répertoire
# que l'utilisateur applicatif ne peut pas lire lui-même (substitution après contrôle,
# fichier root glissé dans le magasin ⇒ lecture refusée ⇒ échec, rien n'est publié).
# Le listing verbeux part sur stderr (archive sur stdout) : fichier ouvert par root.
log "Sauvegarde du magasin de fichiers ${FILESTORE_DIR}…"
log "Archivage sous l'identité ${APP_USER} (uid ${APP_UID})."
if ! ( cd / && sudo -u "$APP_USER" -- tar -C "$STORE_PARENT" --verbose -cf - -- "$STORE_BASE" ) 2>"$WORK/files.index" \
  | gzip -9 \
  | openssl enc -aes-256-cbc -pbkdf2 -salt -pass "file:${KEY_FILE}" \
  > "$WORK/files"; then
  tar_diagnostics
  log "ÉCHEC : archivage du magasin impossible sous l'identité ${APP_USER} (fichier illisible par l'API ?) ; aucune publication."
  exit 1
fi
tar_diagnostics
chmod 0400 "$WORK/files"
log "Archive fichiers préparée : ${OUT_FILES} ($(du -h "$WORK/files" | cut -f1))"

# ── Relevé du MÊME snapshot que le dump : comptages EXACTS par table, tête de la ──
# chaîne d'audit et (B4) fichiers référencés par la base : identifiants de stockage
# opaques des pièces DMP et KYC — comptés et comparés à l'archive, jamais publiés.
cat >&"$SNAP_IN" <<'SQL'
SELECT format('SELECT %L || ''='' || count(*) FROM %I.%I;', 'rows.' || tablename, schemaname, tablename)
  FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename\gexec
SELECT 'audit_head=' || coalesce((SELECT hash FROM audit_logs ORDER BY "createdAt" DESC, id DESC LIMIT 1), 'none');
SELECT 'files_expected=' || count(*) FROM (SELECT "encryptedUrl" AS ref FROM documents UNION SELECT "fileUrl" FROM kyc_documents) AS refs WHERE ref ~ '^[0-9a-f-]{36}$';
SELECT 'ref=' || ref FROM (SELECT "encryptedUrl" AS ref FROM documents UNION SELECT "fileUrl" FROM kyc_documents) AS refs WHERE ref ~ '^[0-9a-f-]{36}$' ORDER BY ref;
COMMIT;
\q
SQL
cat <&"$SNAP_OUT" > "$WORK/snapshot.out"
wait "$SNAP_PID"
SNAP_PID=""
sed '/^ref=/d' "$WORK/snapshot.out" > "$WORK/snapshot.rows"
FILES_EXPECTED="$(sed -n 's/^files_expected=\([0-9]\{1,\}\)$/\1/p' "$WORK/snapshot.rows")"
[[ "$FILES_EXPECTED" =~ ^[0-9]+$ ]] || { log "ÉCHEC : nombre de fichiers référencés absent du relevé de la base."; exit 1; }
# Complétude : entrées non-répertoire archivées (lignes du magasin seulement, jamais les
# diagnostics), puis identifiants référencés ABSENTS de l'archive. Préfixe passé par
# l'environnement (awk -v interpréterait les « \ »).
FILES_COUNT="$(STORE_PREFIX="${STORE_BASE}/" awk 'index($0, ENVIRON["STORE_PREFIX"]) == 1 && $0 !~ /\/$/ { n++ } END { print n + 0 }' "$WORK/files.index")"
sed -n 's/^ref=\([0-9a-f-]\{36\}\)$/\1/p' "$WORK/snapshot.out" | LC_ALL=C sort -u > "$WORK/refs.expected"
STORE_PREFIX="${STORE_BASE}/" awk 'BEGIN { prefix = ENVIRON["STORE_PREFIX"] } index($0, prefix) == 1 { name = substr($0, length(prefix) + 1); if (name ~ /^[0-9a-f-]+\.bin$/ && length(name) == 40) print substr(name, 1, 36) }' \
  "$WORK/files.index" | LC_ALL=C sort -u > "$WORK/refs.archived"
FILES_MISSING="$(LC_ALL=C comm -23 "$WORK/refs.expected" "$WORK/refs.archived" | wc -l)"

# ── Manifeste : relevé ci-dessus + SHA-256 des archives (détecte une archive ──
# tronquée/altérée AVANT tout déchiffrement) + complétude du magasin de fichiers.
{
  echo "stamp=${STAMP}"
  echo "db_archive=$(basename "$OUT") sha256=$(sha256sum "$WORK/db" | cut -d' ' -f1)"
  echo "files_archive=$(basename "$OUT_FILES") sha256=$(sha256sum "$WORK/files" | cut -d' ' -f1)"
  echo "files_count=${FILES_COUNT}"
  echo "files_missing=${FILES_MISSING}"
  cat "$WORK/snapshot.rows"
} > "$WORK/manifest"
chmod 0400 "$WORK/manifest"
# Publication finale : pas de manifeste complet si une étape précédente a échoué.
PUBLISHING=1
mv "$WORK/db" "$OUT"
mv "$WORK/files" "$OUT_FILES"
mv "$WORK/manifest" "$OUT_MANIFEST"
COMMITTED=1
# Magasin incomplet (mauvais répertoire, fichiers perdus) : le trio est publié — la base
# reste la copie la plus récente — mais le manifeste le déclare incomplet (check-backup
# et healthwatch le refusent), la tâche échoue et AUCUNE ancienne sauvegarde n'est purgée.
if (( FILES_COUNT < FILES_EXPECTED || FILES_MISSING > 0 )); then
  log "ÉCHEC : magasin de fichiers incomplet — ${FILES_MISSING} fichier(s) référencé(s) par la base absent(s) de l'archive (référencés ${FILES_EXPECTED}, archivés ${FILES_COUNT}). Vérifier KYC_STORAGE_DIR du .env de l'API ; anciennes sauvegardes conservées (aucune purge)."
  exit 1
fi
log "Manifeste et deux archives publiés : ${OUT_MANIFEST}"

# ── Rétention : purge des sauvegardes plus anciennes que RETENTION_DAYS ──
DELETED="$(find "$BACKUP_DIR" \( -name 'digisante_*.sql.gz.enc' -o -name 'digisante_files_*.tar.gz.enc' -o -name 'digisante_manifest_*.txt' \) -type f -mtime "+${RETENTION_DAYS}" -print -delete | wc -l)"
log "Purge rétention (> ${RETENTION_DAYS} j) : ${DELETED} fichier(s) supprimé(s)."

# Pour restaurer — LES DEUX, sinon le dossier médical pointe vers des fichiers absents :
#   openssl enc -d -aes-256-cbc -pbkdf2 -pass file:/etc/digisante/backup.key \
#     -in digisante_YYYYMMDD_HHMMSS.sql.gz.enc | gunzip | psql digisante
#   openssl enc -d -aes-256-cbc -pbkdf2 -pass file:/etc/digisante/backup.key \
#     -in digisante_files_YYYYMMDD_HHMMSS.tar.gz.enc | gunzip | tar -C /chemin/parent -xf -
log "Terminé ✓"
