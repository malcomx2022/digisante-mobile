import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, readdirSync, existsSync, rmSync, utimesSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkBackup } from './check-backup.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));const sha='a'.repeat(40);
function fixture() {
  const dir=mkdtempSync(join(tmpdir(),'digisante-l10-'));const bin=join(dir,'bin');mkdirSync(bin);
  const env={...process.env,PATH:bin+':'+process.env.PATH,APP_DIR:join(dir,'app'),LOG_DIR:join(dir,'log'),TRACE:join(dir,'trace'),DB_NAME:'fixture_preprod',BACKUP_DIR:join(dir,'backups'),BACKUP_KEY_FILE:join(dir,'backup.key'),KYC_STORAGE_DIR:join(dir,'files')};
  for(const path of [env.APP_DIR,env.LOG_DIR,env.BACKUP_DIR,env.KYC_STORAGE_DIR,join(env.APP_DIR,'apps/api')]) mkdirSync(path,{recursive:true});
  writeFileSync(join(env.APP_DIR,'apps/api/.env'),'NODE_ENV=production\n');chmodSync(join(env.APP_DIR,'apps/api/.env'),0o600);
  writeFileSync(env.BACKUP_KEY_FILE,'SYNTHETIC TEST KEY');chmodSync(env.BACKUP_KEY_FILE,0o600);
  writeFileSync(join(env.KYC_STORAGE_DIR,'fixture.bin'),'SYNTHETIC ENCRYPTED FILE');
  const command=(name,body)=>{const path=join(bin,name);writeFileSync(path,'#!/bin/bash\nset -euo pipefail\n'+body+'\n');chmodSync(path,0o755);};
  command('git',`echo "git $*" >> "$TRACE"
case "$1" in
status) [[ "\u0024{DIRTY:-0}" == 0 ]] || echo ' M synthetic';;
rev-parse) echo '${sha}';;
merge-base) [[ "\u0024{WRONG_BRANCH:-0}" == 0 ]];;
esac`);
  command('pnpm',`echo "pnpm $*" >> "$TRACE"; if [[ "\u0024{BUILD_FAIL:-0}" == 1 && "$1" == build ]]; then exit 9; fi`);
  command('pm2',`echo "pm2 $*" >> "$TRACE"
case "$1" in
jlist) if [[ "\u0024{PM2_BROKEN:-0}" == 1 ]]; then echo invalid; elif [[ "\u0024{OLD_WRITERS:-0}" == 1 && ! -f "$APP_DIR/stopped" ]]; then echo '[{"name":"digisante-api","pm2_env":{"status":"online"}},{"name":"digisante-web","pm2_env":{"status":"online"}}]'; else echo '[]'; fi;;
stop) [[ "\u0024{STOP_FAIL:-0}" == 0 ]] || exit 2; touch "$APP_DIR/stopped";;
esac`);
  command('curl',`echo 'curl' >> "$TRACE"; if [[ "\u0024{BAD_READY:-0}" == 1 ]]; then echo '<html>wrong backend</html>'; else echo '{"status":"ready","db":"up","redis":"up"}'; fi`);
  command('sleep',':');
  command('sudo',`[[ "$1" == -u ]]; shift 2
case "$1" in
pg_dump) echo "dump $*" >> "$TRACE"; [[ "\u0024{DUMP_FAIL:-0}" == 0 ]] || exit 3; echo '-- SYNTHETIC SQL DUMP';;
psql) echo 'snapshot-open' >> "$TRACE"; IFS= read -r first; echo '00000001-00000002-1'; while IFS= read -r line; do [[ "$line" != *q ]] || break; done; [[ "\u0024{MANIFEST_FAIL:-0}" == 0 ]] || exit 4; echo 'rows.fixture=1'; echo 'audit_head=none';;
*) exec "$@";;
esac`);
  const run=(script,extra={},args=[])=>spawnSync('bash',[resolve(root,'infra/deploy/scripts',script),...args],{env:{...env,...extra},encoding:'utf8',timeout:20_000});
  const trace=()=>existsSync(env.TRACE)?readFileSync(env.TRACE,'utf8'):'';
  return {dir,env,run,trace,command,clean:()=>rmSync(dir,{recursive:true,force:true})};
}
const deployEnv={DEPLOY_REF:sha,DEPLOY_ENVIRONMENT:'preproduction',DEPLOY_MAINTENANCE_READY:'1'};
test('déploiement : SHA/maintenance/env production/change opérateur/branche exigés avant effets',()=>{
  for(const change of [{DEPLOY_REF:'main'},{DEPLOY_MAINTENANCE_READY:'0'},{DEPLOY_ENVIRONMENT:'bad'},{DIRTY:'1'},{WRONG_BRANCH:'1'}]) {
    const f=fixture();try {const r=f.run('deploy.sh',{...deployEnv,...change});assert.notEqual(r.status,0,r.stderr);assert.doesNotMatch(f.trace(),/pnpm |pm2 /);}finally{f.clean();}
  }
  const f=fixture();try {writeFileSync(join(f.env.APP_DIR,'apps/api/.env'),'NODE_ENV=test\n');assert.notEqual(f.run('deploy.sh',deployEnv).status,0);assert.doesNotMatch(f.trace(),/pnpm |pm2 /);}finally{f.clean();}
});
test('déploiement : anciens writers arrêtés, SHA détaché, build avant migrate, succès tracé',()=>{
  const f=fixture();try {const r=f.run('deploy.sh',{...deployEnv,OLD_WRITERS:'1'});assert.equal(r.status,0,r.stderr+r.stdout);const t=f.trace();assert.ok(t.indexOf('pm2 stop')<t.indexOf('git switch --detach'));assert.ok(t.indexOf('pnpm build')<t.indexOf('prisma migrate deploy'));assert.ok(t.indexOf('prisma migrate deploy')<t.indexOf('pm2 startOrReload'));assert.match(readFileSync(join(f.env.LOG_DIR,'deploy_history.log'),'utf8'),/status=SUCCESS/);}finally{f.clean();}
});
test('déploiement : PM2 illisible/arrêt échoué/build échoué bloque migrations, échec conservé',()=>{
  for(const change of [{PM2_BROKEN:'1'},{OLD_WRITERS:'1',STOP_FAIL:'1'},{BUILD_FAIL:'1'}]) {const f=fixture();try{const r=f.run('deploy.sh',{...deployEnv,...change});assert.notEqual(r.status,0);assert.doesNotMatch(f.trace(),/prisma migrate deploy/);assert.match(readFileSync(join(f.env.LOG_DIR,'deploy_history.log'),'utf8'),/status=FAILED/);}finally{f.clean();}}
});
test('déploiement : HTML 200 ne vaut pas readiness, aucun ancien code promis',()=>{
  const f=fixture();try{const r=f.run('deploy.sh',{...deployEnv,BAD_READY:'1'});assert.notEqual(r.status,0);assert.doesNotMatch(r.stdout,/code précédent reste actif/);assert.match(readFileSync(join(f.env.LOG_DIR,'deploy_history.log'),'utf8'),/status=FAILED stage=readiness/);}finally{f.clean();}
});
test('backup : magasin/clé absents ou permissions ouvertes refusés avant dump',()=>{
  const f=fixture();try{for(const extra of [{KYC_STORAGE_DIR:join(f.dir,'absent')},{BACKUP_KEY_FILE:join(f.dir,'absent')}])assert.notEqual(f.run('pg_dump_encrypted.sh',extra).status,0);chmodSync(f.env.BACKUP_KEY_FILE,0o644);assert.notEqual(f.run('pg_dump_encrypted.sh').status,0);assert.equal(f.trace(),'');}finally{f.clean();}
});
test('backup : pipeline dump ou manifeste en panne ne publie rien et ne purge pas les anciennes archives',()=>{
  for(const extra of [{DUMP_FAIL:'1'},{MANIFEST_FAIL:'1'}]){const f=fixture();try{const old=join(f.env.BACKUP_DIR,'digisante_20000101_000000.sql.gz.enc');writeFileSync(old,'OLD SYNTHETIC');utimesSync(old,new Date(0),new Date(0));const r=f.run('pg_dump_encrypted.sh',extra);assert.notEqual(r.status,0,r.stderr);assert.deepEqual(readdirSync(f.env.BACKUP_DIR).filter(n=>n!=='\.backup.lock'),['digisante_20000101_000000.sql.gz.enc']);assert.match(r.stdout+r.stderr,/ÉCHEC/);}finally{f.clean();}}
});
test('backup : vrai chiffrement/gzip/tar, snapshot partagé, publication complète et altération détectée',async()=>{
  const f=fixture();try{const r=f.run('pg_dump_encrypted.sh');assert.equal(r.status,0,r.stderr+r.stdout);const files=readdirSync(f.env.BACKUP_DIR).filter(n=>!n.startsWith('.'));assert.equal(files.length,3);const manifest=join(f.env.BACKUP_DIR,files.find(n=>n.includes('_manifest_')));await checkBackup(manifest);assert.match(f.trace(),/pg_dump .*--snapshot 00000001-00000002-1/);
    const db=join(f.env.BACKUP_DIR,files.find(n=>n.endsWith('.sql.gz.enc')));const decoded=spawnSync('openssl',['enc','-d','-aes-256-cbc','-pbkdf2','-pass','file:'+f.env.BACKUP_KEY_FILE,'-in',db]);assert.equal(decoded.status,0);const sql=spawnSync('gunzip',{input:decoded.stdout,encoding:'utf8'});assert.match(sql.stdout,/SYNTHETIC SQL DUMP/);
    chmodSync(db,0o600);writeFileSync(db,'ALTERED');await assert.rejects(checkBackup(manifest));assert.ok(readdirSync(f.env.BACKUP_DIR).every(n=>!n.startsWith('.backup.')||n==='.backup.lock'));
  }finally{f.clean();}
});
test('backup : invocation concurrente refusée, aucun fichier écrasé',()=>{
  const f=fixture();try{f.command('flock','exit 1');const r=f.run('pg_dump_encrypted.sh');assert.notEqual(r.status,0);assert.match(r.stderr,/déjà en cours/);assert.equal(f.trace(),'');}finally{f.clean();}
});
test('vérification cible : --run-jobs refuse une production déclarée avant toute sonde',()=>{
  const f=fixture();try{const r=f.run('verify_deploy.sh',{DOMAIN:'preprod.example.bj',VERIFY_JOB_ENVIRONMENT:'production'},['--run-jobs']);assert.notEqual(r.status,0);assert.equal(f.trace(),'');}finally{f.clean();}
});

