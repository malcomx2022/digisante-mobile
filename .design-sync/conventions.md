# DigiSanté — Design System « Wax & Terre »

PWA e-santé (Bénin). Composants React **présentationnels**, stylés par **classes
utilitaires Tailwind** + classes de motifs CSS dédiées. Tout le style est dans le
`styles.css` livré — **aucun provider n'est requis pour le style**.

## Mise en place

- Importer les composants depuis le bundle (`window.WaxTerre.*`) ; le style vient
  du `styles.css` lié. Pas de `ThemeProvider`.
- **Polices** : `font-display` = Bricolage Grotesque (titres, libellés, boutons —
  toujours `font-extrabold` pour les accents) ; `font-body` = DM Sans (texte).
- **Une seule exception provider** : `ConfirmDialog` lit le contexte i18n pour son
  libellé d'annulation par défaut. Passez toujours `cancelLabel` (et `confirmLabel`),
  ou enveloppez dans `LocaleProvider` ; sinon `useLocale` lève une erreur.

## Idiome de style — classes utilitaires (vocabulaire réel)

**Thème par espace** (ne jamais mélanger les familles) :

| Espace | Famille token | Exemples |
|---|---|---|
| Patient (primaire) | `sante-*` (vert) | `bg-sante-600`, `text-sante-700`, `border-sante-500` |
| Médecin PRO / Admin | `indigo-*` | `bg-indigo-600`, `text-indigo-700` |
| Diaspora / Pharmacie / Labo | `ocre-*` (or) | `bg-ocre-400`, `text-ocre-600` |
| CTA transverse / accent | `terre-*` (terre cuite) | `bg-terre-500` |
| Urgences (SOS) | `sos-*` (rouge) | `bg-sos-500`, `text-sos-600` |

Échelles `50…950` disponibles pour `bg-/text-/border-/ring-`.

- **Fond d'app** : `bg-creme` (#FAF6F0) — **jamais** `bg-white` pur ni `gray-50`.
  Texte principal : `text-nuit`. Écrans sombres : `bg-nuit`.
- **Motifs (classes CSS dédiées, déjà dans `styles.css`)** :
  - `card-pagne` — coin coupé 18px, sur **cartes, boutons, badges, avatars**
    (signature du DS). Variante `card-pagne-inv`.
  - `stitch` / `stitch-indigo` / `stitch-sos` / `stitch-light` — couture dashed
    « fait main », **1 seule par groupe visuel**.
  - `nkyinkyim` — séparateur zigzag adinkra, **remplace tout `<hr>`**.
  - `kente-bar` — frise tissée, **ferme le bas des headers sombres**.
  - `bogolan-dark`, `wax-light`, `wax-indigo`, `wax-ocre` — fonds texturés
    (100% CSS, aucune image).

## Où est la vérité

- Le stylesheet : `_ds/<dossier>/styles.css` (tokens + motifs + utilitaires).
- Par composant : `<Name>.prompt.md` (usage, exemples) et `<Name>.d.ts` (props).

## Exemple idiomatique

```tsx
import { Button, CardPagne, Badge } from window.WaxTerre;

<CardPagne stitch="indigo" className="bg-white p-4">
  <div className="flex items-center gap-2">
    <h3 className="font-display font-extrabold text-nuit">Téléconsultation</h3>
    <Badge variant="pro">PRO</Badge>
  </div>
  <p className="font-body text-sm text-stone-500 mt-1.5">Dr. Awa Koffi — demain 10h00</p>
  <Button variant="sante" full className="mt-4">Rejoindre</Button>
</CardPagne>
```
