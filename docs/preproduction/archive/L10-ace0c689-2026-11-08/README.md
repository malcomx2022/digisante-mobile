# Registre L10 conservé — candidat `ace0c689` (archivé le 8 novembre 2026)

Copie **exacte** (octet pour octet) du registre `docs/preproduction/L10/evidence.json` tel que publié sur `main` (identique de `0c623f2` à `121b767`), avant la déclaration de la candidate suivante (`main` après fusion de la PR #228, décision du porteur du 8 novembre 2026).

- Candidat : `ace0c689686204348e33c56e95cbc387d3b438b2`, CI `main` run 39687976461 ; cible `preprod.digisantemobile.app` (VPS IONOS partagé, dérogation du 13/10/2026).
- Contenu : 15 records, tous PASS, sur l'instantané L10 `d6bfcba2cd3a7afbc5e51d934b4881435e5f893e6cf33c62f2a569fddb040a6d` : FEDAPAY-S1, S2, S3, S4, S7, S8 ; I1, I3, I4, I5, I6, I7, I8, I9 ; RESEND-R6. 100 cas attendus : gate de ce candidat **clos en l'état** (non complet, 85 cas jamais rejoués).
- Empreinte SHA-256 du fichier : `d4d3aedce85ca3c550d18c855407c47770a60dcf54c2871ad834a6a591f7f8dd`.

Ces preuves restent **rattachées à `ace0c689`** : elles ne valent pas pour la candidate suivante, et le gate ne les transfère pas (le code, l'infrastructure — rôle PostgreSQL d'exécution, utilisateur ACL Valkey, zones Nginx — et l'instantané L10 ont changé). Ne pas modifier ce fichier ; toute rectification se fait par un nouveau record sur la candidate courante. Les pièces privées référencées restent hors dépôt.
