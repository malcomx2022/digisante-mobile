// ─────────────────────────────────────────────────────────────
// Chaîne d'alerte de la réconciliation FedaPay (B2, revue indépendante 13/10/2026).
// Contrat : l'API répond NON 2xx dès qu'un paiement du lot échoue (500
// RECONCILE_PARTIAL_FAILURE + compteurs) ⇒ `fedapay_reconcile.sh` journalise
// ÉCHEC et sort 1 ⇒ la sonde `cron` de healthwatch alerte dès 1 échec. Un échec
// isolé n'atteint PAS le seuil de la sonde `providers` (3 lignes par passage) :
// sans réponse non 2xx, il serait silencieux. API et réseau simulés (faux curl),
// aucun service réel contacté.
// ─────────────────────────────────────────────────────────────
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SYNTHETIC_TOKEN = 'synthetic-reconcile-token-0000';

function fixture({ code, body }) {
  const dir = mkdtempSync(join(tmpdir(), 'digisante-reconcile-'));
  chmodSync(dir, 0o755); // faux outils exécutables par le compte sans droits (B3, en root)
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const tokenFile = join(dir, 'reconcile.token');
  writeFileSync(tokenFile, `${SYNTHETIC_TOKEN}\n`);
  chmodSync(tokenFile, 0o600);
  const command = (name, script) => {
    const path = join(bin, name);
    writeFileSync(path, `#!/bin/bash\nset -euo pipefail\n${script}\n`);
    chmodSync(path, 0o755);
  };
  // Faux curl : réponse de /payments/reconcile (code + corps) ; /ready toujours prêt.
  command('curl', `printf '%s\\n' "$*" >> "$ARGV_TRACE"
out=""; url=""
while (($#)); do
  case "$1" in
    -o|-w|-X|--max-time|--connect-timeout) [[ "$1" == -o ]] && out="$2"; shift 2;;
    --config) cat >> "$CONFIG_TRACE"; shift 2;;
    -*) shift;;
    *) url="$1"; shift;;
  esac
done
# Sortie réelle de \`-o -\` + \`-w '\\n%{http_code}'\` : corps puis code sur stdout.
if [[ "$url" == */payments/reconcile ]]; then printf '%s' "$RECONCILE_BODY"; printf '\\n%s' "$RECONCILE_CODE"
else echo '{"status":"ready","db":"up","redis":"up"}'; fi`);
  command('logger', ':');
  command('fixture-psql', 'echo 0');
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    // Profil d'environnement obligatoire ; la copie exécutée est ici le checkout.
    DIGISANTE_ENV: 'preproduction',
    ROOT_LIB: ROOT,
    RECONCILE_TOKEN_FILE: tokenFile,
    RECONCILE_CODE: String(code),
    RECONCILE_BODY: body,
    ARGV_TRACE: join(dir, 'argv'),
    CONFIG_TRACE: join(dir, 'config'),
    // B3 : lancé par root, la requête part sous ce compte sans droits (traces accessibles).
    ...(process.getuid?.() === 0 ? { JOBS_USER: 'daemon' } : {}),
  };
  for (const trace of [env.ARGV_TRACE, env.CONFIG_TRACE]) { writeFileSync(trace, ''); chmodSync(trace, 0o666); }
  const log = join(dir, 'reconcile.log');
  const apiLog = join(dir, 'api-out.log');
  const run = (script, extra = {}) =>
    spawnSync('bash', [resolve(ROOT, 'infra/deploy/scripts', script)], { env: { ...env, ...extra }, encoding: 'utf8', timeout: 20_000 });
  const healthwatch = () =>
    run('healthwatch.sh', {
      STATE_DIR: join(dir, 'state'), HEALTHWATCH_CONF: join(dir, 'no-conf'), ALERT_CMD: '', DOMAIN: '', PM2_CHECK: '0',
      DISK_PATHS: dir, BACKUP_DIR: join(dir, 'backups'), JOB_LOGS: log, API_LOG: apiLog, PSQL: join(bin, 'fixture-psql'),
    });
  return { dir, log, apiLog, run, healthwatch, clean: () => rmSync(dir, { recursive: true, force: true }) };
}

test('réconciliation : un paiement en échec (HTTP 500 + failed) ⇒ ÉCHEC, sortie 1, alerte cron ; providers seul resterait muet', () => {
  const body = JSON.stringify({ code: 'RECONCILE_PARTIAL_FAILURE', message: 'Réconciliation incomplète : paiement(s) en échec, lot poursuivi', scanned: 2, resolved: 1, failed: 1 });
  const f = fixture({ code: 500, body });
  try {
    const r = f.run('fedapay_reconcile.sh');
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stdout, /ÉCHEC réconciliation \(HTTP 500\)/);
    assert.match(r.stdout, /"failed":1/);
    // Jeton transmis par `--config -` (stdin), jamais en argument (absent de `ps`).
    assert.doesNotMatch(readFileSync(join(f.dir, 'argv'), 'utf8'), new RegExp(SYNTHETIC_TOKEN));
    assert.match(readFileSync(join(f.dir, 'config'), 'utf8'), new RegExp(`X-Service-Token: ${SYNTHETIC_TOKEN}`));
    // Redirection cron : `>> /var/log/digisante/reconcile.log 2>&1`.
    writeFileSync(f.log, r.stdout + r.stderr);
    // Une seule ligne fournisseur pour ce paiement (journal pino de l'API).
    writeFileSync(f.apiLog, `${JSON.stringify({ level: 50, paymentId: 'cuid-synthetic', job: 'reconcile', msg: '[FedaPay] réconciliation : paiement en échec, lot poursuivi' })}\n`);
    const h = f.healthwatch();
    assert.equal(h.status, 0, h.stderr);
    assert.match(h.stdout, /cron +ALERTE +1 échec/);
    assert.match(h.stdout, /providers +OK +1 erreur/);
  } finally {
    f.clean();
  }
});

test('réconciliation : lot complet (HTTP 200, failed 0) ⇒ acceptée, sortie 0, sonde cron OK', () => {
  const f = fixture({ code: 200, body: JSON.stringify({ scanned: 2, resolved: 2, failed: 0 }) });
  try {
    const r = f.run('fedapay_reconcile.sh');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Réconciliation acceptée \(HTTP 200\)/);
    writeFileSync(f.log, r.stdout + r.stderr);
    writeFileSync(f.apiLog, '');
    const h = f.healthwatch();
    assert.equal(h.status, 0, h.stderr);
    assert.match(h.stdout, /cron +OK +aucune tâche en échec/);
  } finally {
    f.clean();
  }
});
