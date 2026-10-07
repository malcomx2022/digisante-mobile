# Plan d'implémentation et de finalisation — DigiSanté Mobile

> Date : **6 octobre 2026**. Base inspectée : `main` @ `8f2f6ca24ad0543d6a08218932c783809eada9b1`, avec les quatre corrections locales de revue.
> Statut : **L0 LIVRÉ SUR MAIN**, PR #178/#179 fusionnées, CI candidate verte ; L1 LIVRÉ SUR MAIN par PR #181 (`53775be`) ; L2 LIVRÉ SUR MAIN par PR #182 (`eb1ba6e`) ; L3 LIVRÉ SUR MAIN par PR #183 (`ce1cae8`) ; L4 VALIDÉ LOCALEMENT (preuves/CI : LOT_L4 et PR du lot) ; L5–L11 PLANIFIÉS. Mise à jour : 7 octobre 2026. Voir `docs/suivi/LOT_L0.md` et `docs/REVUE_L0_2026-10.md`. Aucun déploiement attesté par ce plan.
> Référence de reprise : `CLAUDE.md` puis `docs/PLAYBOOK_Codage_DigiSante.md`.
> Version documentaire : `docs/Plan_Implementations_Restantes_2026-10.docx`, générée depuis ce fichier par `scripts/docs/generate-implementation-plan.js`.

## I. Périmètre, état de départ et règles Claude Code

### 1. Objectif et limites

Terminer les boucles fonctionnelles du périmètre retenu, puis produire les preuves permettant l'ouverture d'un pilote. Les parcours des sept rôles sont largement présents ; le nombre d'écrans ou de tests ne prouve pas la clôture de chaque workflow.

Quatre corrections sont regroupées sur la branche L0 `feat/l0-baseline-review` : contrôle du statut/rôle à chaque requête protégée, remboursement WALLET entrant atomique, réconciliation PENDING/PROCESSING, réservation RDV concurrente sous verrou médecin. Résultats locaux du 6 octobre : **390 tests API + 50 tests web**, **8 E2E**, lint/typecheck et builds verts ; 29 migrations, schéma validé et aucune dérive constatée. Migration 28→29 répétée sur données synthétiques ; revue du diff consignée. CI candidates `6edcd427` et `fd2114e` vertes (build-and-test et e2e), PR #178/#179 fusionnées ; main vérifié à `2ee3cfb`. Fournisseurs réels et déploiement à valider séparément ; consulter la CI main et la fiche L0.

Les preuves opérationnelles des documents du 22 septembre restent historiques. Leur absence dans le dépôt signifie « non prouvé », sans affirmer que l'opérateur n'a rien fait depuis. Ne pas remplacer les anciens PV signés ou datés par des déclarations actuelles.

### 2. Conventions à conserver

- Stack : Next.js 14/App Router, Fastify, Prisma, PostgreSQL 16 **natif en production**, Redis, VPS Infomaniak ; Node 24 et pnpm du `package.json`.
- Réutiliser les modules, helpers, composants et intégrations existants. Routes fines, métier dans les services, validation des entrées, erreurs normalisées, types/enums dans `@digisante/shared`.
- Une fonctionnalité = une branche ; un lot peut comporter plusieurs PR cohérentes. Conventional Commits en anglais ; commentaires français possibles ; `main` doit rester déployable.
- Schéma : migration versionnée, revue SQL et répétition sur données synthétiques avant livraison ; aucune réécriture d'une migration déjà appliquée, aucun `db push` en production.
- Confidentialité : aucune donnée médicale accessible à l'admin, à la diaspora ou à l'ASC ; médecin vérifié et consentement par entrée ; audit append-only sans contenu médical ni secret.
- Frontend : design « Wax & Terre », composants et thèmes existants, accessibilité mobile/desktop ; lire les références de la skill `digisante-design-system` avant les changements UI. Aucune chaîne UI en dur ; FR/EN complets, FON/YOR suivis et validés pour les clés critiques.
- Paiements : isoler les changements du chemin gelé, faire la revue explicite et les re-tests HMAC/idempotence/réconciliation prévus par `CLAUDE.md` §3.5. Ne pas demander de nouveau une autorisation déjà donnée pour le même périmètre ; ne pas considérer la seule rédaction du plan comme une revue du futur code.
- Tests utiles pour les transitions, la concurrence, les droits et les incidents réseau ; pas de chiffre de validation inventé. Intégrations simulées et recette fournisseur réelle sont deux preuves distinctes.
- Documents techniques Markdown pour la reprise dans le dépôt ; livrable DOCX généré avec `docx`, puis validé. Pas de conversion PDF du plan. L'export médical patient prévu par l'application reste inchangé.

