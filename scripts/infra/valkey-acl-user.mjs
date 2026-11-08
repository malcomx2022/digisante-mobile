// Crée/met à jour un utilisateur ACL Valkey/Redis avec les règles de provision-ionos.sh
// (bloc `valkey-acl`, source unique) — utilisé par la CI pour rejouer la suite API sous
// l'utilisateur et le préfixe d'un environnement. Aucune dépendance : RESP sur node:net.
//   VALKEY_APP_PASSWORD=… node scripts/infra/valkey-acl-user.mjs <url-admin> <utilisateur> <préfixe>
// Le mot de passe passe par l'environnement (jamais en argument) et seule son empreinte
// SHA-256 part au serveur, comme au provisioning.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';

const PROVISION = fileURLToPath(new URL('../../infra/deploy/scripts/provision-ionos.sh', import.meta.url));

export function aclRules(prefix) {
  const r = spawnSync('bash', ['-c', `set -euo pipefail; eval "$(sed -n '/^# >>> valkey-acl/,/^# <<< valkey-acl/p' "$1")"; valkey_acl_rules "$2"`, '_', PROVISION, prefix], { encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout.trim()) throw new Error('bloc valkey-acl introuvable dans provision-ionos.sh');
  return r.stdout.trim().split('\n');
}

function command(url, args) {
  const resp = (a) => `*${a.length}\r\n${a.map((x) => `$${Buffer.byteLength(x)}\r\n${x}\r\n`).join('')}`;
  const auth = url.password ? [url.username ? ['AUTH', decodeURIComponent(url.username), decodeURIComponent(url.password)] : ['AUTH', decodeURIComponent(url.password)]] : [];
  const cmds = [...auth, args];
  return new Promise((resolve, reject) => {
    const sock = connect(Number(url.port || 6379), url.hostname);
    let buf = '';
    sock.on('data', (d) => {
      buf += d;
      const lines = buf.split('\r\n').filter(Boolean);
      if (lines.length >= cmds.length) { sock.end(); const last = lines[cmds.length - 1]; (last.startsWith('+') ? resolve(last.slice(1)) : reject(new Error(last.startsWith('-') ? last.slice(1).split(' ')[0] : 'réponse inattendue'))); }
    });
    sock.on('error', reject);
    sock.write(cmds.map(resp).join(''));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [adminUrl, user, prefix] = process.argv.slice(2);
  const password = process.env.VALKEY_APP_PASSWORD ?? '';
  if (!adminUrl || !/^[a-z][a-z0-9-]*$/.test(user ?? '') || !/^[a-z][a-z0-9-]{0,62}:$/.test(prefix ?? '') || password.length < 16) {
    console.error('usage : VALKEY_APP_PASSWORD=… valkey-acl-user.mjs <url-admin> <utilisateur> <préfixe:>');
    process.exit(2);
  }
  const hash = createHash('sha256').update(password).digest('hex');
  await command(new URL(adminUrl), ['ACL', 'SETUSER', user, 'reset', 'on', `#${hash}`, ...aclRules(prefix)]);
  console.log(`utilisateur ACL ${user} : ${prefix}*`);
}
