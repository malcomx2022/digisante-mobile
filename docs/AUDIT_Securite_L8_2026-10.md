# Addendum sécurité L8 — 7 octobre 2026

> Auto-revue de code par Codex, pas audit indépendant ni pentest. Rapport du 22 septembre conservé ; ses compteurs/preuves historiques ne décrivent pas la candidate actuelle. Base main ebd0547 après #187 ; contrat, revue et résultats : CONTRAT_Securite_L8, REVUE_L8_2026-10, suivi/LOT_L8.

## Matrice des quinze résiduels historiques

| ID | État observé / correction | Preuve ou gate restant | Responsable / échéance |
|---|---|---|---|
| X1 | Fermé côté code L1 : échéance indépendante ConsentRecord | Tests scope L1 + régressions L8 ; reprise historique sans droits inventés | Technique ; recette cible L10 |
| X2 | Fermé côté code L1 : auteur authentifié, NULL legacy conservé | Tests attribution L1/L8, preuve après suppression | Technique ; conservation L11 |
| X3 | Fermé côté code L2 : laboratoire actif/vérifié, identité figée | Tests KYC/pool/prise en charge L2/L8 | Technique ; qualification juridique L10/L11 |
| X4 | Réponses publiques génériques register/OTP, aucun profil avant possession en dev/prod ; quotas inconnus et erreurs vérification uniformes | Tests contrats production ; timings lookup/SMS réels et ergonomie restent à mesurer, sans risque accepté fictif | Exploitation/porteur et pentesteur ; L10 avant GO L11 |
| X5 | Réglage console non exécuté : Geo Permissions SMS/Voice pays attendus | Recette Twilio, preuve console et tests autorisés ; aucun accès réel obtenu | Exploitation/porteur ; L10 avant GO L11 |
| X6 | Choix fail-closed Redis conservé, aucun skipOnError/repli mémoire | Test panne OTP refuse session ; recette rate-limit PM2/CGNAT réelle L10 | Exploitation ; L10 avant GO L11 |
| X7 | Journaux API sans query ; modèle Nginx global noquery sans Referer et erreurs de requête désactivées | Syntaxe nginx -t + erreur upstream DMP/WS avec sentinel sans fuite ; installer/qualifier cible/collecteurs et ancien historique reste L10/L11 | Exploitation ; L10 avant GO L11 |
| X8 | CSP resserrée, unsafe-eval prod retiré, FCM distinct ; HSTS snippet préparé | E2E en-têtes/hydratation ; unsafe-inline Next, compatibilité SDK réel et HTTPS/HSTS cible NON clos et NON acceptés automatiquement | Technique/sécurité + exploitation/porteur ; arbitrage avant GO L11, qualification L10 |
| X9 | Checkout HTTPS sur deux hôtes exacts partagé API/client ; redirections API interdites | Tests URL host/scheme/credentials/port/backslash, faux fournisseur rejeté ; vraie URL sandbox/live à confirmer L10 | Technique + finance ; L10 avant GO L11 |
| X10 | Fermé côté code L5 : Daily privé, jeton hors URL et join même instance chargée | Tests L5 conservés ; appel réel/admission/éjection deux appareils L10 | Technique/exploitation ; L10 |
| X11 | FCM lien normalisé et origine contrôlée, antislash/contrôles refusés | Tests VM du script réel, navigation interne/externe et focus ; push réel L10 | Technique/exploitation ; L10 |
| X12 | Dernier tri createdAt/id ; nouvelle date strictement croissante sous verrou audit | 13 écritures concurrentes/horloge figée-reculée, hash recalculés ; héritage/restore à vérifier avant bascule | Technique/exploitation ; L10/L11 |
| X13 | OTP HMAC poivré avec secret infra et séparation de domaine | Ancien SHA/ancienne clé refusés, nouveau code accepté ; rotation invalide les OTP pendants | Technique/exploitation ; bascule L10 |
| X14 | JWT_REFRESH_TTL lu et validé ; JWT/cookie/Redis alignés | Test 2h + rotation, durée invalide/overflow refusé ; défaut 30d conservé | Technique ; livré avec candidate |
| X15 | Périmètre du pentest externe préparé, aucun test externe exécuté | Rapport d’un prestataire externe + suivi des corrections ; aucune certification déduite de Vitest | Porteur/sécurité ; avant ouverture L11 |

## Résiduels supplémentaires revus

- §5 septembre : corps FedaPay et exceptions réseau brutes retirés ; comparaison reconcile unifiée en temps constant, tests §5 réexécutés. L’absence de clé interdit une transaction factice en production. HMAC/CAS/commission/ledger/wallet inchangés, aucun fournisseur réel/DLQ attesté.
- L1/L2 : audits des mutations consentement DMP, soumission/décision KYC et prise en charge/résultat critique laboratoire déplacés dans la transaction de l’effet ; tests de panne et rollback. Les lectures/refus sont audités séparément ; aucune promesse de livraison externe exactly-once.
- Ne pas confondre X6 (Redis) et X12 (tri audit), contrairement à certaines mentions de reprise L6/L7 ; cet addendum établit la référence sans réécrire les anciens résultats.

## Dossier pour le test d’intrusion externe

Candidate exacte SHA/PR/CI, schéma/migrations, inventaire des 182 REST +1 WS/28 modules, sept rôles, scopes admin, contrats L1–L8 et cette matrice à remettre au prestataire. Autoriser uniquement une préproduction isolée et des comptes/données/fonds synthétiques ; définir contact incident, créneau et limites de charge avant les essais. Aucun test sur production ou fournisseur réel autorisé par ce document.

Couvrir possession téléphone/énumération par réponse et temps, SMS pumping/Geo Permissions, limites cluster/Redis, JWT/cookie/refresh/CSRF/suspension/rôle courant, KYC/consentements par entrée et concurrence, logs API/Nginx/collecteurs, stockage local/PWA partagé/XSS/CSP/FCM, Daily bearer/admission/éjection, webhook HMAC/retry/réconciliation/URL/secret, wallet/abonnement/finance sous courses, IDOR/export et journal append-only sous rôle DB non propriétaire. Vérifier header HTTPS/HSTS/certificat, restauration/rollback et absence d’accès admin/ASC/diaspora aux contenus DMP. Évaluer nonce/hashes et le risque unsafe-inline avant décision explicite du porteur.

Chaque finding : gravité, scénario reproductible sans secret réel, fichier/endpoint, responsable et date de correction ; retest du prestataire et décision GO/NO-GO. Les cases X5/X8/X15 et recettes réelles ne sont pas signées par l’assistant. Aucun risque n’est marqué accepté sans décision humaine explicite.

Consommation OTP L8 : CAS Lua Redis du hash courant avant suppression du code/compteur, une seule session par code ; un renvoi concurrent n’est jamais effacé par une ancienne vérification. CSP choisie par phase Next (développement seulement pour next dev), jamais par le seul NODE_ENV=test de la pile E2E. Tests simultané/renvoi et en-têtes du serveur de production requis.
