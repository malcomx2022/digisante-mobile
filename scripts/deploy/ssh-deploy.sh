#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Exécute un script de déploiement sur le VPS par SSH en transmettant l'URL du rôle
# PROPRIÉTAIRE PostgreSQL (MIGRATION_DATABASE_URL) par l'ENTRÉE STANDARD, jamais dans la
# ligne de commande distante (revue GO du 22/10/2026).
#
# Pourquoi pas appleboy/ssh-action `envs` : ses variables sont recopiées dans le texte de la
# commande exécutée sur l'hôte, et /proc/<pid>/cmdline est lisible par tous les comptes de
# l'hôte IONOS PARTAGÉ (ImmiPro, BeninLink…) pendant toute la durée du déploiement.
# Ici la commande distante ne contient que du code et des valeurs NON secrètes ; l'URL est lue
# sur l'entrée standard, exportée (environ = lisible par le même compte et root seulement),
# puis l'entrée standard est coupée avant le script.
#
# Clé d'hôte : scannée puis retenue SEULEMENT si son empreinte SHA256 égale VPS_FINGERPRINT ;
# sinon aucune connexion (un DNS détourné ne reçoit ni la clé SSH ni le secret).
#
#   VPS_HOST VPS_USER VPS_SSH_KEY VPS_FINGERPRINT [VPS_SSH_PORT] MIGRATION_DATABASE_URL
#   ssh-deploy.sh <script-distant> [NOM=valeur …]     (valeurs non secrètes : [A-Za-z0-9._-])
# ─────────────────────────────────────────────────────────────
set -euo pipefail
case "$-" in *x*) echo "[ssh-deploy] bash -x refusé : le secret de migration serait affiché" >&2; exit 1 ;; esac
die() { echo "[ssh-deploy] ÉCHEC : $*" >&2; exit 1; }

for v in VPS_HOST VPS_USER VPS_SSH_KEY VPS_FINGERPRINT MIGRATION_DATABASE_URL; do
  [[ -n "${!v:-}" ]] || die "${v} requis (secret GitHub de l'environnement)"
done
port="${VPS_SSH_PORT:-22}"
[[ "$port" =~ ^[0-9]{1,5}$ ]] || die "port SSH invalide"
[[ "$VPS_HOST" =~ ^[A-Za-z0-9.-]+$ ]] || die "hôte invalide"
[[ "$VPS_USER" =~ ^[a-z][a-z0-9-]*$ ]] || die "utilisateur invalide"
[[ "$MIGRATION_DATABASE_URL" != *$'\n'* && "$MIGRATION_DATABASE_URL" != *$'\r'* ]] || die "MIGRATION_DATABASE_URL sur plusieurs lignes"
remote_script="${1:-}"
[[ -f "$remote_script" ]] || die "script distant introuvable"
shift
assign=""
for kv in "$@"; do
  [[ "$kv" =~ ^[A-Z_][A-Z0-9_]*=[A-Za-z0-9._-]*$ ]] || die "affectation non sûre (nom en majuscules, valeur [A-Za-z0-9._-])"
  assign+="${kv}"$'\n'
done

work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
umask 077
printf '%s\n' "$VPS_SSH_KEY" > "$work/key"

expected="${VPS_FINGERPRINT#SHA256:}"
ssh-keyscan -T 15 -p "$port" -- "$VPS_HOST" 2>/dev/null > "$work/scan" || true
: > "$work/known_hosts"
while IFS= read -r line; do
  [[ -n "$line" && "$line" != \#* ]] || continue
  fp="$(ssh-keygen -l -E sha256 -f - <<<"$line" 2>/dev/null | awk '{print $2}' || true)"
  [[ -n "$fp" && "${fp#SHA256:}" == "$expected" ]] && printf '%s\n' "$line" >> "$work/known_hosts"
done < "$work/scan"
[[ -s "$work/known_hosts" ]] || die "aucune clé d'hôte de ${VPS_HOST}:${port} ne correspond à VPS_FINGERPRINT : connexion refusée"

# Script encodé (base64 : alphabet sûr pour la ligne de commande) ; aucun secret dedans.
payload="$({ printf '%s' "$assign"; cat -- "$remote_script"; } | base64 -w0)"
remote="IFS= read -r MIGRATION_DATABASE_URL && export MIGRATION_DATABASE_URL && exec bash -c \"\$(printf %s ${payload} | base64 -d)\" </dev/null"
printf '%s\n' "$MIGRATION_DATABASE_URL" | ssh -i "$work/key" -p "$port" \
  -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile="$work/known_hosts" -o GlobalKnownHostsFile=/dev/null \
  -- "${VPS_USER}@${VPS_HOST}" "$remote"
