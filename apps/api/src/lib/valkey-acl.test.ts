// Isolement Valkey (revue GO du 22/10/2026, résiduel 2) — Redis/Valkey RÉEL (Redis ≥ 7).
// Applique les règles ACL EXTRAITES de provision-ionos.sh (source unique) à un utilisateur
// jetable, puis vérifie avec les options de connexion de l'API (lib/redis.ts) :
//  - ce que l'API exécute passe : clés, scripts Lua de l'OTP et du rate-limit, pub/sub préfixé ;
//  - rien d'autre : FLUSH*, KEYS/SCAN, INFO/CONFIG/ACL/CLIENT, clés et canaux hors préfixe,
//    même après SELECT d'un autre index ;
//  - les sondes ACL DRYRUN de `provision-ionos.sh --verify` donnent le même verdict.
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { redisOptions as RedisOptionsFn } from './redis.js';

// Magasin Redis du rate-limit (module CommonJS sans types) : même script Lua qu'en production.
type RateLimitStore = { incr(key: string, cb: (err: Error | null, r: { current: number; ttl: number }) => void, timeWindow: number, max: number): void };
const RedisStore = createRequire(import.meta.url)('@fastify/rate-limit/store/RedisStore.js') as new (continueExceeding: boolean, exponentialBackoff: boolean, redis: Redis, key: string) => RateLimitStore;

const ADMIN_URL = process.env.REDIS_ADMIN_URL || process.env.REDIS_URL;
const PROVISION = fileURLToPath(new URL('../../../../infra/deploy/scripts/provision-ionos.sh', import.meta.url));