### 3. Décisions à consigner au début du lot concerné

| Décision | Proposition de travail | Moment |
|---|---|---|
| Périmètre commercial du pilote | **Confirmé par le porteur en L0** : sept rôles et offre médecin au lot L6 ; autres abonnements reportés après pilote. Aucun plan payant commercialisé avant validation de L6/L7. | L0 puis L6 |
| Tarifs, période, renouvellement, droits des plans | Catalogue serveur versionné ; paiement d'une période, sans renouvellement automatique non pris en charge par le fournisseur. Aucun tarif inventé. | L6 |
| Reversements professionnels et remboursement opérateur | Circuit manuel traçable pour le pilote ; automatisation séparée si contrat/API fournisseur vérifiés. | L7 |
| Lecture médicale hors ligne sur appareil partagé | Opt-in, données minimales et clé locale déverrouillée ; pas de stockage médical persistant sans modèle de protection validé. | L4 |
| Validation des laboratoires | Dossier administratif et approbation avant prise en charge ; statuts existants repris après vérification, jamais approuvés automatiquement. | L2 |

Ces décisions bloquent uniquement leurs sous-lots dépendants. Préparer modèles, contrats et tests indépendants pendant leur clarification ; ne pas exposer une offre payante ou un accès médical en attendant une décision.

## II. Lots d'implémentation

### 4. Ordre et dépendances

| Lot | Objectif | Dépend de | Statut initial |
|---|---|---|---|
| L0 | Livrer la baseline et fixer le périmètre | — | Revue et CI validées ; livré sur main par PR #178/#179 |
| L1 | Consentements par entrée et auteurs DMP | L0 | Livré sur main par PR #181 ; preuves dans LOT_L1 |
| L2 | Habilitation laboratoire | L0 | Livré sur main par PR #182 ; preuves dans LOT_L2 |
| L3 | Rejeu des mutations sans doublon | L0 | Livré sur main par PR #183 ; preuves dans LOT_L3 |
| L4 | Stockage hors ligne protégé et disponibilité exacte | L1, L3 | Candidate sur feat/l4-protected-offline ; preuves dans LOT_L4 |
| L5 | Salles Daily privées et jetons participants | L0 | À implémenter |
| L6 | Abonnements payants de bout en bout | L0, décisions commerciales | À implémenter |
| L7 | Revenus, exports et opérations financières | L6 pour revenus d'abonnement ; L0 pour consultations | À implémenter |
| L8 | Fermer ou arbitrer les autres résiduels de sécurité | L0 ; revue finale après L1–L7 | À traiter |
| L9 | Traductions natives et validation clinique | Démarrage dès L0 ; clôture après gel des textes | Preuves externes à obtenir |
| L10 | Préproduction et fournisseurs réels | L0 pour préparer ; L1–L8 pour candidate complète | À exécuter |
| L11 | Recette finale, restauration, rollback et GO/NO-GO | L9, L10 | À exécuter |

L1/L2/L3/L5 et la préparation fournisseurs/validation humaine peuvent avancer indépendamment. Intégrer les PR en respectant leurs dépendances ; ne pas découper un lot en changements incompatibles sur `main`.

### L0 — Baseline et livraison des corrections

**Travail.** Préserver le diff existant, vérifier la révision distante au moment de la reprise, isoler les corrections dans une branche de revue et préparer les PR. Ne pas écraser les fichiers locaux. Mettre à jour la matrice CDC → fonctionnalité → preuve → lot ; acter le périmètre du pilote. Vérifier l'exécution GitHub Actions actuelle, sans reprendre le diagnostic de quota de septembre comme un fait actuel.

