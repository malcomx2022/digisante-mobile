#!/usr/bin/env node
// Crée une nouvelle campagne vierge ; ne réécrit jamais un dossier de retour.
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { buildSnapshot, ROOT, sha256 } from './content.mjs';
import { CLINICAL_SCOPES, contentHash } from './check-l9-gate.mjs';
import { reviewArtifacts } from './prepare-l9.mjs';
import { buildLinguisticReview } from './linguistic-review.mjs';
import { buildClinicalReview } from './clinical-review.mjs';
import { REFERENCES, CONSULTED_ON } from './review-references.mjs';

export const CAMPAIGN_ID = 'L9-2026-10-14';
export const BASE_COMMIT = '3e2eb7f2f72d9b5d9d4aee2a74d4b7f16ec7c620';
export const SOURCE_SNAPSHOT = '3e061d5232d7bc11fe4dc92134a1b2e8d0dc1753b503c38ba261365b514944ed';
export const DEFAULT_DIR = resolve(ROOT, 'docs/validation/L9/campaign-2026-10-14');
const ARCHIVE = 'Kit_Relecteurs_L9.zip';
const GENERATOR_SOURCES = ['scripts/validation/prepare-review-campaign.mjs', 'scripts/validation/clinical-review.mjs', 'scripts/validation/linguistic-review.mjs', 'scripts/validation/review-references.mjs', 'scripts/docs/generate-l9-review-kit.cjs'];
const EXTRA_SOURCES = ['apps/web/src/lib/speech.ts', 'apps/web/src/components/chat/PhrasebookPanel.tsx'];
const json = (value) => JSON.stringify(value, null, 2) + '\n';
const cell = (value) => `"${String(value !== null && typeof value === 'object' ? JSON.stringify(value) : value ?? '').replace(/"/g, '""')}"`;
export function objectsCsv(rows) {
  if (!rows.length) throw new Error('Une grille vide ne constitue pas un dossier de revue');
  const keys = Object.keys(rows[0]);
  if (rows.some((row) => JSON.stringify(Object.keys(row)) !== JSON.stringify(keys))) throw new Error('Colonnes incohérentes');
  return [keys, ...rows.map((row) => keys.map((key) => row[key]))].map((row) => row.map(cell).join(',')).join('\n') + '\n';
}

