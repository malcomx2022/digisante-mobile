# Internationalisation (i18n) — workflow de traduction

DigiSanté Mobile est **multilingue** : **FR, EN, Fɔ̀ngbè (FON), Yorùbá (YOR)**
(périmètre recentré en juin 2026 — Baatɔnum et Dendi retirés).

- **Source de vérité** : le **français (FR)**.
- **Repli automatique** : `langue choisie → FR → clé brute`. Une clé absente d'une locale retombe donc proprement sur le FR (aucun écran cassé).
- **Fichier unique** : `apps/web/src/i18n/messages.ts` (un bloc plat `namespace.key` par langue).

## État de couverture

```bash
pnpm i18n:check      # rapport (clés traduites / manquantes / critiques) par locale
pnpm i18n:export     # idem + écrit docs/i18n/todo.<locale>.csv (clés à traduire)
```

| Locale | État |
|---|---|
| FR | **Complet** (source) |
| EN | **Complet** |
| FON · YOR | **Partiel** — 1er jet machine puis relecture native (voir ci-dessous) |

> ⚠️ FON et YOR sont des **langues peu dotées**. La traduction machine n'est qu'un **brouillon** : elle **doit être relue/validée par des locuteurs natifs** avant intégration. Une traduction médicale erronée est un risque de sécurité.

## Brouillons assistés par machine (NLLB-200) — `pnpm i18n:draft`

Un 1er jet peut être généré avec **NLLB-200** (Meta) pour accélérer le travail des relecteurs natifs. **Outil de développement uniquement** — il n'écrit JAMAIS dans `messages.ts`, mais dans un CSV de revue.

> ⚠️ NLLB n'est **plus servi par l'API serverless HuggingFace** : la traduction s'exécute **en local** (CPU). Pré-requis (hors dépendances du repo) :
> ```bash
> pip install transformers torch sentencepiece
> ```
> Le modèle (~2,4 Go) se télécharge au 1er lancement depuis huggingface.co (accès public, aucun token requis).

```bash
pnpm i18n:draft -- --locale=fon,yor       # génère docs/i18n/draft.fon.csv + draft.yor.csv
pnpm i18n:draft -- --locale=fon --limit=20  # test sur 20 clés
pnpm i18n:draft -- --locale=fon,yor --dry   # essai à blanc (sans charger le modèle)
```

- Architecture : le script Node (`translate-draft.mjs`) parse `messages.ts`, exclut les clés critiques, protège les variables et écrit le CSV ; il délègue l'inférence au service Python local `nllb_translate.py` (modèle chargé une fois par langue).
- Sortie : `docs/i18n/draft.<locale>.csv` (colonnes `key, critical, fr, en, draft, flags`).
- Les **clés critiques** `sos.*` / `labo.*` / `payments.*` ne sont **jamais** machine-traduites (drapeau `HUMAIN_OBLIGATOIRE`) — cf. §6.
- Les variables `{name}`, `{date}`… sont protégées ; un drapeau `PLACEHOLDER_A_VERIFIER` signale les cas à corriger.
- Licence NLLB-200 = **CC-BY-NC** (usage projet santé non lucratif).

## Clés CRITIQUES → double validation (CLAUDE.md §6)

Les namespaces **`sos.*`, `labo.*`, `payments.*`** touchent l'urgence, les résultats de laboratoire et les paiements. Toute traduction de ces clés exige une **double validation** (traducteur natif + relecture, idéalement rôle CSO). Elles sont marquées `CRITIQUE` dans les CSV.

## Procédure pour un traducteur / relecteur

1. (Option) Générer un 1er jet : `HF_TOKEN=… pnpm i18n:draft -- --locale=fon` → `docs/i18n/draft.fon.csv`.
   Sinon, liste vierge à remplir : `pnpm i18n:export` → `docs/i18n/todo.<locale>.csv`.
2. Ouvrir le CSV. **Relire/corriger** la colonne `draft` (ou remplir `<locale>`), en validant chaque chaîne. **Laisser vide** une clé non encore validée (le repli FR s'applique).
3. Reporter les paires `clé → traduction` dans le bloc de la langue (`const fon: …` / `const yor: …`) de `apps/web/src/i18n/messages.ts`, syntaxe : `'namespace.key': 'traduction',`.
4. Vérifier : `pnpm i18n:check` (couverture en hausse) ; `pnpm --filter @digisante/web typecheck` et `lint` verts.

## Règles d'édition

- Ne jamais mettre de chaîne d'UI en dur dans les composants — toujours via `t('namespace.key')`.
- Conserver les **interpolations** `{name}`, `{date}`, `{xof}`, `{n}` telles quelles dans la traduction.
- Conserver les **accents et caractères spéciaux** (ɔ, ɛ, ̀, ́, …) — encodage UTF-8.
- Ne pas inventer ni publier de MT pour une clé critique : laisser vide tant qu'elle n'est pas double-validée.

Les fichiers `docs/i18n/todo.*.csv` et `draft.*.csv` sont des **instantanés régénérables** (non versionnés).

## Reprise L9 — 8 octobre 2026

Référence actuelle : `docs/CONTRAT_Validation_L9.md` et `docs/validation/L9/README.md`. Retours annoncés par le porteur, références à communiquer ultérieurement : aucune traduction importée, aucune relecture/signature vérifiée. 1 098 clés FR/EN, 232 manquantes FON/YOR dont 6 critiques chacun ; 27 phrases FR/EN sans langue native.

Les étapes manuelles historiques ci-dessus sont remplacées pour les clés UI par l’importeur contrôlé : référence privée obligatoire `--evidence-ref`, FR **et EN** actuels, double relecture distincte/date réelle non future pour les critiques, `--dry-run` d’abord. `--require-all` ferme tout import avec rejet, `--overwrite` seulement pour remplacement explicitement relu. Source/trace préparées avec rollback sur erreur ; pas de garantie de commit multi-fichier lors d’un crash, inspecter le diff/verrou avant reprise. L’import trace les clés et les empreintes CSV/source avant/après.

`--include-critical` de l’outil de brouillon est désormais **refusé**, même avec `--dry` ; les préfixes critiques partagent une définition unique. Le phrasier suit une PR dédiée après retours natifs et contreseing clinique ; son CSV ne s’importe pas dans le dictionnaire UI. L’objectif actuel L9 couvre toutes les langues annoncées et le contenu embarqué, pas seulement les six SOS. Les nouveaux instantanés unsigned sont versionnés ; les todo/draft historiques restent régénérables et ignorés.