**Validation.** Contrôles de release sur PostgreSQL/Redis dédiés, E2E sur la candidate, CI complète et build reproductible. Préparer la livraison de `20261006130000_wallet_refund_in` avant le code utilisant REFUND_IN. Identifier les remboursements historiques potentiellement incomplets pour rapprochement manuel ; aucun recrédit automatique sans preuve.

**Documentation.** `CLAUDE.md` §1/§8/§9, README, playbook, checklist déploiement, compteurs mesurés. Consigner SHA, commandes, résultats et limites dans une fiche L0.

### L1 — Consentement DMP par entrée et traçabilité

**Fichiers de départ.** `apps/api/prisma/schema.prisma`, `apps/api/src/lib/dmp-consent.ts`, `modules/dmp/dmp.service.ts`, routes/export/documents DMP et tests de consentement.

**Travail.** Porter l'échéance sur chaque `ConsentRecord` et filtrer toutes les lectures/exportations avec cette échéance, la révocation et le médecin courant vérifié. Ajouter un auteur authentifié aux entrées ; ne jamais accepter l'auteur choisi par le client. Pour les anciennes données : attribution inconnue si non démontrable ; conservation de la preuve connue, sans inventer un auteur. Reprise des consentements conservatrice, à partir d'échéances démontrables ; demander un nouveau partage lorsqu'elles ne sont pas reconstructibles. Vérifier aussi les accès aux pièces jointes.

**Acceptation.** Deux entrées d'un même patient avec échéances différentes restent indépendantes ; réclamer la seconde ne prolonge pas la première. Révocation, re-octroi, expiration exacte, export et téléchargement respectent la même portée. Admin/ASC/diaspora restent refusés. Migration sans élargissement des accès existants.

**Documentation.** Invariants réels dans `CLAUDE.md` §4/§8 ; note de migration et matrice de droits ; addendum X1/X2 à l'audit et scénarios DMP de la recette sept rôles.

**Exécution L1 (6 octobre).** Branche `feat/l1-dmp-consent-authorship` depuis main après #180. Auteur de session, échéance indépendante, contrôle export/pièces et transitions sérialisées. Migration additive : tous les anciens liens restent NULL jusqu’à une nouvelle réclamation ; aucune inférence d’auteur. 412 tests API + 50 web, 8 E2E et 11 étapes de release verts ; reprise 29→30 validée. Fiche `docs/suivi/LOT_L1.md`, revue `docs/REVUE_L1_2026-10.md`, addendum X1/X2 ; aucune fusion/déploiement déduit des modifications locales.

### L2 — Validation des laboratoires

**Fichiers de départ.** Profils/rôles du schéma Prisma, `modules/kyc`, `modules/laboratory`, UI laboratoire et file administrative KYC.

**Travail.** Définir identité de la structure, pièces, statuts et transitions ; réutiliser les mécanismes KYC compatibles sans changer la validation médecin. Restreindre claim/traitement/saisie de résultats à un laboratoire approuvé et actif. Assurer l'appropriation atomique d'une demande et le cloisonnement après claim. Définir le devenir des commandes déjà prises en charge lors d'une suspension.

**Acceptation.** Non vérifié, rejeté ou suspendu : aucune prise en charge ni accès à l'identité/résultat. Deux claims simultanés : un seul laboratoire gagne. Un laboratoire ne lit/modifie jamais les commandes de l'autre. Les approbations administratives ne révèlent aucun contenu clinique.

**Documentation.** Workflow KYC laboratoire, droits et reprise des comptes existants ; `CLAUDE.md`, playbook, addendum X3 et recette laboratoire.

**Implémentation L2.** Branche `feat/l2-laboratory-verification` depuis main `53775be` après #181. Structure et pièces obligatoires figées à soumission, badge après vérification manuelle, accès actif/approuvé, claim/avance/publication conditionnels. Les commandes suspendues restent attribuées ; lecture patient/médecin conservée, aucun transfert automatique. Migration 30→31 sans approbation héritée. Preuves, reprise, revue et statut de livraison : `docs/suivi/LOT_L2.md`, `docs/REVUE_L2_2026-10.md`, addendum X3. Les tests ne remplacent pas la recette humaine et les autorisations réelles.

### L3 — Synchronisation serveur idempotente

