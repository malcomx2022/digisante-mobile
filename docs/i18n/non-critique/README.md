# Kit de relecture native — 251 textes non critiques manquants (FON / YOR)

Préparé le 11 novembre 2026. **Aucune traduction n'est intégrée à l'application** : les brouillons de ce kit sont un
premier jet machine et ne seront jamais publiés tels quels (CLAUDE.md §8, « Langues »). Seuls les textes **écrits ou
confirmés par un relecteur natif** sont importés.

Les textes critiques (urgence, laboratoire, paiements) ont leurs propres kits : `../sos-critique/`,
`../labo-critique/` et `../payments-critique/`.

## Contenu

251 textes par langue, absents aujourd'hui en Fɔ̀ngbè et en Yorùbá : l'écran affiche le français.

| Domaine (préfixe) | Textes | Domaine | Textes |
|---|---|---|---|
| `vault.` coffre hors ligne | 46 | `labkyc.` dossier laboratoire | 11 |
| `subscriptions.` abonnement médecin | 34 | `legal.` textes légaux (libellés) | 11 |
| `finance_ops.` opérations financières (admin) | 29 | `deletions.` effacement (admin) | 10 |
| `referrals.` orientations | 26 | `teleconsult.` téléconsultation | 9 |
| `revenue.` revenus médecin | 24 | `dmpdoc.` pièces du dossier | 9 |
| `edureview.` relecture des contenus | 8 | `proprofile.` fiche médecin | 7 |
| `triage.`, `pro.` | 6 chacun | `privacy.` | 5 |
| `pharmacie.` | 4 | `prescription.`, `offline.` | 2 chacun |
| `posology.`, `integrations.` | 1 chacun | | |

## Fichiers

| Fichier | Pour qui |
|---|---|
| `non-critique.fon.csv` | Relecteurs Fɔ̀ngbè : remplir la colonne `fon` |
| `non-critique.yor.csv` | Relecteurs Yorùbá : remplir la colonne `yor` |

Colonnes :
- `key`, `critical`, `fr`, `en` : **ne pas modifier** (l'import refuse un fichier dont `fr` ou `en` a changé).
- **colonne de la langue : à remplir**. Elle est volontairement vide.
- `brouillon_nllb_a_relire` : premier jet machine (NLLB-200, exécuté en local). **Souvent faux** : sens tronqué,
  mots inventés, phrases incomplètes. C'est une aide, pas une référence.
- `alerte` : variable `{…}` altérée par la machine, brouillon identique au français, ou brouillon retiré parce
  qu'inexploitable (la machine bouclait sur un mot : 13 en FON, 7 en YOR). Dans ce dernier cas, traduire directement.
- `ecrans` : où le texte s'affiche dans l'application (pour le contexte).

## Consignes aux relecteurs

1. Pour chaque ligne, lire le français (et l'anglais en aide). Si le brouillon est juste, le **recopier** dans la
   colonne de la langue ; sinon, écrire la bonne traduction. Une colonne vide n'est jamais traitée comme une
   approbation.
2. Garder **tels quels** les fragments entre accolades (`{name}`, `{amount}`, `{date}`…) : l'application les remplace.
   L'import refuse une ligne dont les variables diffèrent du français.
3. Traduire le sens, en phrases courtes et orales ; le public comprend des patients peu alphabétisés.
4. Ne pas recopier le français : une cellule identique au français est refusée à l'import.
5. Si un texte n'a pas d'équivalent naturel, laisser la cellule **vide** : le français reste affiché, sans danger.

## Validation et intégration

Une **seule** relecture native suffit pour ces textes non critiques. Le porteur conserve le retour signé hors
dépôt, sous une **référence privée** (aucune donnée personnelle dans le dépôt).

```bash
node scripts/i18n/import-validated.mjs --locale fon --csv <retour.fon.csv> \
  --reviewer "<relecteur>" --date <AAAA-MM-JJ> \
  --evidence-ref "<référence privée du retour>" --dry-run
```

Relire le compte rendu du `--dry-run`, puis relancer sans `--dry-run`. Recommencer avec `--locale yor`. Les cellules
laissées vides sont refusées sans conséquence.

Après l'import :
- la traçabilité (date, relecteur, clés, empreintes, sans contenu) est ajoutée automatiquement à
  `docs/i18n/TRACABILITE_Relectures.md` ;
- `pnpm i18n:check` : le nombre de textes manquants baisse d'autant ;
- `messages.ts` fait partie de l'instantané L9 : lancer `pnpm validation:prepare`, régénérer et valider le dossier
  clinique L9, puis `pnpm validation:check`.

## Régénérer les brouillons

Les brouillons se régénèrent avec `pnpm i18n:draft` (`scripts/i18n/translate-draft.mjs`). Prérequis : Python avec
`transformers`, `torch` et `sentencepiece` ; le modèle `facebook/nllb-200-distilled-600M` (≈ 2,5 Go, licence
CC-BY-NC) est téléchargé au premier lancement. La sortie `docs/i18n/draft.<langue>.csv` n'est pas versionnée.

Format vérifié le 11/11/2026 : `import-validated.mjs --dry-run` accepte ce fichier une fois rempli (251 clés par
langue, un seul relecteur, 0 refusée), avec des marqueurs de test qui ne sont pas des traductions.
