# Campagne de relecture L9-2026-10-14

Statut : PREPARED_FOR_REVIEW — dossiers vierges, aucune validation humaine attestée. Les relecteurs sont identifiés par le porteur ; leurs identités, habilitations et disponibilités restent à vérifier dans le circuit privé.

Base du code : 3e2eb7f2f72d9b5d9d4aee2a74d4b7f16ec7c620 (main après fusion de PR #203). Snapshot SHA256 : 3e061d5232d7bc11fe4dc92134a1b2e8d0dc1753b503c38ba261365b514944ed. Chaque portée a sa propre empreinte dans campaign.json et les formulaires. Les empreintes supplémentaires du moteur vocal et du panneau phrasier documentent la recette ; elles ne changent pas le contrat L9.

## Documents à remettre

Le ZIP Kit_Relecteurs_L9.zip contient ce guide, les formulaires DOCX, le dossier clinique non signé existant et les grilles CSV. Le guide documentaire à partager est Guide_Relecteurs_L9.docx. Utiliser des copies privées des formulaires et CSV pour les retours ; conserver les modèles publics vierges. Importer les CSV dans le tableur avec encodage UTF-8 et séparateur virgule pour préserver Fɔ̀ngbè, Yorùbá et les diacritiques ; vérifier les caractères avant et après réexport.

| Destinataire | Documents | Retour attendu |
|---|---|---|
| Coordinateur clinique | Dossier_Clinique_L9.docx, Avis_Clinique_L9.docx, clinical-scopes.csv, clinical-cases.csv, references.csv | Avis distinct sur chacune des sept portées ; corrections exactes et références |
| Deux locuteurs Fɔ̀ngbè distincts | Avis_Linguistique_FON_L9.docx, ui.fon.review.csv, phrasebook.fon.review.csv, glossary.fon.csv | Relecture indépendante de tout le corpus, propositions et divergences |
| Deux locuteurs Yorùbá distincts | Avis_Linguistique_YOR_L9.docx, ui.yor.review.csv, phrasebook.yor.review.csv, glossary.yor.csv | Même processus pour Yorùbá |
| Équipe de recette avec public cible | source-questions.csv, usability-sessions.csv, grilles de langue | Sens restitué, erreurs observées, oralité et affichage sur appareils |

Un même binôme peut couvrir UI et phrasier dans sa langue. Une même personne habilitée peut couvrir plusieurs portées cliniques. Les profils suggérés dans clinical-scopes.csv aident à répartir le travail ; le porteur vérifie l'habilitation et la compétence de chaque signataire.

## Étape 1 — Cadrer la séance et figer le candidat

Nommer un coordinateur, attribuer les portées et convenir des dates dans le circuit privé. Avant la séance, fixer population, nombre de participants, appareils, scénarios et critères quantitatifs ; ce kit n'invente aucun seuil d'acceptabilité clinique. Utiliser uniquement des données synthétiques. Ouvrir les sources et écrans correspondant aux clés ; contextRoute et contextDescription sont volontairement vides et doivent être renseignés après observation, sans route inventée.

## Étape 2 — Traiter les réserves prioritaires

clinical-cases.csv présente 45 cas synthétiques ou constats d'inspection. observedOutput indique EXECUTED_PURE_SOURCE pour les modules purs ou STATIC_SOURCE_INSPECTION pour les constats de code. Ces sorties décrivent le comportement actuel : aucune n'est une recommandation de dose ou une décision clinique acceptée. La recette réelle sur écran, API et voix reste à effectuer.

Les posologies peuvent perdre fractions et unités, transformer une fréquence hebdomadaire en prises quotidiennes ou inverser une négation. Un triage sans réponses retourne HOME. Le calendrier vaccinal doit être confronté au calendrier béninois consolidé actuel : MenA, déploiement du vaccin paludisme, dates, rappels et rattrapage ; HPV requiert un arbitrage de périmètre au-delà des 15 mois actuels. Examiner aussi CPN, auto-mesures, alertes d'allergie et conseils éducatifs. Les options techniques proposées dans les cas sont à discuter, jamais préapprouvées.

## Étape 3 — Clarifier les sources FR/EN

Les 13 questions SQ relèvent des ambiguïtés de sens, d'unités, d'abréviations, d'état ou d'action. Les résoudre avec le responsable produit et, si clinique, le professionnel compétent, avant traduction définitive. Ne pas choisir silencieusement entre deux intentions. Le glossaire contient des concepts sources et des pièges, avec termes natifs vierges.

## Étape 4 — Première relecture native complète

Chaque langue comprend 1098 clés UI, dont 866 textes existants et 232 manquants, ainsi que 27 phrases natives manquantes. Les textes déjà présents doivent aussi être relus. P0 regroupe les 47 clés critiques ; les six SOS absentes sont prioritaires. Les fichiers critical.*.review.csv facilitent ce premier passage, mais seul le fichier ui.*.review.csv fait foi pour l'ensemble ; reporter toute observation P0 dans celui-ci. P1 puis P2 puis P3 suivent ; toutes les clés restent nécessaires. Q0/Q1/Q2 organisent le phrasier sans retirer l'exigence de double relecture.

Remplir proposedNative et primaryNotes. Conserver strictement les variables entre accolades, nombres, unités, négations, acteur, temporalité et degré d'urgence. Employer une orthographe et des diacritiques UTF-8 vérifiés. Aucune traduction automatique native ni texte natif généré n'est fourni par ce kit. Un texte identique au FR peut être un emprunt légitime : le signal sameAsFrench appelle une revue, pas un rejet automatique.

## Étape 5 — Deuxième relecture et contreseing clinique

Le second locuteur doit être une personne distincte. Faire d'abord restituer le sens indépendamment, puis confronter le candidat à la source et au contexte. Consigner divergences et arbitrages ; une réserve reste OPEN, DISPUTED ou TO_CORRECT jusqu'à correction et nouvelle revue. Les statuts de travail possibles sont OPEN, NEEDS_CONTEXT, TO_CORRECT, READY_FOR_SECOND_REVIEW, DISPUTED, ACCEPTED_FOR_IMPORT et REJECTED. ACCEPTED_FOR_IMPORT est un état de travail ; seul un dossier vérifié sur le contenu final autorise l'intégration.

Le professionnel relit questions et résultats du triage, calendriers, posologie et phrasier clinique. Chaque portée reçoit un avis explicite : à corriger, rejeté ou validé, avec périmètre et empreinte exacts. Un avis partiel ne valide pas les sept portées. Aucun champ décision, signature, nom ou date n'est prérempli.

## Étape 6 — Tester compréhension, voix et affichage

Sur appareil, demander : « Que vous demande ce message ? », « Que se passe-t-il si vous appuyez ici ? », « Qu'est-ce qui a été fait et que reste-t-il à faire ? », « À quoi correspondent ce nombre et son unité ? », « Dans quelle langue sera envoyé ce message ? ». Recueillir une restitution spontanée avant toute explication. Consigner erreur, aide nécessaire, action réellement choisie, appareil, langue et référence de version dans usability-sessions.csv ; les identifiants de session doivent être pseudonymes, sans données patient.

Contrôler diacritiques, police agrandie, troncatures, langue de repli, choix de langue cible du phrasier, nombres, unités et mises en garde. Écouter le son réellement produit : speech.ts mappe FON et YOR vers fr-FR. Une validation écrite ne valide pas cette prononciation. Toute confusion liée à urgence, prescription, consentement ou paiement ouvre une réserve, une correction et un nouveau test. Ne pas remplacer le test oral par une reconstruction textuelle du moteur vocal.

## Étape 7 — Appliquer les corrections et renouveler la revue

Ne pas modifier les algorithmes cliniques ou leurs consignes sur la seule base de ce kit. Le contrat L9 exige un diff exact approuvé, des tests pertinents et une nouvelle revue de la version corrigée. Une option à soumettre pour la posologie est de conserver intégralement le texte du prescripteur et de retirer les déductions ambiguës ; le professionnel doit approuver le périmètre et le rendu avant mise en œuvre.

Pour l'éducation, demander l'inventaire réel des articles publiés sur la cible : identifiants, révisions, langues, titres et corps, date d'export, empreinte de l'export. Le seed ne prouve pas le corpus de production. Le contreseing education doit inclure runtimeInventoryRef. Aucun accès à cette base de production n'est attesté dans ce dossier.

## Étape 8 — Recevoir les pièces et préparer l'intégration

Les formulaires remplis, signatures, identités, références nominatives et notes sensibles restent hors dépôt public. Le porteur vérifie identité, compétence, habilitation, deux personnes natives distinctes, dates réelles, portées, empreintes et résolution de toutes les réserves. Les quatre pièces natives portent sur FON/UI, FON/phrasier, YOR/UI et YOR/phrasier ; sept avis cliniques sont nécessaires.

Les grilles review.csv utilisent proposedNative et ne sont pas directement importables. Après vérification, produire un CSV conforme aux modèles source-messages.fon.csv ou source-messages.yor.csv. La revue couvre les 1 098 clés ; l'import porte seulement sur les ajouts et remplacements effectivement approuvés. Conserver les textes existants relus et acceptés sans les réimporter. L'importeur refuse les nouvelles valeurs identiques au FR ; un emprunt existant inchangé peut être couvert par la revue sans réimport, jamais inventer une reformulation pour contourner ce contrôle.

Exécuter l'import UI avec les identités et références vérifiées, d'abord en --dry-run --require-all sur les lignes sélectionnées pour l'import. Un remplacement demande --overwrite explicite. --require-all exige zéro rejet dans ce CSV, pas une preuve de revue complète ; vérifier séparément la couverture des 1 098 clés. Le phrasier natif passe par une PR dédiée, pas par cet importeur. Après intégration, régénérer snapshot et dossier, comparer les empreintes finales et obtenir le contreseing sur le candidat final. Une signature de l'état initial incomplet ne prouve pas les traductions ajoutées ensuite.

Renseigner evidence.json uniquement à partir de pièces effectivement vérifiées, selon ../README.md et ../../../CONTRAT_Validation_L9.md. Le gate contrôle la cohérence des références, sans authentifier signature ni habilitation. Les contrôles techniques verts ne constituent ni validation humaine ni GO de lancement. Les gates L9, L10 et L11 restent distincts.

## Références publiques et limites

Les liens de references.csv ont été consultés le 2026-10-14. Les annonces nationales signalent des évolutions du PEV ; aucun calendrier national consolidé de 2026 n'a été obtenu. Demander ce document au référent PEV compétent. Les recommandations OMS sont des références professionnelles dont l'application locale, les populations et les mises à jour doivent être arbitrées ; aucune dose ni modification de sévérité n'est choisie dans ce kit.

## Vérification des modèles par l'équipe de développement

Commande : pnpm validation:campaign:check. Elle compare les sources, toutes les grilles vierges, les empreintes des artefacts et les documents OOXML. Pour une nouvelle copie des modèles de cette campagne, pnpm validation:campaign --output-dir <nouveau-dossier-vide>. La génération refuse un dossier existant pour protéger les retours et refuse un snapshot différent. Une future campagne exige un nouvel identifiant, sa base de code, ses références actualisées et un snapshot explicitement fixé dans l'outillage. Le contrôle du kit n'accorde aucune approbation et ne modifie pas evidence.json. Le ZIP contient les modèles ; sa copie remplie ne doit jamais être commitée.
