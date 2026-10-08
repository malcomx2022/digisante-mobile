# Dossier de relecture native FON / YOR — lancement du 1ᵉʳ septembre 2026

> Chantier **B1** de l'état des lieux (`docs/ETAT_DES_LIEUX_Finalisation_2026-09.md` §4.1).
> Ce document est le **brief à remettre aux relecteurs** (locuteurs natifs Fɔ̀ngbè et Yorùbá),
> accompagné des fichiers `todo.fon.csv` et `todo.yor.csv` régénérés le jour de l'envoi
> (`pnpm i18n:export` — les CSV sont des artefacts générés, non versionnés).

---

## 1. Contexte pour le relecteur

DigiSanté Mobile est une application de e-santé béninoise (téléconsultation, dossier médical,
ordonnances, alertes d'urgence SOS). Elle s'affiche en **français, anglais, Fɔ̀ngbè et Yorùbá**.
Le français est la référence ; l'anglais est complet. Il reste **74 textes** à traduire dans
votre langue — dont **6 textes d'URGENCE prioritaires** qui s'affichent sur l'écran d'alerte SOS :
aujourd'hui, une personne parlant Fɔ̀ngbè ou Yorùbá y lit du **français au moment d'une urgence**.

## 2. Les 6 textes prioritaires (écran d'urgence SOS)

| Clé | Français (référence) | Anglais (aide) |
|---|---|---|
| `sos.active_title` | Alerte en cours | Alert in progress |
| `sos.im_ok` | Je vais bien | I am fine |
| `sos.false_alarm` | Fausse alerte | False alarm |
| `sos.history` | Mes alertes passées | My past alerts |
| `sos.status.RESOLVED` | Clôturée | Closed |
| `sos.status.FALSE_ALARM` | Fausse alerte | False alarm |

`sos.false_alarm` est le **bouton** (« c'était une fausse alerte ») ; `sos.status.FALSE_ALARM`
est l'**étiquette d'état** dans l'historique — les deux peuvent avoir la même traduction si
c'est naturel dans votre langue.

## 3. Comment remplir le fichier

Le fichier CSV s'ouvre dans Excel/LibreOffice/Google Sheets. Colonnes :

- **key** : identifiant technique — **ne pas modifier**.
- **critical** : `CRITIQUE` = les 6 textes prioritaires ci-dessus.
- **fr** / **en** : le texte source et son équivalent anglais — **ne pas modifier**.
- **fon** (ou **yor**) : ✍️ **votre traduction, dans cette colonne uniquement**.

Règles :

1. Les fragments entre accolades comme `{name}`, `{amount}`, `{count}` sont remplacés par
   l'application (un nom, un montant…) : **les recopier tels quels**, à la place naturelle
   dans la phrase.
2. Traduire le **sens**, pas le mot-à-mot — public : patients, y compris peu alphabétisés ;
   privilégier des tournures courtes et orales.
3. En cas de doute sur le contexte d'un texte, **laisser la case vide** et le signaler :
   une case vide garde le repli français (sans danger) ; une traduction fausse est pire.
4. Écrire avec l'orthographe usuelle de la langue (diacritiques compris) — l'application
   affiche l'Unicode complet.

## 4. Règles côté projet (rappel — CLAUDE.md §6)

- **Aucune traduction machine** pour les clés `CRITIQUE` (`sos.*`) — relecture humaine native
  uniquement. Pour les 68 autres clés, un premier jet machine (NLLB local, `pnpm i18n:draft`)
  est permis **puis relu** ; jamais publié tel quel.
- Les namespaces `sos.*` / `labo.*` / `payments.*` exigent une **double validation** : faire
  relire les 6 clés critiques par un **second** locuteur natif indépendant.

## 5. Circuit de retour et d'intégration (côté développement)

1. Le relecteur renvoie le CSV rempli (+ nom et date, pour la traçabilité).
2. Réintégrer les traductions avec l'importeur contrôlé (jamais à la main) :
   ```bash
   node scripts/i18n/import-validated.mjs --locale fon --csv <retour.fon.csv> \
        --reviewer "<Nom>" --date AAAA-MM-JJ \
        --second-reviewer "<Nom 2>" --second-date AAAA-MM-JJ --dry-run   # contrôle, puis sans --dry-run
   ```
   Il refuse toute clé **critique** sans second relecteur distinct, toute variable `{x}` ou
   balise différente du FR, les cases vides ou identiques au FR, un CSV mal encodé (U+FFFD),
   un fichier dont la colonne `fr` a été modifiée ; il n'écrase jamais une traduction
   existante (`--overwrite`) et consigne relecteur(s)/dates/nombre de clés dans
   `docs/i18n/TRACABILITE_Relectures.md` (aucun contenu).
3. Vérifier : `pnpm i18n:check` → l'objectif de sortie du chantier B1 est
   **0 clé critique manquante** en FON et YOR (la couverture globale peut rester < 100 %,
   seules les critiques bloquent les premiers patients réels).
4. Faire relire les 6 clés critiques par le second locuteur (double validation §6),
   consigner les deux relecteurs (noms, dates) dans `docs/VALIDATION_Clinique.md`
   (section traçabilité) et livrer par PR dédiée (`pnpm test` + build).

## 6. État au lancement (mesuré le 01/09/2026)

`pnpm i18n:check` : référence FR **942 clés** (47 critiques) · EN **100 %** ·
FON **868/942 (92 %)** · YOR **868/942 (92 %)** · **74 manquantes par langue dont 6 critiques**.
Fichiers remis aux relecteurs : `todo.fon.csv` et `todo.yor.csv` (74 lignes + en-tête chacun).

## 7. État au 22/09/2026 (prompt 16) — ⛔ en attente des retours natifs

Aucun CSV validé n'a été remis : **rien n'est importé**, aucune traduction n'est inventée.
Mesure du jour : **75** clés manquantes par langue (dont **6 critiques** `sos.*`) — la 75ᵉ est
`integrations.unreadable` (console admin, non critique), ajoutée le 22/09. Importeur prêt et
testé (`scripts/i18n/import-validated.test.mjs`, 5 cas) ; essai à blanc sur l'export réel :
75 lignes refusées « case vide », 0 écriture.

## Addendum L9 — 8 octobre 2026

Les chiffres et procédures du lancement restent historiques. Référence actuelle : `docs/CONTRAT_Validation_L9.md` ; nouvel instantané versionné `docs/validation/L9/` (1 098 clés UI et 27 phrases), empreintes et colonnes de retour vierges distinctes des textes existants. 232 clés manquantes par langue, 6 SOS critiques chacun. La présence des 866 clés natives ne constitue pas une preuve de relecture.

Retours annoncés, références différées par le porteur ; rien importé ni signé fictivement. Ajouter `--evidence-ref '<référence privée vérifiée>'` à l’importeur actuel et contrôler FR/EN et relecteurs/dates ; garder signatures/données personnelles hors dépôt public. Phrasier : PR dédiée, double relecture et contreseing clinique. Le seuil historique « zéro critique » ne ferme pas le lot actuel : parité des langues annoncées + contenu embarqué et preuves sont exigés avant GO.
