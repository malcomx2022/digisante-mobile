#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Vérification POST-DÉPLOIEMENT — DigiSanté Mobile (B3 phase 6). LECTURE SEULE sur la
# configuration ; sondes HTTP/WS et journaux. Les tâches mutantes exigent
# --run-jobs + DIGISANTE_ENV=preproduction + VERIFY_JOB_ENVIRONMENT=preproduction.
# Aucun secret affiché. DIGISANTE_ENV (obligatoire) désigne l'environnement contrôlé sur
# l'hôte partagé : noms PM2, crontab /etc/cron.d/digisante[-preprod], copie root, journaux.
#
#   sudo DIGISANTE_ENV=preproduction DOMAIN=preprod.digisantemobile.app \
#        bash /usr/local/lib/digisante-preprod/infra/deploy/scripts/verify_deploy.sh
#   sudo DIGISANTE_ENV=production DOMAIN=digisantemobile.app \
#        bash /usr/local/lib/digisante/infra/deploy/scripts/verify_deploy.sh
# (copie root:root installée par install_root_scripts.sh — B3 : jamais celle de APP_DIR.)
#
# Sortie : une ligne PASS/FAIL/WARN/INFO par contrôle, code 1 si au moins un FAIL. Un
# écart entre le SHA des scripts root installés et le SHA déployé est un WARN : il ne
# fait pas échouer la vérification (relancer install_root_scripts.sh si nécessaire).
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
# donne aussi les chemins PAR DÉFAUT (utilisateur, compte sans droits des tâches, checkout,
# journaux, copie root, configuration, état, sauvegardes, base, crontab, journal
# WebSocket) ; une valeur déjà posée par l'opérateur prime pour ces chemins.
# Chaque script n'utilise qu'une partie de ces variables communes (SC2034 attendu).
# shellcheck disable=SC2034
digisante_profile() {
  local sfx
  case "${DIGISANTE_ENV:-}" in
    preproduction) sfx=-preprod; API_PORT=3101; WEB_PORT=3100; : "${DB_NAME:=digisante_preprod}" ;;
    production) sfx=; API_PORT=3201; WEB_PORT=3200; : "${DB_NAME:=digisante}" ;;
    *) echo "DIGISANTE_ENV requis : preproduction ou production (aucun défaut implicite)" >&2; return 1 ;;
  esac
  PM2_API="digisante${sfx}-api"; PM2_WEB="digisante${sfx}-web"; API_BASE="http://127.0.0.1:${API_PORT}"
  : "${APP_USER:=digisante${sfx}}" "${JOBS_USER:=digisante${sfx}-jobs}"
  : "${APP_DIR:=/var/www/digisante${sfx}}" "${APP_LOG_DIR:=/var/log/digisante${sfx}}"
  : "${ETC_DIR:=/etc/digisante${sfx}}" "${ROOT_LIB:=/usr/local/lib/digisante${sfx}}" "${STATE_DIR:=/var/lib/digisante${sfx}}"
  : "${CRON_LOG_DIR:=/var/log/digisante${sfx}-cron}" "${BACKUP_DIR:=/var/backups/digisante${sfx}}"
  : "${CRON_FILE:=/etc/cron.d/digisante${sfx}}" "${WS_LOG:=/var/log/nginx/digisante${sfx}-ws.log}"
}
# <<< digisante_profile
trusted_path "${BASH_SOURCE[0]}" || { echo "Script lancé depuis un emplacement modifiable par un autre compte : utiliser la copie installée par install_root_scripts.sh" >&2; exit 1; }
SELF_ROOT="$(cd "$(dirname "$(readlink -f -- "${BASH_SOURCE[0]}")")/../../.." && pwd -P)"
digisante_profile || exit 1
[[ "$(readlink -f -- "$ROOT_LIB")" == "$SELF_ROOT" ]] || { echo "[verify] ÉCHEC : copie root d'un autre environnement que ${DIGISANTE_ENV} (${ROOT_LIB} attendu)" >&2; exit 1; }