function guide(campaign) {
  const s = campaign.stats;
  return `# Campagne de relecture ${CAMPAIGN_ID}

Statut : PREPARED_FOR_REVIEW — dossiers vierges, aucune validation humaine attestée. Les relecteurs sont identifiés par le porteur ; leurs identités, habilitations et disponibilités restent à vérifier dans le circuit privé.

Base du code : ${BASE_COMMIT} (main après fusion de PR #203). Snapshot SHA256 : ${campaign.sourceSnapshotSha256}. Chaque portée a sa propre empreinte dans campaign.json et les formulaires. Les empreintes supplémentaires du moteur vocal et du panneau phrasier documentent la recette ; elles ne changent pas le contrat L9.

## Documents à remettre

Le ZIP Kit_Relecteurs_L9.zip contient ce guide, les formulaires DOCX, le dossier clinique non signé existant et les grilles CSV. Le guide documentaire à partager est Guide_Relecteurs_L9.docx. Utiliser des copies privées des formulaires et CSV pour les retours ; conserver les modèles publics vierges. Importer les CSV dans le tableur avec encodage UTF-8 et séparateur virgule pour préserver Fɔ̀ngbè, Yorùbá et les diacritiques ; vérifier les caractères avant et après réexport.

| Destinataire | Documents | Retour attendu |
|---|---|---|
| Coordinateur clinique | Dossier_Clinique_L9.docx, Avis_Clinique_L9.docx, clinical-scopes.csv, clinical-cases.csv, references.csv | Avis distinct sur chacune des sept portées ; corrections exactes et références |
| Deux locuteurs Fɔ̀ngbè distincts | Avis_Linguistique_FON_L9.docx, ui.fon.review.csv, phrasebook.fon.review.csv, glossary.fon.csv | Relecture indépendante de tout le corpus, propositions et divergences |
| Deux locuteurs Yorùbá distincts | Avis_Linguistique_YOR_L9.docx, ui.yor.review.csv, phrasebook.yor.review.csv, glossary.yor.csv | Même processus pour Yorùbá |
| Équipe de recette avec public cible | source-questions.csv, usability-sessions.csv, grilles de langue | Sens restitué, erreurs observées, oralité et affichage sur appareils |

Un même binôme peut couvrir UI et phrasier dans sa langue. Une même personne habilitée peut couvrir plusieurs portées cliniques. Les profils suggérés dans clinical-scopes.csv aident à répartir le travail ; le porteur vérifie l'habilitation et la compétence de chaque signataire.

## Étape 1 — Cadrer la séance et figer le candidat

Nommer un coordinateur, attribuer les portées et convenir des dates dans le circuit privé. Avant la séance, fixer population, nombre de participants, appareils, scénarios et critères quantitatifs ; ce kit n'invente aucun seuil d'acceptabilité clinique. Utiliser uniquement des données synthétiques. Ouvrir les sources et écrans correspondant aux clés ; contextRoute et contextDescription sont volontairement vides et doivent être renseignés après observation, sans route inventée.

## Étape 2 — Traiter les réserves prioritaires

clinical-cases.csv présente ${campaign.clinicalCases} cas synthétiques ou constats d'inspection. observedOutput indique EXECUTED_PURE_SOURCE pour les modules purs ou STATIC_SOURCE_INSPECTION pour les constats de code. Ces sorties décrivent le comportement actuel : aucune n'est une recommandation de dose ou une décision clinique acceptée. La recette réelle sur écran, API et voix reste à effectuer.

Les posologies peuvent perdre fractions et unités, transformer une fréquence hebdomadaire en prises quotidiennes ou inverser une négation. Un triage sans réponses retourne HOME. Le calendrier vaccinal doit être confronté au calendrier béninois consolidé actuel : MenA, déploiement du vaccin paludisme, dates, rappels et rattrapage ; HPV requiert un arbitrage de périmètre au-delà des 15 mois actuels. Examiner aussi CPN, auto-mesures, alertes d'allergie et conseils éducatifs. Les options techniques proposées dans les cas sont à discuter, jamais préapprouvées.

## Étape 3 — Clarifier les sources FR/EN

Les ${campaign.sourceQuestions.length} questions SQ relèvent des ambiguïtés de sens, d'unités, d'abréviations, d'état ou d'action. Les résoudre avec le responsable produit et, si clinique, le professionnel compétent, avant traduction définitive. Ne pas choisir silencieusement entre deux intentions. Le glossaire contient des concepts sources et des pièges, avec termes natifs vierges.

## Étape 4 — Première relecture native complète

Chaque langue comprend ${s.ui.total} clés UI, dont ${s.locales.fon.present} textes existants et ${s.locales.fon.missing} manquants, ainsi que ${s.phrasebook.total} phrases natives manquantes. Les textes déjà présents doivent aussi être relus. P0 regroupe les ${s.ui.critical} clés critiques ; les six SOS absentes sont prioritaires. Les fichiers critical.*.review.csv facilitent ce premier passage, mais seul le fichier ui.*.review.csv fait foi pour l'ensemble ; reporter toute observation P0 dans celui-ci. P1 puis P2 puis P3 suivent ; toutes les clés restent nécessaires. Q0/Q1/Q2 organisent le phrasier sans retirer l'exigence de double relecture.

Remplir proposedNative et primaryNotes. Conserver strictement les variables entre accolades, nombres, unités, négations, acteur, temporalité et degré d'urgence. Employer une orthographe et des diacritiques UTF-8 vérifiés. Aucune traduction automatique native ni texte natif généré n'est fourni par ce kit. Un texte identique au FR peut être un emprunt légitime : le signal sameAsFrench appelle une revue, pas un rejet automatique.

## Étape 5 — Deuxième relecture et contreseing clinique

Le second locuteur doit être une personne distincte. Faire d'abord restituer le sens indépendamment, puis confronter le candidat à la source et au contexte. Consigner divergences et arbitrages ; une réserve reste OPEN, DISPUTED ou TO_CORRECT jusqu'à correction et nouvelle revue. Les statuts de travail possibles sont OPEN, NEEDS_CONTEXT, TO_CORRECT, READY_FOR_SECOND_REVIEW, DISPUTED, ACCEPTED_FOR_IMPORT et REJECTED. ACCEPTED_FOR_IMPORT est un état de travail ; seul un dossier vérifié sur le contenu final autorise l'intégration.

Le professionnel relit questions et résultats du triage, calendriers, posologie et phrasier clinique. Chaque portée reçoit un avis explicite : à corriger, rejeté ou validé, avec périmètre et empreinte exacts. Un avis partiel ne valide pas les sept portées. Aucun champ décision, signature, nom ou date n'est prérempli.

## Étape 6 — Tester compréhension, voix et affichage

Sur appareil, demander : « Que vous demande ce message ? », « Que se passe-t-il si vous appuyez ici ? », « Qu'est-ce qui a été fait et que reste-t-il à faire ? », « À quoi correspondent ce nombre et son unité ? », « Dans quelle langue sera envoyé ce message ? ». Recueillir une restitution spontanée avant toute explication. Consigner erreur, aide nécessaire, action réellement choisie, appareil, langue et référence de version dans usability-sessions.csv ; les identifiants de session doivent être pseudonymes, sans données patient.

Contrôler diacritiques, police agrandie, troncatures, langue de repli, choix de langue cible du phrasier, nombres, unités et mises en garde. Écouter le son réellement produit : speech.ts mappe FON et YOR vers fr-FR. Une validation écrite ne valide pas cette prononciation. Toute confusion liée à urgence, prescription, consentement ou paiement ouvre une réserve, une correction et un nouveau test. Ne pas remplacer le test oral par une reconstruction textuelle du moteur vocal.

## Étape 7 — Appliquer les corrections et renouveler la revue

Ne pas modifier les algorithmes cliniques ou leurs consignes sur la seule base de ce kit. Le contrat L9 exige un diff exact approuvé, des tests pertinents et une nouvelle revue de la version corrigée. Une option à soumettre pour la posologie est de conserver intégralement le texte du prescripteur et de retirer les déductions ambiguës ; le professionnel doit approuver le périmètre et le rendu avant mise en œuvre.

Pour l'éducation, demander l'inventaire réel des articles publiés sur la cible : identifiants, révisions, langues, titres et corps, date d'export, empreinte de l'export. Le seed ne prouve pas le corpus de production. Le contreseing education doit inclure runtimeInventoryRef. Aucun accès à cette base de production n'est attesté dans ce dossier.

## Étape 8 — Recevoir les pièces et préparer l'intégration

Les formulaires remplis, signatures, identités, références nominatives et notes sensibles restent hors dépôt public. Le porteur vérifie identité, compétence, habilitation, deux personnes natives distinctes, dates réelles, portées, empreintes et résolution de toutes les réserves. Les quatre pièces natives portent sur FON/UI, FON/phrasier, YOR/UI et YOR/phrasier ; sept avis cliniques sont nécessaires.

Les grilles review.csv utilisent proposedNative et ne sont pas directement importables. Après vérification, produire un CSV conforme aux modèles source-messages.fon.csv ou source-messages.yor.csv. La revue couvre les 1 098 clés ; l'import porte seulement sur les ajouts et remplacements effectivement approuvés. Conserver les textes existants relus et acceptés sans les réimporter. L'importeur refuse les nouvelles valeurs identiques au FR ; un emprunt existant inchangé peut être couvert par la revue sans réimport, jamais inventer une reformulation pour contourner ce contrôle.

Exécuter l'import UI avec les identités et références vérifiées, d'abord en --dry-run --require-all sur les lignes sélectionnées pour l'import. Un remplacement demande --overwrite explicite. --require-all exige zéro rejet dans ce CSV, pas une preuve de revue complète ; vérifier séparément la couverture des 1 098 clés. Le phrasier natif passe par une PR dédiée, pas par cet importeur. Après intégration, régénérer snapshot et dossier, comparer les empreintes finales et obtenir le contreseing sur le candidat final. Une signature de l'état initial incomplet ne prouve pas les traductions ajoutées ensuite.

Renseigner evidence.json uniquement à partir de pièces effectivement vérifiées, selon ../README.md et ../../../CONTRAT_Validation_L9.md. Le gate contrôle la cohérence des références, sans authentifier signature ni habilitation. Les contrôles techniques verts ne constituent ni validation humaine ni GO de lancement. Les gates L9, L10 et L11 restent distincts.

## Références publiques et limites

Les liens de references.csv ont été consultés le ${CONSULTED_ON}. Les annonces nationales signalent des évolutions du PEV ; aucun calendrier national consolidé de 2026 n'a été obtenu. Demander ce document au référent PEV compétent. Les recommandations OMS sont des références professionnelles dont l'application locale, les populations et les mises à jour doivent être arbitrées ; aucune dose ni modification de sévérité n'est choisie dans ce kit.

## Vérification des modèles par l'équipe de développement

Commande : pnpm validation:campaign:check. Elle compare les sources, toutes les grilles vierges, les empreintes des artefacts et les documents OOXML. Pour une nouvelle copie des modèles de cette campagne, pnpm validation:campaign --output-dir <nouveau-dossier-vide>. La génération refuse un dossier existant pour protéger les retours et refuse un snapshot différent. Une future campagne exige un nouvel identifiant, sa base de code, ses références actualisées et un snapshot explicitement fixé dans l'outillage. Le contrôle du kit n'accorde aucune approbation et ne modifie pas evidence.json. Le ZIP contient les modèles ; sa copie remplie ne doit jamais être commitée.
`;
}

