// Recette S8 (B1) : sonde de l'hôte du lien FedaPay bac à sable — sans réseau (fetch simulé).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { S8_AMOUNT_XOF, S8_DECISIONS, SANDBOX_API, describeCheckoutUrl, formatS8, runS8Probe, s8Verdict } from './fedapay-s8.mjs';
import { selectedSmokeFiles, smokeEnvironmentIssues } from './smoke-guard.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const TOKEN = 'SYNTHETICTOKENsecret0123456789abcdefXYZ';
const SECRET = 'sk_sandbox_SYNTHETIC_SECRET_VALUE';
const secrets = { secretKey: SECRET, publicKey: 'pk_sandbox_SYNTHETIC', webhookSecret: 'wh_SYNTHETIC' };
// Liste et contrôle de même forme que la production (injectés : la sonde n'en a pas de copie).
const hosts = { live: ['process.fedapay.com', 'checkout.fedapay.com'], sandbox: ['sandbox-process.fedapay.com', 'sandbox-checkout.fedapay.com'] };
const isAllowedSandbox = (url) => /^https:\/\/(sandbox-process|sandbox-checkout)\.fedapay\.com(?::443)?(?:[/?#]|$)/.test(url) && !/[\\\s@]/.test(url);
const parseId = (v) => (Number.isSafeInteger(v) && v > 0 ? String(v) : typeof v === 'string' && /^[a-z0-9_-]{1,128}$/i.test(v) ? v : null);
const reference = 'ds-recette-s8-20261013180000-ab12';

function fakeFedapay({ create = { status: 200, body: { 'v1/transaction': { id: 7310518301 } } }, token = { status: 200, body: { token: TOKEN, url: `https://sandbox-process.fedapay.com/${TOKEN}` } } } = {}) {
  const calls = [];
  const request = async (url, init) => {
    calls.push({ url, init });
    const r = url.endsWith('/token') ? token : create;
    return new Response(r.raw ?? JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  };
  return { calls, request };
}
const probe = (fake, extra = {}) => runS8Probe({ enabled: true, secrets, request: fake.request, parseId, isAllowedSandbox, hosts, reference, ...extra });
const printed = (result) => formatS8(result, reference).join('\n');

test('S8 : hôte bac à sable autorisé ⇒ PASS ; deux POST seulement, vers la seule API bac à sable, sans redirection', async () => {
  const fake = fakeFedapay();
  const result = await probe(fake);
  assert.equal(result.verdict, 'PASS'); assert.equal(result.code, 'HOTE_AUTORISE');
  assert.equal(result.shape.host, 'sandbox-process.fedapay.com'); assert.equal(result.transaction, '••••8301');
  assert.deepEqual(result.tokenFields, ['token', 'url']);
  assert.deepEqual(fake.calls.map((c) => c.url), [`${SANDBOX_API}/transactions`, `${SANDBOX_API}/transactions/7310518301/token`]);
  for (const { init } of fake.calls) {
    assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error'); assert.ok(init.signal instanceof AbortSignal);
  }
  const body = JSON.parse(fake.calls[0].init.body);
  assert.deepEqual(body, { description: 'DigiSanté — recette S8 (synthétique, jamais payée)', amount: S8_AMOUNT_XOF, currency: { iso: 'XOF' }, merchant_reference: reference });
  assert.equal(fake.calls[1].init.body, undefined);
});

test('S8 : la sortie ne contient jamais le jeton, le lien complet, la clé ni l’identifiant entier', async () => {
  for (const url of [`https://sandbox-process.fedapay.com/${TOKEN}`, `https://sandbox-process.fedapay.com/pay?token=${TOKEN}#${TOKEN}`, `https://unexpected.example/${TOKEN}`]) {
    const out = printed(await probe(fakeFedapay({ token: { status: 200, body: { token: TOKEN, url } } })));
    for (const secretValue of [TOKEN, SECRET, '7310518301', url]) assert.doesNotMatch(out, new RegExp(secretValue.replace(/[.?#/]/g, '\\$&')), `${url} : ${secretValue}`);
  }
  const out = printed(await probe(fakeFedapay()));
  assert.match(out, new RegExp(`chemin /<${TOKEN.length} car\\. a-z,A-Z,0-9>`));
});

test('S8 : hôte live, non listé ou forme refusée ⇒ FAIL codé, hôte consigné, aucune autre requête', async () => {
  const cases = [
    [`https://process.fedapay.com/${TOKEN}`, 'HOTE_LIVE', 'process.fedapay.com'],
    [`https://checkout.fedapay.com/${TOKEN}`, 'HOTE_LIVE', 'checkout.fedapay.com'],
    [`https://me.fedapay.com/${TOKEN}`, 'HOTE_NON_LISTE', 'me.fedapay.com'],
    [`https://sandbox-process.fedapay.com.evil.example/${TOKEN}`, 'HOTE_NON_LISTE', 'sandbox-process.fedapay.com.evil.example'],
    [`http://sandbox-process.fedapay.com/${TOKEN}`, 'FORME_REFUSEE', 'sandbox-process.fedapay.com'],
    [`https://sandbox-process.fedapay.com:8443/${TOKEN}`, 'FORME_REFUSEE', 'sandbox-process.fedapay.com'],
    [`https://user@sandbox-process.fedapay.com/${TOKEN}`, 'FORME_REFUSEE', 'sandbox-process.fedapay.com'],
  ];
  for (const [url, code, host] of cases) {
    const fake = fakeFedapay({ token: { status: 200, body: { url } } });
    const result = await probe(fake);
    assert.equal(result.verdict, 'FAIL', url); assert.equal(result.code, code, url); assert.equal(result.shape.host, host, url);
    assert.equal(fake.calls.length, 2, url);
    assert.match(printed(result), new RegExp(`lien \\w+://${host.replace(/\./g, '\\.')}`), url);
  }
});

test('S8 : réponse amont refusée ou sans lien ⇒ FAIL codé, aucun corps recopié, pas de lien demandé sans identifiant', async () => {
  let fake = fakeFedapay({ create: { status: 401, body: { message: 'SYNTHETIC upstream detail' } } });
  let result = await probe(fake);
  assert.equal(result.code, 'CREATION_HTTP'); assert.equal(result.createStatus, 401); assert.equal(fake.calls.length, 1);
  assert.doesNotMatch(printed(result), /SYNTHETIC upstream detail/);
  for (const body of [{ 'v1/transaction': { id: 2 ** 53 } }, { 'v1/transaction': { id: '../7' } }, { other: 1 }]) {
    fake = fakeFedapay({ create: { status: 200, body } });
    result = await probe(fake);
    assert.equal(result.code, 'ID_INVALIDE', JSON.stringify(body)); assert.equal(fake.calls.length, 1);
  }
  fake = fakeFedapay({ create: { status: 200, body: { id: 'tx_SYNTH42' } }, token: { status: 422, body: { message: 'SYNTHETIC' } } });
  result = await probe(fake);
  assert.equal(result.code, 'TOKEN_HTTP'); assert.equal(result.tokenStatus, 422); assert.equal(result.transaction, '••••TH42');
  for (const token of [{ status: 200, body: { token: TOKEN } }, { status: 200, raw: 'not json' }, { status: 200, body: { url: 'not a url' } }]) {
    result = await probe(fakeFedapay({ token }));
    assert.equal(result.code, 'URL_INVALIDE');
  }
});

test('S8 : clé live/inconnue, configuration incomplète ou désactivée, référence invalide ⇒ refus AVANT tout réseau', async () => {
  const fake = fakeFedapay();
  for (const secretKey of ['sk_live_SYNTHETIC', 'unknown', '', ' sk_sandbox_ ']) await assert.rejects(probe(fake, { secrets: { ...secrets, secretKey } }), secretKey);
  await assert.rejects(probe(fake, { secrets: { secretKey: SECRET, publicKey: 'pk' } }));
  await assert.rejects(probe(fake, { enabled: false }));
  for (const bad of ['', 'UPPER-case-ref', 'ref with space', 'x'.repeat(65), undefined]) await assert.rejects(probe(fake, { reference: bad }), String(bad));
  assert.equal(fake.calls.length, 0);
  // Clé changée entre les deux appels : le second n'atteint jamais le réseau.
  const mutable = { ...secrets };
  const calls = [];
  const request = async (url) => { calls.push(url); mutable.secretKey = 'sk_live_SYNTHETIC'; return new Response(JSON.stringify({ id: 9 }), { status: 200 }); };
  await assert.rejects(runS8Probe({ enabled: true, secrets: mutable, request, parseId, isAllowedSandbox, hosts, reference }));
  assert.equal(calls.length, 1);
});

test('S8 : forme du lien sans contenu (chemin, requête, fragment)', () => {
  assert.deepEqual(describeCheckoutUrl(`https://sandbox-process.fedapay.com/pay/${TOKEN}?t=${TOKEN}&x=1#frag`), {
    valid: true, protocol: 'https', host: 'sandbox-process.fedapay.com', port: null, credentials: false,
    path: `/<3 car. a-z>/<${TOKEN.length} car. a-z,A-Z,0-9>`, queryParams: 2, fragment: true,
  });
  for (const bad of [undefined, null, '', 42, 'sandbox-process.fedapay.com/x']) assert.deepEqual(describeCheckoutUrl(bad), { valid: false });
  assert.equal(s8Verdict('https://sandbox-checkout.fedapay.com/x', { isAllowedSandbox, hosts }).code, 'HOTE_AUTORISE');
});

test('S8 : chaque code a une décision opérateur reprise mot pour mot dans la recette', () => {
  const recipe = readFileSync(`${root}docs/RECETTE_FedaPay_Sandbox.md`, 'utf8');
  for (const [code, decision] of Object.entries(S8_DECISIONS)) {
    assert.ok(recipe.includes(`\`${code}\``), `code ${code} absent de la recette`);
    assert.ok(recipe.includes(decision), `décision ${code} divergente de la recette`);
  }
});

test('S8 : opt-in distinct du préflight, exclusif (un seul fournisseur par commande), même garde L10', () => {
  const sha = 'a'.repeat(40);
  const env = { NODE_ENV: 'production', SMOKE_ENVIRONMENT: 'preproduction', SMOKE_EXPECTED_SHA: sha, SMOKE_DATABASE_NAME: 'digisante_preprod', DATABASE_URL: 'postgresql://fixture@127.0.0.1:5432/digisante_preprod', REDIS_URL: 'redis://127.0.0.1:6379/5', SMOKE_REDIS_DB: '5', SMOKE_FEDAPAY_S8: '1' };
  assert.deepEqual(selectedSmokeFiles(env), ['src/services/fedapay-s8.smoke.test.ts']);
  assert.deepEqual(smokeEnvironmentIssues(env, sha), []);
  assert.ok(smokeEnvironmentIssues({ ...env, SMOKE_FEDAPAY: '1' }, sha).length, 'préflight + S8 dans la même commande');
  for (const change of [{ NODE_ENV: 'test' }, { SMOKE_ENVIRONMENT: 'production' }, { SMOKE_EXPECTED_SHA: 'b'.repeat(40) }]) assert.ok(smokeEnvironmentIssues({ ...env, ...change }, sha).length);
});