DOMAIN="${DOMAIN:?Définir DOMAIN (ex. digisante.bj)}"
[[ "$DOMAIN" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ ]] || { echo "Nom de domaine invalide" >&2; exit 1; }
RUN_JOBS=0
if [[ "${1:-}" == "--run-jobs" && $# == 1 ]]; then
  [[ "${VERIFY_JOB_ENVIRONMENT:-}" == "preproduction" && "$DIGISANTE_ENV" == "preproduction" ]] || { echo "Les tâches exigent une préproduction synthétique explicitement déclarée." >&2; exit 1; }
  RUN_JOBS=1
elif (( $# != 0 )); then echo "Option inconnue (seule --run-jobs est autorisée)" >&2; exit 1; fi
# B3 : scripts exécutés par root = copie root:root (ROOT_LIB du profil), jamais APP_DIR.
ROOT_MANIFEST="${ROOT_LIB}/root-scripts.manifest"
JOB="${ROOT_LIB}/infra/deploy/scripts/internal_job.sh"
FAILS=0
WARNS=0

pass() { printf '\033[0;32mPASS\033[0m %s\n' "$*"; }
fail() { printf '\033[0;31mFAIL\033[0m %s\n' "$*"; FAILS=$((FAILS + 1)); }
warn() { printf '\033[0;33mWARN\033[0m %s\n' "$*"; WARNS=$((WARNS + 1)); }
info() { printf 'INFO %s\n' "$*"; }

# 1. PM2 : api ×2 + web de CET environnement, en ligne (`pm2 jlist` de l'utilisateur applicatif)
PM2_JSON="$(sudo -u "$APP_USER" pm2 jlist 2>/dev/null || echo '[]')"
read -r API_ON WEB_ON < <(printf '%s' "$PM2_JSON" | PM2_API="$PM2_API" PM2_WEB="$PM2_WEB" node -e '
  let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let l=[];try{l=JSON.parse(d||"[]");if(!Array.isArray(l))l=[]}catch{};
  const n=(x)=>l.filter(p=>p.name===x&&p.pm2_env&&p.pm2_env.status==="online").length;
  console.log(n(process.env.PM2_API),n(process.env.PM2_WEB))})')
[[ "$API_ON" == "2" ]] && pass "PM2 ${PM2_API} : 2 instances online" || fail "PM2 ${PM2_API} : ${API_ON} instance(s) online (attendu 2)"
[[ "$WEB_ON" == "1" ]] && pass "PM2 ${PM2_WEB} : online" || fail "PM2 ${PM2_WEB} : ${WEB_ON} instance(s) online (attendu 1)"

# 2. Migrations : base à jour
if sudo -u "$APP_USER" bash -c 'cd "$1" && pnpm --filter @digisante/api exec prisma migrate status' _ "$APP_DIR" 2>&1 | grep -q 'up to date'; then
  pass "migrations : base à jour"
else
  fail "migrations : base non à jour (prisma migrate status)"
fi

# 3. Certificat TLS : présent et valide encore ≥ 14 jours
END="$(echo | timeout 15 openssl s_client -verify_return_error -verify_hostname "$DOMAIN" -connect "${DOMAIN}:443" -servername "$DOMAIN" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 )" || END=""
if [[ -n "$END" ]]; then
  DAYS=$(( ( $(date -d "$END" +%s) - $(date +%s) ) / 86400 ))
  (( DAYS >= 14 )) && pass "TLS : certificat valide encore ${DAYS} j" || fail "TLS : expiration dans ${DAYS} j"
else
  fail "TLS : aucun certificat présenté sur ${DOMAIN}:443"
fi

# 4. health / ready via HTTPS (chemin public complet : Nginx → API)
json_status() {
  node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const r=JSON.parse(d);const ok=process.argv[1]==="ready"?r.status==="ready"&&r.db==="up"&&r.redis==="up":r.status==="ok"&&r.service==="digisante-api";process.exit(ok?0:1)}catch{process.exit(1)}})' "$1"
}
if curl -fsS --connect-timeout 5 --max-time 15 "https://${DOMAIN}/api/v1/health" | json_status health; then pass "health : réponse API valide"; else fail "health : KO ou réponse non conforme"; fi
if curl -fsS --connect-timeout 5 --max-time 15 "https://${DOMAIN}/api/v1/ready" | json_status ready; then pass "ready : DB + Redis up"; else fail "ready : KO ou réponse non conforme"; fi

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