export function buildCampaignArtifacts(snapshot = buildSnapshot()) {
  if (snapshot.sourceSnapshotSha256 !== SOURCE_SNAPSHOT) throw new Error('Version source différente : préparer explicitement une nouvelle campagne, sans réutiliser les dates ni la base du kit L9-2026-10-14.');
  const linguistic = buildLinguisticReview(snapshot);
  const clinical = buildClinicalReview(snapshot);
  if (JSON.stringify(clinical.scopes.map((row) => row.scope)) !== JSON.stringify(CLINICAL_SCOPES)) throw new Error('Les sept portées doivent rester celles du contrat L9');
  const fingerprint = (path) => ({ path, sha256: sha256(readFileSync(resolve(ROOT, path))) });
  const campaign = {
    schemaVersion: 1, campaignId: CAMPAIGN_ID, status: 'PREPARED_FOR_REVIEW', baseCommitSha: BASE_COMMIT,
    sourceSnapshotSha256: snapshot.sourceSnapshotSha256,
    scopes: clinical.scopes,
    nativeScopes: ['fon', 'yor'].flatMap((locale) => ['ui', 'phrasebook-native'].map((scope) => ({ locale, scope, contentSha256: contentHash(snapshot, scope, locale) }))),
    additionalRecipeSources: EXTRA_SOURCES.map(fingerprint), generatorSources: GENERATOR_SOURCES.map(fingerprint),
    stats: linguistic.stats, sourceQuestions: linguistic.questions, clinicalCases: clinical.cases.length,
    reserves: clinical.reserves, references: REFERENCES.map((row) => ({ ...row, consultedOn: CONSULTED_ON })),
    humanApprovals: [], runtimeEducationInventory: { status: 'NOT_PROVIDED', reference: '' },
  };
  const files = { 'campaign.json': json(campaign), 'README.md': guide(campaign), 'clinical-cases.csv': objectsCsv(clinical.cases),
    'clinical-scopes.csv': objectsCsv(clinical.scopes.map((row) => ({ ...row, reviewStatus: 'OPEN', decision: '', requiredCorrection: '', evidenceRef: '', runtimeInventoryRef: '' }))),
    'source-questions.csv': objectsCsv(linguistic.questions.map((row) => ({ ...row, decision: '', clarification: '', issueRef: '', reviewStatus: 'OPEN' }))),
    'references.csv': objectsCsv(campaign.references),
    'usability-sessions.csv': objectsCsv([{ sessionRef: '', locale: '', scope: '', keyOrCaseId: '', candidateContentSha256: '', deviceAndBrowser: '', scenario: '', spontaneousMeaning: '',observedAction: '', assistanceNeeded: '', errorObserved: '', diacriticsAndDisplay: '', actualSpeechAndVoice: '', result: 'NOT_RUN', issueRef: '', retestRef: '' }]),
  };
  for (const locale of ['fon', 'yor']) {
    files[`ui.${locale}.review.csv`] = objectsCsv(linguistic.uiSheets[locale]);
    files[`critical.${locale}.review.csv`] = objectsCsv(linguistic.uiSheets[locale].filter((row) => row.critical));
    files[`phrasebook.${locale}.review.csv`] = objectsCsv(linguistic.phrasebookSheets[locale]);
    files[`glossary.${locale}.csv`] = objectsCsv(linguistic.glossary.map((row) => ({ locale, ...row })));
  }
  const sourceFiles = Object.fromEntries(Object.entries(reviewArtifacts(snapshot)).filter(([name]) => name !== 'manifest.json').map(([name, data]) => [`source-${name}`, data]));
  Object.assign(files, sourceFiles);
  files['source-manifest.json'] = json({ schemaVersion: 1, sourceSnapshotSha256: snapshot.sourceSnapshotSha256, artifacts: Object.fromEntries(Object.entries(sourceFiles).map(([name, data]) => [name, sha256(data)])) });
  return { campaign, files };
}