test('vérification : sondes par défaut sans tâches ; opt-in synthétique lance exactement six tâches',()=>{
  for(const jobs of [false,true]) {
    const f=fixture();try {
      f.command('pm2',`echo '[{"name":"digisante-api","pm2_env":{"status":"online"}},{"name":"digisante-api","pm2_env":{"status":"online"}},{"name":"digisante-web","pm2_env":{"status":"online"}}]'`);
      f.command('pnpm',`echo 'Database schema is up to date!'`);
      f.command('openssl',`if [[ "$1" == x509 ]]; then cat >/dev/null; echo "notAfter=$(date -d '+30 days')"; else echo CERT; fi`);
      f.command('curl',`case "$*" in
*health*) echo '{"status":"ok","service":"digisante-api"}';;
*ready*) echo '{"status":"ready","db":"up","redis":"up"}';;
*chat/ws*) echo '101';;
*) echo 'Strict-Transport-Security: max-age=31536000';;
esac`);
      f.command('crontab',`cat '${root}infra/deploy/crontab.preproduction.example'`);
      f.command('timedatectl',`echo Africa/Porto-Novo`);
      const jobdir=join(f.env.APP_DIR,'infra/deploy/scripts');mkdirSync(jobdir,{recursive:true});writeFileSync(join(jobdir,'internal_job.sh'),'echo job-called >> "$TRACE"\n');
      const ws=join(f.dir,'ws.log');writeFileSync(ws,'');
      const r=f.run('verify_deploy.sh',{DOMAIN:'preprod.example.bj',VERIFY_JOB_ENVIRONMENT:'preproduction',WS_LOG:ws},jobs?['--run-jobs']:[]);
      assert.equal(r.status,0,r.stdout+r.stderr);assert.equal((f.trace().match(/job-called/g)||[]).length,jobs?6:0);
    }finally{f.clean();}
  }
});

