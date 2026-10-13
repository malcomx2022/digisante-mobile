// Recette S8 (B1) : sonde de l'hôte du lien FedaPay bac à sable — sans réseau (fetch simulé).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { S8_AMOUNT_XOF, S8_DECISIONS, SANDBOX_API, describeCheckoutUrl, displayHost, formatS8, runS8Probe, s8Verdict, tokenFacts } from './fedapay-s8.mjs';
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
    if (r.throws) throw r.throws;
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
  assert.equal(result.createWrapper, 'v1/transaction'); assert.deepEqual(result.createFields, ['id']); assert.equal(result.createStatus, 200);
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

test('S8 : panne de transport ⇒ code RESEAU, référence et identifiant masqué conservés, message d’erreur jamais recopié', async () => {
  const leaky = new TypeError(`Headers.append: "Bearer ${SECRET}" is an invalid header value. ${TOKEN}`);
  let fake = fakeFedapay({ create: { throws: leaky } });
  let result = await probe(fake);
  assert.equal(result.code, 'CREATION_RESEAU'); assert.equal(result.failure, 'TypeError'); assert.equal(fake.calls.length, 1);
  let out = printed(result);
  assert.match(out, new RegExp(`référence=${reference}`)); assert.doesNotMatch(out, /SYNTHETIC_SECRET|SYNTHETICTOKEN|invalid header/);
  const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  fake = fakeFedapay({ token: { throws: timeout } });
  result = await probe(fake);
  assert.equal(result.code, 'TOKEN_RESEAU'); assert.equal(result.failure, 'TimeoutError'); assert.equal(result.transaction, '••••8301');
  out = printed(result);
  assert.match(out, /transaction=••••8301/); assert.doesNotMatch(out, /aborted/);
  // Nom d'erreur hors forme : jamais recopié.
  const weird = new Error('x'); weird.name = `Bearer ${SECRET}`;
  result = await probe(fakeFedapay({ create: { throws: weird } }));
  assert.equal(result.failure, 'Error');
});

test('S8 : étiquette d’hôte longue (jeton possible) affichée par sa seule forme ; hôtes connus lisibles', async () => {
  const tokenHost = `${TOKEN.toLowerCase()}.sandbox-process.fedapay.com`;
  const result = await probe(fakeFedapay({ token: { status: 200, body: { url: `https://${tokenHost}/` } } }));
  assert.equal(result.code, 'HOTE_NON_LISTE');
  const out = printed(result);
  assert.doesNotMatch(out, new RegExp(TOKEN.toLowerCase()));
  assert.match(out, new RegExp(`lien https://<${TOKEN.length} car\\. a-z,0-9>\\.sandbox-process\\.fedapay\\.com`));
  for (const host of ['sandbox-process.fedapay.com', 'sandbox-checkout.fedapay.com', 'process.fedapay.com', 'me.fedapay.com', 'fpay.li']) assert.equal(displayHost(host), host);
  assert.equal(displayHost('xn--bcher-kva.example'), 'xn--bcher-kva.example');
});

test('S8 : lien ↔ jeton relevés sans affichage (chemin = /<jeton>, JWT sub = transaction, validité arrondie)', async () => {
  const now = 1_800_000_000;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ typ: 'JWT', alg: 'HS256' })}.${b64({ sub: 7310518301, exp: now + 24 * 3600 })}.SIGNATURE_SYNTH`;
  const result = await probe(fakeFedapay({ token: { status: 200, body: { token: jwt, url: `https://sandbox-process.fedapay.com/${jwt}` } } }), { nowSeconds: now });
  assert.equal(result.verdict, 'PASS');
  assert.deepEqual(result.facts, { pathIsToken: true, jwt: { subMatches: true, validityHours: 24 } });
  const out = printed(result);
  assert.match(out, /chemin = \/<jeton> : oui · jeton JWT : oui \(sub = transaction : oui, validité ≈ 24 h\)/);
  for (const part of jwt.split('.')) assert.doesNotMatch(out, new RegExp(part));
  assert.deepEqual(tokenFacts(`https://sandbox-process.fedapay.com/other`, jwt, '1', now), { pathIsToken: false, jwt: { subMatches: false, validityHours: 24 } });
  assert.deepEqual(tokenFacts(`https://sandbox-process.fedapay.com/${TOKEN}`, TOKEN, '1'), { pathIsToken: true, jwt: null });
  assert.deepEqual(tokenFacts('x', undefined, '1'), { pathIsToken: null, jwt: null });
});

test('S8 : création sans enveloppe (OpenAPI) et lien fourni dès la création ⇒ forme relevée, hôte seul', async () => {
  const result = await probe(fakeFedapay({ create: { status: 201, body: { id: 77, reference: 'trx_SYNTH', payment_url: `https://sandbox-process.fedapay.com/${TOKEN}` } } }));
  assert.equal(result.createStatus, 201); assert.equal(result.createWrapper, 'racine');
  assert.deepEqual(result.createFields, ['id', 'payment_url', 'reference']); assert.equal(result.createPaymentUrlHost, 'sandbox-process.fedapay.com');
  const out = printed(result);
  assert.match(out, /création HTTP 201 \(forme : racine ; champs : id,payment_url,reference ; payment_url sur sandbox-process\.fedapay\.com\)/);
  assert.doesNotMatch(out, new RegExp(TOKEN)); assert.doesNotMatch(out, /trx_SYNTH/);
});

test('S8 : clé avec caractère invalide (octet nul, espace interne, non ASCII) refusée avant réseau ; blancs de bord tolérés comme par fetch', async () => {
  const fake = fakeFedapay();
  for (const secretKey of ['sk_sandbox_AB\u0000CD', 'sk_sandbox_AB CD', 'sk_sandbox_ABé', 'sk_sandbox_AB\nCD']) await assert.rejects(probe(fake, { secrets: { ...secrets, secretKey } }), JSON.stringify(secretKey));
  assert.equal(fake.calls.length, 0);
  assert.equal((await probe(fakeFedapay(), { secrets: { ...secrets, secretKey: `${SECRET}\n` } })).verdict, 'PASS');
});
