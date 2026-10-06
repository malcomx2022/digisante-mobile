# Lot L2 — Habilitation des laboratoires

> Date : 6 octobre 2026 (Africa/Lagos). Implémentation et revue : Codex, à la demande du porteur, selon les conventions Claude Code.
> Branche : `feat/l2-laboratory-verification`. Base main : `53775be962c10192964ea113caa3a551cf74b411`, après fusion de [PR #181](https://github.com/malcomx2022/digisante-mobile/pull/181) le 6 octobre à 15:32:54 UTC.
> Statut : **VALIDÉ LOCALEMENT — livraison/CI à consulter sur la PR du lot**. Aucun déploiement ni fusion automatique.
> Commit applicatif : `33cea97cd8cdcd188cda9385e7c9587237f60013`. [PR et checks du lot L2](https://github.com/malcomx2022/digisante-mobile/pulls?q=is%3Apr+head%3Afeat%2Fl2-laboratory-verification).

## Workflow administratif

La structure renseigne nom, adresse, téléphone béninois (+229 suivi de dix chiffres) et numéro d'autorisation d'exercice. Les pièces obligatoires réutilisent les types existants : `NATIONAL_ID` pour le responsable et `PRACTICE_LICENSE` pour la structure. Upload image/PDF ≤5 Mo, contrôle du format réel et stockage chiffré existants ; lecture authentifiée du propriétaire ou de l'admin `kyc:review`, sans URL publique.

`POST /kyc` ouvre un seul dossier laboratoire, même en concurrence. `NOT_SUBMITTED` et `NEEDS_REVISION` sont éditables ; `POST /kyc/submit` exige identité complète et les deux catégories de pièce, fige l'identité dans `KycSubmission.labIdentity`, efface toutes les anciennes coches de vérification puis passe en `UNDER_REVIEW`. Les uploads et modifications d'identité sont alors refusés.

La revue est manuelle : l'admin vérifie chaque pièce via le mécanisme existant, puis décide. Le serveur exige les deux catégories vérifiées et toutes les pièces cochées avant `APPROVED`, sans utiliser la checklist déclarative du client comme preuve. La décision et son historique sont transactionnels. Deux décisions opposées concurrentes ne créent qu'une revue et un audit de décision.

- `APPROVED` pose `Lab.verifiedAt`, active le compte et fige l'identité. Un nouvel appel d'ouverture renvoie le dossier existant ; aucun dossier parallèle ni renouvellement implicite.
- `NEEDS_REVISION` retire l'habilitation et replace le compte en `PENDING_KYC` ; correction puis soumission du même dossier, avec nouvelle vérification des pièces.
- `REJECTED` retire l'habilitation et place le compte en `PENDING_KYC`. Une nouvelle ouverture crée un nouveau dossier sans copier les anciennes pièces ; l'historique reste conservé.
- `SUSPENDED` est le statut du compte, pas un nouvel enum KYC. Le JWT est refusé ; une revue KYC ne lève jamais cette suspension. L'admin doit réactiver explicitement via le workflow utilisateurs. Un laboratoire auparavant approuvé retrouve alors ses droits et ses demandes conservées ; un non-approuvé doit encore compléter son dossier.

La validation médecin et le stub CNOM existants ne changent pas de politique. Les pièces KYC sont administratives ; ne pas y déposer de résultats patient. Les écrans `/labo/kyc`, `/labo/profile`, la porte d'accès aux résultats/demandes et la revue admin utilisent les composants Wax & Terre existants, FR/EN ; FON/YOR utilisent le repli FR, sans inventer de validation native.

## Droits et commandes

`GET/PUT /kyc/laboratory` : état et identité de sa propre structure seulement. Les actes cliniques vérifient à chaque transaction le rôle courant LABORATOIRE, `User.status=ACTIVE` et `Lab.verifiedAt` non NULL. Le contrôle et l'opération restent sous verrou PostgreSQL de la ligne User, commun aux revues et à la suspension utilisateur. Une lecture déjà autorisée avant une suspension ne peut être retirée rétroactivement.

| Acteur / état | Pool / commandes / résultats |
|---|---|
| Labo non vérifié, PENDING_KYC, rejeté ou en correction | 403 sur pool, file, liste, claim, avance et résultat ; aucune identité patient retournée |
| Labo suspendu | 401 via l'authentification ; recontrôle transactionnel refuse aussi les actes engagés après la suspension gagnante au verrou |
| Labo actif approuvé | Pool limité aux PENDING non attribués ou ciblés sur lui, projection id/type/échéance/date sans nom patient ; identité seulement après claim de ses propres demandes |
| Autre labo approuvé | Aucune commande privée dans sa file ; pas d'avance ni de résultat sur les commandes de l'autre |
| Médecin prescripteur / patient propriétaire | Parcours existants ; lecture des résultats conservée lors de la suspension du laboratoire |
| Admin KYC | Identité de la structure, responsable et pièces administratives seulement ; pas de commande, résultat ni DMP |

La prescription ciblée est autorisée seulement vers un laboratoire actuellement approuvé et actif. Sa demande PENDING apparaît dans son pool sans identité patient jusqu'à acceptation, et aucun autre laboratoire ne peut la réclamer. Le problème des prescriptions ciblées bloquées dans l'ancien workflow est corrigé.

`PENDING → SAMPLE_COLLECTED → PROCESSING → COMPLETED` : claim/avance/publication utilisent des mises à jour conditionnelles. Deux laboratoires concurrents : une attribution gagnante et un audit ; deux publications : un résultat et une notification patient. La publication exige PROCESSING sans résultat existant. Résultat, transition et notifications patient/prescripteur sont dans la même transaction : un échec annule ces effets DB. L'envoi fournisseur reste assuré par le dispatch existant, sans promesse d'envoi externe exactement une fois.

**Suspension : les commandes et résultats restent attribués au laboratoire d'origine, gelés pour son compte ; aucune remise automatique dans le pool ni réattribution.** Le médecin/patient conserve son circuit de lecture. Le pilote prévoit une résolution administrative hors circuit clinique pour une interruption durable ; aucune nouvelle API de transfert inter-laboratoires n'est introduite.

## Migration 30→31 et reprise des comptes

`20261006154628_laboratory_verification` créée par `prisma migrate dev --create-only`, SQL relu puis appliqué à la base de test. Trois champs nullable : `Lab.licenseNumber`, `Lab.verifiedAt`, `KycSubmission.labIdentity`. Aucun enum/modèle nouveau, aucun UPDATE/DELETE, aucune approbation déduite d'un ancien statut.

Tous les anciens laboratoires sont non habilités après migration, y compris ceux dont un ancien dossier est APPROVED. Pour ceux-ci, l'ouverture crée un nouveau dossier complet ; les anciennes pièces restent historiques. Un ancien dossier UNDER_REVIEW sans identité figée ne peut pas être approuvé : l'admin doit demander une correction puis la structure complète/resoumet son identité et ses pièces. Les laboratoires d'annuaire sans compte restent dans l'annuaire, sans droit clinique.

Répétition exécutée depuis le schéma de main (30 migrations) sur une base d'upgrade synthétique : égalité exacte des colonnes historiques sur huit tables, cinq laboratoires avec `verifiedAt/licenseNumber=NULL`, trois dossiers avec `labIdentity=NULL`, deux commandes attribuées et un résultat conservés ; `migrate diff` sans dérive. Cas : APPROVED, REJECTED, UNDER_REVIEW, SUSPENDED et annuaire sans compte. Les tests API vérifient ensuite refus et réouverture/revue explicite. Une ancienne fixture pharmacie/laboratoire a été adaptée au badge et à PROCESSING après le premier contrôle de suite ; le contrôle final complet ci-dessous passe.

### Déploiement préparé, non exécuté

1. Sauvegarde/restauration base et fichiers vérifiées ; annoncer la nouvelle validation aux laboratoires et le gel de leurs commandes historiques jusqu'à approbation.
2. Maintenance : arrêter les anciens workers API laboratoire avant migration. Aucun mélange de workers qui ignorent le badge et de nouveaux guards.
3. Installation au lockfile, Prisma generate, migrate deploy, build puis démarrage de la candidate ; compléter les dossiers et faire les revues administratives explicites.
4. Vérifier readiness, compte non habilité refusé, approuvé autorisé, suspension effective, attribution isolée et lecture patient/médecin. Exécuter l'addendum L2 de recette sur appareils réels.
5. Retour arrière : conserver les champs et préférer une correction en avant ; ne pas redémarrer l'ancien service laboratoire qui autorise les comptes sans badge. Toute restauration relève du runbook L10/L11 et d'une revue opérateur, sans script de backfill d'habilitation.

Diagnostic en lecture seule après migration : `SELECT count(*) FROM labs WHERE "userId" IS NOT NULL AND "verifiedAt" IS NULL;`. Le seed de démonstration reste volontairement non habilité ; il suit la revue manuelle, sans exception de production.

## Preuves exécutées

Pile dédiée : Node 24.19.0, PostgreSQL 16 et Redis 7, conteneurs `digisante-l2-db` / `digisante-l2-redis`, bases test/upgrade/E2E séparées ; ces deux conteneurs ont été supprimés après les contrôles, services dev préexistants conservés. pnpm local 11.19.0 avec dépendances provisionnées, dépôt/CI épinglés à 9.12.0 et lockfile inchangé. Aucun fournisseur réel ni environnement de production.

| Contrôle | Résultat |
|---|---|
| KYC/laboratoire ciblés | 42 tests verts, dont 27 nouveaux scénarios L2 ; médecin/CNOM existants verts |
| Migration | 30→31, huit tables historiques identiques, aucun accès implicite ni dérive |
| Lint/typecheck | Verts lors de l'implémentation ; contrôle final dans release:check |
| Parcours navigateur L2 | Inscription laboratoire, accès bloqué, structure, deux uploads, gel de revue, checklist admin et accès après approbation : vert |
| Suite release et E2E complète | **439 API +50 web +9 E2E verts**, aucun skip ; release:check **11 étapes en 80 s**, 28 tests outillage verts ; build/lint/types/Prisma et scan de 111 fichiers web sans secret verts |
| Compteurs | 165 REST/1 WS, 27 modules, 67 pages, 48 modèles/31 enums/31 migrations, 439 API +50 web +9 E2E |
| DOCX du plan | Régénéré, validé ZIP/XML/relations/A4/tableaux/concordance source ; rendu Word et signatures humaines non contrôlés |

i18n final : FR/EN 955 clés, EN complet ; FON/YOR 868 présentes et 87 manquantes chacun, dont les six critiques SOS déjà ouvertes. Les onze nouvelles clés administratives sont en repli FR ; relecture native suivie en L9.

Reproduire sur une pile synthétique dédiée : migrations deploy/generate, `pnpm --filter @digisante/api exec vitest run src/modules/laboratory src/modules/kyc`, `pnpm release:check`, build avec proxy E2E, puis `pnpm test:e2e` sur DB/Redis séparés. Le navigateur utilise Chromium système/Pixel 5 émulé localement, Chromium Playwright en CI. Traces synthétiques non versionnées : `/workspace/work/digisante-l2/`.

## Revue et limites

Revue : `docs/REVUE_L2_2026-10.md`. X3 : `docs/ADDENDUM_Audit_Laboratoire_L2_2026-10.md`. Recette physique : addendum L2 de `docs/RECETTE_7_Roles_PV.md`, cases non cochées.

L2 n'atteste pas l'autorisation légale effective d'une structure, la validation clinique des analyses, les fournisseurs réels ou l'ouverture en production. Les audits KYC/claim/critique utilisent le mécanisme existant après commit métier : un arrêt entre commit et audit reste un résiduel de traçabilité à traiter par la finalisation sécurité, sans inventer une garantie transactionnelle d'audit. Tri d'audit et reprise après panne restent suivis en L8 ; rejeu serveur durable en L3. Le changement d'identité d'une structure déjà approuvée et le transfert de commandes ne sont pas des workflows automatisés du pilote.
