# Lot L11 — recette finale et décision d'ouverture

État au 14 octobre 2026 : **OUVERT, aucune recette réelle ni décision GO attestée**. Cette fiche organise la clôture ; elle n'ajoute aucune approbation. Références : plan actif, contrats L9/L10, `infra/deploy/README.md`, revue complète du 14 octobre.

## Candidate et dépendances

- Candidate : SHA complet à renseigner après fusion des corrections et qualification de la CI main. Ne pas utiliser le SHA de départ `b974080` pour les nouveaux correctifs.
- L9 : traductions natives et contreseings sur les empreintes exactes. Archive antérieure `docs/validation/archive/L9-4a8a1596-2026-10-14` conservée ; aucune validation transposable automatiquement.
- L10 : registre cible/fournisseurs à remplir après essais autorisés ; qualification CI seule ne vaut ni recette ni GO.
- Cible : VPS IONOS partagé, PG18.6 natif, Valkey ; dérogation I2 et ressources communes à arbitrer explicitement.

## Matrice de clôture

| Critère | État | Preuve attendue |
|---|---|---|
| Sept rôles sur appareils et réseaux réels | NON ATTESTÉ | PV par parcours, appareils/versions, réseau lent/coupures, anomalies et décisions |
| FR/EN/FON/YOR et textes critiques | NON ATTESTÉ | Références natives exactes et double relecture critique |
| Triage, PEV, CPN, phrasier, prescriptions/posologie, constantes, corpus éducation | NON ATTESTÉ | Pièces privées habilitées et contreseings du snapshot courant ; inventaire publié réel |
| Fournisseurs et paiements sandbox/live limités | NON ATTESTÉ | Campagne L10 complète, SHA/version/destinataires autorisés ; rapprochement des issues incertaines |
| Racine d'exploitation et isolation hôte partagé | NON ATTESTÉ | B3/B4 installés, droits/copies root, bases/index/ports distincts, ACL/canaux PubSub et capacité hôte |
| Restauration base ET fichiers | NON ATTESTÉ | Exercice indépendant sur hôte distinct, intégrité/compteurs/références/audit, clé hors hôte source |
| Rollback code/schéma compatible | NON ATTESTÉ | Répétition avec sauvegarde, maintenance et homogénéité workers ; pas de retour Git sur schéma incompatible |
| Pentest et risques résiduels | NON ATTESTÉ | Rapport, correctifs, re-tests et arbitrages explicites ; aucun blocage santé/confidentialité/argent |
| GO/NO-GO et ouverture | NON ATTESTÉ | Nouveau PV signé par responsables, pièces exactes, réserves et périmètre autorisé |

## Exécution et conservation

Préparer les commandes et données synthétiques selon les runbooks. Ne pas envoyer d'urgence réelle ou de message à un tiers sans instructions explicites. Les secrets et pièces nominatives restent hors dépôt public. Consigner la référence privée, pas le contenu personnel.

Avant installation de la nouvelle garde de déploiement, désactiver les gates et annuler les anciens jobs capturés : ils peuvent encore exécuter leur ancien workflow. La copie root B3 doit correspondre au SHA qualifié ; aucune mise en production automatique n'est déduite d'une PR.

Après chaque recette : consigner résultat, SHA complet, versions, opérateur, date Africa/Lagos, référence de preuve, anomalies et décision. Un échec conserve son statut ; aucun remplacement d'un PV historique signé. Une modification de candidate périme les preuves concernées et impose requalification.

## Points financiers à rapprocher

Un paiement fournisseur confirmé après annulation apparaît dans les anomalies ; le modèle historique ne prouve pas l'acteur d'annulation. Ne pas rembourser tous les CANCELLED automatiquement. Définir l'obligation durable future et traiter les cas historiques avec preuve. Les annulations médecin de paiements déjà confirmés doivent valider RDV et remboursement interne ensemble ; remboursements opérateur réels restent manuels et tracés.

## Reprise Claude Code

Lire `CLAUDE.md`, `docs/suivi/LOT_Revue_2026-10-14.md`, le plan actif et les contrats L9/L10. Exécuter un critère à la fois, rapporter les preuves réelles et leurs limites. La présente fiche est un plan de recette, sans signature ni autorisation d'ouverture.
