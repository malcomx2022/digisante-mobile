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
2. Réintégrer les traductions dans `apps/web/src/i18n/messages.ts` (dictionnaire plat —
   ajouter les clés au bloc `fon` / `yor`).
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