function aclRules(prefix: string): string[] {
  const r = spawnSync('bash', ['-c', `set -euo pipefail; eval "$(sed -n '/^# >>> valkey-acl/,/^# <<< valkey-acl/p' "$1")"; valkey_acl_rules "$2"`, '_', PROVISION, prefix], { encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout.trim()) throw new Error(`bloc valkey-acl introuvable dans provision-ionos.sh : ${r.stderr}`);
  return r.stdout.trim().split('\n');
}

describe.skipIf(!ADMIN_URL)('Utilisateur ACL Valkey de l’environnement', () => {
  const tag = randomBytes(4).toString('hex');
  const user = `dsacl-${tag}`;
  const prefix = `dsacl-${tag}:`;
  const password = randomBytes(24).toString('hex');
  const base = new URL(ADMIN_URL ?? 'redis://invalid');
  const asUser = (db = base.pathname || '/1') => {
    const url = new URL(base); url.username = user; url.password = password; url.pathname = db;
    return url.toString();
  };
  // Import différé : lib/redis.ts lit la configuration validée (absente sans infrastructure).
  let redisOptions: typeof RedisOptionsFn;
  let admin: Redis;
  let app: Redis;
  const extra: Redis[] = [];
  const connect = (url: string, opts = {}) => { const c = new Redis(url, { ...redisOptions({ keyPrefix: prefix }), maxRetriesPerRequest: 1, ...opts }); extra.push(c); return c; };

  beforeAll(async () => {
    ({ redisOptions } = await import('./redis.js'));
    admin = new Redis(ADMIN_URL!, { maxRetriesPerRequest: 1 });
    // Même forme que le provisioning : empreinte SHA-256, jamais le mot de passe en clair.
    const hash = createHash('sha256').update(password).digest('hex');
    expect(await admin.call('ACL', 'SETUSER', user, 'reset', 'on', `#${hash}`, ...aclRules(prefix))).toBe('OK');
    app = connect(asUser());
  });

  afterAll(async () => {
    for (const c of extra) c.disconnect();
    await admin.del(`${prefix}probe`, `${prefix}otp`, `${prefix}lock`, 'dsacl-outside');
    await admin.call('ACL', 'DELUSER', user);
    admin.disconnect();
  });

  it('commandes de l’API permises sous le préfixe (clé réellement préfixée)', async () => {
    expect(await app.set('probe', '1', 'EX', 60)).toBe('OK');
    expect(await admin.get(`${prefix}probe`)).toBe('1');
    expect(await app.incr('lock')).toBe(1);
    expect(await app.expire('lock', 60)).toBe(1);
    expect(await app.ttl('lock')).toBeGreaterThan(0);
    expect(await app.getdel('probe')).toBe('1');
    expect(await app.del('lock')).toBe(1);
    expect(await app.ping()).toBe('PONG');
  });

  it('script Lua de consommation (OTP) et script du rate-limit Fastify', async () => {
    await app.set('otp', 'abc');
    const consumed = await app.eval("if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end redis.call('DEL', KEYS[1], KEYS[2]) return 1", 2, 'otp', 'otp-attempts', 'abc');
    expect(consumed).toBe(1);
    const limiter = connect(asUser(), { connectionName: 'digisante-ratelimit', enableOfflineQueue: true });
    const store = new RedisStore(false, false, limiter, 'rl-');
    const hit = await new Promise<{ current: number; ttl: number }>((resolve, reject) => store.incr('203.0.113.9', (err, r) => (err ? reject(err) : resolve(r)), 60_000, 100));
    expect(hit.current).toBe(1);
    expect(await admin.exists(`${prefix}rl-203.0.113.9`)).toBe(1);
    await admin.del(`${prefix}rl-203.0.113.9`);
  });

  it('pub/sub : canal préfixé reçu, canal commun refusé', async () => {
    const sub = connect(asUser());
    const received = new Promise<string>((resolve) => sub.on('message', (_c, m) => resolve(m)));
    await sub.subscribe(`${prefix}chat:events`);
    expect(await app.publish(`${prefix}chat:events`, 'hello')).toBe(1);
    expect(await received).toBe('hello');
    await expect(app.publish('chat:events', 'x')).rejects.toThrow(/NOPERM/);
    await expect(connect(asUser()).subscribe('chat:events')).rejects.toThrow(/NOPERM/);
  });

  it.each([
    ['FLUSHALL', ['FLUSHALL']], ['FLUSHDB', ['FLUSHDB']], ['KEYS', ['KEYS', '*']], ['SCAN', ['SCAN', '0']],
    ['INFO', ['INFO']], ['CONFIG GET', ['CONFIG', 'GET', 'maxmemory']], ['ACL LIST', ['ACL', 'LIST']],
    ['CLIENT LIST', ['CLIENT', 'LIST']], ['SWAPDB', ['SWAPDB', '5', '6']], ['DBSIZE', ['DBSIZE']], ['RANDOMKEY', ['RANDOMKEY']],
  ])('refusé : %s', async (_label, args) => {
    await expect(app.call(...(args as [string, ...string[]]))).rejects.toThrow(/NOPERM/);
  });

  it('clé hors préfixe refusée, y compris après SELECT d’un autre index', async () => {
    await admin.set('dsacl-outside', 'secret');
    const raw = connect(asUser(), { keyPrefix: undefined });
    await expect(raw.get('dsacl-outside')).rejects.toThrow(/NOPERM/);
    const other = connect(asUser('/0'), { keyPrefix: undefined });
    await expect(other.get('dsacl-outside')).rejects.toThrow(/NOPERM/);
    await expect(other.get('otp:+22900000000')).rejects.toThrow(/NOPERM/);
  });

  it('sondes ACL DRYRUN de provision-ionos.sh --verify : même verdict que l’exécution réelle', async () => {
    const dry = (...a: string[]) => admin.call('ACL', 'DRYRUN', user, ...a).then((r) => r === 'OK', () => false);
    expect(await dry('GET', `${prefix}probe`)).toBe(true);
    expect(await dry('PUBLISH', `${prefix}chat:events`, 'x')).toBe(true);
    for (const probe of [['FLUSHALL'], ['FLUSHDB'], ['KEYS', '*'], ['SCAN', '0'], ['CONFIG', 'GET', 'maxmemory'], ['INFO'], ['ACL', 'LIST'],
      ['CLIENT', 'LIST'], ['MONITOR'], ['SWAPDB', '5', '6'], ['GET', 'otp:probe'], ['GET', 'digisante:probe'], ['PUBLISH', 'chat:events', 'x'],
      ['SUBSCRIBE', 'digisante:chat:events'], ['MOVE', `${prefix}probe`, '0']]) {
      expect(await dry(...probe), probe.join(' ')).toBe(false);
    }
  });
});
