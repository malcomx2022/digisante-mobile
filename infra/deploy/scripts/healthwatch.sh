#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Surveillance LOCALE du VPS DigiSanté (aucun SaaS) — cron root toutes les 5 min.
# Chaque contrôle produit OK / ALERTE ; une notification n'est émise QUE sur un
# CHANGEMENT d'état (nouvelle alerte, ou retour à la normale) : pas de spam.
#
# DIGISANTE_ENV (obligatoire) : une instance par environnement de l'hôte partagé, chacune
# avec ses noms PM2, son port d'API, ses journaux, son état et ses sauvegardes.
#
# Destinataire : commande configurée dans ${ETC_DIR}/alert.conf (root, 0600), ex.
#   ALERT_CMD='mail -s "[DigiSanté] alerte production" ops@exemple.bj'
# Le message arrive sur l'entrée standard. Sans ALERT_CMD : syslog seulement
# (`journalctl -t digisante-healthwatch`). Runbook : docs/RUNBOOK_Alertes.md.
# Aucun secret, aucune donnée de santé dans les messages (comptages et états seuls).
#
# B3 : lancé depuis la copie INSTALLÉE root:root (/usr/local/lib/digisante[-preprod], cf.
# install_root_scripts.sh), jamais depuis APP_DIR. Le module de contrôle des sauvegardes
# est pris dans la MÊME installation (même commit) et n'est exécuté que s'il n'est
# modifiable par aucun autre compte ; les journaux des tâches root sont lus dans
# ${CRON_LOG_DIR} (root), pas dans le répertoire de l'utilisateur applicatif.
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
trusted_path "${BASH_SOURCE[0]}" || { echo "[healthwatch] ÉCHEC : script lancé depuis un emplacement modifiable par un autre compte ; utiliser la copie installée par install_root_scripts.sh" >&2; exit 1; }
SELF_ROOT="$(cd "$(dirname "$(readlink -f -- "${BASH_SOURCE[0]}")")/../../.." && pwd -P)"
digisante_profile || exit 1
[[ "$(readlink -f -- "$ROOT_LIB")" == "$SELF_ROOT" ]] || { echo "[healthwatch] ÉCHEC : copie root d'un autre environnement que ${DIGISANTE_ENV} (${ROOT_LIB} attendu)" >&2; exit 1; }

CONF="${HEALTHWATCH_CONF:-${ETC_DIR}/alert.conf}"
if [[ -r "$CONF" ]]; then
  # Fichier SOURCÉ par root : refusé s'il est modifiable par un autre compte.
  trusted_path "$CONF" || { echo "[healthwatch] ÉCHEC : ${CONF} modifiable par un autre compte ; non chargé" >&2; exit 1; }
  # shellcheck disable=SC1090
  source "$CONF"
fi

PM2_CHECK="${PM2_CHECK:-1}"
BACKUP_MAX_AGE_H="${BACKUP_MAX_AGE_H:-26}"
DISK_PATHS="${DISK_PATHS:-/ ${BACKUP_DIR}}"
DISK_THRESHOLD="${DISK_THRESHOLD:-85}"
# Journaux des tâches ROOT : répertoire root:root (un journal dans le répertoire de
# l'utilisateur applicatif pourrait être remplacé par un lien vers un fichier système).
JOB_LOGS="${JOB_LOGS:-${CRON_LOG_DIR}/med_reminders.log ${CRON_LOG_DIR}/appt_reminders.log ${CRON_LOG_DIR}/vaccination_reminders.log ${CRON_LOG_DIR}/maternity_reminders.log ${CRON_LOG_DIR}/notify_dispatch.log ${CRON_LOG_DIR}/reconcile.log ${CRON_LOG_DIR}/pg_dump.log ${CRON_LOG_DIR}/sync_receipts.log}"
API_LOG="${API_LOG:-${APP_LOG_DIR}/api-error.log ${APP_LOG_DIR}/api-out.log}"
[[ "$DB_NAME" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] || { echo "Nom de base invalide" >&2; exit 1; }
PSQL="${PSQL:-sudo -u postgres psql -d $DB_NAME -At}"
BACKLOG_MAX="${BACKLOG_MAX:-100}"
WEBHOOK_401_MAX="${WEBHOOK_401_MAX:-5}"
PROVIDER_ERR_MAX="${PROVIDER_ERR_MAX:-3}"
DOMAIN="${DOMAIN:-}"
STATE="${STATE_DIR}/healthwatch.state"
ALERT_CMD="${ALERT_CMD:-}"

install -d -m 0700 "$STATE_DIR"
declare -A NOW=()
check() { NOW["$1"]="$2"; printf '%-10s %-8s %s\n' "$1" "${2%%|*}" "${2#*|}"; }

# 1. Readiness (DB + Redis)
if curl -fsS --connect-timeout 3 --max-time 10 "${API_BASE}/api/v1/ready" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const r=JSON.parse(d);process.exit(r.status==="ready"&&r.db==="up"&&r.redis==="up"?0:1)}catch{process.exit(1)}})'; then
  check ready "OK|DB + Redis joignables"
