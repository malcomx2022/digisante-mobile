# Kit de correction du phrasier (`-C1`) — FON / YOR

Préparé le 16 novembre 2026. Il fait suite aux retours `PHR-FON-2026-11` et `PHR-YOR-2026-11`, intégrés par la PR #257.
**Aucune traduction n'est fournie.** Les relecteurs écrivent eux-mêmes les textes corrigés.

**Statut (16/11/2026) : retours reçus et intégrés** (réf. `PHR-FON-2026-11-C1`, `PHR-YOR-2026-11-C1`). Les quatre
phrases sont corrigées ; détail dans `docs/i18n/TRACABILITE_Relectures.md`. Les modèles ci-dessous restent vierges.

## Pourquoi ce kit

L'application a intégré 26 phrases FON et 25 phrases YOR. Trois phrases ont été mises de côté parce que leur sens
semble différer du français. Elles s'affichent en français tant qu'elles ne sont pas corrigées. Un point mineur
s'ajoute en FON.

| Langue | Phrase | Français | Ce qu'il faut vérifier |
|---|---|---|---|
| YOR | `pos.once_day` | Une fois par jour. | « lọ́sàn-án » se lit « l'après-midi », pas « par jour ». Il faut une prise **par jour**, à n'importe quel moment. La phrase `pos.twice_day`, déjà validée, utilise « lójúmọ́ ». |
| YOR | `sym.vomit_diarrhea` | Avez-vous des vomissements ou la diarrhée ? | « ìgbẹ́ » désigne les selles : le vomissement n'apparaît pas. La question doit porter sur **deux** symptômes. |
| FON | `pos.finish` | Terminez tout le traitement. | « azɔn » désigne-t-il le **traitement** ou la **maladie** ? La phrase doit dire de prendre tous les médicaments jusqu'au bout, même si l'on va mieux. |
| FON | `greet.hello` (mineur) | Bonjour, je suis là pour vous aider. | Le texte contient « ‚ » (guillemet bas) à la place d'une virgule. Confirmer la virgule, ou garder tel quel. |

Les trois premières phrases sont des consignes de soin. Une erreur de sens peut changer la prise d'un médicament ou
faire passer à côté d'un symptôme.

## Fichiers

| Fichier | Pour qui |
|---|---|
| `correction.fon.csv` | Relecteurs Fɔ̀ngbè (FON-R1 puis FON-R2) |
| `correction.yor.csv` | Relecteurs Yorùbá (YOR-R1 puis YOR-R2) |

Colonnes :
- `key`, `critical`, `category`, `fr`, `en` : référence, à ne pas modifier ;
- `texte_retour_*` : le texte reçu le 15/11, pour mémoire ;
- `point_a_verifier` : la question posée ;
- **`fon_corrige` / `yor_corrige` : à remplir** avec le texte final ;
- `remarque` : facultative, par exemple pour justifier un texte gardé tel quel.

Empreintes SHA-256 des modèles vierges :
- FON : `d3b5f2c2551318a3157daabfe23927ef17c29194ff84db597180f48217cf3925`
- YOR : `7b65c0d1bb362ef1d3c9c853d703cdd0c88042f6c7e0d55f10e627e5fb9c5f46`

## Consignes aux relecteurs

1. Traduire le **sens** du français, court et simple. La personne qui lit peut être âgée ou inquiète.
2. Si le texte reçu était juste, recopier ce texte dans la colonne corrigée et l'expliquer dans `remarque`.
3. Si aucune formulation naturelle n'existe, laisser la cellule vide et l'expliquer : la phrase restera en français.
4. Ne pas modifier les autres colonnes. Ne pas recopier le français.
5. Ces phrases sont cliniques : un **second relecteur différent** confirme chaque texte, comme pour le premier retour.

## Après le retour

- Le porteur conserve les retours signés **hors dépôt**, sous les références `PHR-FON-2026-11-C1` et
  `PHR-YOR-2026-11-C1`.
- L'intégration se fera par une PR dédiée dans `packages/shared/src/phrasebook.ts`. Les textes seront repris mot pour
  mot et tracés dans `docs/i18n/TRACABILITE_Relectures.md`.
- **Décision à prendre à ce moment-là.** `phrasebook.ts` est figé par la campagne L9 active (`L9-2026-11-16`). Deux
  options :
  - archiver cette campagne et en ouvrir une nouvelle ;
  - attendre la fin de ses avis.

  Le choix revient au porteur.
- Le contreseing clinique (portée `phrasebook`) doit porter sur la version qui intègre ces corrections.
