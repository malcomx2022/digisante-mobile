#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Restauration VÉRIFIÉE des deux archives d'une même sauvegarde — B5.
# À exécuter sur une MACHINE TIERCE isolée (jamais sur la production), avec un
# PostgreSQL 16 local et la clé de sauvegarde copiée hors VPS.
#
#   sudo STAMP=20260922_020000 BACKUP_DIR=/chemin/archives KEY_FILE=/chemin/backup.key \
#        WORK_DIR=/srv/b5 bash verify_restore.sh            # restaure + contrôle
#   sudo STAMP=… WORK_DIR=/srv/b5 bash verify_restore.sh --cleanup   # détruit tout
#
# Connexion PostgreSQL : variables libpq standard (PGHOST, PGPORT, PGUSER), superutilisateur
# local. Option : HEALTH_ENCRYPTION_KEY dans l'ENVIRONNEMENT pour vérifier un échantillon de
# checksums de pièces jointes (jamais en argument). Aucune donnée personnelle n'est affichée :
# comptages, empreintes et statuts uniquement.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

STAMP="${STAMP:?Définir STAMP (ex. 20260922_020000)}"
WORK_DIR="${WORK_DIR:?Définir WORK_DIR (répertoire de travail isolé)}"
RESTORE_DB="${RESTORE_DB:-digisante_restore_${STAMP}}"
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
FAILS=0

pass() { printf 'PASS %s\n' "$*"; }
fail() { printf 'FAIL %s\n' "$*"; FAILS=$((FAILS + 1)); }

if [[ "${1:-}" == "--cleanup" ]]; then
  # Données de santé restaurées : destruction systématique après le test.
  psql -d postgres -v ON_ERROR_STOP=1 -qc "DROP DATABASE IF EXISTS \"${RESTORE_DB}\"" && echo "base ${RESTORE_DB} supprimée"
  rm -rf -- "${WORK_DIR:?}/files" && echo "fichiers restaurés supprimés (${WORK_DIR}/files)"
  exit 0
fi

BACKUP_DIR="${BACKUP_DIR:?Définir BACKUP_DIR}"
KEY_FILE="${KEY_FILE:?Définir KEY_FILE (clé de sauvegarde copiée hors VPS)}"
DB_ARCHIVE="${BACKUP_DIR}/digisante_${STAMP}.sql.gz.enc"
FILES_ARCHIVE="${BACKUP_DIR}/digisante_files_${STAMP}.tar.gz.enc"
MANIFEST="${BACKUP_DIR}/digisante_manifest_${STAMP}.txt"
dec() { openssl enc -d -aes-256-cbc -pbkdf2 -pass "file:${KEY_FILE}" -in "$1"; }

# 1. Les DEUX archives du MÊME horodatage (+ manifeste) sont présentes
for f in "$DB_ARCHIVE" "$FILES_ARCHIVE" "$MANIFEST"; do [[ -r "$f" ]] || { echo "FAIL absent : $f"; exit 1; }; done
pass "archives base + fichiers + manifeste du ${STAMP}"

# 2. Intégrité AVANT déchiffrement : SHA-256 = manifeste
for f in "$DB_ARCHIVE" "$FILES_ARCHIVE"; do
  expected="$(grep -F "$(basename "$f")" "$MANIFEST" | sed -n 's/.*sha256=\([0-9a-f]*\).*/\1/p')"
  [[ -n "$expected" && "$(sha256sum "$f" | cut -d' ' -f1)" == "$expected" ]] && pass "SHA-256 conforme : $(basename "$f")" || fail "SHA-256 ≠ manifeste : $(basename "$f")"
done

# 3. Déchiffrement + gzip intègres (mauvaise clé / archive tronquée ⇒ échec ici)
for f in "$DB_ARCHIVE" "$FILES_ARCHIVE"; do
  dec "$f" | gzip -t && pass "déchiffrement + gzip : $(basename "$f")" || fail "déchiffrement/gzip : $(basename "$f")"
done
(( FAILS == 0 )) || { echo "❌ archives inutilisables — arrêt avant restauration"; exit 1; }

# 4. Restauration dans une base PostgreSQL 16 VIERGE (refus si elle existe déjà)
psql -d postgres -Atc 'SHOW server_version' | grep -q '^16\.' && pass "PostgreSQL 16" || fail "PostgreSQL ≠ 16"
if psql -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname='${RESTORE_DB}'" | grep -q 1; then
  echo "FAIL la base ${RESTORE_DB} existe déjà — lancer --cleanup d'abord"; exit 1
