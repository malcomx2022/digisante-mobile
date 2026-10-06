# Lot L1 — Consentements par entrée et auteurs DMP

> Date : 6 octobre 2026 (Africa/Lagos). Exécution et revue : Codex, à la demande du porteur.
> Branche : `feat/l1-dmp-consent-authorship`. Base main après PR #180 : `d55cf1ae0a9870a29829652c50f6e362476edb76`.
> Statut : **LIVRÉ SUR MAIN** par PR #181 ; fusion constatée le 6 octobre 2026 à 15:32:54 UTC, main `53775be962c10192964ea113caa3a551cf74b411`. Aucun déploiement déduit de la fusion.
> Commit applicatif : `9755b7f72c5fdd25079be071cce2408882d872af` ; PR et CI : [PR du lot L1](https://github.com/malcomx2022/digisante-mobile/pulls?q=is%3Apr+head%3Afeat%2Fl1-dmp-consent-authorship).

## Comportement livré par la candidate

- `ConsentRecord.expiresAt` est la source d'échéance : strictement après l'heure courante ; NULL ou expiré = refus. Réclamer B ne modifie pas A.
- Médecin actif, rôle courant MEDECIN et KYC actuellement vérifié ; révocation nominative persistante. Les autres rôles ne réclament pas le DMP.
- Liste, détail, export, ajout et téléchargement de pièces utilisent la même portée. Un propriétaire conserve tout son dossier.
- Réclamation, partage, révocation d'entrée, révocation du médecin et ré-octroi sont sérialisés par le même verrou PostgreSQL transactionnel par patient. La réclamation et son lien sont atomiques.
- Ré-octroi explicite : renouvelle les seuls liens dont l'échéance est connue. Les liens NULL restent fermés ; `requiresNewShare=true` si aucun lien n'est renouvelable. La levée de révocation autorise une nouvelle réclamation valide, pas la lecture automatique des anciens liens.
- Retirer le partage d'une entrée supprime aussi ses liens réclamés : le ré-octroi ne la ressuscite pas. Les autres entrées restent indépendantes.
- `authorId`/`authorRole` proviennent de la session authentifiée ; les champs homonymes du client sont ignorés par le schéma d'entrée. Pas de route de modification d'auteur.
- Auteurs anciens inconnus : NULL ; pas d'attribution au patient, ni à un médecin ayant simplement consulté. L'identifiant connu reste avec l'entrée après suppression du compte auteur (pas de FK vers User).
- Auteur médecin : pas de consentement de lecture implicite sur la nouvelle entrée. Le patient la partage explicitement. L'export ajoute un performer seulement si l'auteur est connu.

## Contrat et droits

`GET /dmp/consents` expose `records[{recordId, expiresAt, active}]`, `recordCount` des entrées actives et une échéance de synthèse (dernière connue). Cette synthèse n'est pas le bail commun de toutes les entrées. L'activité tient aussi compte du rôle/statut/KYC actuel du bénéficiaire. `Consent.expiresAt` reste une borne historique conservatrice ; le guard L1 ne l'utilise pas.

Les réponses de création/liste/détail DMP portent `authorId` et `authorRole`, nullable pour l'héritage inconnu. Le contrat TypeScript web est actualisé ; aucun nouveau parcours ou écran frontend ajouté au lot L1. L'export existant est enrichi sans attester une validation FHIR clinique complète.

| Acteur | Lecture/export/fichiers | Création d'entrée |
|---|---|---|
| Patient propriétaire | Tout son dossier | Auteur = son identité authentifiée |
| Autre patient | Refus | Toujours son propre dossier, pas le patientId fourni |
| Médecin actif/vérifié | Seulement liens non révoqués avec échéance future | Après consentement patient ; auteur authentifié, aucun accès supplémentaire |
| Médecin non vérifié/rôle changé | Refus, même QR | Refus |
| Compte suspendu | JWT refusé (401) | JWT refusé |
| ADMIN, ASC, DIASPORA, PHARMACIE, LABORATOIRE | Refus, même QR | Refus |

Les contrôles autorisent la requête au moment de la résolution de portée. Ils ne peuvent retirer une réponse déjà délivrée ou arrêter rétroactivement une requête en cours.

## Migration 29→30 et reprise

`20261006144830_dmp_entry_expiry_authorship` créée via `prisma migrate dev --create-only`, SQL revu puis appliqué via migrate dev. Trois colonnes nullable, aucun UPDATE/DELETE historique, aucun auteur inféré. Le schéma ancien ne conservait ni l'échéance par entrée ni l'identité du jeton réclamé : le QR courant est réémissible, le parent peut avoir été écrasé par une autre entrée. **Tous les anciens liens restent NULL et fermés.**

Un médecin déjà consenti doit réclamer explicitement un partage valide de chaque entrée. Un QR encore valide peut être présenté à nouveau ; un QR expiré ou retiré doit être réémis par le patient. La migration ne transforme pas le seul ancien lien en droit de lecture. Si le consentement était révoqué, le patient doit d'abord le ré-octroyer explicitement. Les lignes et métadonnées historiques sont conservées ; elles ne sont pas transformées en permissions démontrées.

### Déploiement préparé (non exécuté)

1. Sauvegarde/restauration vérifiées, annonce de maintenance et du renouvellement des partages.
2. Arrêter les anciens workers API/DMP ; ne pas servir un mélange d'anciens et nouveaux guards pendant la migration.
3. Installation au lockfile, Prisma generate, migrate deploy de la migration revue, build et démarrage de la candidate.
4. Vérifier propriétaire, médecin sans nouveau partage refusé, nouveau partage limité à une entrée, révocation et fichiers ; vérifier ready et les crons selon le runbook.
5. Retour arrière : conserver les colonnes et les contrôles par entrée, préférer une correction en avant. **Ne pas relancer l'ancien guard** sur les liens NULL : il ignore leur échéance. Une restauration/neutralisation DMP éventuelle relève du runbook de reprise et de la revue opérateur L10/L11, pas d'un retrait automatique de colonnes.

Diagnostic préalable en lecture seule : compter les liens à renouveler et les auteurs non attribuables, sans contenu médical. Après migration, `SELECT count(*) FROM consent_records WHERE "expiresAt" IS NULL` ; ces lignes ne sont pas des erreurs à recréditer/réautoriser par script. Ne pas publier les identités ni les jetons dans un PV.

## Vérifications exécutées

Pile dédiée : Node 24.19.0, PostgreSQL 16, Redis 7 /1 et /2. Conteneurs `digisante_l1_postgres` et `digisante_l1_redis`, indépendants des services dev existants ; supprimés après les vérifications. pnpm local 11.19.0 et dépendances provisionnées ; dépôt/CI épinglés à pnpm 9.12.0, sans changement du lockfile. `pnpm_config_verify_deps_before_run=false` reste un réglage local de test. Aucun fournisseur réel ni base production.

| Contrôle | Résultat exécuté |
|---|---|
| Tests DMP ciblés | 45 tests verts (19 nouveaux scénarios L1, consentements/docs existants et décisions pures) |
| Suite API/web | 412 API + 50 web verts dans le contrôle final, aucun skip |
| Lint/typecheck et build | Verts dans le contrôle final |
| E2E navigateur | 8 passed, Chromium système/Pixel 5 émulé ; auth/routage et triage hors réseau, pas toute la recette clinique |
| Répétition de migration | 29→30 ; huit liens historiques fermés, huit entrées et toutes leurs métadonnées conservées, auteurs NULL, révocation conservée |
| Cas de migration | QR supposé inchangé, deux échéances, QR réémis, token absent, expiration, révocation, borne parent différente, consentement vide, lien autre patient ; aucun bail inféré |
| migrate diff après reprise | Aucun écart, tables de contrôle synthétiques retirées |
| Compteurs | 163 REST/1 WS, 48 modèles/31 enums, 30 migrations, 73 fichiers de test API, 412/50/8 cas |
| release:check | **11 étapes vertes**, 78 s ; 28 tests d’outillage verts, zéro skip ; scan de 110 fichiers web sans secret serveur |
| Plan DOCX | Régénéré et validé (ZIP/XML/relations/A4/tableaux/concordance source) ; rendu Word et signatures humaines non contrôlés |

Traces synthétiques locales non versionnées : `/workspace/work/digisante-l1/`. Les tests utilisent Date.now contrôlé pour l'expiration, avec les dates natives réelles de l'audit et une IP synthétique par scénario ; aucun relâchement du rate-limit ou de l'audit en production.

Reproduction : pile de test dédiée, Prisma generate/migrate deploy, `pnpm --filter @digisante/api exec vitest run src/modules/dmp src/lib/dmp-consent.test.ts`, `pnpm release:check`, puis build E2E avec `NEXT_PUBLIC_API_URL=`/`E2E_API_PROXY` et `pnpm test:e2e` sur bases PostgreSQL/Redis séparées. DOCX : générateur du plan puis validateur structurel.

## Revue et suite

Revue : `docs/REVUE_L1_2026-10.md`. X1/X2 : `docs/ADDENDUM_Audit_DMP_L1_2026-10.md`. Scénarios physiques à exécuter : addendum L1 de `docs/RECETTE_7_Roles_PV.md`, sans cocher le PV historique.

Une publication Git/CI verte n'atteste pas le déploiement ni une recette médicale. Vérifier merged/merged_at, main et les checks avant le lot dépendant ; aucune fusion automatique par Codex. L2 est traité séparément sur `feat/l2-laboratory-verification` ; voir LOT_L2 pour sa livraison.
