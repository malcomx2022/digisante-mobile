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
const REAL_STAT=spawnSync('bash',['-c','command -v stat'],{encoding:'utf8'}).stdout.trim();
// Identifiant de stockage opaque (format lib/filestore) du fichier synthétique du magasin.
const STORE_ID='00000000-0000-4000-8000-000000000001';
const ROOT_LIST=readFileSync(resolve(root,'infra/deploy/root-scripts.list'),'utf8').split('\n').map((l)=>/^(0755|0644) (\S+)$/.exec(l)).filter(Boolean).map((m)=>({mode:parseInt(m[1],8),path:m[2]}));
const sha256=(path)=>createHash('sha256').update(readFileSync(path)).digest('hex');
// Utilisateur applicatif du magasin (B4) : jamais root. En root, `nobody` (le shim sudo
// abandonne réellement les privilèges pour tar) ; sinon l'utilisateur courant de la CI.
const IS_ROOT=process.getuid?.()===0;
const APP=IS_ROOT?{user:'nobody',uid:65534,gid:65534}:{user:userInfo().username,uid:process.getuid(),gid:process.getgid()};
// Compte sans droits des tâches (B3) : en root, `daemon` (≠ utilisateur applicatif `nobody`),
// les requêtes des tâches abandonnent réellement les privilèges ; hors root, rien à abandonner.
// Hors root, compte existant distinct de l'utilisateur courant (contrôlé par verify_deploy seulement).
const JOBS=IS_ROOT?{user:'daemon',uid:1}:{user:'nobody',uid:65534};
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
function writeRootManifest(lib,installedSha,environment='preproduction') {
  const lines=[`sha=${installedSha}`,`environment=${environment}`,'branch=main','source=file:///synthetic','installed_at=2026-10-13T00:00:00+01:00',...ROOT_LIST.map(({mode,path})=>`file=${path} mode=0${mode.toString(8)} sha256=${sha256(join(lib,path))}`)];
  writeFileSync(join(lib,'root-scripts.manifest'),lines.join('\n')+'\n');chmodSync(join(lib,'root-scripts.manifest'),0o644);
}
function fixture() {
  const dir=mkdtempSync(join(tmpdir(),'digisante-l10-'));chmodSync(dir,0o755);const bin=join(dir,'bin');mkdirSync(bin);const lib=join(dir,'lib');copyTree(lib);
  const env={...process.env,PATH:bin+':'+process.env.PATH,REAL_STAT,FAKE_ROOT_PARENT:dirname(dir),DIGISANTE_ENV:'preproduction',APP_DIR:join(dir,'app'),APP_USER:APP.user,JOBS_USER:JOBS.user,LOG_DIR:join(dir,'log'),TRACE:join(dir,'trace'),DB_NAME:'fixture_preprod',BACKUP_DIR:join(dir,'backups'),BACKUP_KEY_FILE:join(dir,'backup.key'),KYC_STORAGE_DIR:join(dir,'files'),ROOT_LIB:lib,ROOT_SCRIPTS_MANIFEST:join(lib,'root-scripts.manifest'),API_ENV_FILE:join(dir,'app/apps/api/.env')};
  for(const path of [env.APP_DIR,env.LOG_DIR,env.BACKUP_DIR,join(env.APP_DIR,'apps/api')]) mkdirSync(path,{recursive:true});
  appStore(env.KYC_STORAGE_DIR);
  // Le script de déploiement contrôle le profil complet ; les services synthétiques
  // ne doivent pas hériter des URLs NODE_ENV=test de la CI qui lance cette suite.
  delete env.DATABASE_URL; delete env.REDIS_URL; env.NODE_ENV='production';
  writeFileSync(join(env.APP_DIR,'apps/api/.env'),'NODE_ENV=production\nDATABASE_URL=postgresql://digisante_preprod_app:synthetic@127.0.0.1:5432/digisante_preprod?schema=public\nREDIS_URL=redis://digisante-preprod:synthetic@127.0.0.1:6379/5\nREDIS_KEY_PREFIX=digisante-preprod:\n');chmodSync(join(env.APP_DIR,'apps/api/.env'),0o600);
  writeFileSync(env.BACKUP_KEY_FILE,'SYNTHETIC TEST KEY');chmodSync(env.BACKUP_KEY_FILE,0o600);
  writeFileSync(env.TRACE,'');chmodSync(env.TRACE,0o666);
  writeFileSync(join(env.KYC_STORAGE_DIR,`${STORE_ID}.bin`),'SYNTHETIC ENCRYPTED FILE');own(env.KYC_STORAGE_DIR);
  const command=(name,body)=>{const path=join(bin,name);writeFileSync(path,'#!/bin/bash\nset -euo pipefail\n'+body+'\n');chmodSync(path,0o755);};
  // Certains exécuteurs mappent root vers nobody pour / et /tmp. Normaliser ces
  // deux ancêtres extérieurs à la fixture, sans changer leurs modes ni les fichiers testés.
  command('stat',`p="\u0024{@: -1}"
if [[ "$1" == -c && "$2" == '%u %a' && ( "$p" == / || "$p" == "$FAKE_ROOT_PARENT" ) ]]; then
  printf '0 %s\\n' "$("$REAL_STAT" -c %a -- "$p")"
else exec "$REAL_STAT" "$@"; fi`);
  command('git',`echo "git $*" >> "$TRACE"
if [[ "$1" == -C ]]; then shift 2; fi
case "$1" in
status) [[ "\u0024{DIRTY:-0}" == 0 ]] || echo ' M synthetic';;
rev-parse) echo '${sha}';;
show) echo '{"packageManager":"pnpm@9.12.0"}';;
merge-base) [[ "\u0024{WRONG_BRANCH:-0}" == 0 ]];;
esac`);
  // Script racine `build` = `pnpm -r build` : l'appel imbriqué passe par le PATH (shim de deploy.sh).
  command('pnpm',`echo "pnpm $*" >> "$TRACE"; if [[ "\u0024{BUILD_FAIL:-0}" == 1 && "$1" == build ]]; then exit 9; fi; if [[ "$1" == build ]]; then pnpm -r build; fi`);
  // deploy.sh : shim \`pnpm\` → \`corepack pnpm …\` (version épinglée) ; \`corepack pnpm@x.y.z --version\` prépare
  // la version de la cible. Délègue au pnpm simulé par chemin absolu (le shim est en tête du PATH).
  command('corepack',`if [[ "$1" == pnpm@* && "$2" == --version ]]; then echo "corepack $*" >> "$TRACE"; echo "\u0024{FAKE_COREPACK_VERSION:-\u0024{1#pnpm@}}"; exit 0; fi
echo "corepack $*" >> "$TRACE"; [[ "$1" == pnpm ]] || exit 2; shift; exec "$(dirname "$0")/pnpm" "$@"`);
  command('pm2',`echo "pm2 $*" >> "$TRACE"
case "$1" in
jlist) other='{"name":"digisante-api","pm2_env":{"status":"online"}},{"name":"digisante-web","pm2_env":{"status":"online"}}'; other="\u0024{OTHER_ENV:-$other}"
  old='{"name":"'"\u0024{OLD_API:-digisante-preprod-api}"'","pm2_env":{"status":"online"}},{"name":"'"\u0024{OLD_WEB:-digisante-preprod-web}"'","pm2_env":{"status":"online"}}'
  if [[ "\u0024{PM2_BROKEN:-0}" == 1 ]]; then echo invalid; elif [[ "\u0024{OLD_WRITERS:-0}" == 1 && ! -f "$APP_DIR/stopped" ]]; then echo "[$old,$other]";
  elif [[ "\u0024{OLD_WRITERS:-0}" == 1 && ! -f "$APP_DIR/deleted" ]]; then echo "[\u0024{old//online/stopped},$other]"; else echo "[$other]"; fi;;
stop) [[ "\u0024{STOP_FAIL:-0}" == 0 ]] || exit 2; touch "$APP_DIR/stopped";;
delete) touch "$APP_DIR/deleted";;
startOrReload) echo "pm2-env DIGISANTE_ENV=\u0024{DIGISANTE_ENV:-absent}" >> "$TRACE"; touch "$APP_DIR/started";;
esac`);
  // ss synthétique. Sans -e (contrôle « ports libres » de deploy.sh avant migrations) : vide,
  // sauf PORT_BUSY=1. Avec -e (port_owned_by) : ports du profil tenus par l'utilisateur
  // applicatif (PORT_UID), sauf PORTS_DOWN=1 ; en déploiement, seulement après le démarrage
  // PM2 ; SQUAT_PORT ajoute un écouteur d'un autre compte (uid 4242) sur ce port.
  command('ss',`echo "ss $*" >> "$TRACE"
if [[ "$1" == -Htlne ]]; then
  if [[ "\u0024{PORTS_DOWN:-0}" != 1 && ( "\u0024{DEPLOY_PORTS:-0}" != 1 || -f "$APP_DIR/started" ) ]]; then
    for p in 3100 3101 3200 3201; do [[ "$*" != *":$p "* ]] || echo "LISTEN 0 511 127.0.0.1:$p 0.0.0.0:* uid:\u0024{PORT_UID:-${APP.uid}} ino:1 sk:1 <->"; done
  fi
  if [[ -n "\u0024{SQUAT_PORT:-}" && "$*" == *":\u0024{SQUAT_PORT} "* ]]; then echo "LISTEN 0 5 127.0.0.2:\u0024{SQUAT_PORT} 0.0.0.0:* uid:4242 ino:2 sk:2 <->"; fi
  exit 0
fi
if [[ "\u0024{PORT_BUSY:-0}" == 1 ]]; then echo 'LISTEN 0 511 127.0.0.1:3101 0.0.0.0:*'; fi`);
  command('curl',`echo "curl $*" >> "$TRACE"; if [[ "\u0024{BAD_READY:-0}" == 1 ]]; then echo '<html>wrong backend</html>'; else echo '{"status":"ready","db":"up","redis":"up"}'; fi`);
  command('sleep',':');
  // Droits du rôle d'exécution appliqués par deploy.sh sous le propriétaire (SQL sur l'entrée standard).
  command('psql',`echo "psql $* user=\u0024{PGUSER:-}" >> "$TRACE"; cat >/dev/null`);
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
// URL du rôle PROPRIÉTAIRE fournie par l'environnement du déploiement (revue GO du 22/10/2026), jamais par le .env.
const deployEnv={DEPLOY_PORTS:'1',DEPLOY_REF:sha,DEPLOY_ENVIRONMENT:'preproduction',DEPLOY_MAINTENANCE_READY:'1',MIGRATION_DATABASE_URL:'postgresql://digisante_preprod:owner-synthetic@127.0.0.1:5432/digisante_preprod?schema=public'};
test('déploiement : SHA/maintenance/env production/change opérateur/branche exigés avant effets',()=>{
  for(const change of [{DEPLOY_REF:'main'},{DEPLOY_MAINTENANCE_READY:'0'},{DEPLOY_ENVIRONMENT:'bad'},{DIRTY:'1'},{WRONG_BRANCH:'1'}]) {
    const f=fixture();try {const r=f.run('deploy.sh',{...deployEnv,...change});assert.notEqual(r.status,0,r.stderr);assert.doesNotMatch(f.trace(),/pnpm |pm2 /);}finally{f.clean();}
  }
  const f=fixture();try {writeFileSync(join(f.env.APP_DIR,'apps/api/.env'),'NODE_ENV=test\n');assert.notEqual(f.run('deploy.sh',deployEnv).status,0);assert.doesNotMatch(f.trace(),/pnpm |pm2 /);}finally{f.clean();}
});
test('déploiement : anciens writers arrêtés, SHA détaché, build avant migrate, succès tracé',()=>{
  const f=fixture();try {const r=f.run('deploy.sh',{...deployEnv,OLD_WRITERS:'1'});assert.equal(r.status,0,r.stderr+r.stdout);const t=f.trace();assert.ok(t.indexOf('pm2 stop')<t.indexOf('git switch --detach'));assert.ok(t.indexOf('pnpm build')<t.indexOf('prisma migrate deploy'));assert.ok(t.indexOf('prisma migrate deploy')<t.indexOf('pm2 startOrReload'));assert.ok(t.indexOf('prisma migrate deploy')<t.indexOf('pm2 delete')&&t.indexOf('pm2 delete')<t.indexOf('pm2 startOrReload'),'apps arrêtées recréées depuis l’ecosystem (startOrReload ne change ni script ni node_args)');assert.match(t,/^corepack pnpm install --frozen-lockfile$/m,'pnpm épinglé (corepack), jamais le pnpm global de l’hôte');assert.match(t,/^corepack pnpm -r build$/m,'appel imbriqué du script racine build : pnpm épinglé aussi');assert.ok(t.indexOf('corepack pnpm@9.12.0 --version')<t.indexOf('pm2 stop'),'version pnpm de la cible préparée avant l’arrêt PM2');assert.match(readFileSync(join(f.env.LOG_DIR,'deploy_history.log'),'utf8'),/status=SUCCESS/);}finally{f.clean();}
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
test('déploiement : pnpm de la cible indisponible via corepack ⇒ refus AVANT tout arrêt PM2 ou checkout',()=>{
  const f=fixture();try{const r=f.run('deploy.sh',{...deployEnv,OLD_WRITERS:'1',FAKE_COREPACK_VERSION:'9.11.0'});assert.notEqual(r.status,0);assert.match(r.stdout+r.stderr,/pnpm 9\.12\.0 indisponible via corepack/);assert.doesNotMatch(f.trace(),/pm2 stop|git switch|pnpm install/);}finally{f.clean();}
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
  // Préproduction en ligne ; la production de l'hôte partagé aussi (jamais comptée ici).
  f.command('pm2',`echo '[{"name":"digisante-preprod-api","pm2_env":{"status":"online"}},{"name":"digisante-preprod-api","pm2_env":{"status":"online"}},{"name":"digisante-preprod-web","pm2_env":{"status":"online"}},{"name":"digisante-api","pm2_env":{"status":"online"}}]'`);
  f.command('pnpm',`echo 'Database schema is up to date!'`);
  f.command('openssl',`if [[ "$1" == x509 ]]; then cat >/dev/null; echo "notAfter=$(date -d '+30 days')"; else echo CERT; [[ "\u0024{TLS_FAIL:-0}" == 0 ]]; fi`);
  f.command('curl',`case "$*" in
*health*) echo '{"status":"ok","service":"digisante-api"}';;
*ready*) echo '{"status":"ready","db":"up","redis":"up"}';;
*chat/ws*) echo '101';;
*) echo 'Strict-Transport-Security: max-age=31536000';;
esac`);
  // Fichier /etc/cron.d de l'environnement (CRON_FILE) ; la crontab root (partagée avec les
  // autres applications de l'hôte) est vide par défaut et n'est lue que pour B3.
  const cron=join(f.dir,'cron.d-digisante-preprod');writeFileSync(cron,crontabBody??readFileSync(resolve(root,'infra/deploy/crontab.preproduction.example'),'utf8').replaceAll('/usr/local/lib/digisante-preprod',f.lib));
  f.env.CRON_FILE=cron;
  const rootCron=join(f.dir,'crontab.txt');writeFileSync(rootCron,'');
  f.command('crontab',`cat '${rootCron}'`);
  f.command('timedatectl',`echo Africa/Porto-Novo`);
  // Tâche synthétique : la copie INSTALLÉE (ROOT_LIB) est appelée, jamais APP_DIR.
  writeFileSync(join(f.lib,'infra/deploy/scripts/internal_job.sh'),'echo job-called >> "$TRACE"\n');
  const appJob=join(f.env.APP_DIR,'infra/deploy/scripts');mkdirSync(appJob,{recursive:true});writeFileSync(join(appJob,'internal_job.sh'),'echo app-dir-job-called >> "$TRACE"\n');
  writeRootManifest(f.lib,sha);
  const ws=join(f.dir,'ws.log');writeFileSync(ws,'');
  return {f,ws};
}
test('vérification : API sous le rôle d’exécution <base>_app exigée, propriétaire ou URL de migration dans le .env ⇒ FAIL',()=>{
  const {f,ws}=verifyFixture();try {
    const base={DOMAIN:'preprod.example.bj',VERIFY_JOB_ENVIRONMENT:'preproduction',WS_LOG:ws};
    let r=f.run('verify_deploy.sh',base);
    assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/PASS.*API sous le rôle d'exécution digisante_preprod_app/);
    for(const body of ['DATABASE_URL=postgresql://digisante_preprod:owner-synthetic@127.0.0.1:5432/digisante_preprod\n',
      'DATABASE_URL=postgresql://digisante_preprod_app:synthetic@127.0.0.1:5432/digisante_preprod\nMIGRATION_DATABASE_URL=postgresql://digisante_preprod:owner-synthetic@127.0.0.1:5432/digisante_preprod\n']) {
      writeFileSync(f.env.API_ENV_FILE,'NODE_ENV=production\n'+body);chmodSync(f.env.API_ENV_FILE,0o600);
      r=f.run('verify_deploy.sh',base);
      assert.notEqual(r.status,0);assert.match(r.stdout,/FAIL.*API \(\.env\) sous .* au lieu de digisante_preprod_app/);assert.doesNotMatch(r.stdout+r.stderr,/owner-synthetic/);
    }
  } finally {f.clean();}
});
test('vérification : API sous l’utilisateur ACL Valkey et le préfixe de l’environnement, default ou autre préfixe ⇒ FAIL',()=>{
  const {f,ws}=verifyFixture();try {
    const base={DOMAIN:'preprod.example.bj',VERIFY_JOB_ENVIRONMENT:'preproduction',WS_LOG:ws};
    let r=f.run('verify_deploy.sh',base);
    assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/PASS.*API sous l'utilisateur ACL Valkey digisante-preprod, préfixe digisante-preprod:/);
    const db='DATABASE_URL=postgresql://digisante_preprod_app:synthetic@127.0.0.1:5432/digisante_preprod\n';
    for(const body of ['REDIS_URL=redis://:valkey-synthetic@127.0.0.1:6379/5\nREDIS_KEY_PREFIX=digisante-preprod:\n',
      'REDIS_URL=redis://default:valkey-synthetic@127.0.0.1:6379/5\nREDIS_KEY_PREFIX=digisante-preprod:\n',
      'REDIS_URL=redis://digisante-preprod:valkey-synthetic@127.0.0.1:6379/5\nREDIS_KEY_PREFIX=digisante:\n',
      'REDIS_URL=redis://digisante-preprod:valkey-synthetic@127.0.0.1:6379/5\n']) {
      writeFileSync(f.env.API_ENV_FILE,'NODE_ENV=production\n'+db+body);chmodSync(f.env.API_ENV_FILE,0o600);
      r=f.run('verify_deploy.sh',base);
      assert.notEqual(r.status,0);assert.match(r.stdout,/FAIL.*utilisateur Valkey\/préfixe/);assert.doesNotMatch(r.stdout+r.stderr,/valkey-synthetic/);
    }
  } finally {f.clean();}
});
test('vérification : sondes par défaut sans tâches ; opt-in synthétique lance exactement six tâches de la copie root',()=>{
  for(const jobs of [false,true]) {
    const {f,ws}=verifyFixture();try {
      const r=f.run('verify_deploy.sh',{DOMAIN:'preprod.example.bj',VERIFY_JOB_ENVIRONMENT:'preproduction',WS_LOG:ws},jobs?['--run-jobs']:[]);
      assert.equal(r.status,0,r.stdout+r.stderr);assert.equal((f.trace().match(/job-called/g)||[]).length,jobs?6:0);assert.doesNotMatch(f.trace(),/app-dir-job-called/);
      assert.match(r.stdout,/PASS.*scripts root : .*conformes au manifeste/);assert.match(r.stdout,/PASS.*cron : aucun chemin sous/);
      // .env de l'API désigné comme DONNÉE (B4) : pas un exécutable sous APP_DIR.
      writeFileSync(f.env.CRON_FILE,`API_ENV_FILE=${f.env.APP_DIR}/apps/api/.env\n`+readFileSync(f.env.CRON_FILE,'utf8'));
      const withEnv=f.run('verify_deploy.sh',{DOMAIN:'preprod.example.bj',WS_LOG:ws});assert.equal(withEnv.status,0,withEnv.stdout);
      if(!jobs){const bad=f.run('verify_deploy.sh',{DOMAIN:'preprod.example.bj',WS_LOG:ws,TLS_FAIL:'1'});assert.notEqual(bad.status,0);assert.match(bad.stdout,/FAIL.*TLS/);}
    }finally{f.clean();}
  }
});
test('vérification B3 : crontab root lançant APP_DIR ou journalisant chez l’utilisateur applicatif ⇒ FAIL',()=>{
  const legacy=(app)=>`J=${app}/infra/deploy/scripts/internal_job.sh\n*/5 * * * * $J /api/v1/reminders/generate >> /var/log/digisante-preprod/med_reminders.log 2>&1\n*/15 * * * * $J /api/v1/appointments/reminders/generate\n30 6 * * * $J /api/v1/vaccinations/reminders/generate\n40 6 * * * $J /api/v1/maternity/reminders/generate\n*/2 * * * * $J /api/v1/notifications/dispatch\n10 3 * * * $J /api/v1/sync/receipts/prune\n0 2 * * * ${app}/infra/deploy/scripts/pg_dump_encrypted.sh\n30 2 * * * ${app}/infra/deploy/scripts/fedapay_reconcile.sh\n*/5 * * * * ${app}/infra/deploy/scripts/healthwatch.sh\n15 3,15 * * * certbot renew\n`;
  const {f,ws}=verifyFixture('');try{
    // Ancienne installation dans la crontab ROOT (hors fichier cron.d) : détectée quand même.
    writeFileSync(join(f.dir,'crontab.txt'),legacy(f.env.APP_DIR));
    const r=f.run('verify_deploy.sh',{DOMAIN:'preprod.example.bj',WS_LOG:ws});assert.notEqual(r.status,0);
    assert.match(r.stdout,/FAIL.*cron : chemin sous .* exécuté par root/);assert.match(r.stdout,/FAIL.*cron : journal root écrit dans \/var\/log\/digisante-preprod/);assert.match(r.stdout,/FAIL.*cron : .*healthwatch\.sh absent/);
    assert.match(r.stdout,/FAIL.*cron : DIGISANTE_ENV=preproduction absent/);
  }finally{f.clean();}
});
test('vérification B3 : fichier cron.d de l’environnement lançant APP_DIR ou journalisant chez l’utilisateur applicatif ⇒ FAIL',()=>{
  const {f,ws}=verifyFixture();try{
    writeFileSync(f.env.CRON_FILE,readFileSync(f.env.CRON_FILE,'utf8')+`*/5 * * * * root ${f.env.APP_DIR}/infra/deploy/scripts/healthwatch.sh >> /var/log/digisante-preprod/hw.log 2>&1\n`);
    const r=f.run('verify_deploy.sh',{DOMAIN:'preprod.example.bj',WS_LOG:ws});assert.notEqual(r.status,0);
    assert.match(r.stdout,/FAIL.*cron : chemin sous .* exécuté par root/);assert.match(r.stdout,/FAIL.*cron : journal root écrit dans \/var\/log\/digisante-preprod/);
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
    f.command('curl',`printf 'ok\\033]0;pwn\\007\\nssh-ed25519 AAAA attacker\\n%.0s' {1..2}; printf '\\n200'`);
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

// ── Hôte IONOS partagé : profil DIGISANTE_ENV (noms PM2, ports, copie root par environnement) ──
test('déploiement préproduction : arrête SEULEMENT digisante-preprod-*, readiness 127.0.0.1:3101, DIGISANTE_ENV transmis à PM2',()=>{
  const f=fixture();try{
    const r=f.run('deploy.sh',{...deployEnv,OLD_WRITERS:'1'});assert.equal(r.status,0,r.stderr+r.stdout);const t=f.trace();
    assert.match(t,/^pm2 stop digisante-preprod-api digisante-preprod-web$/m);
    assert.doesNotMatch(t,/^pm2 stop .*\bdigisante-(api|web)\b/m,'processus de production jamais arrêtés');
    assert.match(t,/^pm2 delete digisante-preprod-api digisante-preprod-web$/m);
    assert.doesNotMatch(t,/^pm2 delete .*\bdigisante-(api|web)\b/m,'définitions de production jamais supprimées');
    assert.match(t,/^pm2-env DIGISANTE_ENV=preproduction$/m);
    assert.match(t,/^curl .*http:\/\/127\.0\.0\.1:3101\/api\/v1\/ready$/m);assert.doesNotMatch(t,/127\.0\.0\.1:300[01]/);
  }finally{f.clean();}
});
test('déploiement production : arrête digisante-api/web (jamais la préproduction), readiness 127.0.0.1:3201',()=>{
  const f=fixture();try{
    writeFileSync(f.env.API_ENV_FILE,'NODE_ENV=production\nDATABASE_URL=postgresql://digisante_app:synthetic@127.0.0.1:5432/digisante?schema=public\nREDIS_URL=redis://digisante:synthetic@127.0.0.1:6379/6\nREDIS_KEY_PREFIX=digisante:\n');
    const r=f.run('deploy.sh',{...deployEnv,MIGRATION_DATABASE_URL:'postgresql://digisante:owner-synthetic@127.0.0.1:5432/digisante?schema=public',DEPLOY_ENVIRONMENT:'production',DIGISANTE_ENV:'',OLD_WRITERS:'1',OLD_API:'digisante-api',OLD_WEB:'digisante-web',OTHER_ENV:'{"name":"digisante-preprod-api","pm2_env":{"status":"online"}}'});
    assert.equal(r.status,0,r.stderr+r.stdout);const t=f.trace();
    assert.match(t,/^pm2 stop digisante-api digisante-web$/m);assert.doesNotMatch(t,/^pm2 stop .*preprod/m);
    assert.match(t,/^pm2 delete digisante-api digisante-web$/m);assert.doesNotMatch(t,/^pm2 delete .*preprod/m);
    assert.match(t,/^pm2-env DIGISANTE_ENV=production$/m);assert.match(t,/^curl .*http:\/\/127\.0\.0\.1:3201\/api\/v1\/ready$/m);
  }finally{f.clean();}
});
test('déploiement : port du profil encore à l’écoute après l’arrêt PM2 ⇒ refus avant checkout et migration',()=>{
  const f=fixture();try{
    const r=f.run('deploy.sh',{...deployEnv,OLD_WRITERS:'1',PORT_BUSY:'1'});assert.notEqual(r.status,0);const t=f.trace();
    assert.match(r.stdout+r.stderr,/port 3101 ou 3100 encore à l'écoute hors des apps PM2 de preproduction/);
    assert.ok(t.indexOf('pm2 stop')<t.indexOf('ss -Htln'),'contrôle APRÈS l’arrêt des apps du profil');
    assert.match(t,/^ss -Htln \( sport = :3101 or sport = :3100 \)$/m);
    assert.doesNotMatch(t,/git switch|prisma migrate deploy|pm2 delete|pm2 startOrReload/);
    assert.match(readFileSync(join(f.env.LOG_DIR,'deploy_history.log'),'utf8'),/status=FAILED stage=maintenance/);
  }finally{f.clean();}
});
test('déploiement : DIGISANTE_ENV hérité ≠ DEPLOY_ENVIRONMENT refusé avant tout effet',()=>{
  const f=fixture();try{const r=f.run('deploy.sh',{...deployEnv,DEPLOY_ENVIRONMENT:'production'});assert.notEqual(r.status,0);assert.match(r.stderr,/DIGISANTE_ENV \(preproduction\) ≠ DEPLOY_ENVIRONMENT \(production\)/);assert.equal(f.trace(),'');}finally{f.clean();}
});
test('tâches root : sans DIGISANTE_ENV aucun appel ; jeton envoyé au seul port local de l’environnement, surcharges 3001 ignorées',()=>{
  for(const script of ['internal_job.sh','fedapay_reconcile.sh']){const f=fixture();try{
    const token=join(f.dir,'token');writeFileSync(token,'SYNTHETIC TOKEN');chmodSync(token,0o600);
    const args=script==='internal_job.sh'?['/api/v1/notifications/dispatch']:[];
    f.command('curl',`echo "curl $*" >> "$TRACE"; printf '{}\\n200'`);
    for(const bad of ['','bogus','toString']){const r=f.run(script,{RECONCILE_TOKEN_FILE:token,DIGISANTE_ENV:bad},args);assert.notEqual(r.status,0,`${script} ${bad}`);assert.match(r.stderr,/DIGISANTE_ENV requis/);assert.equal(f.trace(),'',`${script} ${bad}`);}
    // Anciens réglages (3001 = Grafana sur l'hôte partagé) : jamais suivis.
    let r=f.run(script,{RECONCILE_TOKEN_FILE:token,API_BASE:'http://127.0.0.1:3001',API_PORT:'3001'},args);assert.equal(r.status,0,r.stderr+r.stdout);
    assert.match(f.trace(),/^curl .*http:\/\/127\.0\.0\.1:3101\/api\/v1\//m);
    r=f.run(script,{RECONCILE_TOKEN_FILE:token,DIGISANTE_ENV:'production'},args);assert.equal(r.status,0,r.stderr+r.stdout);
    assert.match(f.trace(),/^curl .*http:\/\/127\.0\.0\.1:3201\/api\/v1\//m);assert.doesNotMatch(f.trace(),/:300[01]\b|SYNTHETIC TOKEN/);
  }finally{f.clean();}}
});
test('résiduel 1 : port squatté, libre ou tenu par un autre compte ⇒ jeton jamais envoyé, readiness jamais crue',()=>{
  for(const script of ['internal_job.sh','fedapay_reconcile.sh']){
    for(const bad of [{SQUAT_PORT:'3101'},{PORTS_DOWN:'1'},{PORT_UID:'4242'}]){const f=fixture();try{
      const token=join(f.dir,'token');writeFileSync(token,'SYNTHETIC TOKEN');chmodSync(token,0o600);
      f.command('curl',`echo "curl $*" >> "$TRACE"; cat > "$TRACE.config"; printf '{}\\n200'`);
      const r=f.run(script,{RECONCILE_TOKEN_FILE:token,...bad},script==='internal_job.sh'?['/api/v1/notifications/dispatch']:[]);
      assert.equal(r.status,1,`${script} ${JSON.stringify(bad)} ${r.stdout}${r.stderr}`);
      assert.match(r.stdout,/ÉCHEC : 127\.0\.0\.1:3101 n'est pas tenu par .* seul \(API arrêtée, ou port squatté par un autre compte\) : jeton non envoyé/);
      assert.doesNotMatch(f.trace(),/^curl /m,`${script} : requête émise`);assert.ok(!existsSync(`${f.env.TRACE}.config`),'jeton transmis');
      assert.doesNotMatch(r.stdout+r.stderr,/SYNTHETIC TOKEN/);
    }finally{f.clean();}}
  }
  // Déploiement : écouteur d'un autre compte sur le port de l'API après le démarrage ⇒ FAILED, readiness jamais interrogée.
  let f=fixture();try{
    const r=f.run('deploy.sh',{...deployEnv,OLD_WRITERS:'1',SQUAT_PORT:'3101'});assert.notEqual(r.status,0);
    assert.match(r.stdout+r.stderr,/ports 3101\/3100 ne sont pas tenus par .* seul \(port squatté \?\)/);
    assert.doesNotMatch(f.trace(),/^curl /m);assert.match(f.trace(),/^ss -Htlne \( sport = :3101 \)$/m);
  }finally{f.clean();}
  // healthwatch : alerte « ports » et readiness non interrogée ; verify_deploy : FAIL nommé.
  f=fixture();try{
    f.command('fixture-psql','echo 0');f.command('logger',':');
    let r=f.run('healthwatch.sh',healthEnv(f));assert.match(r.stdout,/^ports +OK +3101\/3100 tenus par /m);
    r=f.run('healthwatch.sh',{...healthEnv(f),SQUAT_PORT:'3100'});
    assert.match(r.stdout,/^ports +ALERTE +port\(s\) 3100 libre\(s\) ou écouté\(s\) par un autre compte/m);assert.match(r.stdout,/^ready +OK/m);
    writeFileSync(f.env.TRACE,'');r=f.run('healthwatch.sh',{...healthEnv(f),SQUAT_PORT:'3101'});
    assert.match(r.stdout,/^ready +ALERTE +port 3101 non tenu par .* : readiness non interrogée/m);assert.doesNotMatch(f.trace(),/^curl .*127\.0\.0\.1:3101/m);
  }finally{f.clean();}
  const {f:v,ws}=verifyFixture();try{
    const base={DOMAIN:'preprod.example.bj',VERIFY_JOB_ENVIRONMENT:'preproduction',WS_LOG:ws};
    let r=v.run('verify_deploy.sh',base);assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/PASS.*port 3101 tenu par .* seul/);assert.match(r.stdout,/PASS.*port 3100 tenu par/);
    r=v.run('verify_deploy.sh',{...base,SQUAT_PORT:'3100'});assert.notEqual(r.status,0);assert.match(r.stdout,/FAIL.*port 3100 libre ou écouté par un autre compte/);
  }finally{v.clean();}
});
test('résiduel 3 : fuseau de l’hôte libre ; décalage UTC non entier ou Porto-Novo inconnu ⇒ FAIL',()=>{
  const realDate=spawnSync('bash',['-c','command -v date'],{encoding:'utf8'}).stdout.trim();
  for(const [extra,expect] of [[{},null],[{HOST_OFFSET:'+0200',HOST_TZ:'Europe/Madrid'},null],[{HOST_OFFSET:'+0530'},/FAIL.*décalage UTC de l'hôte \+0530 non entier/],[{NO_PN:'1'},/FAIL.*fuseau Africa\/Porto-Novo inconnu de l'hôte/]]){
    const {f,ws}=verifyFixture();try{
      f.command('date',`if [[ "$1" == +%z ]]; then if [[ "\u0024{TZ:-}" == Africa/Porto-Novo ]]; then [[ -n "\u0024{NO_PN:-}" ]] && echo +0000 || echo +0100; exit 0; fi; [[ -n "\u0024{HOST_OFFSET:-}" ]] && { echo "$HOST_OFFSET"; exit 0; }; fi; exec ${realDate} "$@"`);
      f.command('timedatectl',`echo "\u0024{HOST_TZ:-Etc/UTC}"`);
      const r=f.run('verify_deploy.sh',{DOMAIN:'preprod.example.bj',VERIFY_JOB_ENVIRONMENT:'preproduction',WS_LOG:ws,...extra});
      assert.match(r.stdout,/INFO fuseau de l'hôte : /);
      if(expect){assert.notEqual(r.status,0,JSON.stringify(extra));assert.match(r.stdout,expect);}
      else{assert.equal(r.status,0,JSON.stringify(extra)+r.stdout+r.stderr);assert.match(r.stdout,/PASS.*décalage UTC de l'hôte en heures entières/);assert.match(r.stdout,/PASS.*données de fuseau Africa\/Porto-Novo présentes/);}
    }finally{f.clean();}
  }
});
test('scripts root : copie d’un autre environnement (ROOT_LIB du profil ≠ copie lancée) refusée avant tout effet',()=>{
  for(const script of ['internal_job.sh','fedapay_reconcile.sh','healthwatch.sh','pg_dump_encrypted.sh','verify_deploy.sh']){
    for(const rootLib of ['other','']){const f=fixture();try{
      // '' ⇒ défaut du profil (/usr/local/lib/digisante-preprod), différent de la copie de test.
      const lib=rootLib?join(f.dir,rootLib):'';if(lib)mkdirSync(lib);
      const r=f.run(script,{DOMAIN:'preprod.example.bj',RECONCILE_TOKEN_FILE:f.env.BACKUP_KEY_FILE,...healthEnv(f),ROOT_LIB:lib},script==='internal_job.sh'?['/api/v1/notifications/dispatch']:[]);
      assert.notEqual(r.status,0,script);assert.match(r.stderr,/copie root d'un autre environnement que preproduction/,script);assert.equal(f.trace(),'',script);
    }finally{f.clean();}}
  }
});
test('vérification : PM2 de CET environnement seulement ; manifeste d’un autre environnement ⇒ FAIL ; --run-jobs exige DIGISANTE_ENV=preproduction',()=>{
  const {f,ws}=verifyFixture();try{
    let r=f.run('verify_deploy.sh',{DOMAIN:'preprod.example.bj',WS_LOG:ws});assert.equal(r.status,0,r.stdout+r.stderr);
    assert.match(r.stdout,/PASS.*PM2 digisante-preprod-api : 2 instances online/);assert.match(r.stdout,/PASS.*cron : DIGISANTE_ENV=preproduction déclaré/);
    writeRootManifest(f.lib,sha,'production');r=f.run('verify_deploy.sh',{DOMAIN:'preprod.example.bj',WS_LOG:ws});assert.notEqual(r.status,0);
    assert.match(r.stdout,/FAIL.*installé pour l'environnement « production », attendu preproduction/);
    r=f.run('verify_deploy.sh',{DOMAIN:'digisantemobile.app',WS_LOG:ws,DIGISANTE_ENV:'production',VERIFY_JOB_ENVIRONMENT:'preproduction'},['--run-jobs']);
    assert.notEqual(r.status,0);assert.doesNotMatch(f.trace(),/job-called/);
    // Fichier cron.d modifiable par un autre compte : cron l'ignorerait ⇒ FAIL.
    writeRootManifest(f.lib,sha);chmodSync(f.env.CRON_FILE,0o666);r=f.run('verify_deploy.sh',{DOMAIN:'preprod.example.bj',WS_LOG:ws});
    assert.notEqual(r.status,0);assert.match(r.stdout,/FAIL.*cron : .* absent ou modifiable par un autre compte/);
  }finally{f.clean();}
});
test('healthwatch : PM2, readiness, état et alerte propres à l’environnement',()=>{
  const f=fixture();try{
    f.command('fixture-psql','echo 0');f.command('logger',':');
    // Seuls les processus de PRODUCTION sont en ligne : la préproduction est en panne.
    f.command('pm2',`echo '[{"name":"digisante-api","pm2_env":{"status":"online"}},{"name":"digisante-api","pm2_env":{"status":"online"}},{"name":"digisante-web","pm2_env":{"status":"online"}}]'`);
    const r=f.run('healthwatch.sh',{...healthEnv(f),PM2_CHECK:'1'});
    assert.match(r.stdout,/pm2 +ALERTE +digisante-preprod-api 0\/2, digisante-preprod-web 0\/1/);
    assert.match(r.stdout,/DigiSanté preproduction — /);
    assert.match(f.trace(),/^curl .*http:\/\/127\.0\.0\.1:3101\/api\/v1\/ready$/m);
  }finally{f.clean();}
});

// ── B3 : requête des tâches sous un compte sans droits, jamais en root ──
const jobArgs=(script)=>script==='internal_job.sh'?['/api/v1/notifications/dispatch']:[];
test('B3 : tâches lancées par root ⇒ requête (curl) sous le compte sans droits, jeton jamais en argument',{skip:!IS_ROOT&&'abandon réel des privilèges : exige root'},()=>{
  for(const script of ['internal_job.sh','fedapay_reconcile.sh']){const f=fixture();try{
    const token=join(f.dir,'token');writeFileSync(token,'SYNTHETIC TOKEN');chmodSync(token,0o600);
    f.command('curl',`echo "curl-as uid=$(id -u) gid=$(id -g) groups=$(id -G) $*" >> "$TRACE"; cat > /dev/null; printf '{"uid":%s}\\n200' "$(id -u)"`);
    const r=f.run(script,{RECONCILE_TOKEN_FILE:token},jobArgs(script));assert.equal(r.status,0,script+r.stderr+r.stdout);
    assert.match(f.trace(),new RegExp(`^curl-as uid=${JOBS.uid} gid=${JOBS.uid} groups=${JOBS.uid} `,'m'),script);
    assert.doesNotMatch(f.trace(),/uid=0\b/,script);assert.doesNotMatch(f.trace(),/SYNTHETIC TOKEN/,script);
    assert.match(r.stdout,new RegExp(`"uid":${JOBS.uid}`),script);
  }finally{f.clean();}}
});
test('B3 : compte des tâches absent, root ou confondu avec l’utilisateur applicatif ⇒ ÉCHEC journalisé, aucune requête',{skip:!IS_ROOT&&'exige root'},()=>{
  for(const script of ['internal_job.sh','fedapay_reconcile.sh']){
    for(const [jobs,why] of [['digisante-absent-jobs',/compte sans droits digisante-absent-jobs absent/],['root',/compte root refusé/],[APP.user,new RegExp(`compte ${APP.user} refusé`)]]){const f=fixture();try{
      const token=join(f.dir,'token');writeFileSync(token,'SYNTHETIC TOKEN');chmodSync(token,0o600);
      const r=f.run(script,{RECONCILE_TOKEN_FILE:token,JOBS_USER:jobs},jobArgs(script));
      assert.equal(r.status,1,`${script} ${jobs}`);assert.match(r.stdout,/ÉCHEC/,`${script} ${jobs}`);assert.match(r.stdout,why,`${script} ${jobs}`);
      assert.doesNotMatch(f.trace(),/^curl/m,`${script} ${jobs} : requête émise`);
    }finally{f.clean();}}
  }
});
test('B3 : réconciliation sans jeton ⇒ ligne ÉCHEC au journal (sonde cron), comme les autres tâches',()=>{
  const f=fixture();try{
    for(const token of [join(f.dir,'absent'),join(f.dir,'empty')]){
      writeFileSync(join(f.dir,'empty'),'');
      const r=f.run('fedapay_reconcile.sh',{RECONCILE_TOKEN_FILE:token});
      assert.equal(r.status,1);assert.match(r.stdout,/ÉCHEC : jeton de service absent ou vide/);assert.doesNotMatch(f.trace(),/^curl/m);
    }
  }finally{f.clean();}
});
test('vérification B3 : compte des tâches absent ou confondu avec root/l’utilisateur applicatif ⇒ FAIL',()=>{
  for(const [jobs,expect] of [[JOBS.user,/PASS.*tâches : requêtes sous /],['digisante-absent-jobs',/FAIL.*tâches : compte sans droits digisante-absent-jobs absent/],['root',/FAIL.*tâches : compte root = root ou utilisateur\/groupe applicatif/],[APP.user,/FAIL.*tâches : compte .* = root ou utilisateur\/groupe applicatif/]]){
    const {f,ws}=verifyFixture();try{
      const r=f.run('verify_deploy.sh',{DOMAIN:'preprod.example.bj',WS_LOG:ws,JOBS_USER:jobs});
      assert.match(r.stdout,expect,jobs);assert.equal(r.status===0,jobs===JOBS.user,jobs+r.stdout);
    }finally{f.clean();}
  }
});
