import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSnapshot, main, ROOT } from './prepare-l10.mjs';
import { evidenceIssues } from './check-l10-gate.mjs';
import { parseManifest } from './check-backup.mjs';
const sha='a'.repeat(40);const now=new Date('2026-10-08T12:00:00.000Z');
test('dossier L10 déterministe, --check sans écriture ; altération refusée et registre préservé',()=>{
  const dir=mkdtempSync(join(tmpdir(),'l10-pack-'));
  try{
    const snapshot=main([],ROOT,dir);assert.deepEqual(buildSnapshot(),snapshot);
    writeFileSync(join(dir,'evidence.json'),'SYNTHETIC PRIVATE REGISTRY');
    main(['--check'],ROOT,dir);assert.equal(readFileSync(join(dir,'evidence.json'),'utf8'),'SYNTHETIC PRIVATE REGISTRY');
    writeFileSync(join(dir,'recette.csv'),'ALTERED');assert.throws(()=>main(['--check'],ROOT,dir));
    main([],ROOT,dir);assert.equal(readFileSync(join(dir,'evidence.json'),'utf8'),'SYNTHETIC PRIVATE REGISTRY');
    assert.ok(snapshot.cases.some((c)=>c.id==='FIREBASE-F7-IPHONE'));assert.ok(snapshot.cases.some((c)=>c.id==='DAILY-D18'));
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('gate L10 refuse absence, rejet, duplication, SHA/source/version/date/identité incohérents',()=>{
  const snapshot={sourceSnapshotSha256:'SYNTHETIC SOURCE HASH',cases:[{id:'I1',conditional:false}]};
  const r={caseId:'I1',result:'PASS',candidateSha:sha,sourceSnapshotSha256:snapshot.sourceSnapshotSha256,executedAt:'2026-10-08T11:00:00.000Z',operator:'SYNTHETIC OPERATOR',evidenceRef:'SYNTHETIC REF'};
  const evidence={schemaVersion:1,candidate:{sha,environment:'preproduction',domain:'preprod.example.bj',dedicatedHostRef:'SYNTHETIC HOST REF',ciRunId:1},records:[r]};
  assert.deepEqual(evidenceIssues(snapshot,evidence,sha,now),[]);
  for(const change of [{result:'FAIL'},{result:'N/A'},{candidateSha:'b'.repeat(40)},{sourceSnapshotSha256:'old'},{executedAt:'2026-02-30T11:00:00.000Z'},{executedAt:'2026-10-09T00:00:00.000Z'},{operator:{}},{evidenceRef:''}])assert.ok(evidenceIssues(snapshot,{...evidence,records:[{...r,...change}]},sha,now).length);
  assert.ok(evidenceIssues(snapshot,{...evidence,records:[]},sha,now).length);assert.ok(evidenceIssues(snapshot,{...evidence,records:[r,r]},sha,now).length);
  assert.ok(evidenceIssues(snapshot,{...evidence,candidate:null},sha,now).length);
});
test('seul SOS public conditionnel accepte N/A avec décision de portée référencée',()=>{
  const snapshot={sourceSnapshotSha256:'SYNTHETIC',cases:[{id:'TWILIO-T11',conditional:true}]};
  const r={caseId:'TWILIO-T11',result:'N/A',candidateSha:sha,sourceSnapshotSha256:'SYNTHETIC',executedAt:'2026-10-08T11:00:00.000Z',operator:'SYNTHETIC',evidenceRef:'SYNTHETIC',reason:'Destination publique non configurée',scopeDecisionRef:'SYNTHETIC'};
  const evidence={schemaVersion:1,candidate:{sha,environment:'preproduction',domain:'preprod.example.bj',dedicatedHostRef:'SYNTHETIC',ciRunId:1},records:[r]};
  assert.deepEqual(evidenceIssues(snapshot,evidence,sha,now),[]);delete r.scopeDecisionRef;assert.ok(evidenceIssues(snapshot,evidence,sha,now).length);
});
test('manifeste backup refuse chemins sortants, doublons, archive absente et comptages invalides',()=>{
  const stamp='20261008_120000';const h='a'.repeat(64);const name=`digisante_manifest_${stamp}.txt`;
  const text=`stamp=${stamp}\ndb_archive=digisante_${stamp}.sql.gz.enc sha256=${h}\nfiles_archive=digisante_files_${stamp}.tar.gz.enc sha256=${h}\nfiles_count=1\nrows.fixture=1\naudit_head=none\n`;
  assert.equal(parseManifest(text,name).archives.length,2);
  for(const changed of [text+`stamp=${stamp}\n`,text.replace('db_archive=digisante_','db_archive=../digisante_'),text.replace('rows.fixture=1','rows.fixture=-1'),text.replace(/^files_archive=.*\n/m,'')])assert.throws(()=>parseManifest(changed,name));
});
