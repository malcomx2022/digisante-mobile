# design-sync — DigiSanté « Wax & Terre »

Notes spécifiques au dépôt pour les re-syncs vers claude.ai/design.

## Forme & entrée
- Shape **package**, mode **synth-entry** : pas de `dist/` de composants. L'entrée
  esbuild est un **barrel committé** : `apps/web/.ds-build/ds-barrel.ts` (re-exporte
  les primitives présentationnelles scopées + `LocaleProvider` pour `cfg.provider`).
- `--node-modules apps/web/node_modules` (react/react-dom y résolvent ; la racine
  n'a pas de react). `PKG_DIR` = `apps/web` (walk-up depuis le barrel).
- Périmètre **volontairement limité** à `src/components/ui/**` (primitives). Les
  composants « colle applicative » (headers, shells, ChatRoom, QrScanner…) sont
  exclus — couplés au routeur/contextes, sans valeur pour l'agent de design.

## CSS — compilé À LA MAIN (pas par le convertisseur)
`cfg.cssEntry` = `apps/web/.ds-build/styles.css`, **régénéré avant chaque build** :
```sh
cd apps/web
node_modules/.bin/tailwindcss -c .ds-build/tailwind.config.cjs -i .ds-build/tw-input.css -o .ds-build/_tw.css --minify
cat .ds-build/_tw.css src/app/patterns.css > .ds-build/styles.css
```
- Committés : `ds-barrel.ts`, `tailwind.config.cjs`, `tw-input.css`. Ignorés
  (régénérables) : `styles.css`, `_tw.css`, `gf.css`, `fonts/`.
- La **safelist** dans `tailwind.config.cjs` émet TOUTE la palette de tokens
  (sante/terre/indigo/ocre/sos × 50…950 + creme/nuit) pour que les designs de
  l'agent soient on-brand. Si les tokens changent dans `apps/web/tailwind.config.ts`,
  les **répercuter** dans `.ds-build/tailwind.config.cjs`.

## Polices — Google Fonts téléchargées (autoportées, offline après)
`cfg.extraFonts` = `apps/web/.ds-build/fonts/fonts.css` (woff2 locaux, gitignorés).
Sur un clone neuf, re-télécharger (réseau requis une fois) :
```sh
cd apps/web/.ds-build && mkdir -p fonts
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
curl -s -A "$UA" "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600;800&family=DM+Sans:wght@400;500;700&display=swap" -o gf.css
for u in $(grep -oE 'https://[^ )]+\.woff2' gf.css | sort -u); do curl -s -A "$UA" "$u" -o "fonts/$(basename "$u")"; done
sed -E 's#url\(https://fonts.gstatic.com/[^ )]+/([^/ )]+\.woff2)\)#url(./\1)#g' gf.css > fonts/fonts.css
```

## Playwright (render check)
- chromium **1217** en cache : `%LOCALAPPDATA%/ms-playwright` → playwright **1.59.0**.
- `cd .ds-sync && npm i esbuild ts-morph @types/react typescript playwright@1.59.0`.
- Exporter `PLAYWRIGHT_BROWSERS_PATH="$LOCALAPPDATA/ms-playwright"` avant validate/capture.

## Provider & overlays
- `cfg.provider` = `LocaleProvider` (enveloppe tous les previews ; requis pour
  `ConfirmDialog` qui lit `useLocale`). Toujours passer `cancelLabel`.
- `ConfirmDialog` est `fixed inset-0` → le preview l'enveloppe dans un conteneur
  `transform: translateZ(0)` (bloc de confinement) ; `cfg.overrides.ConfirmDialog`
  = `cardMode single`, `viewport 680x400`.

## Build complet
```sh
node .ds-sync/package-build.mjs --config .design-sync/config.json \
  --node-modules apps/web/node_modules --entry apps/web/.ds-build/ds-barrel.ts --out ./ds-bundle
PLAYWRIGHT_BROWSERS_PATH="$LOCALAPPDATA/ms-playwright" node .ds-sync/package-validate.mjs ./ds-bundle
```

## Known render warns
- `tokens: … (1 missing, below threshold)` — bénin (une `var(--token)` non définie,
  sous le seuil). Pas d'action.

## Risques de re-sync (watch-list)
- **CSS/polices régénérés hors convertisseur** : si on modifie un composant sans
  recompiler le CSS, `styles.css` est périmé → recompiler EN PREMIER, toujours.
- **woff2 gitignorés** : clone neuf = re-télécharger (réseau). Sinon polices en repli.
- **Tokens** : divergence possible entre `tailwind.config.ts` (app) et
  `.ds-build/tailwind.config.cjs` (bundle) — garder synchronisés.
- **`.d.ts` via `dtsPropsFor`** : props écrites à la main (pas de `dist`/types). Si
  l'API d'un composant change, mettre à jour `cfg.dtsPropsFor.<Name>`.
