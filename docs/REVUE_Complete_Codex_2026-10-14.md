# Revue complète et finalisation — DigiSanté Mobile

Date : 14 octobre 2026 (Africa/Lagos). Dépôt : https://github.com/malcomx2022/digisante-mobile. Base : main b9740803ce6698574c90c67ec27414e2afb44484. Branche candidate : codex/full-review-2026-10-14.

## I. Périmètre et résultat

Revue du monorepo et des consignes CLAUDE.md, du playbook et du plan actif L0–L11 : API/droits/confidentialité, parcours web et hors ligne, paiements/finances/abonnements, KYC/pharmacie, infrastructure et contrôles de livraison. Travaux parallèles puis relecture croisée des diffs par un autre agent de cette session ; aucune revue externe ni signature humaine attestée. La revue ne constitue ni un pentest exhaustif ni une validation clinique.

L0–L8 sont déjà intégrés côté code. L9 est préparé techniquement, avec validations humaines ouvertes. L10 possède l’outillage de préproduction/provisioning IONOS et la sonde FedaPay S8 ; les preuves de cible/fournisseurs restent ouvertes. L11 demeure la recette d’ouverture. Le décompte de pages ou de tests ne ferme pas ces gates.

Cette candidate corrige les défauts reproductibles ci-dessous. Aucun compte fournisseur, VPS, paiement réel, message externe ou déploiement n’a été utilisé. Données de test synthétiques et bases dédiées ; aucune base de production utilisée.

## II. Corrections et preuves de non-régression

| Référence | Défaut concret | Comportement corrigé | Preuve |
|---|---|---|---|
| R1 | Décision KYC médecin/pharmacie réactivant un compte suspendu | Compte verrouillé et statut/rôle courants relus avant dossier/badge/audit ; réactivation administrative préalable | Régressions rôle KYC seul, suspension concurrente, état et audit inchangés |
| R2 | Même token FCM lié à plusieurs comptes sur téléphone partagé | Transfert transactionnel et sérialisé, héritage ambigu refusé au dispatch | Deux comptes, six inscriptions concurrentes, rotations croisées, suspension en attente |
| R3 | Rejet FCM tardif supprimant un nouveau token ; liaison dispatch périmée | Relecture avant envoi et purge conditionnelle sur token exact | Rotation pendant sendPush simulé, changement de liaison dans un même lot |
| R4 | Délivrance avec seuls identifiants, double délivrance et effets partiels | QR actuel/signature requis, verrou ordonnance et transaction lignes/statut/journal/notifications | Deux pharmacies, QR absent/faux, doublons, ligne terminale, panne journal/notification |
| R5 | QR DMP après navigation interne non pris en compte | Vue médecin remontée sur couple patient/token, état manuel isolé | Navigateur : collage, navigation retour, changement/suppression paramètres |
| R6 | Anciennes requêtes ou refresh déconnectant/rejouant sous le nouveau compte | Génération de session revalidée avant envoi/refresh/retour/parsing, single-flight par génération ; ancien logout ne purge pas la session suivante | Promesses différées succès/null/401/réseau, aucun replay sous B |
| R13 | Paiement d’un RDV terminal et annulation committée avant remboursement échoué | Refus préflight et sous verrou ; refundWithin réutilisé dans transaction de l’annulation | WALLET/opérateur, rollback audit/crédit, courses paiement/annulation/remboursement |
| R14 | Brouillon/messages ou motif d’orientation suivant le changement de patient | État isolé par conversation/patient, générations de réponses et navigation URL ; brouillon vidé | Navigateur A→B, réponse retardée, destinataire URL et orientation |
| R15 | Logout avec JWT A révoquant le cookie et le token FCM de B | Binding acteur/refresh avant effets ; mismatch 403 sans Set-Cookie ni révocation | Véritables sessions OTP/Redis A+B, refresh B utilisable et logout A/A idempotent |
| R7 | Ancien déploiement réinstallable, concurrence manuelle, mauvais profil DB/Valkey | Ascendance et verrou ; rollback explicite ; profil fichier et variables héritées contrôlés avant arrêt/migration | Graphes Git réels temporaires, candidate ancienne/divergente, verrou, profils croisés |
| R8 | Script de contrôle provenant d’un ancien SHA | Workflows extraient la garde au MAIN_SHA relevé, candidate applicative conserve son SHA | Contrôle câblage, trace tooling et procédure annulation anciens jobs |
| R9 | Contrôle B4 exécuté dans postgres et compensé par un UUID orphelin | Base du profil, présence ordinaire de chaque référence, SQL/schéma partiel refusés | Deux profils, référence manquante malgré compte égal, symlink et erreurs SQL |
| R10 | Échéance PRO traversant un trou entre périodes payées | Fin de couverture continue uniquement ; droits courants inchangés | Remboursement période médiane, frontières et périodes adjacentes |
| R11 | Statistiques RR répondant 500 après changement concurrent médecin | Lecture cohérente reprise trois fois maximum uniquement sur erreur de sérialisation | Concurrence déterministe, bornes retry et refus erreur métier/timeout |
| R12 | Confirmation de paiement après annulation invisible en finance | Anomalie consultation COMPLETED/RDV CANCELLED sans REFUND affichée | Annulation API puis webhook signé ; aucun remboursement automatique déduit |

Les transactions de paiement/annulation ont un budget explicite de 30 secondes pour supporter une attente légitime sur le verrou de compte tenu par l’abonnement ; aucun appel réseau fournisseur ajouté sous ces verrous. Si un RDV est annulé pendant la création fournisseur, la transaction amont peut rester impayée sans Payment local ni lien rendu : rapprochement nécessaire, sans promesse d’atomicité distribuée.

