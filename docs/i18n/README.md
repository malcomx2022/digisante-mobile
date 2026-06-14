# Internationalisation (i18n) — workflow de traduction

DigiSanté Mobile est **multilingue** : **FR, EN, Fɔ̀ngbè (FON), Baatɔnum (BARIBA), Dendi (DENDI)**.

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
| FON · BARIBA · DENDI | **Partiel** — à compléter par des traducteurs (voir ci-dessous) |

> ⚠️ FON, BARIBA et DENDI sont des **langues peu dotées**. Leur traduction **n'est pas générée automatiquement** : elle doit être réalisée/relue par des **locuteurs natifs**. C'est volontaire — une traduction médicale erronée est un risque de sécurité.

## Clés CRITIQUES → double validation (CLAUDE.md §6)

Les namespaces **`sos.*`, `labo.*`, `payments.*`** touchent l'urgence, les résultats de laboratoire et les paiements. Toute traduction de ces clés exige une **double validation** (traducteur natif + relecture, idéalement rôle CSO). Elles sont marquées `CRITIQUE` dans les CSV d'export.

## Procédure pour un traducteur

1. Générer la liste à traduire : `pnpm i18n:export` → `docs/i18n/todo.<locale>.csv`.
2. Ouvrir le CSV (colonnes : `key`, `critical`, `fr`, `en`, `<locale>`). Remplir la dernière colonne (`<locale>`) avec la traduction validée. **Laisser vide** une clé non encore validée (le repli FR s'applique).
3. Reporter les paires `clé → traduction` dans le bloc de la langue concernée (`const fon: …` / `const bariba: …` / `const dendi: …`) de `apps/web/src/i18n/messages.ts`, en respectant la syntaxe : `'namespace.key': 'traduction',`.
4. Vérifier : `pnpm i18n:check` doit montrer la couverture augmentée ; `pnpm --filter @digisante/web typecheck` et `lint` doivent rester verts.

## Règles d'édition

- Ne jamais mettre de chaîne d'UI en dur dans les composants — toujours via `t('namespace.key')`.
- Conserver les **interpolations** `{name}`, `{date}`, `{xof}`, `{n}` telles quelles dans la traduction.
- Conserver les **accents et caractères spéciaux** (ɔ, ɛ, ̀, ́, …) — encodage UTF-8.
- Ne pas inventer de traduction pour une clé critique : laisser vide tant qu'elle n'est pas validée.

Les fichiers `docs/i18n/todo.*.csv` sont des **instantanés régénérables** (`pnpm i18n:export`) — il n'est pas nécessaire de les versionner à chaque changement.
