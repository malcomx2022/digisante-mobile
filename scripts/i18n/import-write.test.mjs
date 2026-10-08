import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeImport } from './import-validated.mjs';

for (const hadTrace of [false,true]) test(`échec publication source : rollback de la trace (${hadTrace?'existante':'nouvelle'})`,()=>{
  const dir=fs.mkdtempSync(join(tmpdir(),'l9-write-'));
  const messagesPath=join(dir,'messages.ts'),tracePath=join(dir,'trace.md');
  fs.writeFileSync(messagesPath,'SOURCE');if(hadTrace)fs.writeFileSync(tracePath,'TRACE');
  const io={...fs,renameSync:(from,to)=>{if(to===messagesPath)throw new Error('TEST FAILURE');return fs.renameSync(from,to);}};
  try {
    assert.throws(()=>writeImport({messagesPath,tracePath,source:'SOURCE',updated:'UPDATED',traceEntry:'ENTRY'},io),/TEST FAILURE/);
    assert.equal(fs.readFileSync(messagesPath,'utf8'),'SOURCE');
    assert.equal(fs.existsSync(tracePath),hadTrace);if(hadTrace)assert.equal(fs.readFileSync(tracePath,'utf8'),'TRACE');
    assert.deepEqual(fs.readdirSync(dir).sort(),hadTrace?['messages.ts','trace.md']:['messages.ts']);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('source modifiée ou import concurrent : aucun écrasement ni trace de réussite',()=>{
  const dir=fs.mkdtempSync(join(tmpdir(),'l9-lock-'));
  const messagesPath=join(dir,'messages.ts'),tracePath=join(dir,'trace.md');fs.writeFileSync(messagesPath,'CURRENT');
  const input={messagesPath,tracePath,source:'STALE',updated:'UPDATED',traceEntry:'ENTRY'};
  try {
    assert.throws(()=>writeImport(input),/modifiée/);assert.equal(fs.existsSync(tracePath),false);
    fs.writeFileSync(messagesPath+'.import-lock','TEST LOCK');
    assert.throws(()=>writeImport({...input,source:'CURRENT'}),/EEXIST/);assert.equal(fs.readFileSync(messagesPath,'utf8'),'CURRENT');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('publication source et trace réussie sans fichier temporaire résiduel',()=>{
  const dir=fs.mkdtempSync(join(tmpdir(),'l9-commit-'));
  const messagesPath=join(dir,'messages.ts'),tracePath=join(dir,'trace.md');fs.writeFileSync(messagesPath,'SOURCE');
  try {
    writeImport({messagesPath,tracePath,source:'SOURCE',updated:'UPDATED',traceEntry:'ENTRY'});
    assert.equal(fs.readFileSync(messagesPath,'utf8'),'UPDATED');assert.ok(fs.readFileSync(tracePath,'utf8').endsWith('ENTRY'));
    assert.deepEqual(fs.readdirSync(dir).sort(),['messages.ts','trace.md']);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
