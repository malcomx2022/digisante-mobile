#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Déclencheur des TÂCHES INTERNES de l'API (générateurs de rappels, dispatch des
# notifications) — appelé par cron, en root.
#
#   internal_job.sh /api/v1/notifications/dispatch
#
# Jeton de service lu dans UN SEUL fichier root-only HORS dépôt (le même que la
# réconciliation) : /etc/digisante/reconcile.token (= RECONCILE_TOKEN du .env API).
#  • le jeton n'est PLUS écrit en clair dans la crontab (placeholder `changeme`
#    oublié ⇒ tous les générateurs en 401, silencieusement) ;
#  • il ne passe PAS en argument de curl (visible dans `ps` par tout utilisateur
#    local) : l'en-tête est fourni par la configuration lue sur l'entrée standard ;
#  • jeton absent/vide, ou réponse non 2xx ⇒ code de sortie 1 et ligne ÉCHEC au log.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

JOB_PATH="${1:?Usage : internal_job.sh /api/v1/<chemin>}"
API_BASE="${API_BASE:-http://127.0.0.1:3001}"
TOKEN_FILE="${RECONCILE_TOKEN_FILE:-/etc/digisante/reconcile.token}"

log() { printf '[job] %s %s %s\n' "$(date -Is)" "$JOB_PATH" "$*"; }

if [[ ! -s "$TOKEN_FILE" ]]; then
  log "ÉCHEC : jeton de service absent ou vide ($TOKEN_FILE)"
  exit 1
fi

RESP="$(mktemp)"
trap 'rm -f "$RESP"' EXIT

# `--config -` : l'en-tête contenant le jeton est lu sur stdin, jamais sur la ligne de commande.
HTTP_CODE="$(printf 'header = "x-service-token: %s"\n' "$(tr -d '\r\n' < "$TOKEN_FILE")" \
  | curl -sS --config - -o "$RESP" -w '%{http_code}' -X POST --max-time 120 "${API_BASE}${JOB_PATH}" || true)"

if [[ "$HTTP_CODE" =~ ^2[0-9][0-9]$ ]]; then
  log "OK (HTTP ${HTTP_CODE}) $(head -c 300 "$RESP" | tr -d '\n')"
else
  log "ÉCHEC (HTTP ${HTTP_CODE:-000}) $(head -c 300 "$RESP" 2>/dev/null | tr -d '\n')"
  exit 1
fi
