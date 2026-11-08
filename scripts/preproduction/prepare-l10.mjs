#!/usr/bin/env node
// Dossier de recette régénérable, sans secrets ni résultats présumés.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SMOKE_PROVIDERS } from './smoke-guard.mjs';
export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const PACK = resolve(ROOT, 'docs/preproduction/L10');
export const RECIPES = {
  FEDAPAY: 'RECETTE_FedaPay_Sandbox.md', TWILIO: 'RECETTE_Twilio_SMS.md',
  DAILY: 'RECETTE_Daily_Teleconsultation.md', FIREBASE: 'RECETTE_Firebase_Push.md',
  RESEND: 'RECETTE_Resend_Email.md', SUBSCRIPTION: 'RECETTE_Abonnements_L6.md',
  FINANCE: 'RECETTE_Finances_L7.md',
};
const hash = (value) => createHash('sha256').update(value).digest('hex');
const json = (value) => JSON.stringify(value, null, 2) + '\n';
const infrastructure = [
  ['I1','CI main réussie et deux jobs exacts sur la candidate, qualification GitHub'],
  ['I2','VPS Infomaniak distinct, PG16 natif *_preprod et Redis local dédiés ; comptes synthétiques'],
  ['I3','Node24/pnpm verrouillé, maintenance, anciens workers arrêtés, SHA exact et migrations à jour'],
  ['I4','Nginx HTTPS/TLS renouvellement et HSTS vérifiés, ready DB/Redis, upgrade WS sans query dans logs'],
  ['I5','Secrets privés/permissions, filestore KYC+DMP, clés conservées hors VPS, héritage audit vérifié sans réécriture'],
  ['I6','Crons installés ET observations horodatées des quatre générateurs, dispatch et purge reçus ; absence de doublons'],
  ['I7','Réconciliation cron réelle/idempotente et diagnostics healthwatch ; alertes vers destinataire autorisé'],
  ['I8','Première sauvegarde cible DB + fichiers + manifeste, contrôle SHA256, copie et clé hors VPS référencées'],
  ['I9','Configuration fournisseur chiffrée/priorité DB ; Firebase public + VAPID au build, pas de devCode/stub'],
];
export function buildSnapshot(root = ROOT) {
  const paths = ['.github/workflows/ci.yml','.github/workflows/preproduction.yml','ecosystem.config.cjs','package.json'];
  const walk = (dir, accept) => {
    for (const e of readdirSync(resolve(root,dir),{withFileTypes:true})) {
      const path = `${dir}/${e.name}`;
      if(e.isDirectory()) walk(path,accept); else if(accept(path)) paths.push(path);
    }
  };
  walk('infra/deploy',(p)=>/\.(sh|conf|example|md|list)$/.test(p)||p.startsWith('infra/deploy/logrotate/'));
  walk('scripts/preproduction',(p)=>!p.endsWith('.test.mjs'));
  // Relais SSH des workflows (secret de migration par l'entrée standard, revue GO du 22/10/2026).
  walk('scripts/deploy',(p)=>!p.endsWith('.test.mjs'));
  // Une sonde par opt-in de smoke-guard (même liste) : aucune sonde hors empreinte.
  for(const {file} of SMOKE_PROVIDERS) paths.push(`apps/api/src/services/${file}.smoke.test.ts`);
  paths.push('apps/api/vitest.smoke.config.ts','apps/api/vitest.smoke.setup.ts');
  const cases = infrastructure.map(([id,scenario])=>({id,recipe:'CONTRAT_Preproduction_L10.md',scenario,conditional:false}));
  for(const [group,name] of Object.entries(RECIPES)) {
    paths.push(`docs/${name}`);
    const lines = readFileSync(resolve(root,'docs',name),'utf8').split('\n');
    const rows = lines.flatMap((line)=>{
      if(/^\| [A-Z]\d+ \|/.test(line)) return [line];
      const m=/^- \[ \] ([A-Z]\d+) — (.+)$/.exec(line);
      return m ? [`| ${m[1]} | ${m[2]} | À recueillir |`] : [];
    });
    if(!rows.length) throw new Error(`Recette sans cas : ${name}`);
    for(const line of rows) {
      const cells = line.split('|').map((cell)=>cell.trim());
      const id = `${group}-${cells[1]}`;
      // F1–F8 doivent être observés séparément sur Android et iPhone installé.
      const devices = group==='FIREBASE' && cells[1]!=='F9' ? ['ANDROID','IPHONE'] : [''];
      for(const device of devices) cases.push({id:id+(device?`-${device}`:''),recipe:name,scenario:cells.slice(2,-1).join(' | '),conditional:id==='TWILIO-T11'});
    }
  }
  if(new Set(cases.map((c)=>c.id)).size!==cases.length) throw new Error('Identifiants de recette dupliqués');
  paths.push('docs/CONTRAT_Preproduction_L10.md','docs/preproduction/L10/README.md','docs/SECRETS_Preproduction_L10.md');
  const sources = Object.fromEntries([...new Set(paths)].sort().map((path)=>[path,hash(readFileSync(resolve(root,path)))]));
  return {schemaVersion:1,sourceSnapshotSha256:hash(json({sources,cases})),sources,cases};
}
export function artifacts(snapshot) {
  const cell=(value)=>'"'+String(value).replace(/"/g,'""')+'"';
  return {
    'snapshot.json':json(snapshot),
    'recette.csv':[['case_id','recipe','scenario','conditional','result','executed_at','operator','evidence_ref'],...snapshot.cases.map((c)=>[c.id,c.recipe,c.scenario,c.conditional,'','','',''])].map((r)=>r.map(cell).join(',')).join('\n')+'\n',
  };
}
export function main(args=process.argv.slice(2),root=ROOT,out=PACK) {
  if(args.some((a)=>a!=='--check')) throw new Error('Seule --check est acceptée');
  const check=args.includes('--check'); const snapshot=buildSnapshot(root);
  if(!check)mkdirSync(out,{recursive:true});
  for(const [name,data] of Object.entries(artifacts(snapshot))) {
    const target=resolve(out,name);
    if(check) {if(readFileSync(target,'utf8')!==data)throw new Error(`Dossier L10 périmé/altéré : ${name}`);}
    else writeFileSync(target,data);
  }
  // Le registre opérateur n'est JAMAIS écrasé par une régénération.
  const evidence=resolve(out,'evidence.json');
  if(!check&&!existsSync(evidence))writeFileSync(evidence,json({schemaVersion:1,candidate:null,records:[]}));
  console.log(`${check?'Vérifié':'Préparé'} : ${snapshot.cases.length} cas L10 ; source ${snapshot.sourceSnapshotSha256}. Aucune recette réelle attestée.`);
  return snapshot;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{main();}catch(error){console.error(error.message);process.exitCode=1;}
}
