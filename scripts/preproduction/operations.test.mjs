import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, readdirSync, existsSync, rmSync, utimesSync, copyFileSync, symlinkSync, lchownSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { tmpdir, userInfo } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkBackup, parseManifest } from './check-backup.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));const sha='a'.repeat(40);
// Identifiant de stockage opaque (format lib/filestore) du fichier synthétique du magasin.
const STORE_ID='00000000-0000-4000-8000-000000000001';
const ROOT_LIST=readFileSync(resolve(root,'infra/deploy/root-scripts.list'),'utf8').split('\n').map((l)=>/^(0755|0644) (\S+)$/.exec(l)).filter(Boolean).map((m)=>({mode:parseInt(m[1],8),path:m[2]}));
const sha256=(path)=>createHash('sha256').update(readFileSync(path)).digest('hex');
// Utilisateur applicatif du magasin (B4) : jamais root. En root, `nobody` (le shim sudo
// abandonne réellement les privilèges pour tar) ; sinon l'utilisateur courant de la CI.
const IS_ROOT=process.getuid?.()===0;
const APP=IS_ROOT?{user:'nobody',uid:65534,gid:65534}:{user:userInfo().username,uid:process.getuid(),gid:process.getgid()};
function own(path){if(!IS_ROOT)return;lchownSync(path,APP.uid,APP.gid);if(lstatSync(path).isDirectory())for(const n of readdirSync(path))own(join(path,n));}
// Magasin conforme : répertoire 0700 appartenant à l'utilisateur applicatif.
function appStore(path){mkdirSync(path,{recursive:true});chmodSync(path,0o700);return path;}
// Copie privée (0755/0644, propriétaire = utilisateur du test) de l'arbre exécuté par root :
// les scripts refusent désormais de tourner depuis un emplacement modifiable par autrui (B3),
// et cette copie ne dépend pas des permissions du checkout de la CI.
function copyTree(dest) {
  for (const {mode,path} of [...ROOT_LIST,{mode:0o755,path:'infra/deploy/scripts/deploy.sh'}]) {
    mkdirSync(dirname(join(dest,path)),{recursive:true,mode:0o755});copyFileSync(resolve(root,path),join(dest,path));chmodSync(join(dest,path),mode);
  }
}
function writeRootManifest(lib,installedSha) {
  const lines=[`sha=${installedSha}`,'branch=main','source=file:///synthetic','installed_at=2026-10-13T00:00:00+01:00',...ROOT_LIST.map(({mode,path})=>`file=${path} mode=0${mode.toString(8)} sha256=${sha256(join(lib,path))}`)];
  writeFileSync(join(lib,'root-scripts.manifest'),lines.join('\n')+'\n');chmodSync(join(lib,'root-scripts.manifest'),0o644);
}
function fixture() {
  const dir=mkdtempSync(join(tmpdir(),'digisante-l10-'));chmodSync(dir,0o755);const bin=join(dir,'bin');mkdirSync(bin);const lib=join(dir,'lib');copyTree(lib);
  const env={...process.env,PATH:bin+':'+process.env.PATH,APP_DIR:join(dir,'app'),APP_USER:APP.user,LOG_DIR:join(dir,'log'),TRACE:join(dir,'trace'),DB_NAME:'fixture_preprod',BACKUP_DIR:join(dir,'backups'),BACKUP_KEY_FILE:join(dir,'backup.key'),KYC_STORAGE_DIR:join(dir,'files'),ROOT_LIB:lib,ROOT_SCRIPTS_MANIFEST:join(lib,'root-scripts.manifest'),API_ENV_FILE:join(dir,'app/apps/api/.env')};
  for(const path of [env.APP_DIR,env.LOG_DIR,env.BACKUP_DIR,join(env.APP_DIR,'apps/api')]) mkdirSync(path,{recursive:true});
  appStore(env.KYC_STORAGE_DIR);
  writeFileSync(join(env.APP_DIR,'apps/api/.env'),'NODE_ENV=production\n');chmodSync(join(env.APP_DIR,'apps/api/.env'),0o600);
  writeFileSync(env.BACKUP_KEY_FILE,'SYNTHETIC TEST KEY');chmodSync(env.BACKUP_KEY_FILE,0o600);
  writeFileSync(join(env.KYC_STORAGE_DIR,`${STORE_ID}.bin`),'SYNTHETIC ENCRYPTED FILE');own(env.KYC_STORAGE_DIR);
  const command=(name,body)=>{const path=join(bin,name);writeFileSync(path,'#!/bin/bash\nset -euo pipefail\n'+body+'\n');chmodSync(path,0o755);};
  command('git',`echo "git $*" >> "$TRACE"
if [[ "$1" == -C ]]; then shift 2; fi
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
  // psql synthétique : relevé du snapshot avec fichiers référencés (FILES_EXPECTED / REFS).
  // tar : tracé avec l'identité demandée ; en root, privilèges RÉELLEMENT abandonnés.
  command('sudo',`[[ "$1" == -u ]]; u="$2"; shift 2; [[ "$1" != -- ]] || shift
case "$1" in
tar) echo "tar-as $u $*" >> "$TRACE"; if [[ "$EUID" == 0 ]]; then exec setpriv --reuid="$u" --regid="$(id -g "$u")" --clear-groups -- "$@"; fi; exec "$@";;
pg_dump) echo "dump $*" >> "$TRACE"; [[ "\u0024{DUMP_FAIL:-0}" == 0 ]] || exit 3; echo '-- SYNTHETIC SQL DUMP';;
psql) echo 'snapshot-open' >> "$TRACE"; IFS= read -r first; echo '00000001-00000002-1'; while IFS= read -r line; do [[ "$line" != *q ]] || break; done; [[ "\u0024{MANIFEST_FAIL:-0}" == 0 ]] || exit 4; echo 'rows.fixture=1'; echo 'audit_head=none'; echo "files_expected=\u0024{FILES_EXPECTED:-1}"; for r in \u0024{REFS-${STORE_ID}}; do echo "ref=$r"; done;;
*) exec "$@";;
esac`);
  const run=(script,extra={},args=[])=>spawnSync('bash',[join(lib,'infra/deploy/scripts',script),...args],{env:{...env,...extra},encoding:'utf8',timeout:20_000});
  const trace=()=>existsSync(env.TRACE)?readFileSync(env.TRACE,'utf8'):'';
  return {dir,lib,env,run,trace,command,clean:()=>rmSync(dir,{recursive:true,force:true})};
}
const published=(f)=>readdirSync(f.env.BACKUP_DIR).filter((n)=>!n.startsWith('.'));
const manifestOf=(f)=>join(f.env.BACKUP_DIR,published(f).find((n)=>n.includes('_manifest_')));
const manifestEntries=(f)=>Object.fromEntries(readFileSync(manifestOf(f),'utf8').trim().split('\n').map((l)=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)];}));
function archivedNames(f) {
  const enc=join(f.env.BACKUP_DIR,published(f).find((n)=>n.includes('_files_')));
  const clear=spawnSync('openssl',['enc','-d','-aes-256-cbc','-pbkdf2','-pass','file:'+f.env.BACKUP_KEY_FILE,'-in',enc]);assert.equal(clear.status,0);
  const list=spawnSync('tar',['-tzf','-'],{input:clear.stdout,encoding:'utf8'});assert.equal(list.status,0);return list.stdout.trim().split('\n');
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
test('déploiement B3 : rappel non bloquant si les scripts root installés ne sont pas au SHA déployé',()=>{
  const f=fixture();try {
    let r=f.run('deploy.sh',deployEnv);assert.equal(r.status,0,r.stderr+r.stdout);assert.match(r.stdout,/AVERTISSEMENT \(B3\).*install_root_scripts\.sh a{40}/);
    writeRootManifest(f.lib,sha);r=f.run('deploy.sh',deployEnv);assert.equal(r.status,0,r.stderr+r.stdout);assert.match(r.stdout,/Scripts root : copie installée au même SHA/);assert.doesNotMatch(r.stdout,/AVERTISSEMENT \(B3\)/);
  }finally{f.clean();}
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
  const f=fixture();try{const r=f.run('pg_dump_encrypted.sh');assert.equal(r.status,0,r.stderr+r.stdout);const files=published(f);assert.equal(files.length,3);const manifest=manifestOf(f);await checkBackup(manifest);assert.match(f.trace(),/pg_dump .*--snapshot 00000001-00000002-1/);
    const m=manifestEntries(f);assert.equal(m.files_count,'1');assert.equal(m.files_expected,'1');assert.equal(m.files_missing,'0');assert.ok(!Object.keys(m).some((k)=>k==='ref'),'identifiants de stockage jamais publiés au manifeste');assert.doesNotMatch(readFileSync(manifest,'utf8'),new RegExp(STORE_ID));
    const db=join(f.env.BACKUP_DIR,files.find(n=>n.endsWith('.sql.gz.enc')));const decoded=spawnSync('openssl',['enc','-d','-aes-256-cbc','-pbkdf2','-pass','file:'+f.env.BACKUP_KEY_FILE,'-in',db]);assert.equal(decoded.status,0);const sql=spawnSync('gunzip',{input:decoded.stdout,encoding:'utf8'});assert.match(sql.stdout,/SYNTHETIC SQL DUMP/);
    chmodSync(db,0o600);writeFileSync(db,'ALTERED');await assert.rejects(checkBackup(manifest));assert.ok(readdirSync(f.env.BACKUP_DIR).every(n=>!n.startsWith('.backup.')||n==='.backup.lock'));
  }finally{f.clean();}
});
test('backup : invocation concurrente refusée, aucun fichier écrasé',()=>{
  const f=fixture();try{f.command('flock','exit 1');const r=f.run('pg_dump_encrypted.sh');assert.notEqual(r.status,0);assert.match(r.stderr,/déjà en cours/);assert.equal(f.trace(),'');}finally{f.clean();}
});
// ── B4 : magasin résolu comme l'API (.env lu comme données), complétude contrôlée ──
test('backup B4 : KYC_STORAGE_DIR lu dans le .env de l’API (absolu) quand la crontab ne le pose pas',()=>{
  const f=fixture();try{
    const relocated=appStore(join(f.dir,'relocated-store'));copyFileSync(join(f.env.KYC_STORAGE_DIR,`${STORE_ID}.bin`),join(relocated,`${STORE_ID}.bin`));own(relocated);
    // Répertoire par défaut présent mais VIDE : c'est lui que l'ancien script archivait.
    mkdirSync(join(f.env.APP_DIR,'apps/api/storage/kyc'),{recursive:true});
    writeFileSync(f.env.API_ENV_FILE,`NODE_ENV=production\nJWT_SECRET="SYNTHETIC SECRET VALUE"\nKYC_STORAGE_DIR="${relocated}"\n`);
    const r=f.run('pg_dump_encrypted.sh',{KYC_STORAGE_DIR:''});assert.equal(r.status,0,r.stderr+r.stdout);
    assert.match(r.stdout,new RegExp(`Sauvegarde du magasin de fichiers ${relocated}`));assert.doesNotMatch(r.stdout+r.stderr,/SYNTHETIC SECRET VALUE/);
    assert.ok(archivedNames(f).includes(`relocated-store/${STORE_ID}.bin`));assert.equal(manifestEntries(f).files_missing,'0');
  }finally{f.clean();}
});
test('backup B4 : valeur vide ou relative résolue depuis le cwd PM2 de l’API (répertoire du .env)',()=>{
  for(const value of ['""','storage/kyc','"  ./storage/../storage/kyc  "']){const f=fixture();try{
    const store=appStore(join(f.env.APP_DIR,'apps/api/storage/kyc'));copyFileSync(join(f.env.KYC_STORAGE_DIR,`${STORE_ID}.bin`),join(store,`${STORE_ID}.bin`));own(store);
    writeFileSync(f.env.API_ENV_FILE,`NODE_ENV=production\nKYC_STORAGE_DIR=${value}\n`);
    const r=f.run('pg_dump_encrypted.sh',{KYC_STORAGE_DIR:''});assert.equal(r.status,0,value+r.stderr+r.stdout);
    assert.match(r.stdout,new RegExp(`Sauvegarde du magasin de fichiers ${store}…`));assert.ok(archivedNames(f).includes(`kyc/${STORE_ID}.bin`));
  }finally{f.clean();}}
});
test('backup B4 : .env absent/lien, magasin lien symbolique ou fichier refusés avant dump',()=>{
  const f=fixture();try{
    rmSync(f.env.API_ENV_FILE);assert.notEqual(f.run('pg_dump_encrypted.sh',{KYC_STORAGE_DIR:''}).status,0);
    const real=join(f.dir,'real.env');writeFileSync(real,`KYC_STORAGE_DIR=${f.env.KYC_STORAGE_DIR}\n`);symlinkSync(real,f.env.API_ENV_FILE);assert.notEqual(f.run('pg_dump_encrypted.sh',{KYC_STORAGE_DIR:''}).status,0);
    const link=join(f.dir,'store-link');symlinkSync(f.env.KYC_STORAGE_DIR,link);assert.notEqual(f.run('pg_dump_encrypted.sh',{KYC_STORAGE_DIR:link}).status,0);
    const file=join(f.dir,'not-a-dir');writeFileSync(file,'x');assert.notEqual(f.run('pg_dump_encrypted.sh',{KYC_STORAGE_DIR:file}).status,0);
    assert.equal(f.trace(),'');assert.deepEqual(published(f),[]);
  }finally{f.clean();}
});
test('backup B4 : fichier référencé absent de l’archive ⇒ échec, trio déclaré incomplet, aucune purge',async()=>{
  const missing='00000000-0000-4000-8000-000000000002';
  for(const extra of [{FILES_EXPECTED:'2',REFS:`${STORE_ID} ${missing}`},{FILES_EXPECTED:'1',REFS:missing}]){const f=fixture();try{
    const old=join(f.env.BACKUP_DIR,'digisante_20000101_000000.sql.gz.enc');writeFileSync(old,'OLD SYNTHETIC');utimesSync(old,new Date(0),new Date(0));
    const r=f.run('pg_dump_encrypted.sh',extra);assert.notEqual(r.status,0);assert.match(r.stdout,/ÉCHEC : magasin de fichiers incomplet — 1 fichier\(s\) référencé\(s\)/);
    assert.ok(existsSync(old),'aucune purge sur sauvegarde incomplète');assert.equal(manifestEntries(f).files_missing,'1');
    await assert.rejects(checkBackup(manifestOf(f)),/Magasin de fichiers incomplet/);
    const cli=spawnSync(process.execPath,[join(f.lib,'scripts/preproduction/check-backup.mjs'),manifestOf(f),'--metadata-only'],{encoding:'utf8'});assert.equal(cli.status,1);assert.match(cli.stderr,/Magasin de fichiers incomplet/);
  }finally{f.clean();}}
});
// ── B3/B4 : la valeur du .env (fichier de l'utilisateur applicatif) est HOSTILE pour root ──
test('backup B3/B4 : magasin hors utilisateur applicatif, ouvert en écriture ou nommé comme une option ⇒ refusé AVANT dump',()=>{
  const f=fixture();try{
    const fill=(dir)=>{writeFileSync(join(dir,`${STORE_ID}.bin`),'SYNTHETIC ENCRYPTED FILE');return dir;};
    // Répertoire de root (ex. /etc/digisante, /root) : en root, répertoire de fixture laissé à root.
    const hostile=[IS_ROOT?fill(appStore(join(f.dir,'root-owned'))):'/etc'];
    for(const mode of [0o770,0o707]){const d=fill(appStore(join(f.dir,`shared-${mode.toString(8)}`)));own(d);chmodSync(d,mode);hostile.push(d);}
    // Nom lu comme une option par tar si passé sans `--` (ici : action exécutée à chaque point de contrôle).
    const optionShaped=fill(appStore(join(f.dir,'--checkpoint-action=exec=touch PWNED')));own(optionShaped);hostile.push(optionShaped);
    if(IS_ROOT){const other=fill(appStore(join(f.dir,'other-account')));lchownSync(other,65533,65533);hostile.push(other);}
    for(const dir of hostile){
      for(const via of ['crontab','.env']){
        writeFileSync(f.env.API_ENV_FILE,`NODE_ENV=production\nKYC_STORAGE_DIR="${dir}"\n`);
        const r=f.run('pg_dump_encrypted.sh',via==='crontab'?{KYC_STORAGE_DIR:dir}:{KYC_STORAGE_DIR:''});
        assert.notEqual(r.status,0,`${dir} (${via}) archivé : ${r.stdout}`);assert.match(r.stderr,/ÉCHEC : magasin de fichiers .*refusé/,dir);
        assert.equal(f.trace(),'',`${dir} (${via}) : aucun snapshot, dump ni tar avant refus`);assert.deepEqual(published(f),[]);
      }
    }
    assert.ok(!existsSync(join(f.dir,'PWNED')),'option injectée exécutée');
  }finally{f.clean();}
});
test('backup B3/B4 : tar lancé sous l’identité de l’utilisateur applicatif, nom du magasin après « -- »',()=>{
  const f=fixture();try{
    const r=f.run('pg_dump_encrypted.sh');assert.equal(r.status,0,r.stderr+r.stdout);
    assert.match(f.trace(),new RegExp(`^tar-as ${APP.user} tar -C ${f.dir} --verbose -cf - -- files$`,'m'));
    assert.match(r.stdout,new RegExp(`Archivage sous l'identité ${APP.user} \\(uid ${APP.uid}\\)`));
    const src=readFileSync(join(f.lib,'infra/deploy/scripts/pg_dump_encrypted.sh'),'utf8');
    assert.match(src,/sudo -u "\$APP_USER" -- tar -C "\$STORE_PARENT" --verbose -cf - -- "\$STORE_BASE"/);
    // APP_USER root ou inconnu : refus avant toute lecture du .env.
    for(const user of ['root','digisante-absent-user']){const bad=f.run('pg_dump_encrypted.sh',{APP_USER:user});assert.notEqual(bad.status,0,user);assert.match(bad.stderr,/utilisateur applicatif \(APP_USER\) introuvable ou root/);}
  }finally{f.clean();}
});
test('backup B3/B4 : fichier root glissé dans le magasin jamais lu par root ⇒ échec, rien de publié',{skip:!IS_ROOT&&'abandon réel des privilèges : exige root'},()=>{
  const f=fixture();try{
    const old=join(f.env.BACKUP_DIR,'digisante_20000101_000000.sql.gz.enc');writeFileSync(old,'OLD SYNTHETIC');utimesSync(old,new Date(0),new Date(0));
    // Laissé à root, 0600 : l'utilisateur applicatif (donc l'API) ne peut pas le lire.
    const secret=join(f.env.KYC_STORAGE_DIR,'00000000-0000-4000-8000-0000000000ff.bin');writeFileSync(secret,'ROOT ONLY SYNTHETIC SECRET');chmodSync(secret,0o600);
    const r=f.run('pg_dump_encrypted.sh');assert.notEqual(r.status,0,r.stdout);
    assert.match(r.stdout,/ÉCHEC : archivage du magasin impossible sous l'identité nobody/);assert.match(r.stderr,/\[pg_dump\] tar : .*Permission denied/);
    assert.deepEqual(published(f),['digisante_20000101_000000.sql.gz.enc'],'rien de publié, aucune purge');
  }finally{f.clean();}
});
test('vérification cible : --run-jobs refuse une production déclarée avant toute sonde',()=>{
  const f=fixture();try{const r=f.run('verify_deploy.sh',{DOMAIN:'preprod.example.bj',VERIFY_JOB_ENVIRONMENT:'production'},['--run-jobs']);assert.notEqual(r.status,0);assert.equal(f.trace(),'');}finally{f.clean();}
});

function verifyFixture(crontabBody) {
  const f=fixture();
  f.command('pm2',`echo '[{"name":"digisante-api","pm2_env":{"status":"online"}},{"name":"digisante-api","pm2_env":{"status":"online"}},{"name":"digisante-web","pm2_env":{"status":"online"}}]'`);
  f.command('pnpm',`echo 'Database schema is up to date!'`);
  f.command('openssl',`if [[ "$1" == x509 ]]; then cat >/dev/null; echo "notAfter=$(date -d '+30 days')"; else echo CERT; [[ "\u0024{TLS_FAIL:-0}" == 0 ]]; fi`);
  f.command('curl',`case "$*" in
*health*) echo '{"status":"ok","service":"digisante-api"}';;
*ready*) echo '{"status":"ready","db":"up","redis":"up"}';;
*chat/ws*) echo '101';;
*) echo 'Strict-Transport-Security: max-age=31536000';;
esac`);
  const cron=join(f.dir,'crontab.txt');writeFileSync(cron,crontabBody??readFileSync(resolve(root,'infra/deploy/crontab.preproduction.example'),'utf8').replaceAll('/usr/local/lib/digisante',f.lib));
  f.command('crontab',`cat '${cron}'`);
  f.command('timedatectl',`echo Africa/Porto-Novo`);
  // Tâche synthétique : la copie INSTALLÉE (ROOT_LIB) est appelée, jamais APP_DIR.
  writeFileSync(join(f.lib,'infra/deploy/scripts/internal_job.sh'),'echo job-called >> "$TRACE"\n');
  const appJob=join(f.env.APP_DIR,'infra/deploy/scripts');mkdirSync(appJob,{recursive:true});writeFileSync(join(appJob,'internal_job.sh'),'echo app-dir-job-called >> "$TRACE"\n');
  writeRootManifest(f.lib,sha);
  const ws=join(f.dir,'ws.log');writeFileSync(ws,'');
  return {f,ws};
}
test('vérification : sondes par défaut sans tâches ; opt-in synthétique lance exactement six tâches de la copie root',()=>{
  for(const jobs of [false,true]) {
    const {f,ws}=verifyFixture();try {
      const r=f.run('verify_deploy.sh',{DOMAIN:'preprod.example.bj',VERIFY_JOB_ENVIRONMENT:'preproduction',WS_LOG:ws},jobs?['--run-jobs']:[]);
      assert.equal(r.status,0,r.stdout+r.stderr);assert.equal((f.trace().match(/job-called/g)||[]).length,jobs?6:0);assert.doesNotMatch(f.trace(),/app-dir-job-called/);
      assert.match(r.stdout,/PASS.*scripts root : .*conformes au manifeste/);assert.match(r.stdout,/PASS.*cron : aucun chemin sous/);
      // .env de l'API désigné comme DONNÉE (B4) : pas un exécutable sous APP_DIR.
      writeFileSync(join(f.dir,'crontab.txt'),`API_ENV_FILE=${f.env.APP_DIR}/apps/api/.env\n`+readFileSync(join(f.dir,'crontab.txt'),'utf8'));
      const withEnv=f.run('verify_deploy.sh',{DOMAIN:'preprod.example.bj',WS_LOG:ws});assert.equal(withEnv.status,0,withEnv.stdout);
      if(!jobs){const bad=f.run('verify_deploy.sh',{DOMAIN:'preprod.example.bj',WS_LOG:ws,TLS_FAIL:'1'});assert.notEqual(bad.status,0);assert.match(bad.stdout,/FAIL.*TLS/);}
    }finally{f.clean();}
  }
});
test('vérification B3 : crontab lançant APP_DIR ou journalisant chez l’utilisateur applicatif ⇒ FAIL',()=>{
  const legacy=(app)=>`J=${app}/infra/deploy/scripts/internal_job.sh\n*/5 * * * * $J /api/v1/reminders/generate >> /var/log/digisante/med_reminders.log 2>&1\n*/15 * * * * $J /api/v1/appointments/reminders/generate\n30 6 * * * $J /api/v1/vaccinations/reminders/generate\n40 6 * * * $J /api/v1/maternity/reminders/generate\n*/2 * * * * $J /api/v1/notifications/dispatch\n10 3 * * * $J /api/v1/sync/receipts/prune\n0 2 * * * ${app}/infra/deploy/scripts/pg_dump_encrypted.sh\n30 2 * * * ${app}/infra/deploy/scripts/fedapay_reconcile.sh\n*/5 * * * * ${app}/infra/deploy/scripts/healthwatch.sh\n15 3,15 * * * certbot renew\n`;
  const {f,ws}=verifyFixture('');try{
    writeFileSync(join(f.dir,'crontab.txt'),legacy(f.env.APP_DIR));
    const r=f.run('verify_deploy.sh',{DOMAIN:'preprod.example.bj',WS_LOG:ws});assert.notEqual(r.status,0);
    assert.match(r.stdout,/FAIL.*cron : chemin sous .* exécuté par root/);assert.match(r.stdout,/FAIL.*cron : journal root écrit dans \/var\/log\/digisante/);assert.match(r.stdout,/FAIL.*cron : .*healthwatch\.sh absent/);
  }finally{f.clean();}
});
test('vérification B3 : SHA root ≠ déployé = WARN non bloquant ; manifeste absent ou fichier altéré = FAIL',()=>{
  const {f,ws}=verifyFixture();try{
    const opts={DOMAIN:'preprod.example.bj',WS_LOG:ws};
    writeRootManifest(f.lib,'b'.repeat(40));let r=f.run('verify_deploy.sh',opts);assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/WARN.*scripts root installés au SHA b{40}, déployé a{40}/);assert.match(r.stdout,/avertissements=1/);
    writeFileSync(join(f.lib,'infra/deploy/scripts/healthwatch.sh'),'#!/bin/bash\necho altered\n');r=f.run('verify_deploy.sh',opts);assert.notEqual(r.status,0);assert.match(r.stdout,/FAIL.*incomplète ou altérée \(1\//);
    rmSync(join(f.lib,'root-scripts.manifest'));r=f.run('verify_deploy.sh',opts);assert.notEqual(r.status,0);assert.match(r.stdout,/FAIL.*manifeste .* absent ou non fiable/);
  }finally{f.clean();}
});

const healthEnv=(f)=>({STATE_DIR:join(f.dir,'state'),HEALTHWATCH_CONF:join(f.dir,'no-conf'),ALERT_CMD:'',DOMAIN:'',PM2_CHECK:'0',DISK_PATHS:f.dir,JOB_LOGS:join(f.dir,'no-log'),API_LOG:join(f.dir,'no-api-log'),PSQL:join(f.dir,'bin/fixture-psql')});
test('healthwatch : archive DB seule refusée ; trio accepté ; horodatage futur et HTML 200 alertés',()=>{
  const f=fixture();try {
    f.command('fixture-psql','echo 0');f.command('logger',':');
    const env=healthEnv(f);
    assert.equal(f.run('pg_dump_encrypted.sh').status,0);
    let r=f.run('healthwatch.sh',env);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/backup +OK +trio publié/);
    const manifest=manifestOf(f);
    utimesSync(manifest,new Date(Date.now()+45_000),new Date(Date.now()+45_000));
    r=f.run('healthwatch.sh',env);assert.match(r.stdout,/backup +ALERTE +sauvegarde périmée ou horodatage futur/);
    utimesSync(manifest,new Date(),new Date());
    rmSync(join(f.env.BACKUP_DIR,published(f).find(n=>n.includes('_files_'))));
    r=f.run('healthwatch.sh',{...env,BAD_READY:'1'});assert.match(r.stdout,/backup +ALERTE +trio/);assert.match(r.stdout,/ready +ALERTE/);
    rmSync(manifest);r=f.run('healthwatch.sh',env);assert.match(r.stdout,/backup +ALERTE +aucune sauvegarde complète/);
  }finally{f.clean();}
});
test('healthwatch B4 : magasin incomplet (archivés < référencés) alerté',()=>{
  const f=fixture();try{
    f.command('fixture-psql','echo 0');f.command('logger',':');
    assert.notEqual(f.run('pg_dump_encrypted.sh',{FILES_EXPECTED:'3',REFS:`${STORE_ID} 00000000-0000-4000-8000-000000000002 00000000-0000-4000-8000-000000000003`}).status,0);
    const r=f.run('healthwatch.sh',healthEnv(f));assert.match(r.stdout,/backup +ALERTE +.*magasin de fichiers incomplet/);
  }finally{f.clean();}
});
test('healthwatch B3 : module de contrôle modifiable par autrui jamais exécuté ; journaux root hors répertoire applicatif',()=>{
  const f=fixture();try{
    f.command('fixture-psql','echo 0');f.command('logger',':');assert.equal(f.run('pg_dump_encrypted.sh').status,0);
    const marker=join(f.dir,'module-executed');const mod=join(f.lib,'scripts/preproduction/check-backup.mjs');
    writeFileSync(mod,`import { writeFileSync } from 'node:fs';writeFileSync(${JSON.stringify(marker)},'pwned');`);chmodSync(mod,0o664);
    const r=f.run('healthwatch.sh',healthEnv(f));assert.match(r.stdout,/backup +ALERTE +module de contrôle des sauvegardes absent ou modifiable/);assert.ok(!existsSync(marker),'module non fiable exécuté par root');
    const src=readFileSync(join(f.lib,'infra/deploy/scripts/healthwatch.sh'),'utf8');assert.doesNotMatch(src,/\/var\/log\/digisante\/(?!api-)/);
  }finally{f.clean();}
});
test('B3 : scripts root refusent de s’exécuter depuis un emplacement modifiable par un autre compte',()=>{
  for(const script of ['internal_job.sh','fedapay_reconcile.sh','healthwatch.sh','pg_dump_encrypted.sh','verify_deploy.sh']){const f=fixture();try{
    const path=join(f.lib,'infra/deploy/scripts',script);chmodSync(path,0o775);
    const r=f.run(script,{DOMAIN:'preprod.example.bj',RECONCILE_TOKEN_FILE:f.env.BACKUP_KEY_FILE,...healthEnv(f)},script==='internal_job.sh'?['/api/v1/notifications/dispatch']:[]);
    assert.notEqual(r.status,0,script);assert.match(r.stderr,/modifiable par un autre compte/,script);assert.equal(f.trace(),'',script);
    chmodSync(path,0o755);chmodSync(join(f.lib,'infra/deploy/scripts'),0o777);assert.notEqual(f.run(script,{DOMAIN:'preprod.example.bj',...healthEnv(f)},script==='internal_job.sh'?['/x']:[]).status,0,script+' (répertoire)');
  }finally{f.clean();}}
});
test('B3 : réponse API recopiée au journal root bornée et sans séquence d’échappement',()=>{
  const f=fixture();try{
    f.command('curl',`while [[ $# -gt 0 ]]; do if [[ "$1" == -o ]]; then printf 'ok\\033]0;pwn\\007\\nssh-ed25519 AAAA attacker\\n%.0s' {1..2} > "$2"; fi; shift; done; printf 200`);
    const token=join(f.dir,'token');writeFileSync(token,'SYNTHETIC TOKEN');chmodSync(token,0o600);
    const r=f.run('internal_job.sh',{RECONCILE_TOKEN_FILE:token},['/api/v1/notifications/dispatch']);assert.equal(r.status,0,r.stderr);
    assert.doesNotMatch(r.stdout,/\u001b/);assert.equal(r.stdout.trim().split('\n').length,1);
    const rec=f.run('fedapay_reconcile.sh',{RECONCILE_TOKEN_FILE:token});assert.equal(rec.status,0,rec.stderr);assert.doesNotMatch(rec.stdout,/[\u001b\u0007]/);
  }finally{f.clean();}
});
test('manifeste B4 : files_expected/files_missing contrôlés ; ancien format accepté et signalé',()=>{
  const stamp='20261013_020000';const name=`digisante_manifest_${stamp}.txt`;
  const base=`stamp=${stamp}\ndb_archive=digisante_${stamp}.sql.gz.enc sha256=${'a'.repeat(64)}\nfiles_archive=digisante_files_${stamp}.tar.gz.enc sha256=${'b'.repeat(64)}\nrows.fixture=1\naudit_head=none\n`;
  assert.deepEqual(parseManifest(base+'files_count=0\n',name).files,{count:0,expected:null,missing:null,legacy:true});
  assert.deepEqual(parseManifest(base+'files_count=5\nfiles_expected=3\nfiles_missing=0\n',name).files,{count:5,expected:3,missing:0,legacy:false});
  assert.equal(parseManifest(base+'files_count=3\nfiles_expected=3\nfiles_missing=0\n',name).files.legacy,false);
  for(const bad of ['files_count=0\nfiles_expected=1\n','files_count=2\nfiles_expected=3\nfiles_missing=0\n','files_count=4\nfiles_expected=3\nfiles_missing=1\n','files_count=4\nfiles_expected=x\n','files_count=4\nfiles_missing=-1\n']) assert.throws(()=>parseManifest(base+bad,name),bad);
});
