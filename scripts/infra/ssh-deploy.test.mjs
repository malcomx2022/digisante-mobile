// scripts/deploy/ssh-deploy.sh — transmission du secret de migration par l'entrée standard SSH.
// ssh et ssh-keyscan simulés (aucun réseau) ; ssh-keygen RÉEL pour l'empreinte de la clé d'hôte.
// Le faux ssh rejoue la commande distante en local avec la même entrée standard : on vérifie
// donc qu'elle FONCTIONNE (secret reçu, script exécuté) et qu'aucun secret n'est en argument.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const SCRIPT = fileURLToPath(new URL('../deploy/ssh-deploy.sh', import.meta.url));
const SECRET = 'postgresql://digisante_preprod:SYNTHETIC_OWNER_SECRET_42@127.0.0.1:5432/digisante_preprod?schema=public';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'digisante-ssh-deploy-'));
  const bin = join(dir, 'bin'); mkdirSync(bin);
  const trace = join(dir, 'trace'); writeFileSync(trace, '');
  const keygen = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(dir, 'hostkey')], { encoding: 'utf8' });
  assert.equal(keygen.status, 0, keygen.stderr);
  const hostPub = readFileSync(join(dir, 'hostkey.pub'), 'utf8').trim().split(' ').slice(0, 2).join(' ');
  const fingerprint = spawnSync('ssh-keygen', ['-l', '-E', 'sha256', '-f', join(dir, 'hostkey.pub')], { encoding: 'utf8' }).stdout.split(' ')[1];
  const fakes = {
    'ssh-keyscan': `echo "keyscan $*" >> "$TRACE"; echo "\${@: -1} ${hostPub}"`,
    // Rejoue la commande distante (dernier argument) avec la même entrée standard.
    ssh: `printf 'ssh-arg %s\\n' "$@" >> "$TRACE"; exec bash -c "\${@: -1}"`,
  };
  for (const [name, body] of Object.entries(fakes)) { writeFileSync(join(bin, name), `#!/usr/bin/env bash\nset -eu\n${body}\n`); chmodSync(join(bin, name), 0o755); }
  const remote = join(dir, 'remote.sh');
  // Script distant de test : trace la candidate, la présence du secret et une entrée standard coupée.
  writeFileSync(remote, `printf 'remote candidate=%s\\n' "$CANDIDATE_SHA" >> "$TRACE"\n[[ "$MIGRATION_DATABASE_URL" == "$EXPECTED_SECRET" ]] && printf 'remote secret=ok\\n' >> "$TRACE"\nif IFS= read -r _x; then echo 'remote stdin=open' >> "$TRACE"; else echo 'remote stdin=closed' >> "$TRACE"; fi\n`);
  const env = { PATH: `${bin}:${process.env.PATH}`, TRACE: trace, HOME: dir, EXPECTED_SECRET: SECRET,
    VPS_HOST: 'preprod.example.invalid', VPS_USER: 'digisante-preprod', VPS_SSH_KEY: 'SYNTHETIC-PRIVATE-KEY', VPS_FINGERPRINT: fingerprint, MIGRATION_DATABASE_URL: SECRET };
  return {
    fingerprint,
    run: (args = [`CANDIDATE_SHA=${'a'.repeat(40)}`], extra = {}) => spawnSync('bash', [SCRIPT, remote, ...args], { env: { ...env, ...extra }, encoding: 'utf8', timeout: 20_000 }),
    trace: () => readFileSync(trace, 'utf8'),
    clean: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('ssh-deploy : secret par l’entrée standard, jamais en argument ; script distant exécuté, entrée coupée', () => {
  const f = fixture();
  try {
    const r = f.run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const trace = f.trace();
    assert.match(trace, /^remote candidate=a{40}$/m);
    assert.match(trace, /^remote secret=ok$/m);
    assert.match(trace, /^remote stdin=closed$/m);
    const args = trace.split('\n').filter((l) => l.startsWith('ssh-arg ')).join('\n');
    assert.ok(args.length > 0);
    assert.ok(!args.includes('SYNTHETIC_OWNER_SECRET_42') && !args.includes('SYNTHETIC-PRIVATE-KEY'), args);
    assert.match(args, /^ssh-arg StrictHostKeyChecking=yes$/m);
    assert.match(args, /^ssh-arg digisante-preprod@preprod\.example\.invalid$/m);
    assert.doesNotMatch(r.stdout + r.stderr, /SYNTHETIC_OWNER_SECRET_42/);
  } finally { f.clean(); }
});

test('ssh-deploy : empreinte d’hôte différente ⇒ aucune connexion ni secret envoyé', () => {
  const f = fixture();
  try {
    const r = f.run(undefined, { VPS_FINGERPRINT: 'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /ne correspond à VPS_FINGERPRINT/);
    assert.doesNotMatch(f.trace(), /^ssh-arg /m);
    // Empreinte sans le préfixe SHA256: acceptée (format des secrets existants).
    const ok = f.run(undefined, { VPS_FINGERPRINT: f.fingerprint.replace(/^SHA256:/, '') });
    assert.equal(ok.status, 0, ok.stderr);
  } finally { f.clean(); }
});

test('ssh-deploy : secret absent ou multi-ligne, affectation non sûre, bash -x ⇒ refus avant connexion', () => {
  const f = fixture();
  try {
    for (const [args, extra] of [
      [undefined, { MIGRATION_DATABASE_URL: '' }],
      [undefined, { MIGRATION_DATABASE_URL: `${SECRET}\nDROP` }],
      [['CANDIDATE_SHA=$(id)'], {}],
      [['candidate=abc'], {}],
      [undefined, { VPS_HOST: 'host;rm -rf /' }],
    ]) {
      const r = f.run(args, extra);
      assert.notEqual(r.status, 0, JSON.stringify([args, extra]));
      assert.doesNotMatch(f.trace(), /^ssh-arg /m);
    }
    const traced = spawnSync('bash', ['-x', SCRIPT, '/dev/null'], { env: { PATH: process.env.PATH, MIGRATION_DATABASE_URL: SECRET }, encoding: 'utf8' });
    assert.notEqual(traced.status, 0);
    assert.doesNotMatch(traced.stderr, /SYNTHETIC_OWNER_SECRET_42/);
  } finally { f.clean(); }
});

test('workflows : plus d’appleboy, secret de migration seulement en variable d’environnement de l’étape', () => {
  for (const [file, secret] of [['.github/workflows/ci.yml', 'DB_MIGRATION_URL'], ['.github/workflows/preproduction.yml', 'PREPROD_DB_MIGRATION_URL']]) {
    const text = readFileSync(fileURLToPath(new URL(`../../${file}`, import.meta.url)), 'utf8');
    assert.doesNotMatch(text, /uses:\s*appleboy\//, file);
    const refs = text.split('\n').filter((l) => l.includes(`secrets.${secret}`));
    // Contrôle de présence + variable de l'étape de déploiement ; jamais dans un script ni en argument.
    assert.equal(refs.length, 2, file);
    for (const l of refs) assert.match(l, new RegExp(`^\\s+[A-Z_]+: \\$\\{\\{ secrets\\.${secret} \\}\\}$`), `${file} : ${l}`);
    assert.match(text, /bash scripts\/deploy\/ssh-deploy\.sh "\$remote"/, file);
  }
});
