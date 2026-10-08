#!/usr/bin/env node
// Cohérence déclarative uniquement ; pièces privées et cible à vérifier humainement.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACK, main as checkSources } from './prepare-l10.mjs';
const nonempty=(v)=>typeof v==='string'&&v.trim().length>0;
export function evidenceIssues(snapshot,evidence,sha,now=new Date()) {
  const issues=[];const candidate=evidence?.candidate;
  if(!/^[0-9a-f]{40}$/.test(sha??''))return ['SHA complet attendu requis'];
  if(evidence?.schemaVersion!==1||!Array.isArray(evidence.records))return ['Registre L10 absent/malformé'];
  if(!candidate||candidate.sha!==sha||candidate.environment!=='preproduction'||!/^([a-z0-9][a-z0-9-]*\.)+[a-z]{2,}$/i.test(candidate.domain??'')||!nonempty(candidate.dedicatedHostRef)||!Number.isSafeInteger(candidate.ciRunId)||candidate.ciRunId<=0)issues.push('Candidate/cible/CI exactes non déclarées');
  const ids=new Set(snapshot.cases.map((c)=>c.id));const seen=new Set();
  for(const r of evidence.records) {
    if(!r||!ids.has(r.caseId)||seen.has(r.caseId)){issues.push('Preuve inconnue ou dupliquée');continue;}
    seen.add(r.caseId);
  }
  for(const c of snapshot.cases) {
    const records=evidence.records.filter((r)=>r?.caseId===c.id);const r=records[0];
    if(!r){issues.push(`${c.id} : preuve absente`);continue;}
    const t=Date.parse(r.executedAt);const canonical=Number.isFinite(t)&&new Date(t).toISOString()===r.executedAt;
    const result=r.result==='PASS'||(c.conditional&&r.result==='N/A'&&nonempty(r.reason)&&nonempty(r.scopeDecisionRef));
    if(records.length!==1||!result||r.candidateSha!==sha||r.sourceSnapshotSha256!==snapshot.sourceSnapshotSha256||!canonical||t>now.getTime()||!nonempty(r.operator)||!nonempty(r.evidenceRef))issues.push(`${c.id} : preuve refusée/périmée/incomplète`);
  }
  return issues;
}
export function main(args=process.argv.slice(2)) {
  if(args.length!==2||args[0]!=='--expected-sha'||!/^[0-9a-f]{40}$/.test(args[1]))throw new Error('Usage : preprod:gate --expected-sha <SHA complet>');
  const snapshot=checkSources(['--check']);
  const evidence=JSON.parse(readFileSync(resolve(PACK,'evidence.json'),'utf8'));
  const issues=evidenceIssues(snapshot,evidence,args[1]);
  if(issues.length){console.error(`L10 OUVERT : ${issues.length} point(s).\n`+issues.join('\n'));return false;}
  console.log('Références déclarées cohérentes ; contrôler CI GitHub/pièces privées/cible avant clôture opérateur. Aucun GO L11.');
  return true;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{if(!main())process.exitCode=1;}catch(error){console.error(error.message);process.exitCode=1;}
}
