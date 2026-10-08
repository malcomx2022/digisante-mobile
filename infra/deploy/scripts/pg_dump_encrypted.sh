#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Sauvegarde nocturne CHIFFRÉE de PostgreSQL — DigiSanté Mobile
# cf. CLAUDE.md §4 (chiffrement au repos AES-256) et §7 (cron 02:00).
# Exécuté par cron en root (accès lecture base + dossier /var/backups).
#
# Chiffrement : AES-256 via openssl (PBKDF2). La passphrase est lue dans
# un fichier root-only HORS dépôt :  /etc/digisante/backup.key
#   sudo install -d -m 0700 /etc/digisante
#   sudo sh -c 'openssl rand -base64 48 > /etc/digisante/backup.key'
#   sudo chmod 0400 /etc/digisante/backup.key
# ⚠️ Sauvegarder cette clé hors VPS : sans elle, les dumps sont irrécupérables.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

DB_NAME="${DB_NAME:-digisante}"
DB_USER="${DB_USER:-digisante}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/digisante}"
KEY_FILE="${BACKUP_KEY_FILE:-/etc/digisante/backup.key}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
# Magasin de fichiers chiffrés (lib/filestore) : pièces KYC ET, depuis août 2026,
# PIÈCES JOINTES DU DMP — donc des DONNÉES DE SANTÉ. Il ne vit PAS dans PostgreSQL :
# une restauration du seul dump laisserait des entrées de dossier pointant vers des
# fichiers disparus. Doit correspondre à KYC_STORAGE_DIR du .env de l'API.
FILESTORE_DIR="${KYC_STORAGE_DIR:-/var/www/digisante-mobile/apps/api/storage/kyc}"

umask 077
[[ "$DB_NAME" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] || { echo "[pg_dump] ÉCHEC : nom de base invalide" >&2; exit 1; }
[[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || { echo "[pg_dump] ÉCHEC : rétention invalide" >&2; exit 1; }
[[ -d "$FILESTORE_DIR" ]] || { echo "[pg_dump] ÉCHEC : magasin de fichiers absent ; aucune sauvegarde complète possible" >&2; exit 1; }
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
if [[ -d "$FILESTORE_DIR" ]]; then
  log "Sauvegarde du magasin de fichiers ${FILESTORE_DIR}…"
  tar -C "$(dirname "$FILESTORE_DIR")" -cf - "$(basename "$FILESTORE_DIR")" \
    | gzip -9 \
    | openssl enc -aes-256-cbc -pbkdf2 -salt -pass "file:${KEY_FILE}" \
    > "$WORK/files"
  chmod 0400 "$WORK/files"
  log "Archive fichiers préparée : ${OUT_FILES} ($(du -h "$WORK/files" | cut -f1))"
fi

# ── Manifeste : comptages EXACTS par table + tête de la chaîne d'audit + SHA-256 ──
# des archives (détecte une archive tronquée/altérée AVANT tout déchiffrement).
{
  echo "stamp=${STAMP}"
  echo "db_archive=$(basename "$OUT") sha256=$(sha256sum "$WORK/db" | cut -d' ' -f1)"
  if [[ -f "$WORK/files" ]]; then
    echo "files_archive=$(basename "$OUT_FILES") sha256=$(sha256sum "$WORK/files" | cut -d' ' -f1)"
    echo "files_count=$(find "$FILESTORE_DIR" -type f | wc -l)"
  fi
  cat >&"$SNAP_IN" <<'SQL'
SELECT format('SELECT %L || ''='' || count(*) FROM %I.%I;', 'rows.' || tablename, schemaname, tablename)
  FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename\gexec
SELECT 'audit_head=' || coalesce((SELECT hash FROM audit_logs ORDER BY "createdAt" DESC, id DESC LIMIT 1), 'none');
COMMIT;
\q
SQL
  cat <&"$SNAP_OUT"
  wait "$SNAP_PID"
  SNAP_PID=""
} > "$WORK/manifest"
chmod 0400 "$WORK/manifest"
# Publication finale : pas de manifeste complet si une étape précédente a échoué.
PUBLISHING=1
mv "$WORK/db" "$OUT"
mv "$WORK/files" "$OUT_FILES"
mv "$WORK/manifest" "$OUT_MANIFEST"
COMMITTED=1
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