fi
psql -d postgres -v ON_ERROR_STOP=1 -qc "CREATE DATABASE \"${RESTORE_DB}\""
dec "$DB_ARCHIVE" | gunzip | psql -d "$RESTORE_DB" -v ON_ERROR_STOP=1 -q >/dev/null && pass "base restaurée : ${RESTORE_DB}" || fail "restauration SQL"

# 5. Restauration des fichiers dans un répertoire distinct, privé
install -d -m 0700 "${WORK_DIR}/files"
dec "$FILES_ARCHIVE" | gunzip | tar -C "${WORK_DIR}/files" -xf - && pass "fichiers restaurés" || fail "restauration fichiers"
STORE="$(find "${WORK_DIR}/files" -mindepth 1 -maxdepth 1 -type d | head -1)"

# 6. Comptages EXACTS table par table = manifeste
MISMATCH=0; TABLES=0
while IFS='=' read -r key value; do
  [[ "$key" == rows.* ]] || continue
  TABLES=$((TABLES + 1)); table="${key#rows.}"
  got="$(psql -d "$RESTORE_DB" -Atc "SELECT count(*) FROM public.\"${table}\"")"
  [[ "$got" == "$value" ]] || { MISMATCH=$((MISMATCH + 1)); echo "  écart ${table} : manifeste ${value} / restauré ${got}"; }
done < "$MANIFEST"
(( TABLES > 0 && MISMATCH == 0 )) && pass "comptages identiques sur ${TABLES} tables" || fail "comptages : ${MISMATCH} écart(s) sur ${TABLES} tables"

# 7. Fichiers référencés présents (+ échantillon de checksums si HEALTH_ENCRYPTION_KEY fournie)
psql -d "$RESTORE_DB" -Atc "SELECT json_build_object('kind','DMP','encryptedUrl',\"encryptedUrl\",'checksum',checksum) FROM documents
  UNION ALL SELECT json_build_object('kind','KYC','encryptedUrl',\"fileUrl\",'checksum',NULL) FROM kyc_documents" \
  | node "${REPO}/scripts/restore/verify-files.mjs" "${STORE:-${WORK_DIR}/files}" && pass "fichiers référencés présents / checksums" || fail "cohérence base ↔ fichiers"

# 8. Chaîne d'audit : tête = manifeste, chaînage intègre, hash recalculables
HEAD_EXPECTED="$(sed -n 's/^audit_head=//p' "$MANIFEST")"
HEAD_GOT="$(psql -d "$RESTORE_DB" -Atc "SELECT coalesce((SELECT hash FROM audit_logs ORDER BY \"createdAt\" DESC, id DESC LIMIT 1),'none')")"
[[ "$HEAD_GOT" == "$HEAD_EXPECTED" ]] && pass "tête de la chaîne d'audit = manifeste" || fail "tête de chaîne d'audit ≠ manifeste"
psql -d "$RESTORE_DB" -Atc "SELECT json_build_object('action',action,'actorId',\"actorId\",'targetId',\"targetId\",'ip',ip,'meta',meta,'prevHash',\"prevHash\",'hash',hash,'ts',to_char(\"createdAt\" at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')) FROM audit_logs ORDER BY \"createdAt\", id" \
  | node "${REPO}/scripts/audit/verify-chain.mjs" && pass "chaîne d'audit intègre et recalculable" || fail "chaîne d'audit (voir ci-dessus)"

# 9. Protections §4 restaurées avec le dump : UPDATE / DELETE / TRUNCATE refusés
for stmt in "UPDATE audit_logs SET action = action" "DELETE FROM audit_logs" "TRUNCATE audit_logs"; do
  if psql -d "$RESTORE_DB" -v ON_ERROR_STOP=1 -qc "BEGIN; ${stmt}; ROLLBACK;" >/dev/null 2>&1; then
    fail "trigger d'audit : « ${stmt} » accepté"
  else
    pass "trigger d'audit : « ${stmt%% *} » refusé"
  fi
done

echo
(( FAILS == 0 )) && echo "✅ Restauration vérifiée (${STAMP}). Détruire ensuite : --cleanup" || { echo "❌ ${FAILS} contrôle(s) en échec"; exit 1; }