else check ready "ALERTE|/ready indisponible ou JSON non conforme"; fi

# 2. PM2 : api ×2 + web DE CET ENVIRONNEMENT (noms fixés par DIGISANTE_ENV)
if [[ "$PM2_CHECK" == "1" ]]; then
  read -r api web < <(sudo -u "$APP_USER" pm2 jlist 2>/dev/null | PM2_API="$PM2_API" PM2_WEB="$PM2_WEB" node -e '
    let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let l=[];try{l=JSON.parse(d);if(!Array.isArray(l))l=[]}catch{}
    const n=(x)=>l.filter(p=>p.name===x&&p.pm2_env&&p.pm2_env.status==="online").length;
    console.log(n(process.env.PM2_API),n(process.env.PM2_WEB))})' || echo "0 0")
  [[ "$api" == "2" && "$web" == "1" ]] && check pm2 "OK|${PM2_API} ${api}/2, ${PM2_WEB} ${web}/1" || check pm2 "ALERTE|${PM2_API} ${api}/2, ${PM2_WEB} ${web}/1 en ligne"
fi

# 3. Espace disque (racine + sauvegardes)
worst=0; where=""
for p in $DISK_PATHS; do
  [[ -e "$p" ]] || continue
  use="$(df -P "$p" | awk 'NR==2{gsub("%","",$5);print $5}')"
  (( use > worst )) && { worst=$use; where=$p; }
done
(( worst < DISK_THRESHOLD )) && check disk "OK|max ${worst}% (seuil ${DISK_THRESHOLD}%)" || check disk "ALERTE|${where} à ${worst}% (seuil ${DISK_THRESHOLD}%)"

# 4. Fraîcheur du trio PUBLIÉ : manifeste = marqueur de fin, pas une archive partielle.
#    Le contrôle refuse aussi un magasin de fichiers incomplet (fichiers archivés <
#    fichiers référencés par la base au moment du dump — B4).
BACKUP_CHECK="${SELF_ROOT}/scripts/preproduction/check-backup.mjs"
last="$(ls -1t "$BACKUP_DIR"/digisante_manifest_2*.txt 2>/dev/null | head -1 || true)"
if [[ -z "$last" ]]; then
  check backup "ALERTE|aucune sauvegarde complète publiée dans ${BACKUP_DIR}"
elif ! trusted_path "$BACKUP_CHECK"; then
  check backup "ALERTE|module de contrôle des sauvegardes absent ou modifiable par un autre compte (réinstaller les scripts root)"
else
  age_s=$(( $(date +%s) - $(stat -c %Y "$last") )); age_h=$((age_s / 3600))
  if (( age_s < 0 || age_s > BACKUP_MAX_AGE_H * 3600 )); then check backup "ALERTE|sauvegarde périmée ou horodatage futur (${age_h} h)"
  elif ! node "$BACKUP_CHECK" "$last" --metadata-only >/dev/null 2>&1; then check backup "ALERTE|trio base/fichiers/manifeste absent, vide, incohérent ou magasin de fichiers incomplet"
  else check backup "OK|trio publié (${age_h} h) ; intégrité/restauration à contrôler séparément"; fi
fi

# 5. Tâches cron en échec (lignes ÉCHEC récentes : journaux modifiés depuis 15 min)
fails=0
for f in $JOB_LOGS; do
  [[ -f "$f" ]] && [[ -n "$(find "$f" -mmin -15 2>/dev/null)" ]] || continue
  fails=$(( fails + $(tail -n 50 "$f" | grep -c 'ÉCHEC' || true) ))
done
(( fails == 0 )) && check cron "OK|aucune tâche en échec" || check cron "ALERTE|${fails} échec(s) récent(s) de tâches (générateurs/dispatch/réconciliation/sauvegarde)"

