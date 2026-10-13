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

Une course infinitésimale demeure entre la dernière relecture d'accès serveur et la livraison du jeton. Les appels fournisseur ont un timeout 8 s et refusent les redirects. Démarrage : voir l'amendement du 13 octobre 2026 ci-dessous (B5), qui remplace la création de salle sous verrou et la réutilisation 409.

Avant mise en service, terminer les consultations historiques non conformes, puis supprimer leurs salles chez Daily ; ne pas ouvrir une salle publique en attendant une migration. Déployer API, client et en-têtes cohérents, fermer les anciens onglets pour enlever l'ancien iframe nu. Rollback conseillé : désactiver Daily et garder le chat, corriger en avant ; ne pas restaurer l'ancien repli à URL/faux token ou un owner médecin.

Aucune preuve de média réel, de refus fournisseur du bearer expiré, de comportement sur appareil physique, de disponibilité réseau ou de conformité réglementaire n'est contenue dans les tests locaux. La recette L10 est obligatoire avant le GO L11.

Le contrat navigateur a détecté une fuite réelle du SDK Prebuilt lors d’un join initial direct : le SDK ajoutait `?t=`. Le correctif charge la même instance avec load sans token, puis rejoint après succès du chargement et nouveau contrôle de fermeture/expiration. Une régression dans cet ordre ou une mise à jour du SDK doit échouer au test de réception par message et d’absence d’URL/DOM/stockage.

## Amendement du 13 octobre 2026 — démarrage hors verrou (bloquant B5)

Constat de la revue indépendante (`REVUE_Independante_L0-L10_2026-10.md` §4.1) : la salle `consult-<rdv>` (nom déterministe) était créée **dans** la transaction, sous `appointments FOR UPDATE` et `doctors FOR SHARE`. Un rollback la laissait orpheline, le nouvel essai dépendait d'un 409 que Daily ne documente pas (502 permanent pour ce RDV), et les réservations chez ce médecin pouvaient échouer en P2028 pendant un démarrage lent (jusqu'à 2 × 8 s de réseau).

| Étape | Invariant | Refus / limite |
|---|---|---|
| 1. Contrôle court (transaction READ COMMITTED) | verrou du RDV, participants ACTIVE aux rôles courants, médecin vérifié, téléconsultation CONFIRMED, aucune consultation, PRO courant | refus avant tout appel fournisseur ; aucun réseau dans la transaction |
| 2. Création Daily hors transaction | nom propre à **chaque** tentative `consult-<rdv>-<32 hex>` (128 bits aléatoires, 105 caractères au plus) ; jeu `[A-Za-z0-9_-]` et borne 128 contrôlés localement avant tout appel ; salle relue conforme | tout statut non 2xx = 502, jamais de reprise d'une salle existante (réutilisation 409 retirée) ; aucun verrou RDV/médecin tenu pendant le réseau |
| 3. Insertion (transaction courte) | nouveau verrou du RDV et relecture de **toutes** les conditions de l'étape 1, puis consultation + notification `CONSULTATION_START` atomiques | annulation, suspension, rôle/KYC retiré, PRO échu ou démarrage concurrent déjà inscrit (400 « Une consultation existe déjà pour ce rendez-vous » pour le perdant) : refus avec l'erreur d'origine |

Nettoyage best effort, sans masquer l'erreur d'origine : délai/coupure ou 5xx après envoi du POST et salle relue non conforme ⇒ DELETE du même nom ; 4xx de création ⇒ aucun DELETE (le nom n'appartient pas à la tentative) ; refus à l'étape 3 ⇒ DELETE de la salle de la tentative. 404 au DELETE = salle absente. En cas d'échec du DELETE, seul le nom de salle est journalisé (nettoyage opérateur) ; l'expiration 4 h avec éjection reste le filet. Sans configuration Daily : comportement inchangé (`roomUrl=null`, `provider=UNAVAILABLE`, nom NULL).

Limites : deux démarrages simultanés peuvent créer deux salles chez Daily (la perdante est supprimée) ; aucune idempotence de `POST /rooms` n'est documentée ; une salle créée après un délai dont le DELETE échoue aussi reste jusqu'à son expiration, sans jeton applicatif. Un compte Daily en **mode HIPAA** remplace/refuse les noms personnalisés : ce flux y est incompatible (un nom généré par Daily ne peut pas être nettoyé après un délai) — vérifier le mode du compte avant recette. Règle de nom, statut d'un doublon, DELETE 404 et quotas 429 (20 req/s ou 100 par 5 s, par clé et par endpoint, susceptibles d'évoluer) sont à confirmer en recette L10 : `SMOKE_DAILY=1` (cas doublon) et cas D19–D21 de `RECETTE_Daily_Teleconsultation.md`. Tests : `daily.test.ts` et `consultations.test.ts` (bloc B5), Daily simulé.
