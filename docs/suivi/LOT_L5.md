# Lot L5 — Téléconsultation Daily privée

> 7 octobre 2026 (Africa/Lagos). Implémentation et auto-revue Codex suivant les conventions Claude Code.
> Branche : `feat/l5-private-teleconsultation`. Base main : `0d3cb74db55f4d807bcbd4695591c61f556835b1`, après fusion de PR #184 le 7 octobre à 11:44:41 UTC.
> Commit applicatif testé : `ba6f398e0bb17fcdc4dc09fa38f2e7bf7709610f`. [PR et checks L5](https://github.com/malcomx2022/digisante-mobile/pulls?q=is%3Apr+head%3Afeat%2Fl5-private-teleconsultation).
> Statut : **LIVRÉ SUR MAIN** par [PR #185](https://github.com/malcomx2022/digisante-mobile/pull/185), fusion constatée le 7 octobre à 12:42:54 UTC, commit `2e5cc77caf04cff02399e5ddfcc4e578b7b023be`. CI finale `f37cf169` et CI main [37623001929](https://github.com/malcomx2022/digisante-mobile/actions/runs/37623001929) vertes ; aucune mise en production attestée.

## Reprise et contrat Claude Code

Salles privées relues, frappe anonyme interdite, deux identités uniques ; chat/écran/enregistrement Daily désactivés. Jetons nominatifs pour patient/médecin, sans propriétaire ni administration, valables au plus 15 min et bornés par le début en DB/fin de salle 4 h. Droits actuels des deux participants, habilitation médecin, consultation ACTIVE et RDV CONFIRMED revalidés avant et après émission. Héritage sans début/non conforme fermé. Sans fournisseur : aucune URL/token/iframe inventés, messagerie accessible.

SDK officiel 0.93.0 dynamique, load sans token puis bearer passé à join par message en mémoire, jamais dans URL/DOM/stockages/logs applicatifs, iframe no-referrer. VIDEO → AUDIO coupe réellement la caméra ; CHAT/sortie/expiration coupe caméra/micro et détruit. Mode monotone serveur/client, perte réseau dégrade localement sans file/rejeu, polling d'accès 15 s. Clôture transactionnelle puis éjection/ban et suppression best effort ; RDV annulé conservé. Réessayer après expiration demande une nouvelle admission courante.

Lire `CONTRAT_Teleconsultation_L5.md`, `GUIDE_DailyCo_Teleconsultation.md`, `REVUE_L5_2026-10.md` et `RECETTE_Daily_Teleconsultation.md` avant reprise. X10 documenté par addendum d'audit ; plan MD/DOCX, Claude, playbook, prompts, matrice pilote, checklist et PV actualisés. L6 reste l'abonnement médecin payant ; autres abonnements après pilote conformément à L0.

## Preuves locales

Pile synthétique isolée : Node 24.19.0, PostgreSQL 16 (`digisante-l5-postgres`) et Redis 7 (`digisante-l5-redis`), deux bases `digisante_l5_test` / `digisante_l5_e2e`, Redis /1 et /2. Conteneurs de recette supprimés après vérifications ; services dev préexistants conservés. pnpm 9.12.0 pour ajout du SDK/lockfile, pnpm 11.19.0 provisionné pour contrôles locaux ; dépôt/CI 9.12.0. Zéro secret/accès production/fournisseur réel.

| Contrôle | Résultat |
|---|---|
| Contrats fournisseur | 20 tests Daily simulés, dont échecs, salles historiques, échéances et éjection/ban |
| Droits API | 17 tests API/DB/Redis réels, fournisseur seul simulé ; tiers/admin, suspension/rôle/KYC, annulation/fin/expiry, course émission et modes concurrents |
| Cycle média | 9 tests helper/méthodes SDK simulées, jeton hors URL, AUDIO, CHAT/cleanup et join tardif |
| Release | **499 API +112 web verts**, aucun skip ; release:check **11 étapes en 131 s**, 28 tests outillage, lint/types/build/Prisma et scan 112 fichiers web sans secret verts |
| E2E | **18 cas verts en 1,3 min**, aucun skip ; SDK navigateur simulé réussi après fermeture de la fuite initiale |
| Mesures | 168 REST/1 WS, 28 modules, 67 pages, 49 modèles/31 enums/32 migrations ; 499 API +112 web +18 E2E recensés |
| DOCX | Généré et validé ZIP/XML/relations/A4/tableaux/concordance ; rendu Word et signatures humaines non attestés |

Reproduire : appliquer les 32 migrations existantes sur bases synthétiques distinctes, exécuter tests ciblés, `pnpm release:check`, puis tous les E2E avec build `NEXT_PUBLIC_API_URL='' E2E_API_PROXY=http://127.0.0.1:3011`. Chromium système/Pixel 5 émulé localement ; Chromium Playwright en CI. Trois nouveaux E2E : deux UI/API/DB réels sans Daily (parcours médecin/patient/CHAT/clôture et refus tiers), un contrat navigateur SDK à admission/iframe simulées (URL/DOM/stockage sans token, no-referrer, destruction). Aucun de ces tests ne prouve des médias fournisseur réels.

i18n : FR/EN 1005 clés, EN complet ; FON/YOR 866 présentes et 139 absentes chacun, repli FR explicite, six critiques SOS toujours L9. Aucune traduction native inventée. Aucun changement de schéma serveur, de paiement ou de coffre L4.

Le contrat navigateur SDK a révélé puis fermé une fuite `?t=` lors du join initial direct : load sans token, puis join sur instance chargée, nouveau contrôle fermeture/expiry. Réception par message et absence d’URL/DOM/stockage doivent rester testées lors de toute mise à jour SDK ; doubles unitaires seuls insuffisants.

## Livraison, exploitation et reste

Préparer API/client/en-têtes homogènes et fermer anciens onglets ; terminer/supprimer les salles historiques non conformes. Vérifier après Nginx en HTTPS sur Android/iOS. Repli d'incident : désactiver Daily et conserver chat, corriger en avant sans rétablir stub/owner/token URL. Panne de clôture fournisseur : avertissement métadonnées et filets jeton 15 min/salle 4 h, pas de garantie d'éjection instantanée. Un bearer copié ou ouvert hors app reste valable jusqu'à son échéance ; expiration interrompt les appels longs, réadmission explicite. Petite course après dernière relecture, orphan room possible après rollback DB jusqu'à expiration ; voir contrat.

Aucun identifiant Daily disponible dans l'environnement courant : smoke réel et D1–D18 deux appareils restent à attester en L10, qualification fournisseur/télémétrie/région/contrat comprise. L6–L11 ouverts ; GO/NO-GO L11, validations natives/clinique et revue humaine indépendante non remplacés par ces tests.