# 6. Fournisseurs en échec (nouvelles lignes du journal API depuis le dernier passage)
perr=0
for f in $API_LOG; do
  [[ -f "$f" ]] || continue
  key="$(echo "$f" | tr '/' '_')"; off_file="${STATE_DIR}/off${key}"
  size="$(stat -c %s "$f")"; off="$(cat "$off_file" 2>/dev/null || echo 0)"
  (( size < off )) && off=0   # rotation (copytruncate)
  perr=$(( perr + $(tail -c +"$((off + 1))" "$f" | grep -Ec '\[(Twilio|Resend|Daily|FCM|FedaPay)\][^"]*(échec|erreur réseau)|envoi non abouti' || true) ))
  echo "$size" > "$off_file"
done
(( perr < PROVIDER_ERR_MAX )) && check providers "OK|${perr} erreur(s) fournisseur depuis le dernier passage" || check providers "ALERTE|${perr} erreurs fournisseurs (SMS/email/push/visio/paiement) depuis le dernier passage"

# 7 & 8. Base : backlog de notifications, webhooks FedaPay rejetés (1 h)
if backlog="$($PSQL -c "SELECT count(*) FROM notifications WHERE status='PENDING' AND \"createdAt\" < now() - interval '15 minutes'" 2>/dev/null)"; then
  (( backlog <= BACKLOG_MAX )) && check backlog "OK|${backlog} notification(s) en attente > 15 min" || check backlog "ALERTE|${backlog} notifications en attente > 15 min (dispatch bloqué ?)"
  rej="$($PSQL -c "SELECT count(*) FROM audit_logs WHERE action='AUTH_FAIL' AND meta->>'source'='fedapay_webhook' AND \"createdAt\" > now() - interval '1 hour'" 2>/dev/null || echo 0)"
  (( rej < WEBHOOK_401_MAX )) && check webhooks "OK|${rej} webhook(s) FedaPay rejeté(s) en 1 h" || check webhooks "ALERTE|${rej} webhooks FedaPay rejetés en 1 h (secret désynchronisé ?)"
else
  check backlog "ALERTE|base inaccessible pour les contrôles (psql)"
fi

# 9. Certificat TLS
if [[ -n "$DOMAIN" ]]; then
  end="$(echo | timeout 15 openssl s_client -verify_return_error -verify_hostname "$DOMAIN" -connect "${DOMAIN}:443" -servername "$DOMAIN" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 )" || end=""
  if [[ -n "$end" ]]; then
    d=$(( ( $(date -d "$end" +%s) - $(date +%s) ) / 86400 ))
    (( d >= 14 )) && check tls "OK|expire dans ${d} j" || check tls "ALERTE|certificat expire dans ${d} j"
  else check tls "ALERTE|aucun certificat présenté"; fi
fi

# ── Notification sur CHANGEMENT d'état uniquement ──
declare -A PREV=()
if [[ -f "$STATE" ]]; then while IFS='=' read -r k v; do PREV["$k"]="$v"; done < "$STATE"; fi
msg=""
for k in "${!NOW[@]}"; do
  cur="${NOW[$k]%%|*}"; prev="${PREV[$k]:-OK}"
  if [[ "$cur" == "ALERTE" && "$prev" != "ALERTE" ]]; then msg+="🔴 ${k} : ${NOW[$k]#*|}"$'\n'
  elif [[ "$cur" == "OK" && "$prev" == "ALERTE" ]]; then msg+="🟢 ${k} rétabli : ${NOW[$k]#*|}"$'\n'; fi
done
: > "$STATE"; for k in "${!NOW[@]}"; do echo "${k}=${NOW[$k]%%|*}" >> "$STATE"; done

if [[ -n "$msg" ]]; then
  body="DigiSanté ${DIGISANTE_ENV} — $(hostname) — $(date -Is)"$'\n'"${msg}"$'\n'"Runbook : docs/RUNBOOK_Alertes.md"
  logger -t digisante-healthwatch -- "[${DIGISANTE_ENV}] $(printf '%s' "$msg" | tr '\n' ' ')" 2>/dev/null || true
  if [[ -n "$ALERT_CMD" ]]; then printf '%s\n' "$body" | bash -c "$ALERT_CMD" || echo "échec de ALERT_CMD" >&2; fi
  printf '\n%s\n' "$body"
fi
