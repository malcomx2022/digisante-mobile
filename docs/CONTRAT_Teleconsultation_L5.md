# Contrat L5 — admission et média Daily privés

> Candidate du 7 octobre 2026. Conventions Claude Code ; aucune nouvelle migration. Le guide d'implémentation expose les champs exacts. Preuves et statut : `suivi/LOT_L5.md` ; revue : `REVUE_L5_2026-10.md`.

| Frontière | Invariant | Refus / limite |
|---|---|---|
| API participant | patient/médecin du RDV, statuts ACTIVE, rôles actuels, médecin vérifié | tiers/admin/acteur suspendu ou rôle retiré refusés avant émission |
| Vie de consultation | ACTIVE, RDV CONFIRMED, début connu, moins de 4 h | état terminal, annulation et héritage sans début fermés ; clôture reste possible |
| Fournisseur | salle privée relue, frappe interdite, deux identités, média limité | salle historique non conforme ou réponse inattendue : 502, jamais d'accès supposé |
| Jeton | nominatif, une salle, aucun owner/admin, au plus 15 min et fin de salle/consultation | éjection fournisseur à expiration ; nouveau join soumis aux droits courants |
| Navigateur | load sans token puis join par message SDK en mémoire ; URL sans token, no-referrer | aucun stockage/SW/log/queue ; un bearer copié reste réutilisable jusqu'à son expiration |
| Mode | VIDEO → AUDIO → CHAT, comparaison serveur et restriction locale monotones | réseau absent : local dégradé, pas de rejeu différé ; serveur peut rester à un palier antérieur |
| Clôture | DB atomique, éjection/ban + DELETE indépendants | panne Daily : fermeture app/polling, puis filet d'expiration ; aucune révocation instantanée absolue promise |

Le jeton est un bearer fournisseur : il n'est pas une preuve d'accès DMP, un jeton lié cryptographiquement à l'appareil, ni une autorisation permanente. Un tiers sans jeton ne doit pas entrer ; un jeton copié peut être réutilisé dans sa fenêtre, sous identité du participant. Deux identités maximum et unicité d'identité réduisent les connexions parallèles, sans transformer ce bearer en mécanisme anti-vol.

Le polling ferme les clients de l'application après refus au prochain contrôle (intervalle 15 s, plus latence). Une session Daily ouverte ailleurs avec un ancien bearer n'est pas révoquée instantanément par une simple suspension en base ; l'échéance de 15 min limite sa validité. La clôture essaie en plus le ban/éjection Daily et DELETE. Ces garanties doivent être vérifiées chez Daily par la recette réelle, pas déduites d'un HTTP DELETE simulé.

Une course infinitésimale demeure entre la dernière relecture d'accès serveur et la livraison du jeton. Les appels fournisseur ont un timeout 8 s et refusent les redirects. Deux démarrages sont sérialisés par RDV ; une salle créée chez Daily juste avant un rollback DB peut rester sans consultation jusqu'à son expiration, sans jeton applicatif émis. Nettoyage opérateur si nécessaire. La réutilisation 409 exige les propriétés conformes et ne prolonge pas la salle.

Avant mise en service, terminer les consultations historiques non conformes, puis supprimer leurs salles chez Daily ; ne pas ouvrir une salle publique en attendant une migration. Déployer API, client et en-têtes cohérents, fermer les anciens onglets pour enlever l'ancien iframe nu. Rollback conseillé : désactiver Daily et garder le chat, corriger en avant ; ne pas restaurer l'ancien repli à URL/faux token ou un owner médecin.

Aucune preuve de média réel, de refus fournisseur du bearer expiré, de comportement sur appareil physique, de disponibilité réseau ou de conformité réglementaire n'est contenue dans les tests locaux. La recette L10 est obligatoire avant le GO L11.

Le contrat navigateur a détecté une fuite réelle du SDK Prebuilt lors d’un join initial direct : le SDK ajoutait `?t=`. Le correctif charge la même instance avec load sans token, puis rejoint après succès du chargement et nouveau contrôle de fermeture/expiration. Une régression dans cet ordre ou une mise à jour du SDK doit échouer au test de réception par message et d’absence d’URL/DOM/stockage.