test('healthwatch : archive DB seule refusée ; trio accepté ; horodatage futur et HTML 200 alertés',()=>{
  const f=fixture();try {
    f.command('fixture-psql','echo 0');f.command('logger',':');
    const env={STATE_DIR:join(f.dir,'state'),HEALTHWATCH_CONF:join(f.dir,'no-conf'),ALERT_CMD:'',DOMAIN:'',PM2_CHECK:'0',DISK_PATHS:f.dir,JOB_LOGS:join(f.dir,'no-log'),API_LOG:join(f.dir,'no-api-log'),PSQL:join(f.dir,'bin/fixture-psql')};
    assert.equal(f.run('pg_dump_encrypted.sh').status,0);
    let r=f.run('healthwatch.sh',env);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/backup +OK +trio publié/);
    const manifest=join(f.env.BACKUP_DIR,readdirSync(f.env.BACKUP_DIR).find(n=>n.includes('_manifest_')));
    utimesSync(manifest,new Date(Date.now()+45_000),new Date(Date.now()+45_000));
    r=f.run('healthwatch.sh',env);assert.match(r.stdout,/backup +ALERTE +sauvegarde périmée ou horodatage futur/);
    utimesSync(manifest,new Date(),new Date());
    rmSync(join(f.env.BACKUP_DIR,readdirSync(f.env.BACKUP_DIR).find(n=>n.includes('_files_'))));
    r=f.run('healthwatch.sh',{...env,BAD_READY:'1'});assert.match(r.stdout,/backup +ALERTE +trio/);assert.match(r.stdout,/ready +ALERTE/);
    rmSync(manifest);r=f.run('healthwatch.sh',env);assert.match(r.stdout,/backup +ALERTE +aucune sauvegarde complète/);
  }finally{f.clean();}
});
