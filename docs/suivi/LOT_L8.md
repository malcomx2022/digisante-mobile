# Lot L8 — sécurité et configuration

> 7 octobre 2026, Africa/Lagos. Branche `feat/l8-security-residuals`.
> Base main : `ebd0547240e1fcd80b6c5a528bf9c5d6c74d05f5`, PR #187 fusionnée à 18:07:19 Africa/Lagos. CI main [37656606253](https://github.com/malcomx2022/digisante-mobile/actions/runs/37656606253) réussie sur ce SHA exact ; build-and-test/e2e réussis et deploy ignoré.
> Statut : **CANDIDATE TECHNIQUE VALIDÉE LOCALEMENT — gates externes ouverts**. Livraison et CI finale à consulter sur la PR. Aucune fusion ou mise en production automatique.

## Reprise Claude Code

Lire `CLAUDE.md`, le playbook, `CONTRAT_Securite_L8.md`, la matrice `AUDIT_Securite_L8_2026-10.md` et `REVUE_L8_2026-10.md`. X6 désigne Redis fail-closed, X12 le tri/chaînage audit. L1/L2/L5 restent les références des droits ; L6/L7 restent les références financières. Périmètre pilote et documents CSV/reçu non fiscal approuvés conservés.

OTP HMAC, CAS de consommation unique et réponse publique générique ; durée refresh alignée JWT/Redis/cookie. Audit ordonné par horloge logique sous verrou ; effets/audits consentement, KYC et laboratoire dans la même transaction. Logs API/Nginx/fournisseurs minimisés, garde FCM normalisée, CSP build/start stricte et exception FCM locale. HSTS seulement préparé, activation après qualification TLS. Sous-lot paiement §3.5 relu : URL HTTPS sur deux hôtes exacts, redirects refusés, comparaison service-token constante. Commission, signatures, mapping de statut et effets financiers inchangés. Aucune migration ni dépendance ajoutée.

## Preuves locales finales

- Commit applicatif : `2f5af0a8d1cf32d01229058c07b666d932e44b5b`. Les résultats ci-dessous portent sur ce code ; le commit suivant est documentaire uniquement. [PR/checks L8](https://github.com/malcomx2022/digisante-mobile/pulls?q=is%3Apr+head%3Afeat%2Fl8-security-residuals) : vérifier la CI sur le SHA final de la PR, jamais la déduire de l’exécution locale.
- `pnpm release:check` : **11 étapes en 99 s**, **605 tests API/80 fichiers +121 web/16 fichiers**, aucun skip ; **28 tests outillage**. Lint/types, schéma, 34 migrations appliquées sans dérive, builds et scan de **112 fichiers web** sans secret serveur verts. Inclut régressions paiements/webhooks HMAC, idempotence/concurrence, wallet/remboursements/réconciliation et abonnements L6/L7.
- `pnpm test:e2e` : **24 passed/9 fichiers**, aucun skip. Parcours existants et nouveau contrôle CSP de production/FCM/hydratation. Test corrigé pour comparer les sources exactes `https:`/`wss:`/`*`, sans confondre un hôte HTTPS autorisé avec une source générale. Aucun code d’exécution modifié après release ; correction du test E2E seule, puis suite complète rejouée.
- Audit synthétique complet après la suite API : `scripts/audit/verify-chain.mjs`, **2 043 entrées, 0 brokenLinks, 0 badHashes**. Cas dédié : 13 écritures concurrentes avec horloge figée puis reculée ; tests de panne de journal vérifient le rollback DMP, KYC médecin/laboratoire et résultat critique avec notification.
- `nginx -t` sur nginx stable/alpine : valide. Proxy isolé avec upstream volontairement absent, DMP et WS en erreur 502, query et Referer contenant une sentinel synthétique : aucune sentinel dans logs accès/erreur/conteneur. Modèle `error_log /dev/null` documenté ; diagnostic accès/status/API structuré. Aucun test HTTPS réel ni déploiement du modèle effectué.
- `pnpm metrics:check` : compteurs/documentation concordants. **182 REST +1 WS/28 modules, 67 pages, 53 modèles, 31 enums, 34 migrations** ; **726 tests API+web**. FR/EN 1 098 clés, aucune manquante EN ; FON/YOR 866/1 098, 232 manquantes dont 6 critiques chacun, inchangées pour L9.
- DOCX régénéré depuis le plan Markdown, validation ZIP/XML/relations/A4/tableaux/source réussie. Validation structurelle, pas de rendu Word ni signature humaine. `git diff --check` sans anomalie.

## Limites et conditions avant ouverture

La matrice attribue responsables et échéances : timings OTP réels et ergonomie, Twilio Geo Permissions, HTTPS/HSTS cible, compatibilité Daily/FCM/FedaPay réelle et pentest externe avec arbitrage de `unsafe-inline` Next restent **non prouvés et non acceptés**. Recette L10, fermeture/arbitrage avant GO L11. La préparation technique n’atteste ni homologation ni sécurité complète du pilote. Langues natives/clinique L9 et finance fournisseur/preuve bancaire L7 restent leurs dossiers propres.

Avant bascule : arrêter tous les anciens writers, vérifier la chaîne héritée sur copie/restauration ; incohérence = NO-GO, aucun backfill ou réécriture append-only. La date audit est logique, pas une horodatation fournisseur. Rotation JWT/HMAC invalide les OTP en attente. Redis reste fail-closed. Le diagnostic Nginx détaillé est réservé à une pile distincte avec données synthétiques.

Environnement : Node 24.19.0, pnpm local 11.19.0 (repo/CI 9.12.0), PostgreSQL16/Redis7 dédiés à L8 avec deux bases test/E2E ; aucun service de développement existant purgé. Fournisseurs simulés dans les tests, aucune donnée patient réelle ni credential fournisseur utilisée. Auto-revue d’implémentation, aucune revue indépendante/pentest prétendu ; journaux intermédiaires hors dépôt.


## Livraison constatée à la reprise L9

PR #188 fusionnée le 8 octobre à 06:50:09 Africa/Lagos sur main `4fc62c1a3a6487a8b42fa7c77a8770b01016fa78`. SHA final L8 `5a0e2612df0a02016d1940e77b94c3b584720f1a`, CI 37665034166 tentative 2 réussie après blocage APT du premier runner avant tout E2E ; 605 API +121 web et 24 E2E réussis, deploy ignoré. CI après fusion 37734382622 réussie sur main exact. Code L8 livré, validations externes sécurité toujours ouvertes ; aucun déploiement attesté.