**Fichiers de départ.** `apps/web/src/lib/api/client.ts`, `lib/offline/queue.ts`, services API des mutations réellement autorisées en file, plugins et schéma Prisma.

**Travail.** Inventorier ces routes. Créer la clé avant le premier envoi et conserver la même au rejeu. Stocker un reçu durable borné par utilisateur, méthode, route canonique et clé, avec empreinte du contenu. Pour les écritures DB, enregistrer le résultat et l'effet métier dans la même transaction ; un hook Redis seul ne couvre pas le crash entre les deux. Prévoir les effets externes séparément, sans promesse « exactement une fois » non garantie. Ne pas conserver de réponse médicale en clair dans les reçus. Recontrôler l'autorisation avant de restituer un résultat.

**Acceptation.** Réponse perdue après commit, requêtes concurrentes, redémarrage API et deux onglets : un seul effet métier. Même clé/contenu différent : conflit. Comptes distincts : aucune collision ni fuite. Durée de conservation des reçus cohérente avec l'âge maximal de la file ; mutation trop ancienne refusée explicitement. Un 401 interrompt le rejeu en attendant réauthentification. Aucun paiement, SOS, OTP ou consentement ne devient rejouable.

**Documentation.** Contrat `Idempotency-Key`, routes couvertes et exclusions, TTL, codes d'erreur, comportement de reprise ; nouveau piège dans `CLAUDE.md` §8 et recette coupure réseau.

**Implémentation L3.** Branche `feat/l3-idempotent-sync` depuis main `eb1ba6e` après #182. Huit routes positives partagées, clé avant fetch, effet/reçu AES-GCM dans une transaction sous verrou User, contrôles courants et HMAC du contenu. Âge 7 j, reçus 14 j, purge 03:10 ; 401 arrête la file, anciens envois ambigus conservés pour revue. Exclusions financières/auth/SOS/consentements, fermeture de grossesse à cible mouvante en ligne. Contrat/revue/preuves : `docs/CONTRAT_Synchronisation_L3.md`, `docs/REVUE_L3_2026-10.md`, `docs/suivi/LOT_L3.md`. 460 API +64 web +11 E2E verts ; release:check 11 étapes, reprise 31→32 sans altération historique. Chiffrement des corps locaux et UX de reprise restent L4.

### L4 — Hors ligne médical et protection du stockage local

**Fichiers de départ.** `public/sw.js`, `lib/offline`, `lib/api/useApi.ts`, `AuthProvider`, pages DMP/ordonnances/urgence/offline et tests existants.

**Travail.** Définir une projection minimale par patient, pas un cache général d'API. Protéger les lectures persistées ET les corps médicaux des mutations en attente/échec, actuellement stockés dans IndexedDB. Établir la gestion de clé, déverrouillage, expiration et appareils partagés avant implémentation : WebCrypto seul ne protège pas contre une session déverrouillée ou une XSS. Ne jamais copier la clé de chiffrement serveur, ni stocker JWT/refresh en localStorage. Traiter la migration des anciennes files sans perte silencieuse.

Afficher date de dernière synchronisation, périmètre disponible et données périmées. Purger au logout/changement de compte selon la politique retenue. Sans mécanisme de clé acceptable, garder la lecture médicale en ligne et corriger les promesses de l'écran offline. SOS exige toujours le réseau ; conserver une orientation locale vers les numéros d'urgence validés.

**Acceptation.** Après fermeture/rechargement hors réseau, seules les données explicitement synchronisées et déverrouillées sont visibles. Compte B ne lit aucune donnée de A ; expiration/purge et échecs IndexedDB sont gérés. CacheStorage ne contient ni réponse médicale ni token. Coupures et réauthentification ne produisent ni doublon ni perte silencieuse.

**Documentation.** Politique locale et limites de révocation sans réseau, modèle de protection, matrice « disponible hors ligne » ; `CLAUDE.md`, playbook et recette Android/iOS.

