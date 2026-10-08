# Lot L9 — préparation des relectures natives et clinique

> 8 octobre 2026, Africa/Lagos. Branche `feat/l9-native-clinical-validation`.
> Base main `4fc62c1a3a6487a8b42fa7c77a8770b01016fa78`, PR #188 fusionnée à 06:50:09 Africa/Lagos. CI main [37734382622](https://github.com/malcomx2022/digisante-mobile/actions/runs/37734382622) réussie sur ce SHA exact, build-and-test/e2e réussis et deploy ignoré.
> Statut : **CANDIDATE TECHNIQUE VALIDÉE LOCALEMENT — L9 humain ouvert**. Retours validés annoncés par le porteur ; leurs références seront communiquées ultérieurement. Aucune pièce reçue, import ou signature attestés. Livraison et CI finale sur la PR ; aucune fusion ou mise en production automatique.

## Reprise Claude Code

Lire `CLAUDE.md`, le playbook, `CONTRAT_Validation_L9.md`, `REVUE_L9_2026-10.md` et `validation/L9/README.md`. Les règles et dictionnaires applicatifs restent ceux de main. L9 prépare la version exacte à relire : corpus complet de 1 098 clés UI et 27 phrases, sources fraîches compilées, calendrier CPN à huit contacts/objectifs, code posologie/allergies verbatim, cas synthétiques de rendu et empreintes de 27 fichiers sources/pages. Les cellules de retour et le registre de preuves sont vierges ; ne pas les remplir par supposition pour rendre un contrôle vert.

Imports : CSV strict/non ambigu, FR/EN courants, valeurs/variables/balises conformes, dates réelles non futures, relecteurs distincts pour les critiques, référence privée requise, option `--require-all` et essai à blanc. Publication source/trace avec verrou, contrôle de concurrence et rollback sur erreur ; pas de transaction multi-fichier anti-crash. MT critique interdite avant accès au modèle/écriture. Les CSV du phrasier demandent une PR dédiée, pas l’importeur UI. Aucun signataire n’est authentifié par ces contrôles de cohérence.

## Preuves locales

- Commit outillage/CI : `b9902b2c8bb0ed9a2274c6c21f8fe1aff13032c9`. Les résultats portent sur ce code ; le commit suivant est documentaire uniquement. [PR/checks L9](https://github.com/malcomx2022/digisante-mobile/pulls?q=is%3Apr+head%3Afeat%2Fl9-native-clinical-validation) : vérifier le SHA final de la PR et ses jobs, sans déduire leur réussite des résultats locaux.
- `pnpm test:scripts` : **8 fichiers réussis**, aucun skip. Exécution détaillée `node --test --test-isolation=none 'scripts/**/*.test.mjs'` : **44 cas réussis**, zéro échec/skip. Régressions CSV, remplacement littéral `$`, calendrier/identités, source modifiée/verrou concurrent, rollback avec trace existante/nouvelle, couverture invalide, MT critique interdite, instantané altéré/périmé, preuve absente/dupliquée/rejetée/périmée et inventaire DB manquant.
- `pnpm lint` et `pnpm typecheck` : réussis sur l’ensemble du workspace. Aucun code runtime dans apps/packages/e2e/infra, dépendance, lockfile, schéma ou migration modifié. Suites API/web/E2E non rejouées localement dans L9 : la CI finale exécute les suites complètes sur son SHA exact. Les 605 API +121 web et 24 E2E de la base sont établis par la CI main citée, pas par cet essai local.
- `pnpm validation:check` : les six artefacts concordent avec les sources actuelles ; snapshot SHA256 `4a8a1596f460665a8f4c877a4b4031916ccb0a5a5ba5fcf52f263e000d2cbeea`. **27 fichiers sources**, 1 098 clés UI et 27 phrases. `--check` ne réécrit pas les artefacts.
- Essai à blanc sur le CSV FON complet vierge, avec métadonnées explicitement synthétiques : **0 clé acceptée, 1 098 refusées, aucune écriture** ; aucune traduction ou trace créée. Les fixtures de gate cohérent sont synthétiques et uniquement en mémoire.
- Couverture : FR/EN **1 098/1 098**, aucune clé EN manquante/invalide/hors référence. FON/YOR **866/1 098** chacun, **232 manquantes dont 6 SOS critiques**, aucune clé présente invalide/hors référence ; phrasier natif **27 phrases sans FON/YOR**. Contenu natif présent ne signifie pas relu.
- `pnpm validation:gate` : **code 1 attendu, 15 points ouverts**. Registre vide, aucune preuve native/contreseing clinique intégré. Ce contrôle séparé ne passe pas dans la CI technique et son résultat non vert n’est pas masqué comme réussite humaine.
- Nouveau `validation/L9/Dossier_Clinique_L9.docx` : ZIP/XML/relations/A4/tableaux et concordance des textes/sources validés. Ancien dossier en circulation inchangé. Plan actif Markdown/DOCX synchronisé et validé. Contrôles structurels uniquement, aucun rendu Word ou signature attestés.
- `pnpm metrics:check` : **16 compteurs /30 mentions documentaires concordants**. Compteurs applicatifs inchangés : **182 REST +1 WS/28 modules, 67 pages, 53 modèles, 31 enums, 34 migrations**, 726 tests API+web. `git diff --check` sans anomalie.

## Conditions de clôture L9 et avant ouverture

Recevoir les références exactes/versions des retours et pièces privées, vérifier les personnes/dates et la qualité/habilitation du signataire, rapprocher chaque portée des empreintes courantes ; réserves = correction explicite dans une PR et nouvelle relecture. Intégrer les traductions relues (UI et phrasier), contrôler placeholders, urgences et compréhension/audio sur appareils. Vérifier les contenus éducatifs réellement publiés en base et leur référence d’inventaire, distincts du seed public. Conserver données/signatures personnelles hors dépôt public.

**Rendu posologie ouvert, avant ouverture réelle** : le parseur prend le premier entier (`0,5 comprimé` → 0, `500 mg` → 500 sans forme comptable), déduit des horaires et suppose des jours pour durée sans unité. Les sorties actuelles sont exposées dans le dossier, jamais approuvées. Corriger/arbitrer la portée prescriptions/posologie avec retour explicite, tester les limites puis obtenir le contreseing sur le code corrigé. Aucun nouveau protocole médical choisi par l’outillage L9.

CI verte = préparation technique vérifiée, pas L9 clôturé ni GO L11. Validation linguistique/clinique, recette cible et décision du porteur restent ouvertes. Aucun fournisseur, VPS, compte patient ou données réelles sollicités ; aucun message aux relecteurs, fusion ou déploiement. Services de développement existants inchangés. Auto-revue d’implémentation, pas revue indépendante ni validation professionnelle.