# 6. Tâches MUTANTES : aucune émission de notification par défaut.
if (( RUN_JOBS == 1 )); then
  if ! trusted_path "$JOB"; then
    fail "tâches : ${JOB} absent ou modifiable par un autre compte (install_root_scripts.sh)"
  else
    for p in reminders/generate appointments/reminders/generate vaccinations/reminders/generate maternity/reminders/generate notifications/dispatch sync/receipts/prune; do
      if bash "$JOB" "/api/v1/${p}" >/dev/null 2>&1; then pass "tâche /api/v1/${p} : 2xx"; else fail "tâche /api/v1/${p} : échec (voir internal_job.sh)"; fi
    done
  fi
else
  info "Tâches non exécutées : résultat limité aux sondes/configuration, aucune preuve cron métier."
fi

# 7. Toutes les tâches attendues, sans accepter une ligne commentée comme installée.
#    Hôte partagé : la crontab de l'environnement est le fichier ${CRON_FILE} (format
#    cron.d, root:root, non modifiable par autrui — sinon cron l'ignore) ; la crontab
#    root, commune aux autres applications de l'hôte, n'est contrôlée que pour B3.
if [[ -f "$CRON_FILE" && ! -L "$CRON_FILE" ]] && trusted_path "$CRON_FILE"; then
  pass "cron : ${CRON_FILE} présent, non modifiable par un autre compte"
  CRON="$(sed '/^[[:space:]]*#/d' "$CRON_FILE")"
else
  fail "cron : ${CRON_FILE} absent ou modifiable par un autre compte"
  CRON=""
fi
grep -Eq "^[[:space:]]*DIGISANTE_ENV=${DIGISANTE_ENV}[[:space:]]*$" <<<"$CRON" && pass "cron : DIGISANTE_ENV=${DIGISANTE_ENV} déclaré" || fail "cron : DIGISANTE_ENV=${DIGISANTE_ENV} absent de ${CRON_FILE}"
ROOT_CRON="$(crontab -l 2>/dev/null | sed '/^[[:space:]]*#/d' || true)"
for needle in /api/v1/reminders/generate /api/v1/appointments/reminders/generate /api/v1/vaccinations/reminders/generate /api/v1/maternity/reminders/generate /api/v1/notifications/dispatch /api/v1/sync/receipts/prune 'certbot renew' \
  "${ROOT_LIB}/infra/deploy/scripts/internal_job.sh" "${ROOT_LIB}/infra/deploy/scripts/pg_dump_encrypted.sh" "${ROOT_LIB}/infra/deploy/scripts/fedapay_reconcile.sh" "${ROOT_LIB}/infra/deploy/scripts/healthwatch.sh"; do
  grep -Fq "$needle" <<<"$CRON" && pass "cron : ${needle}" || fail "cron : ${needle} absent"
done
# B3 : la crontab root ne lance rien depuis APP_DIR et n'écrit pas dans le répertoire de
# journaux de l'utilisateur applicatif (un lien symbolique y détournerait l'écriture root).
# (API_ENV_FILE/API_DIR désignent le .env LU COMME DONNÉE par la sauvegarde — B4 : exclus.)
ALL_CRON="${CRON}"$'\n'"${ROOT_CRON}"
CRON_EXEC="$(sed -E 's/(^|[[:space:]])(API_ENV_FILE|API_DIR)=[^[:space:]]*//g' <<<"$ALL_CRON")"
grep -Fq "${APP_DIR%/}/" <<<"$CRON_EXEC" && fail "cron : chemin sous ${APP_DIR} (modifiable par ${APP_USER}) exécuté par root" || pass "cron : aucun chemin sous ${APP_DIR}"
grep -Eq ">>?[[:space:]]*${APP_LOG_DIR%/}/" <<<"$ALL_CRON" && fail "cron : journal root écrit dans ${APP_LOG_DIR} (répertoire de ${APP_USER})" || pass "cron : journaux root hors de ${APP_LOG_DIR}"
# B3 : requêtes des tâches (internal_job.sh, fedapay_reconcile.sh) sous un compte sans droits,
# ni root ni l'utilisateur applicatif ; absent ⇒ ces tâches journalisent ÉCHEC sans requête.
if JOBS_UID="$(id -u -- "$JOBS_USER" 2>/dev/null)" && JOBS_GID="$(id -g -- "$JOBS_USER" 2>/dev/null)"; then
  APP_UID="$(id -u -- "$APP_USER" 2>/dev/null || true)"; APP_GID="$(id -g -- "$APP_USER" 2>/dev/null || true)"
  if [[ "$JOBS_UID" == 0 || "$JOBS_GID" == 0 || "$JOBS_UID" == "$APP_UID" || "$JOBS_GID" == "$APP_GID" ]]; then
    fail "tâches : compte ${JOBS_USER} = root ou utilisateur/groupe applicatif ${APP_USER}"
  else
    pass "tâches : requêtes sous ${JOBS_USER} (uid ${JOBS_UID}), ni root ni ${APP_USER}"
  fi
