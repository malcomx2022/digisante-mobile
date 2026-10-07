# Lot L3 — Rejeu des mutations sans doublon

> 6 octobre 2026 (Africa/Lagos). Implémentation et auto-revue : Codex à la demande du porteur, selon les conventions Claude Code.
> Branche : `feat/l3-idempotent-sync`. Base main : `eb1ba6ed70c2accf581a29bc2d10317bc5555caa`, après fusion de PR #182 le 6 octobre à 16:19:42 UTC.
> Statut : **LIVRÉ SUR MAIN — PR #183 fusionnée le 6 octobre à 17:25:24 UTC, main ce1cae8**. Aucune fusion automatique ni déploiement.
> Commit applicatif : `e178a7561afea575aef3ce5a357a25fa8b4f7d24`. [PR et checks L3](https://github.com/malcomx2022/digisante-mobile/pulls?q=is%3Apr+head%3Afeat%2Fl3-idempotent-sync).

## Résultat et reprise Claude Code

Le client crée et persiste l'identité avant le premier envoi, conserve le même corps/compte/clé et ne rejoue que huit routes explicitement couvertes. PostgreSQL enregistre effet métier et reçu AES-GCM dans la même transaction, sous verrou User et avec droits courants. Corps différent sous la même clé : 409, aucun second effet ; réponse perdue, concurrence ou redémarrage : reçu durable retrouvé. Contrat détaillé : `docs/CONTRAT_Synchronisation_L3.md` ; revue : `docs/REVUE_L3_2026-10.md`.

Âge maximal 7 jours, tolérance future 5 minutes, reçus 14 jours après commit. Purge interne authentifiée quotidienne à 03:10. Anciennes entrées sans preuve ou route exclue : conservation pour revue, aucun nouveau jeton ni rejeu silencieux. Un 401 interrompt sans archiver ; propriétaire recontrôlé avant chaque envoi et retry. AuthProvider pose le propriétaire directement et partage un seul refresh avant la reprise initiale. Deux onglets partagent la clé, avec arbitrage serveur ; ordre global de deux actions distinctes entre onglets non garanti.

Aucune extension des paiements/SOS/OTP/consentements/partages DMP ou du laboratoire. Fermeture de grossesse exclue faute de cible stable ; toute mutation hors liste positive exige le réseau. Les appels en ligne sans clé restent compatibles mais sans garantie de déduplication. Les reçus de création sont lisibles seulement si la ressource existe encore et appartient au patient. Après suppression/transfert : 404, revue manuelle. La suppression PEV rejouée renvoie seulement l'accusé non clinique du compte du reçu.

## Migration et exploitation

`20261006164320_mutation_receipts` crée `mutation_receipts`, son unicité composite, son index d'expiration et la FK User avec cascade. Table vide à la migration ; aucun backfill d'identité ou d'effet. Upgrade **31→32** sur base synthétique distincte : instantanés complets identiques de users/labs/patients/doctors/kyc_submissions/kyc_documents/lab_orders/lab_results, table reçus vide, `migrate diff` sans dérive. Les entités L2 et leurs attributions restent inchangées.

Déploiement préparé, non exécuté : sauvegarde/restauration → arrêt des anciens workers → installation au lockfile/Prisma generate/migrate deploy/build → démarrage homogène → renouvellement client/SW → contrôle des huit routes et de la purge. Surveiller volumes et réussite du cron : aucune purge prématurée d'un reçu. Préférer une correction en avant ; ancien serveur ignorant les clés et clients anciens réouvrent le risque de doublon. Rotation de clé santé avec les données/reçus, jamais par simple remplacement d'env.

## Preuves

Pile dédiée : Node 24.19.0, PostgreSQL 16, Redis 7 ; conteneurs `digisante-l3-db` / `digisante-l3-redis`, bases test/upgrade/E2E séparées ; ces deux conteneurs ont été supprimés après les contrôles, services dev préexistants conservés. pnpm local 11.19.0, dépendances provisionnées ; dépôt/CI épinglés à 9.12.0, lockfile inchangé. Aucun fournisseur réel ni production. Traces synthétiques non versionnées dans `/workspace/work/digisante-l3/`.

| Contrôle | Résultat |
|---|---|
| API L3 | 21 scénarios verts : huit routes, concurrence, rollback reçu, redémarrage, isolation/rôles/propriétaires, contenu canonique, expiration/purge et panne Redis |
| Web L3 | 14 nouveaux scénarios verts : persist avant fetch, même clé, JSON stable, session/401, single-flight, TTL, anciennes entrées/exclusions et archives |
| Migration | 31→32 sans modification historique ni dérive, reçus vides |
| Release et E2E | **460 API +64 web +11 E2E verts**, aucun skip ; release:check **11 étapes en 95 s**, 28 tests outillage, lint/types/build/Prisma et scan 111 fichiers web sans secret verts |
| Compteurs mesurés | 166 REST/1 WS, 28 modules, 67 pages, 49 modèles/31 enums/32 migrations ; 460 API +64 web +11 E2E recensés |
| Plan DOCX | Régénéré et validé ZIP/XML/relations/A4/tableaux/concordance source ; rendu Word et signatures humaines non contrôlés |

Reproduire : migrations/generate sur pile synthétique dédiée ; tests `sync.test.ts`, `client.sync.test.ts`, puis `pnpm release:check`. Build avec `NEXT_PUBLIC_API_URL='' E2E_API_PROXY=http://127.0.0.1:3011`, E2E sur DB/Redis distincts. Le scénario navigateur fait committer via `route.fetch()` puis abandonne la réponse et recharge ; un autre fait reprendre la même entrée par deux onglets. Chromium système/Pixel 5 émulé localement, Chromium Playwright en CI. Recette physique : addendum L3 de `docs/RECETTE_7_Roles_PV.md`, cases non cochées.

i18n : FR/EN 955 clés, EN complet ; FON/YOR 868 présentes et 87 manquantes chacune, dont les six critiques SOS suivies en L9. Aucun nouveau texte UI ni validation native/clinique inventée.

La protection locale et l’interface de reprise sont complétées en L4 : `../CONTRAT_Hors_Ligne_L4.md`. Les limites ci-dessous décrivent L3 seul.

## Limites restantes

Corps IndexedDB en attente/échec toujours en clair, interface complète de revue manuelle, politique de clé/purge et lecture médicale persistée : **L4**. Les entrées anciennes sans propriétaire ne sont jamais rattachées à un compte arbitraire. Les helpers de diagnostic/archive existent mais ne constituent pas une UX de reprise finalisée.

L3 garantit l'atomicité des effets DB couverts et des reçus ; hint chat Redis post-commit en best-effort, aucun exactly-once externe ni outbox fournisseur. Aucun déplacement de la déduplication financière gelée. Un reçu est une photographie de l'action originale, pas l'état actuel du dossier. Une auto-revue et des tests synthétiques ne remplacent ni une revue humaine indépendante, ni une recette appareil/fournisseur, ni le GO pilote L9–L11.
