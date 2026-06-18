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

Un 1er jet peut être généré avec **NLLB-200** (Meta, via HuggingFace Inference) pour accélérer le travail des relecteurs. **Outil de développement uniquement** — il n'écrit JAMAIS dans `messages.ts`, mais dans un CSV de revue.

```bash
# Jeton HF (accès lecture) requis : https://huggingface.co/settings/tokens
HF_TOKEN=hf_xxx pnpm i18n:draft -- --locale=fon,yor
# essai à blanc sans réseau (vérifie le périmètre) :
pnpm i18n:draft -- --locale=fon,yor --dry
```

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