Validation API complète sur PostgreSQL/Redis dédiés : **689 tests réussis dans 91 fichiers, aucun ignoré**, dont HMAC valides/invalides, retries webhooks, idempotence, crédits et remboursements. Web complet : **142 tests réussis dans 16 fichiers, aucun ignoré**. Scripts : **152 réussis sur 158, six ignorés** pour contrôles root réel/shellcheck absent. **35 scénarios E2E validés** (32 au run complet, trois corrigés puis verts au rejeu ciblé de quatre cas), lint/typecheck/builds verts et scan de 112 fichiers du bundle sans secret serveur. Détail de la reprise dans la fiche de lot.

Les tests ont d’abord démontré les échecs sur le code antérieur, puis validé les corrections. Les changements du chemin paiement §5 font l’objet de la relecture explicite et des re-tests HMAC, idempotence, crédits, remboursements et réconciliation ; les résultats consolidés figurent dans la fiche de lot.

## III. Restant et limites avant ouverture

| Domaine | État | Preuve/action encore nécessaire |
|---|---|---|
| L9 langues | Ouvert | Retours FON/YOR réels, double validation critique ; 232 clés manquantes par langue dont six critiques, phrasier natif incomplet |
| L9 clinique | Ouvert | Contreseing exact par portée ; posologie actuelle extrait le premier entier et infère horaires/durée, correction clinique explicite à arbitrer avant usage réel |
| L10 fournisseurs | Ouvert | FedaPay S8/S9/S10 et campagne complète, Daily deux appareils D19–D21, Twilio, FCM et Resend sur destinataires autorisés |
| L10 hôte | Ouvert | Installation root B3, isolation IONOS, backup B4 réel, certificats/crons/sondes et qualification SHA CI |
| L11 | Ouvert | Sept rôles/appareils/réseaux réels, restauration DB+fichiers sur hôte indépendant, rollback compatible, pentest et nouveau PV GO/NO-GO |

Confirmation fournisseur tardive sur RDV déjà annulé : l’acteur d’annulation historique n’est pas conservé dans le modèle. Aucun remboursement automatique ni rétroactif n’est déduit de CANCELLED ; rapprochement opérateur et obligation durable restent à définir. Les captures concernées ne sont pas directement éligibles au reversement mais peuvent influer sur la balance globale ; anomalie à traiter avant ouverture.

Auth navigateur : Web Locks sérialise requête/réponse/parsing/publication/purge entre onglets de la même origine. Sans Web Locks, repli dans l’onglet uniquement ; une requête réseau bloquée peut retenir le verrou. Les essais appareils/navigateurs réels restent requis.

Limites FCM : une notification déjà remise ou en vol chez le fournisseur n’est pas révocable. Une modification de liaison immédiatement après la dernière lecture reste une course distribuée possible ; la correction ne promet pas une coupure absolue. Workers homogènes requis, écritures DB directes hors garantie applicative d’unicité.

Limites exploitation : les anciens workflows déjà capturés peuvent encore exécuter l’ancien script. Désactiver les gates et annuler ces jobs avant installation de la garde, conformément au README. Le contrôle B4 vérifie référence/type, pas intégrité GCM ni restauration. PubSub Redis chat:events est commun aux index /5 et /6 : événements avec identifiants uniquement, contenu refetché dans la DB locale ; isolation ACL/canaux de l’hôte partagé à traiter en L11. Notes Consultation.notes toujours en clair au repos, sans UI d’écriture actuelle : chiffrement/reprise à qualifier.

Résiduels web P2 confirmés à traiter : une panne de chargement des consentements est présentée comme liste vide ; un partage lancé avant chargement du profil peut produire un lien sans patientId ; le tableau de bord trie seulement les cinq RDV retournés par ordre serveur descendant et peut annoncer un mauvais prochain RDV en présence de six rendez-vous futurs. Ces constats sont en lecture seule, sans recette navigateur dédiée dans cette candidate.

Autres résiduels documentés de la revue précédente : flux de réassignation labo suspendu, audits document DMP après commit, horloge appareil/synchronisation, secret d’enveloppe des reçus et ordre d’annulation/téléconsultation. Ils ne sont pas déclarés résolus par cette candidate. Certaines protections demandent une recette fournisseurs ou une évolution de contrat/migration ; voir revue indépendante §4.2/§8.

## IV. Reprise Claude Code et livraison

Lire CLAUDE.md, docs/suivi/LOT_Revue_2026-10-14.md et docs/suivi/LOT_L11.md, puis inspecter le diff avant toute édition. Conserver les correctifs, la stack et les exclusions de rejeu financier. Reprendre un lot à la fois avec critères/test/preuves, sans fusion ni ouverture automatique.

Instantané L9 antérieur 4a8a1596… conservé avec dossier non signé et manifestes dans docs/validation/archive/L9-4a8a1596-2026-10-14. Les retours annoncés doivent rester liés à leur version. La candidate courante reçoit un nouveau dossier non signé après correction technique de messagerie ; aucune traduction, identité ou signature fabriquée. Rendu Word et signatures humaines à vérifier séparément.

Après fusion : qualifier le nouveau SHA main et sa CI, régénérer les preuves L10, installer les copies root de la même version, réaliser les recettes et consigner preuves privées autorisées. Aucun test simulé ne remplace un paiement fournisseur, un appel réel ou un PV signé.