export function writeNewCampaign(out, files) {
  if (existsSync(out)) throw new Error('Dossier existant : aucun écrasement autorisé. Utiliser --check ou un nouveau --output-dir.');
  for (const name of Object.keys(files)) if (!/^[a-zA-Z0-9_.-]+$/.test(name) || name === 'manifest.json' || name === ARCHIVE) throw new Error('Nom de fichier non autorisé');
  mkdirSync(out, { recursive: true });
  for (const [name, data] of Object.entries(files)) writeFileSync(join(out, name), data, { flag: 'wx' });
  writeFileSync(join(out, 'manifest.json'), json({ schemaVersion: 1, campaignId: CAMPAIGN_ID, artifacts: Object.fromEntries(Object.entries(files).map(([name, data]) => [name, sha256(data)])) }), { flag: 'wx' });
}

const zipProgram = `import sys,zipfile,json,pathlib
d=pathlib.Path(sys.argv[1]); mode=sys.argv[2]; m=json.loads((d/'manifest.json').read_text()); names=sorted([*m['artifacts'],'manifest.json']); archive=d/'${ARCHIVE}'
if mode=='build':
 with zipfile.ZipFile(archive,'x',compression=zipfile.ZIP_DEFLATED) as z:
  for n in names:
   info=zipfile.ZipInfo(n,(1980,1,1,0,0,0)); info.compress_type=zipfile.ZIP_DEFLATED; info.external_attr=0o100644<<16; z.writestr(info,(d/n).read_bytes())
else:
 with zipfile.ZipFile(archive) as z:
  assert z.namelist()==names, 'Inventaire ZIP différent'
  for n in names: assert z.read(n)==(d/n).read_bytes(), 'Contenu ZIP différent: '+n
`;
function zip(out, mode) {
  const result = spawnSync('python3', ['-c', zipProgram, out, mode], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'Échec de vérification du ZIP');
}

