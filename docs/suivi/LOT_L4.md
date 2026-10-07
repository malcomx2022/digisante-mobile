# Lot L4 — Coffre hors ligne protégé et disponibilité exacte

> 7 octobre 2026 (Africa/Lagos). Implémentation et auto-revue : Codex à la demande du porteur, suivant les conventions Claude Code.
> Branche : `feat/l4-protected-offline`. Base main : `ce1cae85fc2fcae33c657aa39dffd98620fb4dd9`, après fusion de PR #183 le 6 octobre à 17:25:24 UTC.
> Statut : **VALIDÉ LOCALEMENT — livraison/CI à consulter sur la PR du lot**. Aucune fusion automatique ni déploiement.
> Commit applicatif : `3e7104e1884be28e9f95189caf7fa29a0fcc614d`. [PR et checks L4](https://github.com/malcomx2022/digisante-mobile/pulls?q=is%3Apr+head%3Afeat%2Fl4-protected-offline).

## Résultat et reprise Claude Code

Coffre à phrase locale opt-in, clé AES-256-GCM aléatoire enveloppée par PBKDF2-SHA256 600 000 ; clé ouverte non exportable en mémoire, jamais phrase/clé serveur/JWT persistés. Fermeture/reload/masquage et inactivité 15 min verrouillent ; BroadcastChannel propage lock/purge. Owner/génération recontrôlés dans les écritures pour empêcher une réintroduction après purge. Compte B ne lit/compte aucune action A ; changement purge les lectures A et conserve seulement ses actions chiffrées pour reprise authentifiée. Logout/effacement : tous les magasins dans une transaction, avertissement si échec.

Lecture explicite sur `/patient/offline` : 20 résumés DMP, 10 ordonnances ×20 lignes sans QR, urgence sans assurance/adresse ; date visible, avertissement 6 h, expiration 24 h et retrait du payload. Aucun cache API générique. Pages classiques en ligne avec lien vers le coffre ; SW v3 prépare seulement coquilles et assets publics, exclut API/RSC/documents/tokens. SOS serveur et vidéo/paiements/partage restent en ligne ; SMS/appel nécessitent couverture téléphonique, disponibilité des numéros non attestée ici.

File chiffrée conservant les identités L3. Sans coffre ouvert : premier envoi en ligne précédé d’un ticket minimal sans corps/méthode/route ; réponse perdue récupérée par GET reçu minimal, jamais nouveau POST. Refus/ambiguïté/absence de reçu conservés pour revue et bloquent toute nouvelle mutation couverte jusqu’à vérification. Rejets accessibles depuis coffre/profil, dates/catégories, détails chiffrés après unlock et lien vers effets en ligne ; suppression volontaire après confirmation, pas de ressaisie automatique. Panne temporaire de refresh garde le contexte local sans jeton/rejeu, refus 401/403 ferme la session ; `navigator.onLine` ne prouve pas la connectivité API.

Contrat détaillé : `../CONTRAT_Hors_Ligne_L4.md` ; revue : `../REVUE_L4_2026-10.md`. Réutiliser les helpers/composants du coffre et les huit routes L3 ; aucune extension financière, package, lockfile ou migration serveur.

## Migration et exploitation

IndexedDB **v3→v4 additive**. Anciens `mutations`/`failed` conservés ; nouveaux magasins `vaults`, `pendingSealed`, `failedSealed`, `snapshots`. Après unlock : migration atomique des seules lignes du compte, id/corps/clé/dates identiques, aucune attribution owner NULL ni backfill d’identité. Échec/lock laisse la ligne ancienne intacte. Les anciennes entrées sans clé sont conservées mais refusées au rejeu.

**L’héritage non migré reste en clair**, même après création d’un coffre : comptes non déverrouillés ou sans owner. Présence signalée sans exposer identité/contenu. Avant appareil partagé/pilote, migrer chaque compte ou vérifier les effets réels puis effacer volontairement ; effacement des seules lignes sans owner proposé séparément. La protection intégrale ne peut pas être attestée avant magasins historiques vides. Ancien onglet bloquant v4 : fermeture requise, erreur visible. Aucune perte silencieuse ni reset automatique.

Déploiement préparé, non exécuté : conserver sauvegardes/clé santé L3 → API/client/SW homogènes → fermer les anciens onglets et renouveler clients → contrôler migration/legacy, cache, coffre, tickets GET et TTL/purge. Ne pas revenir au client v3 qui réécrit en clair ; correction en avant recommandée. Après effacement volontaire, pas de récupération locale ; vérifier le serveur avant ressaisie. Schéma serveur inchangé : 32 migrations existantes appliquées sur deux bases synthétiques distinctes ; validate/status/migrate diff sans dérive verts.

## Preuves et reproduction

Pile isolée : Node 24.19.0, PostgreSQL 16, Redis 7 ; conteneurs `digisante-l4-db` / `digisante-l4-redis`, bases `digisante_l4_test` et `digisante_l4_e2e`, Redis /1 et /2. Ces deux conteneurs ont été supprimés après les contrôles ; services dev préexistants conservés. pnpm local 11.19.0/dépendances provisionnées, dépôt/CI épinglés 9.12.0 ; lockfile inchangé. Aucun fournisseur réel ni production. Traces synthétiques non versionnées sous `/workspace/work/digisante-l4/`.

| Contrôle | Résultat |
|---|---|
| API ciblée | 28 scénarios sync verts : huit routes L3 +7 nouveaux contrôles L4, lecture sans effet/contenu, clé seule/ambiguïté, droits/propriétaire/expiration |
| Web ciblé | Coffre 20, tickets 7, SW 6, refresh 2 nouveaux, cache session 4 ; migration, lock, purge en vol, quota, TTL, isolement et aucune écriture clinique en clair |
| Release et E2E | **467 API +103 web +15 E2E verts**, aucun skip ; release:check **11 étapes en 85 s**, 28 tests outillage, lint/types/build/Prisma et scan 111 fichiers web sans secret verts |
| Compteurs mesurés | 167 REST/1 WS, 28 modules, 67 pages ; 49 modèles/31 enums/32 migrations ; 467 API +103 web +15 E2E recensés |
| Plan DOCX | Régénéré et validé ZIP/XML/relations/A4/tableaux/concordance avec le Markdown ; rendu Word/signatures humaines non attestés |

Reproduire : appliquer les 32 migrations sur une pile synthétique dédiée ; `sync.test.ts`, web Vitest, puis `pnpm release:check`. Build avec `NEXT_PUBLIC_API_URL='' E2E_API_PROXY=http://127.0.0.1:3011`, E2E sur DB/Redis distincts. Scénarios Playwright : effet PEV committé/réponse abandonnée, recharge/phrase/même clé ; deux onglets GET pour ticket sans coffre et un seul POST ; lecture synchronisée/reload réel sans réseau/mauvaise phrase/cache sans API ni marqueur ; changement réel A→B avec file A conservée et cachée ; migration historique sans changement de clé ; échec de purge et signal Storage refusé au logout avec avertissement mémoire/session fermée. Chromium système/Pixel 5 émulé localement, Chromium Playwright en CI. Recette physique dans addendum L4 de `RECETTE_7_Roles_PV.md`, cases non cochées.

i18n : FR/EN 1003 clés, EN complet ; FON/YOR 866 présentes et 137 manquantes chacune, dont six critiques SOS suivies en L9. Deux promesses anciennes offline/SOS incorrectes retirées des langues natives pour repli FR, aucune traduction native inventée.

## Limites restantes

Protection au repos après migration, sans garantie contre XSS/session ouverte, phrase faible/attaque hors ligne, navigateur/horloge/stockage compromis ni copie de ciphertext dans une sauvegarde. Aucune révocation ni connaissance de nouveaux résultats hors réseau. Projection datée pour lecture, aucune validité clinique actuelle ou délivrance prouvée. Phrase oubliée sans récupération. Ordre global de mutations distinctes entre onglets non garanti ; reçu absent après rétention exige revue manuelle, aucun exactly-once externe.

L5–L11 restent ouverts. Auto-revue/tests synthétiques ne remplacent ni revue humaine indépendante, ni appareils Android/iOS physiques, ni validation native/clinique, ni fournisseurs/GO pilote.
