#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// i18n — génération de BROUILLONS de traduction (outil DEV uniquement) via
// NLLB-200 exécuté EN LOCAL (transformers + torch CPU). FR = source de vérité.
//
// ⚠️ NLLB n'est plus servi par l'API serverless HuggingFace ; la traduction se
// fait donc localement (service Python `nllb_translate.py`). Pré-requis :
//     pip install transformers torch sentencepiece
//
// Écrit docs/i18n/draft.<locale>.csv — JAMAIS directement messages.ts.
// Les clés CRITIQUES (sos./labo./payments.) ne sont PAS machine-traduites
// (CLAUDE.md §4/§6) : drapeau « HUMAIN_OBLIGATOIRE », à traduire ET
// double-valider par un humain. Le reste est un 1er JET à RELIRE par des
// locuteurs natifs avant intégration.
//
//   node scripts/i18n/translate-draft.mjs --locale=fon,yor
//   options :
//     --locale=fon,yor      langues cibles (déf. fon,yor)
//     --limit=N             limite le nombre de clés (test)
//     --model=ID            modèle HF (déf. facebook/nllb-200-distilled-600M)
//     --include-critical    force la MT des clés critiques (DÉCONSEILLÉ)
//     --dry                 n'appelle PAS le modèle : liste seulement
//
// 0 dépendance npm. Licence NLLB-200 = CC-BY-NC.
// ─────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const MESSAGES = resolve(ROOT, 'apps/web/src/i18n/messages.ts');
const OUT_DIR = resolve(ROOT, 'docs/i18n');
const PY_HELPER = resolve(HERE, 'nllb_translate.py');

const CRITICAL_PREFIXES = ['sos.', 'labo.', 'payments.'];
const isCritical = (k) => CRITICAL_PREFIXES.some((p) => k.startsWith(p));

// locale interne → code FLORES-200 attendu par NLLB.
const FLORES = { fr: 'fra_Latn', en: 'eng_Latn', fon: 'fon_Latn', yor: 'yor_Latn' };

const csv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : def;
};
const flag = (name) => argv.includes(`--${name}`);

/** Extrait un objet de locale du source TS (littéral plat évalué en isolation). */
function extractLocale(source, name) {
  const re = new RegExp(`const ${name}: Messages = (\\{[\\s\\S]*?\\n\\});`);
  const m = source.match(re);
  if (!m) throw new Error(`Bloc de locale introuvable : ${name}`);
  // eslint-disable-next-line no-new-func
  return new Function(`return ${m[1]}`)();
}

// Protège les variables {name}, {days}… (souvent altérées par la MT).
function protect(text) {
  const vars = [];
  const masked = text.replace(/\{(\w+)\}/g, (_, k) => {
    vars.push(k);
    return ` VAR${vars.length - 1}X `;
  });
  return { masked, vars };
}
function restore(text, vars) {
  let out = text;
  vars.forEach((k, i) => {
    out = out.replace(new RegExp(`VAR\\s*${i}\\s*X`, 'i'), `{${k}}`);
  });
  const ok = vars.every((k) => out.includes(`{${k}}`));
  return { out: out.trim(), ok };
}

const MODEL = arg('model', 'facebook/nllb-200-distilled-600M');

/** Traduit un lot de chaînes via le service Python local (modèle chargé 1×). */
function translateLocal(texts, tgtFlores) {
  const res = spawnSync('python', [PY_HELPER], {
    input: JSON.stringify({ model: MODEL, src_lang: FLORES.fr, tgt_lang: tgtFlores, texts }),
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'inherit'], // progression Python → stderr visible
  });
  if (res.status !== 0) {
    throw new Error(`Échec du service NLLB (python3). Pré-requis : pip install transformers torch sentencepiece.\n${res.error ?? ''}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    throw new Error(`Sortie Python illisible : ${String(res.stdout).slice(0, 200)}`);
  }
  if (!Array.isArray(parsed) || parsed.length !== texts.length) {
    throw new Error(`Nombre de traductions inattendu (${parsed.length}/${texts.length}).`);
  }
  return parsed;
}

function main() {
  const dry = flag('dry');
  const locales = arg('locale', 'fon,yor').split(',').map((s) => s.trim()).filter(Boolean);
  const limit = Number(arg('limit', '0')) || 0;
  const includeCritical = flag('include-critical');

  const source = readFileSync(MESSAGES, 'utf8');
  const fr = extractLocale(source, 'fr');
  const en = extractLocale(source, 'en');
  const frKeys = Object.keys(fr);
  mkdirSync(OUT_DIR, { recursive: true });

  for (const locale of locales) {
    if (!FLORES[locale]) {
      console.error(`Locale inconnue (ni FLORES) : ${locale}`);
      continue;
    }
    const existing = extractLocale(source, locale);
    let missing = frKeys.filter((k) => !(k in existing));
    if (limit) missing = missing.slice(0, limit);

    // Sépare clés critiques (jamais machine-traduites) et clés à traduire.
    const toMT = missing.filter((k) => !isCritical(k) || includeCritical);
    const humans = missing.filter((k) => isCritical(k) && !includeCritical);
    console.log(`\n${locale} : ${missing.length} manquantes — ${toMT.length} machine, ${humans.length} critiques→humain${dry ? ' (DRY)' : ` → NLLB ${MODEL} (local)`}`);

    // Prépare et traduit le lot (masquage des variables avant MT).
    const prepared = toMT.map((k) => ({ key: k, ...protect(fr[k]) }));
    let translations = [];
    if (!dry && prepared.length) {
      translations = translateLocal(prepared.map((p) => p.masked), FLORES[locale]);
    }
    const drafts = new Map();
    let flagged = 0;
    prepared.forEach((p, i) => {
      if (dry) {
        drafts.set(p.key, { out: '', flags: 'DRY' });
        return;
      }
      const { out, ok } = restore(translations[i], p.vars);
      if (!ok) flagged += 1;
      drafts.set(p.key, { out, flags: ok ? '' : 'PLACEHOLDER_A_VERIFIER' });
    });

    // Écrit le CSV dans l'ordre source.
    const rows = [['key', 'critical', 'fr', 'en', 'draft', 'flags'].map(csv).join(',')];
    for (const key of missing) {
      const critical = isCritical(key) && !includeCritical;
      if (critical) {
        rows.push([key, 'CRITIQUE', fr[key], en[key] ?? '', '', 'HUMAIN_OBLIGATOIRE'].map(csv).join(','));
      } else {
        const d = drafts.get(key) ?? { out: '', flags: 'ERREUR' };
        const flags = [isCritical(key) ? 'CRITIQUE' : '', d.flags].filter(Boolean).join('|');
        rows.push([key, isCritical(key) ? 'CRITIQUE' : '', fr[key], en[key] ?? '', d.out, flags].map(csv).join(','));
      }
    }
    const path = resolve(OUT_DIR, `draft.${locale}.csv`);
    writeFileSync(path, `${rows.join('\n')}\n`, 'utf8');
    console.log(`  → ${path}  (machine ${toMT.length}, critiques→humain ${humans.length}, placeholders à vérifier ${flagged})`);
  }

  console.log('\n⚠️  Brouillons = 1er jet. RELECTURE par locuteurs natifs OBLIGATOIRE avant intégration.');
}

main();
