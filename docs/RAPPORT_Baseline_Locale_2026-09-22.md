# Rapport — baseline locale complète (prompt 1)

> **Date** : 22 septembre 2026 · **Base** : `main` @ `4828e70` · **Nature** : mesure exécutée,
> pas une paraphrase. Aucun secret n'apparaît ci-dessous (placeholders de DEV/CI uniquement).

## 1. Environnement

| Élément | Valeur |
|---|---|
| Docker | **indisponible** (pas de démon) → services **natifs** utilisés |
| PostgreSQL | 16 natif (`/usr/lib/postgresql/16`), cluster jetable, port **5434** (aligné sur `.env.example`) |
| Redis | natif, port **6380** — base `/1` (intégration), `/2` (e2e) |
| Node / pnpm | Node 22.22 (la CI et la prod sont en **Node 24** — écart d'environnement, sans effet mesuré) / pnpm 9.12 |
| Chromium | pré-installé `/opt/pw-browsers/chromium-1194` ; `@playwright/test` attend la révision 1234 |

Bases dédiées : `digisante_test` (intégration) et `digisante_e2e` (Playwright), rôle `digisante`.

## 2. Commandes et résultats

```bash
pnpm install --frozen-lockfile            # postinstall → prisma generate
DATABASE_URL=…/digisante_test pnpm --filter @digisante/api prisma migrate deploy
pnpm i18n:check
pnpm lint
pnpm typecheck
NODE_ENV=test REDIS_URL=redis://127.0.0.1:6380/1 DATABASE_URL=…/digisante_test pnpm test
NEXT_PUBLIC_API_URL= E2E_API_PROXY=http://127.0.0.1:3011 pnpm build
DATABASE_URL=…/digisante_e2e REDIS_URL=redis://127.0.0.1:6380/2 \
  PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium-1194/chrome-linux/chrome pnpm test:e2e
```

| Contrôle | Passed | Failed | Skipped | Observations |
|---|---|---|---|---|
| `i18n:check` | ✓ | — | — | FR 942 clés (47 critiques) · EN 100 % · FON/YOR 92 % (74 manquantes dont **6 critiques** `sos.*` — B1, attendu) |
| `lint` | ✓ | 0 | — | 0 warning |
| `typecheck` | ✓ | 0 | — | API + web |
| Tests API | **325** | 0 | **0** | 64 fichiers |
| Tests web | **37** | 0 | **0** | 5 fichiers |
| `build` | ✓ | 0 | — | shared + API + web (66 pages) ; Google Fonts joignable ce jour (cf. §4) |
| e2e Playwright | **8** | 0 | 0 | 2 specs |

**Critère du prompt atteint** : 325 API, 37 web et 8 e2e exécutés, tous verts.

## 3. Analyse des skips

Aucun test n'est marqué `.skip`/`.todo`. Les **20 suites d'intégration** utilisent
`describe.skipIf(!HAS_INFRA)` : elles ne se désactivent **que** si `DATABASE_URL`/`REDIS_URL`
manquent. Ce sont des skips **d'environnement**, pas des skips intentionnels — ce qui explique les
« 184 tests non exécutés » de la revue du 22/09 (pile absente). Avec la pile démarrée :
**0 skip**. Aucun test n'a été modifié pour passer.

## 4. Défauts / limites constatés

1. **e2e — révision de navigateur** (environnement, corrigé côté outillage) : le Chromium
   pré-installé ne correspond pas à la révision attendue et le CDN Playwright n'est pas
   joignable. `playwright.config.ts` accepte désormais `PLAYWRIGHT_CHROMIUM_EXECUTABLE`
   (optionnel ; absent ⇒ comportement inchangé, la CI installe toujours son navigateur).
2. **Build web dépendant de Google Fonts** : réussi ici, mais non hermétique — traité par le
   prompt 2.
3. **Node 22 local vs Node 24 CI/prod** : les contrôles passent ; la CI (Node 24) reste la
   référence.

## 5. Ce que cette baseline ne prouve pas

Elle ne dit rien du VPS (B3), des fournisseurs réels (B4, tous en stub), de la restauration sur
machine tierce (B5), ni des validations humaines (B1/B2).
