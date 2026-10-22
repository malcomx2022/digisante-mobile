#!/usr/bin/env node
// Imprime le SQL des droits du rôle d'exécution tel que deploy.sh l'applique (source unique :
// bloc `runtime-grants.sql` de infra/deploy/scripts/deploy.sh). Sert à la CI, qui rejoue la
// suite API sous ce rôle restreint ; aucun accès réseau, aucune base touchée par ce script.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const text = readFileSync(fileURLToPath(new URL('../../infra/deploy/scripts/deploy.sh', import.meta.url)), 'utf8');
const block = text.slice(text.indexOf('# >>> runtime-grants.sql'), text.indexOf('# <<< runtime-grants.sql'));
const start = block.indexOf("<<'SQL'\n");
const end = block.lastIndexOf('\nSQL\n');
if (start < 0 || end < 0) {
  console.error('bloc runtime-grants.sql introuvable dans deploy.sh');
  process.exit(1);
}
process.stdout.write(block.slice(start + "<<'SQL'\n".length, end + 1));
