#!/usr/bin/env node
// Métadonnées GitHub en lecture seule : CI exacte, pas une preuve de déploiement.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export function successfulRun(sha, runs) {
  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) throw new Error('SHA candidat complet requis');
  const r = runs.find((r) => r.head_sha === sha && r.head_branch === 'main' && r.event === 'push' && r.status === 'completed' && r.conclusion === 'success');
  if (!r) throw new Error('Aucune CI main réussie sur le SHA candidat exact');
  return r;
}
export function assertJobs(jobs) {
  for (const name of ['build-and-test', 'e2e']) {
    const found = jobs.filter((j) => j.name === name);
    if (found.length !== 1 || found[0].status !== 'completed' || found[0].conclusion !== 'success') throw new Error(`Job ${name} non réussi ou ambigu`);
  }
}
export function main(env = process.env, api = (path) => JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8' }))) {
  const sha = env.CANDIDATE_SHA;
  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) throw new Error('SHA candidat complet requis avant tout appel GitHub');
  const repo = env.GITHUB_REPOSITORY ?? 'malcomx2022/digisante-mobile';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Référence de dépôt invalide');
  const result = api(`repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${sha}&branch=main&event=push&per_page=100`);
  const r = successfulRun(sha, result.workflow_runs);
  assertJobs(api(`repos/${repo}/actions/runs/${r.id}/jobs?per_page=100`).jobs);
  console.log(`CI qualifiée : SHA ${sha}, run ${r.id}, build-and-test + e2e réussis ; aucun déploiement déduit.`);
  return r.id;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
