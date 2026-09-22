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

STAMP="$(date +%Y%m%d_%H%M%S)"
OUT="${BACKUP_DIR}/digisante_${STAMP}.sql.gz.enc"
OUT_FILES="${BACKUP_DIR}/digisante_files_${STAMP}.tar.gz.enc"
# Manifeste NON chiffré (aucune donnée personnelle : noms de tables, comptages, empreintes)
# — référence de la restauration (verify_restore.sh compare la base restaurée à ce relevé).
OUT_MANIFEST="${BACKUP_DIR}/digisante_manifest_${STAMP}.txt"

log() { printf '[pg_dump] %s %s\n' "$(date -Is)" "$*"; }

if [[ ! -r "$KEY_FILE" ]]; then
  echo "[pg_dump] Clé de chiffrement introuvable : $KEY_FILE" >&2
  exit 1
fi
install -d -m 0700 "$BACKUP_DIR"

log "Démarrage du dump chiffré de la base '${DB_NAME}'…"
# pg_dump → gzip → openssl AES-256 (PBKDF2). pipefail garantit l'échec si un maillon casse.
sudo -u postgres pg_dump --no-owner --no-privileges "$DB_NAME" \
  | gzip -9 \
  | openssl enc -aes-256-cbc -pbkdf2 -salt -pass "file:${KEY_FILE}" \
  > "$OUT"

chmod 0400 "$OUT"
SIZE="$(du -h "$OUT" | cut -f1)"
log "Sauvegarde base écrite : ${OUT} (${SIZE})"

# ── Magasin de fichiers (KYC + pièces jointes DMP) ──────────────────────────
# Chiffré une seconde fois à la même clé : les fichiers sont DÉJÀ chiffrés au repos
# (AES-256-GCM), mais la sauvegarde quitte le VPS — on ne relâche pas la protection
# en transit/au stockage distant sous prétexte qu'elle existe en amont.
if [[ -d "$FILESTORE_DIR" ]]; then
  log "Sauvegarde du magasin de fichiers ${FILESTORE_DIR}…"
  tar -C "$(dirname "$FILESTORE_DIR")" -cf - "$(basename "$FILESTORE_DIR")" \
    | gzip -9 \
    | openssl enc -aes-256-cbc -pbkdf2 -salt -pass "file:${KEY_FILE}" \
    > "$OUT_FILES"
  chmod 0400 "$OUT_FILES"
  log "Sauvegarde fichiers écrite : ${OUT_FILES} ($(du -h "$OUT_FILES" | cut -f1))"
else
  # Ne PAS échouer silencieusement : sans fichiers, les pièces jointes du DMP
  # seraient perdues à la première restauration sans que personne ne l'ait vu.
  log "ATTENTION : magasin de fichiers introuvable (${FILESTORE_DIR}) — RIEN n'a été sauvegardé côté fichiers."
  log "  → vérifier KYC_STORAGE_DIR dans apps/api/.env ; les pièces jointes du DMP sont des données de santé."
fi

# ── Manifeste : comptages EXACTS par table + tête de la chaîne d'audit + SHA-256 ──
# des archives (détecte une archive tronquée/altérée AVANT tout déchiffrement).
{
  echo "stamp=${STAMP}"
  echo "db_archive=$(basename "$OUT") sha256=$(sha256sum "$OUT" | cut -d' ' -f1)"
  if [[ -f "$OUT_FILES" ]]; then
    echo "files_archive=$(basename "$OUT_FILES") sha256=$(sha256sum "$OUT_FILES" | cut -d' ' -f1)"
    echo "files_count=$(find "$FILESTORE_DIR" -type f | wc -l)"
  fi
  sudo -u postgres psql -d "$DB_NAME" -At -v ON_ERROR_STOP=1 <<'SQL'
SELECT format('SELECT %L || ''='' || count(*) FROM %I.%I;', 'rows.' || tablename, schemaname, tablename)
  FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename\gexec
SELECT 'audit_head=' || coalesce((SELECT hash FROM audit_logs ORDER BY "createdAt" DESC, id DESC LIMIT 1), 'none');
SQL
} > "$OUT_MANIFEST"
chmod 0400 "$OUT_MANIFEST"
log "Manifeste écrit : ${OUT_MANIFEST}"

# ── Rétention : purge des sauvegardes plus anciennes que RETENTION_DAYS ──
DELETED="$(find "$BACKUP_DIR" \( -name 'digisante_*.sql.gz.enc' -o -name 'digisante_files_*.tar.gz.enc' -o -name 'digisante_manifest_*.txt' \) -type f -mtime "+${RETENTION_DAYS}" -print -delete | wc -l)"
log "Purge rétention (> ${RETENTION_DAYS} j) : ${DELETED} fichier(s) supprimé(s)."

# Pour restaurer — LES DEUX, sinon le dossier médical pointe vers des fichiers absents :
#   openssl enc -d -aes-256-cbc -pbkdf2 -pass file:/etc/digisante/backup.key \
#     -in digisante_YYYYMMDD_HHMMSS.sql.gz.enc | gunzip | psql digisante
#   openssl enc -d -aes-256-cbc -pbkdf2 -pass file:/etc/digisante/backup.key \
#     -in digisante_files_YYYYMMDD_HHMMSS.tar.gz.enc | gunzip | tar -C /chemin/parent -xf -
log "Terminé ✓"