export function checkCampaign(out, expectedFiles) {
  const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.campaignId !== CAMPAIGN_ID) throw new Error('Manifest de campagne invalide');
  const names = Object.keys(manifest.artifacts ?? {});
  const expectedNames = Object.keys(expectedFiles);
  const docNames = ['Guide_Relecteurs_L9.docx', 'Avis_Clinique_L9.docx', 'Avis_Linguistique_FON_L9.docx', 'Avis_Linguistique_YOR_L9.docx', 'Dossier_Clinique_L9.docx'];
  if (JSON.stringify([...names].sort()) !== JSON.stringify([...expectedNames, ...docNames].sort())) throw new Error('Inventaire de campagne incorrect');
  if (JSON.stringify(readdirSync(out).sort()) !== JSON.stringify([...names, 'manifest.json', ARCHIVE].sort())) throw new Error('Fichier inattendu dans les modèles publics');
  for (const name of names) {
    const data = readFileSync(join(out, name));
    if (sha256(data) !== manifest.artifacts[name]) throw new Error(`Modèle modifié : ${name}`);
    if (name in expectedFiles && !data.equals(Buffer.from(expectedFiles[name]))) throw new Error(`Modèle périmé : ${name}`);
  }
  if (!readFileSync(join(out, 'Dossier_Clinique_L9.docx')).equals(readFileSync(resolve(ROOT, 'docs/validation/L9/Dossier_Clinique_L9.docx')))) throw new Error('Dossier clinique différent de la référence L9');
  zip(out, 'check');
}

export async function main(args = process.argv.slice(2)) {
  if (args.some((arg) => !['--check', '--output-dir'].includes(arg) && args[args.indexOf(arg) - 1] !== '--output-dir')) throw new Error('Argument inconnu');
  const index = args.indexOf('--output-dir');
  if (index >= 0 && (!args[index + 1] || args[index + 1].startsWith('--'))) throw new Error('--output-dir exige un nouveau chemin');
  const out = resolve(index >= 0 ? args[index + 1] : DEFAULT_DIR);
  const { campaign, files } = buildCampaignArtifacts();
  if (args.includes('--check')) checkCampaign(out, files);
  else {
    if (existsSync(out)) throw new Error('Dossier existant : aucun écrasement autorisé. Utiliser --check ou un nouveau --output-dir.');
    const require = createRequire(import.meta.url);
    const { buildDocuments } = require('../docs/generate-l9-review-kit.cjs');
    const documents = await buildDocuments(campaign, files['README.md']);
    const dossier = readFileSync(resolve(ROOT, 'docs/validation/L9/Dossier_Clinique_L9.docx'));
    writeNewCampaign(out, { ...files, ...documents, 'Dossier_Clinique_L9.docx': dossier });
    zip(out, 'build');
  }
  const validator = spawnSync('python3', [resolve(ROOT, 'scripts/docs/validate-l9-review-kit.py'), out], { encoding: 'utf8' });
  if (validator.status !== 0) throw new Error(validator.stderr || validator.stdout || 'DOCX invalide');
  console.log(validator.stdout.trim());
  console.log(`${args.includes('--check') ? 'Vérifié' : 'Préparé'} : ${out}, snapshot ${campaign.sourceSnapshotSha256} ; aucun avis humain ajouté.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
