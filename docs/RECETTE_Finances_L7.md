# Recette finances L7

> 7 octobre 2026. Tests locaux et fournisseurs/humains restent des preuves distinctes. Références : contrat, revue et `suivi/LOT_L7.md`.

Résultats locaux finaux : 571 tests API +117 web, 28 tests scripts et 23 E2E verts ; release:check 11 étapes et migration sans dérive. Commit applicatif `3c0c9dfb7a68113bf5e9d4b1a881a71e9113dcf7`. La CI finale de PR doit être vérifiée séparément.

## Vérifications automatisées

API/DB/Redis : deux médecins, isolation statistiques/CSV, PRO payé courant, active/KYC/rôle et scopes courants ; dates inclusives Lagos/invalides, remboursement inter-périodes, tarif snapshot, échecs/pending exclus, héritage signalé ; audit/wallet/ledger rollback, CAS webhook et remboursements répétés/concurrents ; réservation concurrente et course remboursement/payout ; compensation/trop-perçu et allocations partielles ; clôture exige start/preuve, référence unique, interdiction d'annuler EXECUTING ; rattrapage opérateur legacy ; absence DMP, export max 10 000, neutralisation CSV ; append-only SQL. Regroupés dans `modules/payments/finance.test.ts`, régressions paiements/L6 et tests existants.

Navigateur Chromium + vraie pile : wallet synthétique paie PRO, revenu réellement généré par API de consultation, autre médecin exclu du CSV téléchargé, reçu marqué non fiscal ; admin finance prend en charge une réservation et consigne une référence de preuve **synthétique**, sans exécuter de transfert bancaire ; action offline refusée, aucune demande externe créée. `e2e/financial-workflows.spec.ts`.

## Recette manuelle / externe à signer

Cases non cochées : aucune validation humaine ou paiement fournisseur réel déduite des simulations.

- [ ] F1 — Finance valide définition des indicateurs, commission 3 % existante, traitement de compensation et références opérateur ; vérifier gross/refund/commission/net et créance de deux médecins sur un relevé fournisseur réel.
- [ ] F2 — Rapprocher les paiements legacy L0, sans fabri­quer date/commission ni relancer un retour déjà effectué ; consigner les preuves et responsables.
- [ ] F3 — Créer demande, prendre en charge une fois, exécuter un reversement réel autorisé hors application, vérifier bénéficiaire/montant/devise et clôturer avec preuve unique. Vérifier deux admins et réponse réseau ambiguë.
- [ ] F4 — Remboursement réel : REFUNDED interne puis retour opérateur, référence fournisseur/operation et preuve distinctes ; ledger ne compte pas ce retour externe comme un autre remboursement du revenu.
- [ ] F5 — Exécution externe incertaine : conserver EXECUTING et rapprocher ; aucun second transfert. Remplacement d'un opérateur suspendu via finance habilitée avec clôture tracée.
- [ ] F6 — Vérifier UI téléphone/desktop, lecture FR/EN, navigation clavier/dialogues, CSV ouvrable et appareil partagé (fichier téléchargé à supprimer volontairement). FON/YOR nouveaux libellés en repli FR, validation native L9.
- [ ] F7 — Reçu non fiscal approuvé conservé comme tel ; tout futur besoin de facture fiscale exige règles légales/numérotation validées, périmètre distinct.
- [ ] F8 — Exploitation : maintenance/migration/arrêt anciens workers, sauvegarde/restore journal et preuves, politique de conservation et droits d'effacement validés avant GO L11.

PV : scénario, comptes synthétiques/réels autorisés, horodatage Africa/Lagos, SHA testé, responsable finance, preuve expurgée et décision. Aucun secret, DMP ou coordonnées bancaires en pièce publique de PR.
