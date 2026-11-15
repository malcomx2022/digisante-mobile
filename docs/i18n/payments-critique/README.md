# Kit de relecture native — 32 textes critiques de paiement (FON / YOR)

Préparé le 11 novembre 2026. **Aucune traduction n'est fournie ni modifiée** : la règle du projet (CLAUDE.md §6)
interdit toute traduction automatique pour les textes critiques et exige la **double validation** par deux
locuteurs natifs distincts.

## Pourquoi ce kit

La règle de double validation protégeait le préfixe `payments.`, mais **aucune clé ne le porte** : les textes
d'argent de l'application étaient donc hors de la règle. Sur décision du porteur (11/11/2026), la définition
unique (`CRITICAL_PREFIXES`, `scripts/i18n/check-coverage.mjs`) couvre désormais les textes d'argent vus par le
patient, le proche en diaspora et le médecin payeur :

| Préfixe | Ce qu'il couvre |
|---|---|
| `appt.pay` | payer un rendez-vous, échec du paiement |
| `prescriptions.pay`, `prescriptions.paid` | payer une ordonnance, moyen de paiement, paiement lancé ou en file |
| `subscriptions.payment_` | état d'un paiement (confirmé, en attente, refusé, annulé, remboursé) |
| `wallet.` | portefeuille diaspora : solde, recharge, historique des mouvements |
| `beneficiaries.send_`, `beneficiaries.sent`, `beneficiaries.amount_`, `beneficiaries.no_account` | envoi d'argent à un proche |

Hors périmètre : la gestion du carnet de proches (nom, lien, téléphone) et les écrans opérateurs admin/pro
(`finance.`, `finance_ops.`, `revenue.`).

État en FON comme en YOR : **14 textes absents** (l'écran affiche le français) et **18 textes présents mais jamais
validés** (premier jet machine, aucune trace de relecture). Quelques textes présents paraissent faux : voir la
colonne `remarque`.

## Statut au 15 novembre 2026

- **YOR : intégré.** 32/32 textes importés après double validation native (`YOR-R1`/`YOR-R2`, 14/11/2026,
  réf. privée `PAY-YOR-2026-11`, `--overwrite --require-all`), entrée dans `docs/i18n/TRACABILITE_Relectures.md`.
  Avant import, la colonne `en` du fichier reçu a été remise à sa valeur de référence sur décision du porteur
  (2 cellules altérées par le tableur : `wallet.converted`, `beneficiaries.send_confirm` ; aucune cellule `yor`
  touchée). Fichier reçu SHA-256 `5c4503a3948d97b0df2178ff2a8598b17e36f77ed75682e45b0ca00010fdab11`, fichier
  importé `de2e9956c857441908ddc723a7638bc4764a97c6fea4ce68834b233431f9bd9b`. Importés tels que validés, signalés
  au porteur : « XOF » au lieu de « FCFA » (`beneficiaries.amount_xof`, `beneficiaries.sent`), « Iwontunwonsi »
  (`wallet.balance`), « 3-D Secure » traduit (`wallet.card_hint`).
- **FON : intégré le 15/11/2026** en deux imports (`FON-R1`/`FON-R2`) : retour du 14/11 (réf. `PAY-FON-2026-11`,
  colonne `en` remise à la référence, 31/32 acceptées, `beneficiaries.send_confirm` vide) puis correction du 15/11
  (réf. `PAY-FON-2026-11-C1`, `beneficiaries.send_confirm`). Fichier reçu SHA-256 `4e2682ff…`, importé `83939914…`,
  correction `bd7d54f3…` (empreintes complètes dans la traçabilité). Importés tels que validés, signalés au
  porteur : « XOF » au lieu de « FCFA » (`beneficiaries.amount_xof`, `beneficiaries.sent`), début anglais
  « Top-up queued » (`wallet.topup_queued`), espace avant le point (3 textes), « 3-D Secure » traduit.

## Fichiers

| Fichier | Pour qui |
|---|---|
| `payments-critique.fon.csv` | Relecteurs Fɔ̀ngbè : remplir la colonne `fon` |
| `payments-critique.yor.csv` | Relecteurs Yorùbá : remplir la colonne `yor` |

Colonnes :
- `key`, `critical`, `fr`, `en` : **ne pas modifier** (l'import refuse un fichier dont `fr` ou `en` a changé).
- **colonne de la langue : à remplir**. Elle est volontairement vide.
- `texte_actuel_non_valide` : ce que l'application affiche aujourd'hui (vide = français affiché). Proposition à
  juger, pas une référence.
- `contexte` : qui lit le texte et à quel moment.
- `remarque` : doutes relevés lors de la préparation. Ce sont des pistes, pas un avis de locuteur natif.

## Consignes aux relecteurs

1. Pour chaque ligne : si le texte actuel est juste, le **recopier** dans la colonne de la langue ; sinon, écrire la
   bonne traduction. Une colonne vide n'est jamais traitée comme une approbation.
2. Le sens doit être **exact** sur l'argent :
   - ne pas confondre « lancé » et « payé » : `prescriptions.paid` et `wallet.topup_initiated` désignent une
     opération lancée, pas encore confirmée ;
   - ne pas confondre « envoyé » et « reçu » : `wallet.tx.TRANSFER` et `wallet.tx.TRANSFER_IN` ;
   - ne pas confondre « argent retiré » et « argent rendu » : `wallet.tx.REFUND` et `wallet.tx.REFUND_IN`.
3. Garder tels quels `{amount}`, `{name}`, `{xof}` (remplacés par l'application), ainsi que `FCFA`, `€`, `FedaPay`,
   `Visa` et, si c'est naturel, `3-D Secure`.
4. Ne pas recopier le français : une cellule identique au français est refusée à l'import.
5. Si un texte n'a pas d'équivalent naturel, laisser la cellule **vide** et écrire une remarque à part. L'écran
   affiche alors le français, ce qui ne présente aucun danger. Rien n'est inventé.

## Double validation (obligatoire)

Pour chaque langue :
- un **premier relecteur** remplit le fichier ;
- un **second relecteur**, différent, le relit et le confirme ;
- le porteur conserve le retour signé hors dépôt, sous une **référence privée** (aucune donnée personnelle dans le
  dépôt).

## Intégration (une fois les deux relectures faites)

Une partie des clés existe déjà : il faut **`--overwrite`**, sinon ces lignes sont refusées comme « déjà
traduites ».

```bash
node scripts/i18n/import-validated.mjs --locale fon --csv <retour.fon.csv> \
  --reviewer "<relecteur 1>" --date <AAAA-MM-JJ> \
  --second-reviewer "<relecteur 2>" --second-date <AAAA-MM-JJ> \
  --evidence-ref "<référence privée du retour>" --overwrite --dry-run
```

Relire le compte rendu du `--dry-run`, puis relancer sans `--dry-run`. Recommencer avec `--locale yor`. Sans second
relecteur, l'outil refuse toutes les lignes.

Après l'import :
- la traçabilité (date, relecteurs, clés, empreintes, sans contenu) est ajoutée automatiquement à
  `docs/i18n/TRACABILITE_Relectures.md` ;
- `pnpm i18n:check` : les 14 clés de paiement manquantes doivent disparaître du compte des critiques ;
- `messages.ts` fait partie de l'instantané L9 : lancer `pnpm validation:prepare`, régénérer et valider le dossier
  clinique L9, puis `pnpm validation:check`.

Format vérifié le 11/11/2026 avec `import-validated.mjs --overwrite --dry-run`, sur une copie remplie de marqueurs
de test : 32 clés critiques acceptées par langue avec double validation, les 32 refusées avec un seul relecteur.