**Implémentation L4 (7 octobre).** Base main `ce1cae8` après fusion #183. Coffre opt-in à phrase locale, PBKDF2/AES-GCM et clé ouverte en mémoire ; lectures minimales explicitement synchronisées, datées, avertissement 6 h/expiration 24 h. Files scellées, lock/reload/purge atomique, isolation des comptes et migration conservatrice v3→v4. Sans coffre : premier envoi en ligne avec ticket minimal, reprise GET reçu seule ; résultat non confirmé bloque toute nouvelle mutation couverte jusqu’à revue. UI Wax & Terre et reprise manuelle, SW limité aux coquilles/chunks publics, promesses SOS corrigées. Contrat : `docs/CONTRAT_Hors_Ligne_L4.md`, revue : `docs/REVUE_L4_2026-10.md`, livraison/preuves : `docs/suivi/LOT_L4.md`. 167 REST/1 WS, 67 pages, 32 migrations ; 467 API +103 web +15 E2E et 11 contrôles release verts, aucun skip ; plan DOCX régénéré et validé structurellement. L’héritage non déverrouillé reste en clair et averti jusqu’à migration de chaque compte/effacement explicite après vérification ; aucune promesse anti-XSS ni révocation hors réseau. Recette Android/iOS et validation clinique/native non attestées.

### L5 — Téléconsultation Daily privée

**Fichiers de départ.** `apps/api/src/services/daily.ts`, `modules/consultations`, `apps/web/src/components/consult/ConsultationRoom.tsx`.

**Travail.** Utiliser effectivement le jeton participant déjà renvoyé par join, via le mécanisme Daily documenté compatible avec l'intégration existante. Créer/configurer des salles privées, limiter validité et privilèges du jeton. Vérifier patient/médecin de la consultation, états terminaux et suspension. Réduire les fuites du jeton dans URL/logs/référents. La bascule AUDIO doit aussi agir sur le média réel, pas seulement le libellé local ; conserver le repli CHAT.

**Acceptation.** URL seule et participant tiers ne donnent pas accès ; jeton expiré refusé ; consultation terminée non rejoignable. Tests contractuels simulés puis appel réel entre deux appareils, permissions caméra/micro et VIDEO → AUDIO → CHAT sur réseau faible.

**Documentation.** Invariants téléconsultation dans `CLAUDE.md`, addendum X10 et `docs/RECETTE_Daily_Teleconsultation.md`.

### L6 — Abonnements réellement payants

**Fichiers de départ.** `modules/subscriptions/subscriptions.routes.ts` et tests, `modules/payments`, modèles Doctor/Payment, shared, `/pro/stats`.

**Travail.** Déplacer le métier des routes vers un service ; catalogue/prix/devise/période autoritatifs serveur et droits appliqués côté API. Introduire le lien plan/paiement/période. Transition cible : demande → paiement en attente → confirmation → activation. FREE reste distinct. Traiter renouvellement manuel, expiration, changement de plan et annulation selon règles documentées. Auditer les plans payants déjà ACTIVE sans paiement ; ne pas fabriquer d'antécédent de paiement.

**Acceptation.** Appel direct à POST subscriptions ne peut plus activer un plan payant gratuitement ; prix client ignoré/refusé. Webhook/reconciliation répétés ou concurrents n'activent qu'une période ; échec/refus ne débloque aucun droit. Expiration appliquée même en cas de retard d'un cron. Re-tests paiements §5, wallet et remboursements existants inchangés hors décisions revues.

**Documentation.** Catalogue, machine à états, droits, reprise des données et limites du renouvellement ; `CLAUDE.md`, runbooks FedaPay, recette abonnements. Ne pas annoncer de débit récurrent si le contrat fournisseur ne le permet pas.

### L7 — Revenus, exports et opérations financières

**Fichiers de départ.** Page `/pro/stats`, paiements/consultations, finance admin, calcul de commission existant.

**Travail.** Agrégats serveur propres au médecin et à une période : consultations, montants confirmés, remboursements, commissions et net selon les règles métier. Distinguer chiffre d'affaires, créance et somme effectivement reversée ; ne pas compter recharge/transfert wallet comme revenu d'une consultation. Compléter indicateurs d'annulation/satisfaction et exports comptables minimisés. Définir format légal des justificatifs avec le porteur, sans créer une « facture conforme » sans règles validées.

Pour le pilote, journaliser la demande/exécution/preuve du reversement et du remboursement externe, avec scopes finance et contrôles anti-double exécution ; distinguer REFUNDED interne et remboursement effectivement exécuté chez l'opérateur. Toute automatisation FedaPay constitue un sous-lot séparé après vérification de l'API/contrat.

