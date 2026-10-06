# Addendum sécurité — laboratoire L2 (X3)

> 6 octobre 2026 (Africa/Lagos). Complète l'audit de release de septembre ; ne réécrit pas ses constats historiques.

**X3 — habilitation laboratoire : correction implémentée et testée localement.** Le contrôle de rôle seul était insuffisant. La candidate exige un compte actif et un badge laboratoire posé par revue administrative complète, sous verrou transactionnel commun aux actes et à la suspension.

La revue exige identité de la structure figée, identité du responsable et autorisation d'exercice, avec toutes les pièces vérifiées. Une checklist déclarative ne pose aucun badge. Les anciens APPROVED ne sont pas convertis en habilitations ; la migration ferme leur accès clinique jusqu'à nouvelle revue explicite.

Les demandes sont appropriées par mise à jour conditionnelle : un seul gagnant concurrent, aucun écrasement. Les prescriptions ciblées sont réservées au laboratoire approuvé destinataire, sans nom patient avant acceptation. Les résultats exigent PROCESSING et le propriétaire ; résultat/transition/notifications DB sont atomiques. Une suspension conserve l'attribution et le contenu pour le patient/prescripteur, en refusant le laboratoire. L'approbation KYC ne lève jamais une suspension.

La file et le détail admin n'incluent aucune relation vers patients, commandes ou résultats. Les pièces restent administratives, dans le stockage chiffré existant, avec lecture authentifiée propriétaire/admin `kyc:review`. La liste des analyses refuse explicitement les rôles administratifs.

Preuves : 27 nouveaux tests API de refus, reprise, revue, isolation, concurrence et rollback ; migration 30→31 conservant huit tables historiques ; parcours navigateur de la structure jusqu'à l'approbation. Résultats complets, SHA applicatif et lien de livraison : `docs/suivi/LOT_L2.md`. Auto-revue : `docs/REVUE_L2_2026-10.md`.

**Limites de clôture :** le badge représente une revue manuelle interne et ne garantit pas à lui seul l'authenticité légale d'une pièce. Recette opérateur et autorisations réelles restent à établir en L10/L11. Les audits post-commit, leur tri et la reprise après panne restent à suivre en L8 ; aucun nouveau droit DMP pour le laboratoire ni contenu médical pour l'admin. Cet addendum ne déclare ni recette physique, ni validation clinique, ni mise en production.
