// Configuration de recette indépendante : AUCUN FLUSHDB, seed ou migration.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { smokeEnvironmentIssues } from '../../scripts/preproduction/smoke-guard.mjs';

export default async function setup() {
  const firstIssues = smokeEnvironmentIssues(process.env, process.env.SMOKE_EXPECTED_SHA ?? '');
  if (firstIssues.length) throw new Error(firstIssues.join('\n'));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const { stdout } = await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  const sha = stdout.trim();
  const issues = smokeEnvironmentIssues(process.env, sha);
  if (issues.length) throw new Error(issues.join('\n'));
}
