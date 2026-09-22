#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Surveillance LOCALE du VPS DigiSanté (aucun SaaS) — cron root toutes les 5 min.
# Chaque contrôle produit OK / ALERTE ; une notification n'est émise QUE sur un
# CHANGEMENT d'état (nouvelle alerte, ou retour à la normale) : pas de spam.
#
# Destinataire : commande configurée dans /etc/digisante/alert.conf (root, 0600), ex.
#   ALERT_CMD='mail -s "[DigiSanté] alerte production" ops@exemple.bj'
# Le message arrive sur l'entrée standard. Sans ALERT_CMD : syslog seulement
# (`journalctl -t digisante-healthwatch`). Runbook : docs/RUNBOOK_Alertes.md.
# Aucun secret, aucune donnée de santé dans les messages (comptages et états seuls).
# ─────────────────────────────────────────────────────────────
set -euo pipefail

CONF="${HEALTHWATCH_CONF:-/etc/digisante/alert.conf}"
# shellcheck disable=SC1090
[[ -r "$CONF" ]] && source "$CONF"

API_URL="${API_URL:-http://127.0.0.1:3001}"
APP_USER="${APP_USER:-digisante}"
PM2_CHECK="${PM2_CHECK:-1}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/digisante}"
BACKUP_MAX_AGE_H="${BACKUP_MAX_AGE_H:-26}"
DISK_PATHS="${DISK_PATHS:-/ /var/backups/digisante}"
DISK_THRESHOLD="${DISK_THRESHOLD:-85}"
JOB_LOGS="${JOB_LOGS:-/var/log/digisante/med_reminders.log /var/log/digisante/appt_reminders.log /var/log/digisante/vaccination_reminders.log /var/log/digisante/maternity_reminders.log /var/log/digisante/notify_dispatch.log /var/log/digisante/reconcile.log /var/log/digisante/pg_dump.log}"
API_LOG="${API_LOG:-/var/log/digisante/api-error.log /var/log/digisante/api-out.log}"
PSQL="${PSQL:-sudo -u postgres psql -d digisante -At}"
BACKLOG_MAX="${BACKLOG_MAX:-100}"
WEBHOOK_401_MAX="${WEBHOOK_401_MAX:-5}"
PROVIDER_ERR_MAX="${PROVIDER_ERR_MAX:-3}"
DOMAIN="${DOMAIN:-}"
STATE_DIR="${STATE_DIR:-/var/lib/digisante}"
STATE="${STATE_DIR}/healthwatch.state"
ALERT_CMD="${ALERT_CMD:-}"

install -d -m 0700 "$STATE_DIR"
declare -A NOW=()
check() { NOW["$1"]="$2"; printf '%-10s %-8s %s\n' "$1" "${2%%|*}" "${2#*|}"; }

# 1. Readiness (DB + Redis)
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${API_URL}/api/v1/ready" || true)"
[[ "$code" == "200" ]] && check ready "OK|DB + Redis joignables" || check ready "ALERTE|/ready HTTP ${code:-000} (DB ou Redis indisponible, ou API arrêtée)"

# 2. PM2 : api ×2 + web
if [[ "$PM2_CHECK" == "1" ]]; then
  read -r api web < <(sudo -u "$APP_USER" pm2 jlist 2>/dev/null | node -e '
    let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let l=[];try{l=JSON.parse(d)}catch{}
    const n=(x)=>l.filter(p=>p.name===x&&p.pm2_env&&p.pm2_env.status==="online").length;
    console.log(n("digisante-api"),n("digisante-web"))})' || echo "0 0")
  [[ "$api" == "2" && "$web" == "1" ]] && check pm2 "OK|api ${api}/2, web ${web}/1" || check pm2 "ALERTE|api ${api}/2, web ${web}/1 en ligne"
fi

# 3. Espace disque (racine + sauvegardes)
worst=0; where=""
for p in $DISK_PATHS; do
  [[ -e "$p" ]] || continue
  use="$(df -P "$p" | awk 'NR==2{gsub("%","",$5);print $5}')"
  (( use > worst )) && { worst=$use; where=$p; }
done
(( worst < DISK_THRESHOLD )) && check disk "OK|max ${worst}% (seuil ${DISK_THRESHOLD}%)" || check disk "ALERTE|${where} à ${worst}% (seuil ${DISK_THRESHOLD}%)"

# 4. Fraîcheur de la sauvegarde (base ET fichiers du même horodatage)
last="$(ls -1t "$BACKUP_DIR"/digisante_2*.sql.gz.enc 2>/dev/null | head -1 || true)"
if [[ -z "$last" ]]; then
  check backup "ALERTE|aucune sauvegarde dans ${BACKUP_DIR}"
else
  age_h=$(( ( $(date +%s) - $(stat -c %Y "$last") ) / 3600 ))
  stamp="$(basename "$last" | sed 's/digisante_\(.*\)\.sql\.gz\.enc/\1/')"
  if (( age_h > BACKUP_MAX_AGE_H )); then check backup "ALERTE|dernière sauvegarde il y a ${age_h} h"
  elif [[ ! -f "$BACKUP_DIR/digisante_files_${stamp}.tar.gz.enc" ]]; then check backup "ALERTE|archive fichiers absente pour ${stamp}"
  else check backup "OK|${stamp} (${age_h} h)"; fi
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
  end="$(echo | openssl s_client -connect "${DOMAIN}:443" -servername "$DOMAIN" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || true)"
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
  body="DigiSanté — $(hostname) — $(date -Is)"$'\n'"${msg}"$'\n'"Runbook : docs/RUNBOOK_Alertes.md"
  logger -t digisante-healthwatch -- "$(printf '%s' "$msg" | tr '\n' ' ')" 2>/dev/null || true
  if [[ -n "$ALERT_CMD" ]]; then printf '%s\n' "$body" | bash -c "$ALERT_CMD" || echo "échec de ALERT_CMD" >&2; fi
  printf '\n%s\n' "$body"
fi
