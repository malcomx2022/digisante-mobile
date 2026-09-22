#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Déclencheur cron de la RÉCONCILIATION FedaPay — DigiSanté Mobile
# cf. CLAUDE.md §5 (logique paiement GELÉE) et §7 (cron 02:30).
#
# ⚠️ Ce script ne contient AUCUNE logique de paiement (module gelé).
# Il se contente d'appeler l'endpoint interne de réconciliation, exposé
# par le module payments (FROZEN). Toute évolution de la réconciliation
# elle-même passe par une revue explicite + re-tests webhooks (HMAC, DLQ).
#
# L'endpoint n'est joignable qu'en local (127.0.0.1) et protégé par un
# token de service lu dans un fichier root-only HORS dépôt :
#   /etc/digisante/reconcile.token
# ─────────────────────────────────────────────────────────────
set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:3001}"
RECONCILE_PATH="${RECONCILE_PATH:-/api/v1/payments/reconcile}"
TOKEN_FILE="${RECONCILE_TOKEN_FILE:-/etc/digisante/reconcile.token}"

log() { printf '[reconcile] %s %s\n' "$(date -Is)" "$*"; }

if [[ ! -r "$TOKEN_FILE" ]]; then
  echo "[reconcile] Token de service introuvable : $TOKEN_FILE" >&2
  exit 1
fi
# Réponse dans un fichier temporaire PRIVÉ (mktemp) : l'ancien chemin fixe
# /tmp/reconcile_resp.json, écrit en root, était exposé à une attaque par lien
# symbolique (un utilisateur local pouvait faire écraser un fichier système).
RESP="$(mktemp)"
trap 'rm -f "$RESP"' EXIT

log "Déclenchement de la réconciliation FedaPay → ${API_BASE}${RECONCILE_PATH}"
# Jeton fourni via `--config -` (stdin) : jamais en argument, donc absent de `ps`.
HTTP_CODE="$(printf 'header = "X-Service-Token: %s"\n' "$(tr -d '\r\n' < "$TOKEN_FILE")" \
  | curl -sS --config - -o "$RESP" -w '%{http_code}' \
  -X POST "${API_BASE}${RECONCILE_PATH}" \
  --max-time 300 || true)"

if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "202" ]]; then
  log "Réconciliation acceptée (HTTP ${HTTP_CODE})."
  cat "$RESP" 2>/dev/null || true
else
  log "ÉCHEC réconciliation (HTTP ${HTTP_CODE}). Réponse :"
  cat "$RESP" 2>/dev/null || true
  exit 1
fi
