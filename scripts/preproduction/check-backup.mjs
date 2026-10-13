#!/usr/bin/env node
// Intégrité technique de trois fichiers ; ni déchiffrement, ni restauration attestée.
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export function parseManifest(text, filename) {
  const stamp = /^digisante_manifest_(\d{8}_\d{6})\.txt$/.exec(filename)?.[1];
  if (!stamp) throw new Error('Nom de manifeste invalide');
  const entries = Object.create(null);
  for (const line of text.trim().split('\n')) {
    const match = /^([\w.]+)=(.*)$/.exec(line);
    if (!match || Object.hasOwn(entries,match[1])) throw new Error('Manifeste ambigu ou malformé');
    entries[match[1]]=match[2];
  }
  const rowKeys = Object.keys(entries).filter((k)=>k.startsWith('rows.'));
  if (entries.stamp!==stamp || !/^\d+$/.test(entries.files_count??'') || !/^(none|[0-9a-f]{64})$/.test(entries.audit_head??'') || !rowKeys.length || rowKeys.some((key)=>!/^rows\.[a-zA-Z_][\w]*$/.test(key)||!/^\d+$/.test(entries[key]))) throw new Error('Comptages/tête audit/horodatage absents ou invalides');
  const archives = ['db','files'].map((kind)=>{
    const expected = kind==='db'?`digisante_${stamp}.sql.gz.enc`:`digisante_files_${stamp}.tar.gz.enc`;
    const match = /^([^ ]+) sha256=([0-9a-f]{64})$/.exec(entries[`${kind}_archive`]??'');
    if (!match || match[1]!==expected) throw new Error('Deux archives du même horodatage avec SHA256 requis');
    return {name:expected,sha256:match[2]};
  });
  return {stamp,archives,files:checkFilestoreCompleteness(entries)};
}
// B4 : `files_expected` = fichiers référencés par la base dans le snapshot du dump
// (pièces DMP + KYC), `files_missing` = référencés mais absents de l'archive. Un magasin
// mal résolu (répertoire par défaut vide) archivait 0 fichier et passait le contrôle.
// Fichiers orphelins tolérés (archivés ≥ attendus). Manifestes antérieurs sans ces clés
// acceptés mais signalés `legacy` (complétude non mesurée à l'époque).
export function checkFilestoreCompleteness(entries) {
  const count = BigInt(entries.files_count);
  const read = (key)=>{
    if (!Object.hasOwn(entries,key)) return null;
    if (!/^\d+$/.test(entries[key])) throw new Error('Complétude du magasin de fichiers illisible');
    return BigInt(entries[key]);
  };
  const expected = read('files_expected');
  const missing = read('files_missing');
  if (expected!==null && count<expected) throw new Error('Magasin de fichiers incomplet : moins de fichiers archivés que de fichiers référencés');
  if (missing!==null && missing>0n) throw new Error('Magasin de fichiers incomplet : fichiers référencés absents de l’archive');
  return {count:Number(count),expected:expected===null?null:Number(expected),missing:missing===null?null:Number(missing),legacy:expected===null};
}
export function checkBackupMetadata(manifest) {
  const info=parseManifest(readFileSync(manifest,'utf8'),basename(manifest));
  for(const archive of info.archives) if (!statSync(resolve(dirname(manifest),archive.name)).isFile() || !statSync(resolve(dirname(manifest),archive.name)).size) throw new Error('Archive absente ou vide');
  return info;
}
export async function checkBackup(manifest) {
  const info=checkBackupMetadata(manifest);
  for(const archive of info.archives) {
    const hash=createHash('sha256');let bytes=0;
    for await (const chunk of createReadStream(resolve(dirname(manifest),archive.name))) {hash.update(chunk);bytes+=chunk.length;}
    if (!bytes || hash.digest('hex')!==archive.sha256) throw new Error('Archive absente, vide ou empreinte différente du manifeste');
  }
  return info.stamp;
}
const filesNote=(files)=>files.legacy?' ; ancien manifeste : complétude du magasin de fichiers non mesurée':` ; magasin : ${files.count} fichier(s) archivé(s) pour ${files.expected} référencé(s)`;
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[3]==='--metadata-only') {const info=checkBackupMetadata(process.argv[2]);console.log(`Trio publié présent (${info.stamp})${filesNote(info.files)} ; SHA256 et restauration non vérifiés.`);}
    else {if(process.argv[3])throw new Error('Option inconnue'); const stamp=await checkBackup(process.argv[2]);console.log(`Archives DB + fichiers et manifeste SHA256 conformes (${stamp})${filesNote(checkBackupMetadata(process.argv[2]).files)} ; restauration non attestée.`);}
  }
  catch (error) {console.error(/^Magasin de fichiers incomplet/.test(error?.message??'')?`${error.message} (vérifier KYC_STORAGE_DIR du .env de l’API).`:'Sauvegarde complète/conforme non établie ; vérifier les trois fichiers sans exposer leur contenu.');process.exitCode=1;}
}