**Acceptation.** Deux médecins : statistiques et exports isolés. Paiement échoué/pending exclu, remboursement déduit une fois, bornes de période testées. Concordance agrégats ↔ transactions ; pas de DMP dans finance. Circuit manuel traçable jusqu'à sa clôture et gestion des anomalies historiques de L0.

**Documentation.** Définitions de chaque indicateur, procédure de rapprochement, reversement/remboursement et preuve requise ; `CLAUDE.md`, recette finance, documentation technique et UI.

### L8 — Résiduels de sécurité et configuration

**Travail.** Reprendre X4–X15 et les résiduels §5 de `AUDIT_Securite_Release_2026-09.md`, en tenant compte des fermetures L1/L2/L5. Corriger tri d'audit déterministe, normalisation des liens SW, configuration JWT inutilisée et absence de filtrage des journaux DMP ; revoir OTP/énumération avec les impacts UX documentés. Vérifier CSP compatible, HSTS après certificat et Twilio Geo Permissions. En sous-lot paiement revu : liste blanche des URL fournisseur, suppression des corps d'erreur bruts et comparaison du jeton de réconciliation en temps constant. Conserver le choix fail-closed Redis sauf décision motivée d'exploitation.

**Acceptation.** Une ligne par résiduel : corrigé avec preuve, réglage opérateur vérifié ou risque accepté explicitement avec propriétaire et échéance. Aucune fuite de jeton, donnée médicale ou secret dans logs/audit/bundle. Préparer le périmètre du test d'intrusion externe.

**Documentation.** Addendum daté, pas réécriture du rapport historique ; `CLAUDE.md` §8, secrets, Nginx et checklist de release.

## III. Validations externes et livraison

### L9 — Traductions et validation clinique

**Travail.** Exporter les clés actuelles, obtenir deux relectures distinctes pour les clés critiques et importer via l'outillage existant. Au départ : EN complet ; FON/YOR 76 clés manquantes chacun, dont 6 critiques SOS. Recalculer après ajout des textes des lots, sans figer ces nombres comme objectif futur. Faire traduire/revoir les contenus embarqués et le phrasier aussi : une parité de clés ne suffit pas.

Faire valider triage, PEV, CPN, phrasier, posologie/ordonnances et format professionnel selon le dossier clinique existant. Consigner version/source, signataire habilité, date et réserves. Aucune signature ou traduction native ne peut être produite à la place du tiers.

**Acceptation.** Parité FR/EN et langues annoncées ; critiques doublement validées ; contrôle strict vert après import. Dossier clinique réellement signé pour le contenu livré. Toute réserve entraîne retrait/révision du contenu concerné avant ouverture.

**Documentation.** Dossier clinique, registre de traductions, suivis B1/B2, recette SOS et actualisation des références dans `CLAUDE.md`.

### L10 — Préproduction et activation des cinq fournisseurs

**Travail.** Environnement isolé représentatif de production : PostgreSQL natif, Redis, Nginx/HTTPS, PM2, secrets et crons. Préparer tôt domaine, comptes et clés ; ne pas utiliser la base production dans les outils de développement. La CI possède déjà un job deploy gated par `vars.DEPLOY_ENABLED == 'true'` : vérifier sa configuration, ne pas traiter ce job comme commenté.

Exécuter les fiches existantes : FedaPay sandbox S1–S7, réconciliation et remboursement ; Twilio OTP/SOS sur MTN/Moov ; Daily privé ; FCM sur application fermée ; Resend avec domaine authentifié. Configuration Firebase publique/VAPID requise au build web. Les boutons readiness n'attestent pas ces parcours. Préparer bascule FedaPay live après sandbox, à partir du plan existant.

**Acceptation.** CI verte sur SHA candidat, santé/ready réels, tests fournisseurs datés avec références non sensibles, crons observés et première sauvegarde DB + fichiers. Aucune clé live dans les tests ordinaires. Distinguer préproduction réalisée, production contrôlée et ouverture aux patients.

**Documentation.** Suivis B3/B4, fiches fournisseurs, checklist de déploiement, inventaire de secrets sans valeurs, version candidate et preuves.

