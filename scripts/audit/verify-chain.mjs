#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// Vérification HORS LIGNE de la chaîne d'audit (§4) — sur une base RESTAURÉE ou
// de production, en lecture seule. Lit sur stdin une ligne JSON par entrée, dans
// l'ordre de la chaîne, produite par :
//
//   psql "$DB" -Atc "select json_build_object('action',action,'actorId',\"actorId\",
//     'targetId',\"targetId\",'ip',ip,'meta',meta,'prevHash',\"prevHash\",'hash',hash,
//     'ts',to_char(\"createdAt\" at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'))
//     from audit_logs order by \"createdAt\", id" | node scripts/audit/verify-chain.mjs
//
// Contrôles : ① chaînage (prevHash = hash précédent) ; ② hash RE-CALCULÉ avec la
// forme canonique de lib/audit.ts (clés triées). Les lignes écrites AVANT la
// canonicalisation (22/09/2026, dev/test uniquement) sont signalées « héritées ».
// Code de sortie 1 si un chaînage est rompu ou si un hash ne correspond pas.
// ─────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) if (value[k] !== undefined) out[k] = canonicalJson(value[k]);
    return out;
  }
  return value;
}

/** Même formule que computeAuditHash (apps/api/src/lib/audit.ts). */
export function rowHash(r) {
  return createHash('sha256').update(JSON.stringify({
    prevHash: r.prevHash ?? '', action: r.action, actorId: r.actorId ?? '', targetId: r.targetId ?? '',
    ip: r.ip ?? '', meta: r.meta == null ? null : canonicalJson(r.meta), ts: r.ts,
  })).digest('hex');
}

export function verify(rows) {
  const res = { rows: rows.length, brokenLinks: [], badHashes: [] };
  rows.forEach((r, i) => {
    if (i > 0 && r.prevHash !== rows[i - 1].hash) res.brokenLinks.push(i);
    if (i === 0 && r.prevHash !== null && r.prevHash !== undefined) res.firstPrevHash = r.prevHash;
    if (rowHash(r) !== r.hash) res.badHashes.push(i);
  });
  return res;
}

function main() {
  const input = readFileSync(0, 'utf8').trim();
  const rows = input ? input.split('\n').map((l) => JSON.parse(l)) : [];
  const r = verify(rows);
  console.log(`[audit] entrées=${r.rows} · chaînages rompus=${r.brokenLinks.length} · hash non recalculables=${r.badHashes.length}`);
  if (r.brokenLinks.length || r.badHashes.length) {
    console.log(`[audit] premiers indices en défaut : liens ${r.brokenLinks.slice(0, 5).join(',') || '—'} · hash ${r.badHashes.slice(0, 5).join(',') || '—'}`);
    console.log('[audit] ⚠️ entrées antérieures au 22/09/2026 (dev/test) : hachage non canonique, attendu.');
    process.exit(1);
  }
  console.log('[audit] ✓ chaîne intègre et entièrement recalculable');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
