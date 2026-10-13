import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { selectedSmokeFiles, smokeEnvironmentIssues, requestFedapaySandbox } from './smoke-guard.mjs';
import { successfulRun, assertJobs, main } from './verify-candidate.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const sha = 'a'.repeat(40);
const env = { NODE_ENV: 'production', SMOKE_ENVIRONMENT: 'preproduction', SMOKE_EXPECTED_SHA: sha, SMOKE_DATABASE_NAME: 'digisante_preprod', DATABASE_URL: 'postgresql://fixture:SYNTHETIC_PASSWORD@127.0.0.1:5432/digisante_preprod', REDIS_URL: 'redis://127.0.0.1:6379/0', SMOKE_REDIS_DB: '0', SMOKE_DAILY: '1' };
test('smoke : isolation déclarée, runtime réel, un fournisseur et SHA exact requis', () => {
  assert.deepEqual(smokeEnvironmentIssues(env, sha), []);
  assert.deepEqual(selectedSmokeFiles(env), ['src/services/daily.smoke.test.ts']);
  for (const change of [{NODE_ENV:'test'}, {SMOKE_ENVIRONMENT:'production'}, {SMOKE_EXPECTED_SHA:'b'.repeat(40)}, {SMOKE_DATABASE_NAME:'digisante'}, {DATABASE_URL:'postgresql://fixture@remote/digisante_preprod'}, {REDIS_URL:'redis://127.0.0.1:6379'}, {SMOKE_REDIS_DB:'1'}, {SMOKE_TWILIO:'1'}, {SMOKE_DAILY:'0'}]) assert.ok(smokeEnvironmentIssues({...env,...change},sha).length);
});
test('erreurs smoke ne révèlent pas les URL/identifiants de connexion', () => {
  assert.doesNotMatch(smokeEnvironmentIssues({...env,DATABASE_URL:'SYNTHETIC_PASSWORD',REDIS_URL:'SYNTHETIC_PASSWORD'},sha).join(' '),/SYNTHETIC_PASSWORD/);
});
test('Vitest smoke refuse le mode test avant serveur/Redis ; aucun setup FLUSHDB hérité', () => {
  const r = spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','vitest.smoke.config.ts'], {cwd:root+'apps/api',encoding:'utf8',timeout:20_000,env:{...process.env,...env,NODE_ENV:'test'}});
  assert.notEqual(r.status,0);assert.match(r.stdout+r.stderr,/NODE_ENV=production requis/);assert.doesNotMatch(r.stdout+r.stderr,/SYNTHETIC_PASSWORD/);
  assert.match(readFileSync(root+'apps/api/vitest.smoke.config.ts','utf8'),/globalSetup: '\.\/vitest.smoke.setup.ts'/);
});
test('préflight FedaPay live/inconnu/incomplet refusé AVANT réseau ; sandbox bornée sans redirect', async () => {
  const calls=[];const request=async (...args)=>{calls.push(args);return new Response('{}',{status:200});};
  for (const secretKey of ['sk_live_SYNTHETIC','unknown','','\nsk_sandbox_TEST','\rsk_sandbox_TEST','sk_sandbox_TE ST']) await assert.rejects(requestFedapaySandbox({secretKey,publicKey:'pk_sandbox_TEST',webhookSecret:'TEST'},request), JSON.stringify(secretKey));
  await assert.rejects(requestFedapaySandbox({secretKey:'sk_sandbox_TEST',publicKey:'TEST'},request));
  assert.equal(calls.length,0);
  assert.equal((await requestFedapaySandbox({secretKey:'sk_sandbox_TEST',publicKey:'pk_sandbox_TEST',webhookSecret:'TEST'},request)).status,200);
  assert.equal(calls[0][0],'https://sandbox-api.fedapay.com/v1/transactions?per_page=1');assert.equal(calls[0][1].redirect,'error');assert.ok(calls[0][1].signal instanceof AbortSignal);
});
test('qualification : une CI verte sur autre SHA/branche/événement ou un job absent ne qualifie pas la candidate', () => {
  const r={head_sha:sha,head_branch:'main',event:'push',status:'completed',conclusion:'success',id:1};
  assert.equal(successfulRun(sha,[r]).id,1);
  for(const change of [{head_sha:'b'.repeat(40)},{head_branch:'feature'},{event:'pull_request'},{status:'in_progress'},{conclusion:'failure'}]) assert.throws(()=>successfulRun(sha,[{...r,...change}]));
  assert.throws(()=>assertJobs([{name:'build-and-test',status:'completed',conclusion:'success'}]));
  assert.throws(()=>assertJobs([{name:'build-and-test',status:'completed',conclusion:'success'},{name:'e2e',status:'completed',conclusion:'skipped'}]));
});
test('SHA malformé refusé sans API ; qualification ne déclenche aucun déploiement', () => {
  let calls=0;assert.throws(()=>main({CANDIDATE_SHA:'bad'},()=>{calls++;}));assert.equal(calls,0);
  const r={head_sha:sha,head_branch:'main',event:'push',status:'completed',conclusion:'success',id:42};
  const api=(path)=>{calls++;return path.includes('/jobs?')?{jobs:['build-and-test','e2e'].map(name=>({name,status:'completed',conclusion:'success'}))}:{workflow_runs:[r]};};
  assert.equal(main({CANDIDATE_SHA:sha},api),42);assert.equal(calls,2);
});
