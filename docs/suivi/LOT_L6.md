# Lot L6 — abonnement médecin réellement payé

> 7 octobre 2026 (Africa/Lagos), implémentation et auto-revue Codex selon les conventions Claude Code.
> Branche : `feat/l6-paid-doctor-subscriptions`. Base main : `2e5cc77caf04cff02399e5ddfcc4e578b7b023be`, après fusion PR #185 à 12:42:54 UTC.
> Statut : **VALIDÉ LOCALEMENT — livraison/CI à consulter sur la PR finale**. Aucune fusion automatique ni mise en production attestée.
> Commit applicatif testé : `ca90ce0e4f8ca4a0783f311718e72d2cf6d58b8f`. [PR et checks L6](https://github.com/malcomx2022/digisante-mobile/pulls?q=is%3Apr+head%3Afeat%2Fl6-paid-doctor-subscriptions).

## Décisions approuvées et reprise Claude Code

Le porteur a confirmé le 7 octobre : FREE + PRO à **5 000 XOF par mois calendaire**, renouvellement manuel, STARTER/CLINIC indisponibles ; PRO réserve nouveau démarrage téléconsultation et revenus L7, FREE conserve base et soins ouverts. Autres abonnements après pilote selon L0. Aucun prélèvement automatique.

Lire `CONTRAT_Abonnements_L6.md`, `RECETTE_Abonnements_L6.md`, `REVUE_L6_2026-10.md`, puis Claude/playbook avant reprise. Paiement/commande/période/audit transactionnels, UUID stable avant POST, prix autoritatif, droits courants sans cron, configuration fournisseur absente refusée sans stub. Abandon avant activation reste financièrement traçable sans droit ; remboursement interne atomique, retour opérateur manuel. Démarrage PRO et join/end L5 des soins ouverts conservés. Historique nominatif sans checkout ; checkout scellé, no-store et aucune file financière offline.

## Preuves locales

Node 24.19.0, pnpm local 11.19.0 (dépôt/CI 9.12.0), PostgreSQL 16 et Redis 7 éphémères dédiés `codex-digisante-l6-db` / `codex-digisante-l6-redis` ; DB distinctes `digisante_l6_test`/`digisante_l6_e2e`, Redis /1 et /2. Fonds wallet/identités synthétiques, HTTP FedaPay et checkout fournisseur simulés ; aucun accès production ni secret fournisseur réel. Conteneurs L6 supprimés après validation ; services dev préexistants `digisante_db`/`digisante_redis` conservés.

| Contrôle | Résultat |
|---|---|
| Revue §3.5 paiement | 117 tests /11 fichiers verts dont 40 cas L6 ; HMAC, ×5/concurrence, reconcile, wallet/refund/rollback/audit et consultations |
| Release final | **534 API +117 web verts**, aucun skip ; release:check **11 étapes en 94 s**, 28 tests outillage, lint/types/build/Prisma et scan 112 fichiers web sans secret verts |
| E2E final | **21 parcours verts en 56,1 s**, aucun skip ; 3 nouveaux L6 et parcours Daily adapté par achat wallet réel synthétique |
| Reprise SQL | Ancien PRO ACTIVE synthétique → PRO EXPIRED ; zéro Payment ou période inventés |
| Mesures | 171 REST/1 WS, 28 modules, 67 pages (23 patient), 50 modèles/31 enums/33 migrations, 76 API +15 web fichiers, 7 specs/21 E2E ; 534 API +117 web =651 cas |
| i18n | FR/EN 1045 clés, EN complet ; FON/YOR 866 présentes/179 absentes, repli FR, six critiques SOS L9 |
| DOCX | Généré et validé ZIP/XML/relations/A4/tableaux/concordance source ; aucun rendu Word ou signature humaine attesté |

Reproduire sur bases de test dédiées migrées : `pnpm --filter @digisante/api exec vitest run src/modules/subscriptions/subscriptions.test.ts src/modules/payments src/modules/appointments src/modules/consultations src/services/fedapay.test.ts src/modules/wallet src/lib/audit.test.ts`, puis `pnpm release:check`. Build `NEXT_PUBLIC_API_URL='' E2E_API_PROXY=http://127.0.0.1:3011`, puis `pnpm test:e2e` avec seconde base/Redis ; Chromium système Pixel 5 émulé localement, navigateur Playwright en CI. Ne jamais lancer ces tests sur une base production ou un Redis partagé : les fixtures et le Redis dédié sont purgés.

## Livraison et restant

Le lot ne comprend aucun tarif inventé, abonnement d'autre rôle, revenu pro L7 ou débit récurrent. Préparer sauvegarde/inventaire des plans/paiements hérités avant migration réelle ; informer les médecins non prouvés. Ne pas revenir à un binaire d'activation gratuite. API/client/migration cohérents et fermeture anciens onglets ; corriger en avant en incident, soin ouvert conservé. Orphan externe possible après rollback checkout, réconciliation/retry et rapprochement humain documentés.

Les cases A1–A17 humaines et les règlements FedaPay réellement effectués restent à attester, notamment L10 ; remboursement opérateur/frais/circuit financier L7/L10. Aucune DLQ applicative. Résiduels sécurité L8, validation native/clinique L9, préproduction et GO L10/L11 ouverts. Documentation Claude, plan MD/DOCX, matrice, guides/runbooks, recette/checklist/PV et métriques actualisés sans modifier les preuves historiques signées. Revue humaine indépendante et ouverture pilote non remplacées par l'auto-revue/CI.
