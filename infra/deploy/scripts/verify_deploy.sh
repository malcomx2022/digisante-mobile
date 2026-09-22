#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Vérification POST-DÉPLOIEMENT — DigiSanté Mobile (B3 phase 6). LECTURE SEULE sur la
# configuration ; seuls les générateurs/dispatch sont déclenchés (tâches idempotentes,
# celles que cron lance de toute façon). N'affiche AUCUN secret.
#
#   sudo DOMAIN=digisante.bj bash infra/deploy/scripts/verify_deploy.sh
#
# Sortie : une ligne PASS/FAIL/INFO par contrôle, code 1 si au moins un FAIL.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

DOMAIN="${DOMAIN:?Définir DOMAIN (ex. digisante.bj)}"
APP_DIR="${APP_DIR:-/var/www/digisante-mobile}"
APP_USER="${APP_USER:-digisante}"
WS_LOG="${WS_LOG:-/var/log/nginx/digisante-ws.log}"
JOB="${APP_DIR}/infra/deploy/scripts/internal_job.sh"
FAILS=0

pass() { printf '\033[0;32mPASS\033[0m %s\n' "$*"; }
fail() { printf '\033[0;31mFAIL\033[0m %s\n' "$*"; FAILS=$((FAILS + 1)); }
info() { printf 'INFO %s\n' "$*"; }

# 1. PM2 : api ×2 + web, en ligne (parse du JSON de `pm2 jlist` de l'utilisateur applicatif)
PM2_JSON="$(sudo -u "$APP_USER" pm2 jlist 2>/dev/null || echo '[]')"
read -r API_ON WEB_ON < <(printf '%s' "$PM2_JSON" | node -e '
  let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const l=JSON.parse(d||"[]");
  const n=(x)=>l.filter(p=>p.name===x&&p.pm2_env&&p.pm2_env.status==="online").length;
  console.log(n("digisante-api"),n("digisante-web"))})')
[[ "$API_ON" == "2" ]] && pass "PM2 digisante-api : 2 instances online" || fail "PM2 digisante-api : ${API_ON} instance(s) online (attendu 2)"
[[ "$WEB_ON" == "1" ]] && pass "PM2 digisante-web : online" || fail "PM2 digisante-web : ${WEB_ON} instance(s) online (attendu 1)"

# 2. Migrations : base à jour
if sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && pnpm --filter @digisante/api exec prisma migrate status" 2>&1 | grep -q 'up to date'; then
  pass "migrations : base à jour"
else
  fail "migrations : base non à jour (prisma migrate status)"
fi

# 3. Certificat TLS : présent et valide encore ≥ 14 jours
END="$(echo | openssl s_client -connect "${DOMAIN}:443" -servername "$DOMAIN" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || true)"
if [[ -n "$END" ]]; then
  DAYS=$(( ( $(date -d "$END" +%s) - $(date +%s) ) / 86400 ))
  (( DAYS >= 14 )) && pass "TLS : certificat valide encore ${DAYS} j" || fail "TLS : expiration dans ${DAYS} j"
else
  fail "TLS : aucun certificat présenté sur ${DOMAIN}:443"
fi

# 4. health / ready via HTTPS (chemin public complet : Nginx → API)
curl -fsS "https://${DOMAIN}/api/v1/health" >/dev/null && pass "health : 200" || fail "health : KO"
READY="$(curl -sS -o /dev/null -w '%{http_code}' "https://${DOMAIN}/api/v1/ready" || true)"
[[ "$READY" == "200" ]] && pass "ready : 200 (DB + Redis)" || fail "ready : HTTP ${READY}"

# 5. WebSocket : Nginx relaie l'upgrade (101). Jeton volontairement FACTICE : le serveur
#    ferme ensuite en 1008 — on vérifie le relais, puis que la query n'est pas journalisée.
#    (`Sec-WebSocket-Key` = 16 octets en base64, sinon 400 ; curl expire en gardant le
#    socket ouvert — le code HTTP 101 est néanmoins restitué.)
WS_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 --http1.1 \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: ZGlnaXNhbnRlLXByb2JlMQ==' \
  "https://${DOMAIN}/api/v1/chat/ws?token=probe-verify-deploy" || true)"
[[ "$WS_CODE" == "101" ]] && pass "WebSocket : upgrade relayé (101)" || fail "WebSocket : HTTP ${WS_CODE} (attendu 101 — upgrade Nginx ?)"
sleep 1
if [[ -r "$WS_LOG" ]]; then
  N="$(grep -c 'token=' "$WS_LOG" || true)"
  [[ "$N" == "0" ]] && pass "log WS : 0 occurrence de token= (après sonde)" || fail "log WS : ${N} occurrence(s) de token= — JWT journalisés"
else
  fail "log WS introuvable : ${WS_LOG}"
fi

# 6. Générateurs + dispatch : 200 via le jeton de service (jamais affiché)
for p in reminders/generate appointments/reminders/generate vaccinations/reminders/generate maternity/reminders/generate notifications/dispatch; do
  if bash "$JOB" "/api/v1/${p}" >/dev/null 2>&1; then pass "tâche /api/v1/${p} : 2xx"; else fail "tâche /api/v1/${p} : échec (voir internal_job.sh)"; fi
done

# 7. Crontab root installée avec les tâches attendues
CRON="$(crontab -l 2>/dev/null || true)"
for needle in internal_job.sh pg_dump_encrypted.sh fedapay_reconcile.sh 'certbot renew'; do
  grep -q "$needle" <<<"$CRON" && pass "cron : ${needle}" || fail "cron : ${needle} absent"
done

# 8. Informations (non bloquantes ici, suivies ailleurs)
curl -sSI "https://${DOMAIN}/" | grep -qi '^strict-transport-security' && info "HSTS présent" || info "HSTS absent (PREFLIGHT O1)"
[[ "$(timedatectl show -p Timezone --value 2>/dev/null)" == "Africa/Porto-Novo" ]] && pass "fuseau Africa/Porto-Novo" || fail "fuseau ≠ Africa/Porto-Novo"
[[ "$(stat -c '%a' "${APP_DIR}/apps/api/.env" 2>/dev/null)" == "600" ]] && pass ".env API en 600" || fail ".env API absent ou permissions ≠ 600"

echo
if (( FAILS > 0 )); then echo "❌ ${FAILS} contrôle(s) en échec"; exit 1; fi
echo "✅ Vérification post-déploiement : tous les contrôles bloquants sont PASS"
