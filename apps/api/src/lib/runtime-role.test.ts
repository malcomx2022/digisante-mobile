// Rôle PostgreSQL d'exécution NON propriétaire (revue GO du 22/10/2026) — PostgreSQL réel.
// Exécute le SQL des droits EXTRAIT de deploy.sh (source unique, appliquée après chaque
// migration sous le rôle propriétaire), puis vérifie sous le rôle d'exécution que l'audit
// s'écrit par le code applicatif mais que ni UPDATE, ni DELETE, ni TRUNCATE, ni la
// désactivation des triggers ne sont possibles sur les registres append-only.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { writeAudit } from './audit.js';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const DEPLOY_SH = fileURLToPath(new URL('../../../../infra/deploy/scripts/deploy.sh', import.meta.url));

function grantsSql(): string {
  const text = readFileSync(DEPLOY_SH, 'utf8');
  const block = text.slice(text.indexOf('# >>> runtime-grants.sql'), text.indexOf('# <<< runtime-grants.sql'));
  const start = block.indexOf("<<'SQL'\n");
  const end = block.lastIndexOf('\nSQL\n');
  if (start < 0 || end < 0) throw new Error('bloc runtime-grants.sql introuvable dans deploy.sh');
  return block.slice(start + "<<'SQL'\n".length, end + 1);
}

describe.skipIf(!HAS_INFRA)('Rôle PostgreSQL d’exécution non propriétaire', () => {
  const base = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid');
  const role = `dsrt_app_${randomBytes(4).toString('hex')}`;
  const password = randomBytes(18).toString('base64url');
  const pgEnv = {
    ...process.env, PGHOST: base.hostname, PGPORT: base.port || '5432', PGDATABASE: base.pathname.slice(1),
    PGUSER: decodeURIComponent(base.username), PGPASSWORD: decodeURIComponent(base.password),
  };
  const psql = (sql: string, vars: string[] = []) =>
    spawnSync('psql', ['-X', '-q', '-A', '-t', ...vars.flatMap((v) => ['-v', v])], { input: sql, env: pgEnv, encoding: 'utf8' });
  const applyGrants = () => psql(grantsSql(), [`app_role=${role}`]);
  let app: PrismaClient;

  beforeAll(async () => {
    const created = psql(`CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}';`);
    expect(created.status, created.stderr).toBe(0);
    const url = new URL(base);
    url.username = role; url.password = password;
    app = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  });

  afterAll(async () => {
    await app?.$disconnect();
    psql(`DROP OWNED BY "${role}"; DROP ROLE IF EXISTS "${role}";`);
  });

  it('droits appliqués et contrôlés (idempotent : deux passages)', () => {
    for (let i = 0; i < 2; i++) {
      const r = applyGrants();
      expect(r.status, r.stderr + r.stdout).toBe(0);
    }
  });

  it('l’API écrit l’audit et le DML courant sous le rôle d’exécution', async () => {
    await writeAudit(app, { action: 'RUNTIME_ROLE_PROBE', meta: { probe: true } });
    expect(await app.auditLog.count({ where: { action: 'RUNTIME_ROLE_PROBE' } })).toBeGreaterThan(0);
    const phone = `+2290199${randomBytes(3).readUIntBE(0, 3).toString().padStart(6, '0').slice(0, 6)}`;
    const user = await app.user.create({ data: { phone, role: 'PATIENT', status: 'ACTIVE' } });
    await app.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });
    await app.user.delete({ where: { id: user.id } });
  });

  it.each([
    ['UPDATE audit_logs', 'UPDATE audit_logs SET ip = ip'],
    ['DELETE audit_logs', 'DELETE FROM audit_logs'],
    ['TRUNCATE audit_logs', 'TRUNCATE audit_logs'],
    ['désactiver les triggers d’audit', 'ALTER TABLE audit_logs DISABLE TRIGGER USER'],
    ['UPDATE finance_entries', 'UPDATE finance_entries SET net = net'],
    ['DELETE finance_entries', 'DELETE FROM finance_entries'],
    ['TRUNCATE finance_entries', 'TRUNCATE finance_entries'],
    ['désactiver les triggers du registre financier', 'ALTER TABLE finance_entries DISABLE TRIGGER USER'],
    ['lire la table des migrations', 'SELECT count(*) FROM "_prisma_migrations"'],
    ['créer une table', 'CREATE TABLE runtime_role_probe (id int)'],
  ])('refusé par les DROITS (pas seulement par un trigger) : %s', async (_label, sql) => {
    // 42501 = insufficient_privilege ; « must be owner » pour ALTER TABLE.
    await expect(app.$executeRawUnsafe(sql)).rejects.toThrow(/permission denied|must be owner|42501/);
  });

  it('rôle d’exécution privilégié : contrôle en échec, rien n’est validé', () => {
    expect(psql(`ALTER ROLE "${role}" CREATEDB;`).status).toBe(0);
    try {
      const r = applyGrants();
      expect(r.status).not.toBe(0);
      expect(r.stdout + r.stderr).toMatch(/non conforme/);
    } finally {
      expect(psql(`ALTER ROLE "${role}" NOCREATEDB;`).status).toBe(0);
    }
  });
});
