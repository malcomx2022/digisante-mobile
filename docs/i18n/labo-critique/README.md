# Kit de relecture native — 31 textes critiques du laboratoire (FON / YOR)

Préparé le 11 novembre 2026. **Aucune traduction n'est fournie ni modifiée** : la règle du projet (CLAUDE.md §6)
interdit toute traduction automatique pour les textes `labo.*` et exige la **double validation** par deux locuteurs
natifs distincts.

## Pourquoi ce kit, alors qu'aucune clé `labo.*` ne « manque »

`pnpm i18n:check` affiche 0 clé `labo.*` manquante en FON et YOR : les 31 textes sont **présents**, mais
**aucun n'a été validé**.

- Ils viennent du premier jet machine (NLLB-200). Le commentaire en tête des blocs `fon`/`yor` de `messages.ts`
  disait « relue et validée… double validation » (corrigé le 12/11/2026), mais aucune preuve ne l'appuyait : le registre
  `docs/validation/L9/evidence.json` est vide, `docs/i18n/TRACABILITE_Relectures.md` n'existe pas, et la campagne
  du 14/10/2026 (archivée dans `docs/validation/archive/L9-3e061d52-2026-11-07/`) laisse les 31 clés `labo.*` de
  chaque langue au statut `OPEN`.
- Plusieurs textes paraissent faux (colonne `remarque`). Ces textes s'affichent pour le personnel du laboratoire,
  pour le **médecin** (étiquette « Critique », valeur trop basse/élevée) et pour le **patient** (état de son analyse).
  Un texte faux sur une alerte de valeur critique est plus dangereux qu'un texte en français.

## Fichiers

| Fichier | Pour qui |
|---|---|
| `labo-critique.fon.csv` | Relecteurs Fɔ̀ngbè : remplir la colonne `fon` |
| `labo-critique.yor.csv` | Relecteurs Yorùbá : remplir la colonne `yor` |

Colonnes :
- `key`, `critical`, `fr`, `en` : **ne pas modifier** (l'import refuse un fichier dont `fr` ou `en` a changé).
- **colonne de la langue : à remplir**. Elle est volontairement vide.
- `texte_actuel_non_valide` : ce que l'application affiche aujourd'hui. Proposition à juger, pas une référence.
- `contexte` : où le texte s'affiche et qui le lit.
- `remarque` : doutes relevés lors de la préparation. Ce sont des pistes, pas un avis de locuteur natif.

## Consignes aux relecteurs

1. Pour chaque ligne, lire le texte actuel. **S'il est juste**, le recopier dans la colonne de la langue.
   **S'il est faux ou maladroit**, écrire la bonne traduction. Une colonne vide n'est jamais traitée comme une
   approbation.
2. Traduire le **sens** : textes courts et clairs. `labo.critical`, `labo.check_msg`, `labo.critical_short` et
   `labo.reason.*` portent une alerte médicale : le sens doit être exact.
3. Garder tels quels `orderId` (`labo.order`) et, si c'est naturel, `glucose` (`labo.analysis_ph`).
4. Ne pas recopier le français : une cellule identique au français est refusée à l'import (c'est le cas du texte
   actuel FON de `labo.title`).
5. Si un texte n'a pas d'équivalent naturel, laisser la cellule **vide** et écrire une remarque à part. L'écran
   affichera alors le français, ce qui ne présente aucun danger. Rien n'est inventé.

## Double validation (obligatoire)

Pour chaque langue :
- un **premier relecteur** remplit le fichier ;
- un **second relecteur**, différent, le relit et le confirme ;
- le porteur conserve le retour signé hors dépôt, sous une **référence privée** (aucune donnée personnelle dans le
  dépôt).

## Intégration (une fois les deux relectures faites)

Les clés existent déjà : il faut **`--overwrite`**, sinon chaque ligne est refusée comme « déjà traduite ».

```bash
node scripts/i18n/import-validated.mjs --locale fon --csv <retour.fon.csv> \
  --reviewer "<relecteur 1>" --date <AAAA-MM-JJ> \
  --second-reviewer "<relecteur 2>" --second-date <AAAA-MM-JJ> \
  --evidence-ref "<référence privée du retour>" --overwrite --dry-run
```

Relire le compte rendu du `--dry-run`, puis relancer sans `--dry-run`. Recommencer avec `--locale yor`.
Une ligne laissée vide est refusée sans conséquence : le texte actuel non validé reste affiché. Pour l'enlever, il
faut une décision du porteur (retour au français), pas un import.

Après l'import :
- la traçabilité (date, relecteurs, clés, empreintes, sans contenu) est ajoutée automatiquement à
  `docs/i18n/TRACABILITE_Relectures.md` ;
- `pnpm i18n:check` doit rester à **0 clé `labo.*` manquante** ;
- `messages.ts` fait partie de l'instantané L9 : lancer `pnpm validation:prepare`, régénérer et valider le dossier
  clinique L9, puis `pnpm validation:check`.

Format vérifié le 11/11/2026 : `import-validated.mjs --overwrite --dry-run` accepte ce fichier, une fois rempli, avec
une double validation (31 clés critiques YOR ; 30 FON, `labo.title` étant refusée parce qu'elle recopie le français).