### L11 — Recette finale et décision d'ouverture

**Travail.** Recette sept rôles Android bas de gamme/iPhone, MTN/Moov, réseau faible ; mettre à jour les attentes de suspension (401 à la prochaine requête, pas attente de 15 min). Inclure les nouveaux lots et les suites E2E de la candidate. Obtenir le test d'intrusion externe et traiter ses résultats.

Restaurer base ET fichiers depuis les sauvegardes de l'environnement cible sur un hôte distinct avec un opérateur indépendant, dans le cadre d'accès autorisé. Répéter le rollback code/schema compatible ; une migration destructive ne se défait pas par un simple retour Git. Vérifier chaîne d'audit, données/fichiers et sondes après restauration/rollback. Effectuer les contrôles live limités prévus avant l'ouverture publique.

**Acceptation.** Chaque critère du nouveau GO/NO-GO possède une preuve datée sur la même candidate ; aucun défaut bloquant de santé, confidentialité ou argent. Sans preuve, statut non validé. Procès-verbal distinct de celui du 22 septembre, signé par les responsables ; déploiement/opening soumis au périmètre effectivement autorisé.

**Documentation.** Nouveau PV de recette, restauration, rollback, audit et GO/NO-GO ; DOCX générés/validés. Ne pas marquer les lots « livrés » sur la seule base de ce plan.

## IV. Exécution par Claude Code et suivi

### 5. Prompt commun de reprise

```text
Lis CLAUDE.md, les AGENTS.md applicables, docs/PLAN_Implementations_Restantes_2026-10.md
et le playbook. Exécute uniquement le lot <Lx> et respecte ses dépendances.
Inspecte le diff local avant toute modification ; ne supprime pas les corrections existantes.
Relis les services, tests et composants du domaine avant d'éditer. Conserve la stack,
le design Wax & Terre, le cloisonnement médical et les invariants du 6 octobre 2026.
Commence par le contrat et la migration éventuelle, puis services, API, UI et tests utiles.
Pour un sous-lot paiement, présente la revue explicite du diff et effectue les re-tests §5.
N'effectue aucune opération réelle sur les fournisseurs ou la production sans autorisation.
Exécute les contrôles pertinents et rapporte passed/failed/skipped, SHA et limites.
Mets à jour CLAUDE.md, le playbook, la fiche du lot, les runbooks impactés et les compteurs
mesurés ; régénère le DOCX du plan. Prépare une branche et des commits Conventional Commits.
Ne qualifie le lot de livré qu'avec les preuves de ses critères d'acceptation.
Si un tarif, une validation clinique ou un accès externe manque, conserve l'étape dépendante
en attente et termine les travaux indépendants autorisés. Aucun résultat ne doit être inventé.
```

**Instruction spécifique à ajouter au prompt commun :**

| Lot | Instruction Claude Code |
|---|---|
| L0 | Sécurise la baseline et prépare sa livraison sans écraser le diff ; ferme la matrice de périmètre du pilote. |
| L1 | Sépare les expirations ConsentRecord, trace l'auteur réel et applique la portée à toutes les lectures/exportations. |
| L2 | Conditionne la prise en charge et les résultats à l'habilitation laboratoire, sans exposition médicale à l'admin. |
| L3 | Protège premier envoi et rejeu par un reçu durable atomique avec l'effet métier ; teste réponse perdue et concurrence. |
| L4 | Protège lectures et files médicales locales ; valide la gestion de clé et la disponibilité après rechargement hors réseau. |
| L5 | Utilise les jetons Daily dans des salles privées et rends la dégradation du média effective. |
| L6 | Relie catalogue serveur, paiement et période d'abonnement ; ferme l'activation gratuite des plans payants. |
| L7 | Remplace l'écran revenus indisponibles par des agrégats vérifiables et documente le circuit financier jusqu'à clôture. |
| L8 | Reprends chaque résiduel d'audit ; ferme, vérifie le réglage ou documente son acceptation explicite. |
| L9 | Prépare/importe les traductions relues et le dossier clinique ; ne produis aucune validation humaine fictive. |
| L10 | Prépare la préproduction et les recettes ; exécute seulement les accès fournisseurs et déploiements autorisés. |
| L11 | Réunis les preuves de la candidate, restaure et répète le rollback autorisés, puis prépare le nouveau GO/NO-GO. |

