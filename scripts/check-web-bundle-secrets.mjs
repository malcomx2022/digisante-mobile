#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// Vérifie qu'aucun secret SERVEUR n'a fui dans le bundle web construit
// (apps/web/.next/static + public). À lancer APRÈS `pnpm build` (release:check le fait).
// Motifs : clé privée PEM, compte de service Google, noms de variables serveur,
// préfixes de clés secrètes connus (FedaPay sk_, Resend re_, Twilio AC…+token).
// Les valeurs trouvées ne sont JAMAIS affichées — seulement fichier + motif.
// ─────────────────────────────────────────────────────────────
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const PATTERNS = [
  { name: 'clé privée PEM', re: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/ },
  { name: 'compte de service Google', re: /[\w.-]+@[\w-]+\.iam\.gserviceaccount\.com/ },
  { name: 'variable serveur Firebase', re: /\bFIREBASE_(PRIVATE_KEY|CLIENT_EMAIL)\b/ },
  { name: 'secret d’infrastructure', re: /\b(HEALTH_ENCRYPTION_KEY|JWT_SECRET|RECONCILE_TOKEN|DATABASE_URL)\b/ },
  { name: 'clé secrète FedaPay', re: /\bsk_(live|sandbox)_[A-Za-z0-9]{8,}/ },
  { name: 'clé API Resend', re: /\bre_[A-Za-z0-9]{16,}_[A-Za-z0-9]{8,}/ },
];

/** Renvoie les correspondances { file, pattern } d'un ensemble de contenus. */
export function scan(entries) {
  const hits = [];
  for (const { file, content } of entries) {
    for (const p of PATTERNS) if (p.re.test(content)) hits.push({ file, pattern: p.name });
  }
  return hits;
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|mjs|json|html|css|map)$/.test(n)) out.push(p);
  }
  return out;
}

function main() {
  const staticDir = join(ROOT, 'apps/web/.next/static');
  if (!existsSync(staticDir)) {
    console.error('❌ apps/web/.next/static introuvable — lancer `pnpm build` d’abord.');
    process.exit(2);
  }
  const files = [...walk(staticDir), ...walk(join(ROOT, 'apps/web/public'))];
  const hits = scan(files.map((f) => ({ file: relative(ROOT, f), content: readFileSync(f, 'utf8') })));
  if (hits.length) {
    console.error('❌ Secret serveur possiblement présent dans le bundle web :');
    hits.forEach((h) => console.error(`   - ${h.file} : ${h.pattern}`));
    process.exit(1);
  }
  console.log(`✓ bundle web : ${files.length} fichiers analysés, aucun secret serveur.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
