# Relecture L9 — instantané non signé

Ces fichiers sont une **préparation technique**, pas des retours approuvés. Le porteur fournira les références ultérieurement. Dictionnaires et phrasier sont des contenus statiques, sans donnée patient ; signatures et pièces personnelles restent hors dépôt public.

**Campagne active : [L9-2026-11-16](campaign-2026-11-16/README.md)** (version qui intègre le phrasier FON/YOR, base `2503d9c`, instantané `470492e2…`, fiche `docs/suivi/CAMPAGNE_L9_2026-11-16.md`). Campagnes archivées, dont les retours restent liés à leur instantané : celle du 14 octobre 2026 dans `docs/validation/archive/L9-3e061d52-2026-11-07/` (`3e061d52…`), et `L9-2026-11-15` dans `docs/validation/archive/L9-8d0fd9c3-2026-11-16/` (`8d0fd9c3…`). Chaque campagne fournit un guide DOCX, des formulaires d'avis vierges, des grilles de langue complètes, des cas synthétiques prioritaires et un ZIP à remettre aux relecteurs identifiés. `pnpm validation:campaign:check` vérifie les modèles ; leur présence ne ferme aucune validation. Les retours remplis restent dans le circuit privé. La génération refuse de réécrire un dossier existant ou d'utiliser un snapshot différent : nouvelle copie de la campagne active avec `pnpm validation:campaign --output-dir <nouveau-dossier>`. Une future version exige un nouvel identifiant, une base et des références actualisées, et un snapshot fixé explicitement dans le registre `CAMPAIGNS` de `scripts/validation/prepare-review-campaign.mjs`.

Lire `docs/CONTRAT_Validation_L9.md`. Régénérer l’instantané avec `pnpm validation:prepare`, puis le nouveau DOCX avec `node scripts/docs/generate-l9-dossier.cjs`. Ne jamais remplacer une pièce déjà signée : conserver la version exacte, appliquer le retour dans une PR et demander un nouveau contreseing si contenu corrigé. Ne pas modifier le dossier clinique historique en circulation.

CSV : `current_fon/current_yor` est le texte existant (présence, pas validation) ; la colonne `fon/yor` reste vierge pour le retour. Toutes les 1 098 clés et les 27 phrases sont exposées, y compris les traductions présentes à relire. Les namespaces critiques utilisent la définition unique de `check-coverage.mjs`. Les CSV du phrasier nécessitent une PR dédiée, pas l’importeur UI.

## Registre de références privées vérifiées

`evidence.json` ne contient aucune approbation initiale. Après vérification effective du retour, ajouter des objets avec les champs suivants ; ne pas remplir des noms/dates/signatures fictifs pour faire passer le gate.

| Collection | Champs requis |
|---|---|
| `native` | `locale` (`fon` ou `yor`), `scope` (`ui` ou `phrasebook-native`), `decision` (`APPROVED`), `contentSha256`, `evidenceRef`, `reviewer`, `date`, `secondReviewer`, `secondDate` |
| `clinical` | `scope` (`triage`, `pev`, `maternity`, `phrasebook`, `prescriptions`, `vitals`, `education`), `decision` (`APPROVED`), `contentSha256`, `evidenceRef`, `reviewer`, `date`, `professionalCapacity` ; aussi `runtimeInventoryRef` pour `education` |

Dates : AAAA-MM-JJ réelles et non futures Africa/Lagos. Deux personnes distinctes, seconde date pas antérieure. Les réserves/rejets sont consignés et résolus ; un `REJECTED`/`TO_CORRECT` ne passe pas. Portées uniques, empreinte exacte du contenu courant. Pour calculer les empreintes candidates sans approuver :

```bash
node --input-type=module <<'JS'
import { buildSnapshot } from './scripts/validation/content.mjs';
import { contentHash, CLINICAL_SCOPES } from './scripts/validation/check-l9-gate.mjs';
const s = buildSnapshot();
for (const locale of ['fon', 'yor']) for (const scope of ['ui', 'phrasebook-native']) console.log(locale, scope, contentHash(s, scope, locale));
for (const scope of CLINICAL_SCOPES) console.log(scope, contentHash(s, scope));
JS
```

L’empreinte globale du snapshot lie toutes les sources. Les preuves par portée lient les fichiers/labels pertinents ; toute modification d’un fichier couvert, même technique, demande contrôle de périmètre et nouvelle référence si nécessaire. Une pièce portant sur l’ancien dossier qui ne couvre pas la CPN/posologie ne prouve pas ces sections du nouveau dossier.

## Contrôles

- `pnpm validation:check` : artefacts conformes aux sources, aucun fichier modifié.
- `python scripts/docs/validate-l9-dossier.py` : OOXML + texte/empreintes du snapshot, pas rendu/signature.
- `pnpm validation:gate` : retourne **1 attendu à cette livraison** (dictionnaires/phrasier et pièces non intégrés). Ce résultat est un état ouvert, pas un défaut technique masqué.

Ces contrôles n’authentifient pas les personnes ni une signature. Le porteur vérifie l’habilitation, les pièces privées, les réserves et les corpus DB avant toute décision L11. Aucune ouverture de pilote ou envoi aux relecteurs n’est automatique.