### 6. Définition de clôture commune

- Contrat et comportements vérifiés, autorisations négatives et incidents couverts ; pas seulement un écran ou un endpoint créé.
- Migration revue et répétée si nécessaire ; reprise de données documentée et compatible avec le rollback retenu.
- Tests ciblés après chaque changement ; suite API/web, lint/typecheck et build pour la candidate intégrée. Contrôles sur pile dédiée uniquement.
- `pnpm metrics:check` et `pnpm i18n:check` ; actualiser les nombres depuis l'outil après tout ajout. `pnpm release:check --strict-i18n` à la clôture linguistique, sur une base de test préalablement migrée.
- `pnpm test:e2e` et CI complète pour la release : `release:check` ne lance pas les E2E, ne déploie pas et ne contacte aucun fournisseur.
- **Revue de chaque lot avant PR**, demandée par le porteur : rapport `docs/REVUE_Lx_<date>.md`, défauts avec gravité/fichier/preuve, corrections et contrôles réexécutés ; ne pas auto-déclarer une revue indépendante. Branche/PR et Conventional Commits ; documentation factualisée et DOCX régénéré/validé ; preuve fournisseur humaine conservée séparément des simulations.

### 7. Fiche de suivi par lot

Créer à l'exécution une fiche `docs/suivi/LOT_Lx.md` : statut (PLANIFIÉ / EN COURS / IMPLÉMENTÉ / VALIDÉ / LIVRÉ), propriétaire, décisions, branche/PR/SHA, migrations, commandes avec date et résultats, critères d'acceptation et liens de preuve, réserves, prochaine action et documents modifiés. Ne pas remplir de résultat anticipé. « Livré » précise toujours l'environnement ; un commit local n'est pas un déploiement.

Mettre à jour `CLAUDE.md` §1 (état), §4 (droits réels), §8 (invariants/pièges) et §9 (références), le playbook et ce plan après chaque lot. Les documents datés gardent leur valeur historique ; ajouter des addenda et de nouveaux PV. Actualiser README, `.env.example`, documentation technique/UI et runbooks uniquement selon les changements réels.

**Régénération documentaire reproductible :**

```text
node scripts/docs/generate-implementation-plan.js
python scripts/docs/validate-implementation-plan.py
```

Le validateur livré contrôle ZIP/XML OOXML, relations, dimensions A4, tableaux et concordance avec la source Markdown. Il ne contrôle ni le rendu visuel Word/LibreOffice ni les signatures humaines ; compléter le contrôle visuel et le validateur documentaire de l'environnement Claude Code avant une diffusion formelle.

### 8. Extensions distinctes après arbitrage produit

Interprète humain, console SOS administrative après arbitrage de confidentialité, catalogue médicamenteux complet validé, batch de campagnes à grande audience, invitation acceptée pour les liens diaspora, ASC v2 et automatisation des reversements/remboursements. Le transfert diaspora vers le wallet du bénéficiaire existe déjà ; le paiement direct de ses soins n'est pas une régression à corriger automatiquement. **Abonnements patient/pharmacie/laboratoire/diaspora reportés après pilote par décision explicite du porteur en L0** ; ce plan détaille l'offre médecin. Voir `docs/MATRICE_Perimetre_Pilote_2026-10.md` pour les autres écarts CDC sans promesse de conformité intégrale.

### 9. Sources et traçabilité

`CLAUDE.md`, playbook, CDC et documentation technique ; audit de sécurité de release septembre (X1–X15), état des lieux septembre, GO/NO-GO du 22 septembre, recette sept rôles, suivis B1–B5 et fiches fournisseurs. Constats vérifiés dans subscriptions.routes.ts, pro/stats/page.tsx, dmp-consent.ts, queue.ts/client.ts, sw.js/useApi.ts et ConsultationRoom.tsx. Nouveau constat de protection locale : `queue.ts` conserve actuellement les corps de mutation dans IndexedDB sans chiffrement explicite ; à traiter avec L4, pas à présenter comme déjà résolu.