else
  fail "tâches : compte sans droits ${JOBS_USER} absent (provisionnement) — tâches en ÉCHEC"
fi
setpriv --help 2>/dev/null | grep -q -- '--no-new-privs' && pass "tâches : setpriv (util-linux) disponible" || fail "tâches : setpriv --no-new-privs indisponible"

# 7 bis. Scripts root installés (B3) : intégrité de la copie root, SHA comparé au déployé.
manifest_re='^file=([A-Za-z0-9._/-]+) mode=(0755|0644) sha256=([0-9a-f]{64})$'
if [[ -f "$ROOT_MANIFEST" && ! -L "$ROOT_MANIFEST" ]] && trusted_path "$ROOT_MANIFEST"; then
  INSTALLED_SHA="$(sed -n 's/^sha=\([0-9a-f]\{40\}\)$/\1/p' "$ROOT_MANIFEST")"
  INSTALLED_ENV="$(sed -n 's/^environment=\(preproduction\|production\)$/\1/p' "$ROOT_MANIFEST")"
  bad=0; total=0; drift=0
  while IFS= read -r line; do
    [[ "$line" =~ $manifest_re ]] || continue
    rel="${BASH_REMATCH[1]}"; want="${BASH_REMATCH[3]}"; total=$((total + 1))
    if [[ "/$rel/" == */../* ]] || ! trusted_path "${ROOT_LIB}/${rel}" || [[ "$(sha256sum "${ROOT_LIB}/${rel}" | cut -d' ' -f1)" != "$want" ]]; then bad=$((bad + 1)); continue; fi
    # Contenu du checkout déployé lu comme DONNÉES (empreinte), jamais exécuté.
    if [[ ! -f "${APP_DIR}/${rel}" || "$(sha256sum "${APP_DIR}/${rel}" | cut -d' ' -f1)" != "$want" ]]; then drift=$((drift + 1)); fi
  done < "$ROOT_MANIFEST"
  if [[ -z "$INSTALLED_SHA" || "$total" == 0 || "$bad" != 0 ]]; then
    fail "scripts root : installation ${ROOT_LIB} incomplète ou altérée (${bad}/${total} fichier(s)) — relancer install_root_scripts.sh"
  elif [[ "$INSTALLED_ENV" != "$DIGISANTE_ENV" ]]; then
    fail "scripts root : ${ROOT_LIB} installé pour l'environnement « ${INSTALLED_ENV:-inconnu} », attendu ${DIGISANTE_ENV} — relancer DIGISANTE_ENV=${DIGISANTE_ENV} install_root_scripts.sh"
  else
    pass "scripts root : ${total} fichier(s) root:root conformes au manifeste (${INSTALLED_SHA})"
    # git exécuté SOUS L'IDENTITÉ applicative (jamais root dans un dépôt qu'elle contrôle) ;
    # sortie non fiable : seul un SHA de 40 hex est retenu.
    DEPLOYED_SHA="$(sudo -u "$APP_USER" git -C "$APP_DIR" rev-parse HEAD 2>/dev/null || true)"
    [[ "$DEPLOYED_SHA" =~ ^[0-9a-f]{40}$ ]] || DEPLOYED_SHA=""
    if [[ "$DEPLOYED_SHA" == "$INSTALLED_SHA" ]]; then
      pass "scripts root : même SHA que le déploiement"
    else
      warn "scripts root installés au SHA ${INSTALLED_SHA}, déployé ${DEPLOYED_SHA:-inconnu} ; ${drift} fichier(s) diffèrent du checkout — si > 0 : sudo DIGISANTE_ENV=${DIGISANTE_ENV} ${ROOT_LIB}/infra/deploy/scripts/install_root_scripts.sh ${DEPLOYED_SHA:-<SHA>}"
    fi
  fi
else
  fail "scripts root : manifeste ${ROOT_MANIFEST} absent ou non fiable — crons root sans copie installée (install_root_scripts.sh)"
fi

# 8. Informations (non bloquantes ici, suivies ailleurs)
curl -sSI --connect-timeout 5 --max-time 15 "https://${DOMAIN}/" | grep -qi '^strict-transport-security' && info "HSTS présent" || info "HSTS absent (PREFLIGHT O1)"
[[ "$(timedatectl show -p Timezone --value 2>/dev/null)" == "Africa/Porto-Novo" ]] && pass "fuseau Africa/Porto-Novo" || fail "fuseau ≠ Africa/Porto-Novo"
[[ "$(stat -c '%a' "${APP_DIR}/apps/api/.env" 2>/dev/null)" == "600" ]] && pass ".env API en 600" || fail ".env API absent ou permissions ≠ 600"
# Revue GO du 22/10/2026 : l'API tourne sous le rôle d'exécution <base>_app, jamais sous le
# propriétaire (migrations seulement, URL fournie au déploiement). Fichier lu comme DONNÉE
# (parseEnv, sans suivre de lien) ; seul le NOM d'utilisateur est extrait, jamais affiché d'autre.
API_DB_USER="$(node -e '
  const fs = require("node:fs"); const { parseEnv } = require("node:util"); const file = process.argv[1];
  try { if (fs.realpathSync(file) !== file) process.exit(3); } catch { process.exit(3); }
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  const env = parseEnv(fs.readFileSync(fd, "utf8"));
  if (Object.hasOwn(env, "MIGRATION_DATABASE_URL")) process.exit(4);
  process.stdout.write(decodeURIComponent(new URL(env.DATABASE_URL).username).replace(/[^a-z0-9_]/g, "?"));' "${APP_DIR}/apps/api/.env" 2>/dev/null || echo "?")"
# Base CANONIQUE du profil (même règle que deploy.sh), jamais un DB_NAME surchargé.
RUN_ROLE="$(unset DB_NAME; digisante_profile && printf '%s_app' "$DB_NAME")"
[[ "$API_DB_USER" == "$RUN_ROLE" ]] && pass "API sous le rôle d'exécution ${RUN_ROLE} (non propriétaire)" \
  || fail "API (.env) sous ${API_DB_USER:-?} au lieu de ${RUN_ROLE}, ou URL du propriétaire présente dans le .env"
# Valkey partagé : utilisateur ACL et préfixe de CET environnement (droits mesurés par
# provision-ionos.sh --verify, ACL DRYRUN) ; jamais l'utilisateur default de l'hôte.
if [[ "$DIGISANTE_ENV" == production ]]; then VALKEY_APP_USER=digisante; else VALKEY_APP_USER=digisante-preprod; fi
API_VALKEY="$(node -e '
  const fs = require("node:fs"); const { parseEnv } = require("node:util"); const file = process.argv[1];
  try { if (fs.realpathSync(file) !== file) process.exit(3); } catch { process.exit(3); }
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  const env = parseEnv(fs.readFileSync(fd, "utf8"));
  const clean = (v) => String(v ?? "").replace(/[^a-z0-9:-]/g, "?");
  process.stdout.write(`${clean(decodeURIComponent(new URL(env.REDIS_URL).username))} ${clean(env.REDIS_KEY_PREFIX)}`);' "${APP_DIR}/apps/api/.env" 2>/dev/null || echo "? ?")"
[[ "$API_VALKEY" == "${VALKEY_APP_USER} ${VALKEY_APP_USER}:" ]] && pass "API sous l'utilisateur ACL Valkey ${VALKEY_APP_USER}, préfixe ${VALKEY_APP_USER}:" \
  || fail "API (.env) : utilisateur Valkey/préfixe « ${API_VALKEY} » au lieu de « ${VALKEY_APP_USER} ${VALKEY_APP_USER}: »"

echo
if (( FAILS > 0 )); then echo "❌ ${FAILS} contrôle(s) en échec (${WARNS} avertissement(s))"; exit 1; fi
echo "Vérification des sondes/configuration : PASS (tâches exécutées=${RUN_JOBS}, avertissements=${WARNS}) ; ni recette fournisseur, ni GO pilote."
