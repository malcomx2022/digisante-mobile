# Kit de relecture native — 8 textes critiques de l'écran SOS (FON / YOR)

Préparé le 8 novembre 2026. **Aucune traduction n'est fournie** : la règle du projet (CLAUDE.md §6) interdit toute
traduction automatique pour les textes `sos.*`, et exige la **double validation** par deux locuteurs natifs distincts.
Tant que ces textes manquent, une personne qui utilise l'application en Fɔ̀ngbè ou en Yorùbá lit du **français sur
l'écran d'urgence**.

## Fichiers

| Fichier | Pour qui |
|---|---|
| `sos-critique.fon.csv` | Relecteurs Fɔ̀ngbè : remplir la colonne `fon` |
| `sos-critique.yor.csv` | Relecteurs Yorùbá : remplir la colonne `yor` |

Colonnes : `key` et `critical` (ne pas modifier), `fr` (texte de référence, ne pas modifier), `en` (aide),
**colonne de la langue (à remplir)**, `contexte` (où le texte s'affiche).

## Consignes aux relecteurs

1. Traduire le **sens** pour une personne en situation d'urgence : court, clair, sans jargon.
2. `sos.false_alarm` est un **bouton** ; `sos.status.FALSE_ALARM` est une **étiquette d'état** dans l'historique. Les deux
   peuvent porter la même traduction si c'est naturel.
3. Dans `sos.no_contact_notified`, garder le numéro **112** tel quel.
4. Ne pas recopier le français : une cellule identique au français est refusée à l'import.
5. Si un texte n'a pas d'équivalent naturel, laisser la cellule **vide** et écrire une remarque à part : rien n'est inventé.

## Double validation (obligatoire)

Pour chaque langue :
- un **premier relecteur** remplit le fichier ;
- un **second relecteur**, différent, le relit et le confirme ;
- le porteur conserve le retour signé hors dépôt, sous une **référence privée** (pas de donnée personnelle dans le dépôt).

## Intégration (une fois les deux relectures faites)

```bash
node scripts/i18n/import-validated.mjs --locale fon --csv <retour.fon.csv> \
  --reviewer "<relecteur 1>" --date <AAAA-MM-JJ> \
  --second-reviewer "<relecteur 2>" --second-date <AAAA-MM-JJ> \
  --evidence-ref "<référence privée du retour>" --dry-run
```

Relire le compte rendu du `--dry-run`, puis relancer sans `--dry-run`. Recommencer avec `--locale yor`.

Après l'import :
- `pnpm i18n:check` doit afficher **0 critique** manquante ;
- `messages.ts` fait partie de l'instantané L9 : lancer `pnpm validation:prepare`, régénérer et valider le dossier
  clinique L9, puis `pnpm validation:check` ;
- la traçabilité (date, relecteurs, nombre de clés, sans contenu) est ajoutée automatiquement à
  `docs/i18n/TRACABILITE_Relectures.md`.

Format vérifié le 08/11/2026 : `import-validated.mjs --dry-run` accepte ce fichier (8 clés critiques par langue, double
validation), colonne `contexte` comprise.
