# Polices embarquées — provenance et licence

| Fichier | Famille | Axe | Source | Licence |
|---|---|---|---|---|
| `BricolageGrotesque-latin.woff2` | Bricolage Grotesque (v9) | variable `wght` 200–800 (utilisé 400–800) | Google Fonts, sous-ensemble `latin` (`fonts.gstatic.com/s/bricolagegrotesque/v9/…`) | SIL OFL 1.1 — `OFL-BricolageGrotesque.txt` |
| `DMSans-latin.woff2` | DM Sans (v17) | variable `wght` (utilisé 400–700) | Google Fonts, sous-ensemble `latin` (`fonts.gstatic.com/s/dmsans/v17/…`) | SIL OFL 1.1 — `OFL-DMSans.txt` |

Les textes de licence proviennent du dépôt officiel `github.com/google/fonts` (`ofl/<famille>/OFL.txt`).
L'OFL autorise l'embarquement et la redistribution avec l'application ; les fichiers ne sont pas
modifiés (pas de renommage de la police, pas de « Reserved Font Name » en jeu).

SHA-256 (récupération du 22/09/2026) :

```
a97804dc9fbe5fc972a08018c5eda4dab7ef2346f64c57e61419d05e6de4ea1c  BricolageGrotesque-latin.woff2
9fea608a947e67020c33cad9a6fe3d60c54119dfb8cff87768a8117a15ed7543  DMSans-latin.woff2
```

Sous-ensemble `latin` = même couverture que l'ancienne configuration `next/font/google`.
⚠️ Les caractères Fɔ̀ngbè/Yorùbá hors `latin` (ɔ, ɛ, ẹ, ọ, ṣ…) retombent sur la police de
repli — comportement **inchangé** par rapport à avant. Ajouter le sous-ensemble `latin-ext`
serait une amélioration de rendu à arbitrer (≈ +40 Ko par famille).
