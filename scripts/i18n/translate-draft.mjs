#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// i18n — génération de BROUILLONS de traduction (outil DEV uniquement) via
// NLLB-200 (HuggingFace Inference). FR = source de vérité.
//
// Écrit docs/i18n/draft.<locale>.csv — JAMAIS directement messages.ts.
// Les clés CRITIQUES (sos./labo./payments.) ne sont PAS machine-traduites
// (CLAUDE.md §4/§6) : listées avec un drapeau « HUMAIN_OBLIGATOIRE », à traduire
// ET double-valider par un humain. Le reste est un 1er JET à RELIRE par des
// locuteurs natifs avant intégration (Phase 3).
//
//   HF_TOKEN=hf_xxx node scripts/i18n/translate-draft.mjs --locale=fon,yor
//   options :
//     --locale=fon,yor      langues cibles (déf. fon,yor)
//     --limit=N             limite le nombre de clés (test)
//     --model=ID            modèle HF (déf. facebook/nllb-200-distilled-600M)
//     --include-critical    force la MT des clés critiques (DÉCONSEILLÉ)
//     --dry                 n'appelle PAS HF : liste seulement (test parsing)
//
// 0 dépendance (fetch/fs natifs, Node ≥ 18). Licence NLLB = CC-BY-NC.
// ─────────────────────────────────────────────────────────────
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MESSAGES = resolve(ROOT, 'apps/web/src/i18n/messages.ts');
const OUT_DIR = resolve(ROOT, 'docs/i18n');

const CRITICAL_PREFIXES = ['sos.', 'labo.', 'payments.'];
const isCritical = (k) => CRITICAL_PREFIXES.some((p) => k.startsWith(p));

// locale interne → code FLORES-200 attendu par NLLB.
const FLORES = { fr: 'fra_Latn', en: 'eng_Latn', fon: 'fon_Latn', yor: 'yor_Latn' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
const HF_URL = `https://api-inference.huggingface.co/models/${MODEL}`;

async function translate(text, tgtCode, token) {
  const { masked, vars } = protect(text);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = await fetch(HF_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputs: masked,
        parameters: { src_lang: FLORES.fr, tgt_lang: tgtCode },
        options: { wait_for_model: true },
      }),
    });
    if (res.status === 503) {
      await sleep(4000 * (attempt + 1)); // modèle en chargement
      continue;
    }
    if (!res.ok) throw new Error(`HF ${res.status} : ${(await res.text()).slice(0, 120)}`);
    const data = await res.json();
    const raw = Array.isArray(data) ? data[0]?.translation_text : data?.translation_text;
    if (!raw) throw new Error(`réponse HF inattendue : ${JSON.stringify(data).slice(0, 160)}`);
    return restore(raw, vars);
  }
  throw new Error('HF indisponible après plusieurs tentatives (modèle en chargement ?)');
}

async function main() {
  const dry = flag('dry');
  const token = process.env.HF_TOKEN;
  if (!token && !dry) {
    console.error('❌ HF_TOKEN manquant. Génère un jeton (accès lecture) sur :');
    console.error('   https://huggingface.co/settings/tokens');
    console.error('   puis : HF_TOKEN=hf_xxx node scripts/i18n/translate-draft.mjs --locale=fon,yor');
    console.error('   (ou --dry pour un essai à blanc sans appel réseau)');
    process.exit(1);
  }

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

    console.log(`\n${locale} : ${missing.length} clés manquantes${dry ? ' (DRY)' : ` → NLLB ${MODEL}`}`);
    const rows = [['key', 'critical', 'fr', 'en', 'draft', 'flags'].map(csv).join(',')];
    let done = 0;
    let flagged = 0;
    let humans = 0;

    for (const key of missing) {
      const critical = isCritical(key);
      if (critical && !includeCritical) {
        rows.push([key, 'CRITIQUE', fr[key], en[key] ?? '', '', 'HUMAIN_OBLIGATOIRE'].map(csv).join(','));
        humans += 1;
        continue;
      }
      if (dry) {
        rows.push([key, critical ? 'CRITIQUE' : '', fr[key], en[key] ?? '', '', 'DRY'].map(csv).join(','));
        continue;
      }
      try {
        const { out, ok } = await translate(fr[key], FLORES[locale], token);
        if (!ok) flagged += 1;
        const flags = [critical ? 'CRITIQUE' : '', ok ? '' : 'PLACEHOLDER_A_VERIFIER'].filter(Boolean).join('|');
        rows.push([key, critical ? 'CRITIQUE' : '', fr[key], en[key] ?? '', out, flags].map(csv).join(','));
        done += 1;
        process.stdout.write(`\r  ${done}/${missing.length}`);
        await sleep(200);
      } catch (e) {
        rows.push([key, critical ? 'CRITIQUE' : '', fr[key], en[key] ?? '', '', `ERREUR:${String(e.message).slice(0, 80)}`].map(csv).join(','));
      }
    }

    const path = resolve(OUT_DIR, `draft.${locale}.csv`);
    writeFileSync(path, `${rows.join('\n')}\n`, 'utf8');
    console.log(`\n  → ${path}  (machine ${done}, critiques→humain ${humans}, placeholders à vérifier ${flagged})`);
  }

  console.log('\n⚠️  Brouillons = 1er jet. RELECTURE par locuteurs natifs OBLIGATOIRE avant intégration (Phase 3).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
