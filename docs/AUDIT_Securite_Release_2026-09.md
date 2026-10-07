# Audit de sécurité de release — septembre 2026

> **Date** : 22/09/2026 · **Périmètre** : code applicatif `apps/api` + `apps/web` à l'état de `main`
> avant mise en production (prompt 19 de `docs/PROMPTS_Claude_Code_Finalisation.md`).
> **Méthode** : trois revues indépendantes en parallèle (auth/sessions/admin · données de santé/§4 ·
> hors-ligne/web/infra), chaque constat **vérifié dans le code** avant correction ; un test de
> non-régression par correctif serveur (`apps/api/src/security/release-audit-2026-09.test.ts`).
> **Nature** : revue de code par l'assistant. **Ce n'est PAS un test d'intrusion** ni un audit par
> un tiers indépendant — un pentest externe reste recommandé avant l'ouverture au public.

## 1. Synthèse

| | Nombre |
|---|---|
| Constats vérifiés et **corrigés** dans ce lot | **13** |
| Constats **résiduels** documentés (non corrigés, motif donné) | **15** |
| Constats en **zone gelée §5** (FedaPay) — soumis à revue explicite | 2 (dont 1 correctif appliqué le 22/09/2026 sur accord du porteur) |
| Dépendances ajoutées · migrations | 0 · 0 |

Contrôles après correction : **376 tests API + 48 tests web verts**, typecheck + lint verts,
`metrics:check` conforme, 28 tests d'outillage verts.

## 2. Constats corrigés

| # | Gravité | Constat | Correctif |
|---|---|---|---|
| R1 | 🔴 Critique | **La file hors-ligne mettait en attente des actions qui ne doivent jamais être rejouées plus tard** : `mutate()` mettait en file AVANT que la garde `online()` ne s'applique ⇒ envoi d'argent à un proche, **alerte SOS**, OTP, paiements pouvaient partir des heures après, sans retour à l'utilisateur. | `NEVER_QUEUE` (auth, admin, paiements, wallet, envoi d'argent, consentements/pièces DMP, KYC, SOS, device) + `OfflineError` levée **avant** la mise en file ; variantes explicites `postNow/patchNow/putNow/delNow` (40 appels convertis). |
| R2 | 🔴 Critique | **File hors-ligne partagée entre comptes** sur un appareil partagé (cas courant : téléphone familial) : les mutations du compte A étaient rejouées avec la session du compte B. | Chaque entrée porte son `owner` ; `flush` ne rejoue que celles de l'utilisateur courant ; la déconnexion purge tout (`purgeAll`). |
| R3 | 🔴 Critique | **Contournement du verrou OTP** : chaque nouvel envoi de code remettait le compteur d'échecs à zéro ⇒ brute-force illimité par cycles de 4 essais. | Le compteur n'est plus réinitialisé à l'envoi (seulement au succès). |
| R4 | 🟠 Haute | **Course sur la vérification OTP** : N vérifications parallèles passaient toutes le contrôle de verrou avant qu'une ne le pose. | `INCR` atomique **avant** comparaison ; au-delà du maximum → verrou + 429. |
| R5 | 🟠 Haute | **Rotation du refresh token non atomique** (`get` puis `del`) : deux requêtes simultanées obtenaient deux sessions à partir du même jeton. | `GETDEL` atomique. |
| R6 | 🟠 Haute | **Pas de `trustProxy`** derrière Nginx : tous les clients apparaissaient en `127.0.0.1` ⇒ un seul seau de rate-limit pour toute la population, IP d'audit inutiles. | `trustProxy: 'loopback'` (seul Nginx local est cru). |
| R7 | 🟠 Haute | **Médecin non vérifié / sans lien avec le patient** : un compte MEDECIN auto-inscrit pouvait, sur n'importe quel `patientId`, signer une ordonnance (QR « authentique » en pharmacie), commander une analyse, **découvrir les allergies** via le refus 400, lire le nom du patient (chat, orientation). | `lib/care.ts` : médecin **vérifié** + **relation de soin** (RDV non annulé, consentement DMP actif ou orientation reçue), vérifiée **avant** tout traitement révélant une donnée. Appliqué à ordonnance, commande d'analyse, ouverture de fil de chat, orientation, rappel pour autrui. |
| R8 | 🟠 Haute | **Rappels = vecteur d'hameçonnage SMS** : titre/texte libres, canal SMS/e-mail, destinataire quelconque ⇒ « DigiSanté : confirmez votre paiement… » depuis l'expéditeur officiel. | Canaux SMS/e-mail refusés pour un rappel programmé ; rappel pour autrui = médecin en relation de soin avec **son** patient. |
| R9 | 🟠 Haute | **Jeton de partage DMP réclamable par un rôle non soignant** (pharmacie, labo, diaspora, ASC) ⇒ consentement durable accordé à qui scanne le QR. | Seul un **médecin vérifié** peut réclamer un jeton (`dmp-consent.ts`) ; tout autre rôle → `DMP_DENIED`. |
| R10 | 🟠 Haute | **Révoquer un partage ne révoquait pas l'accès déjà réclamé** : le soignant ayant scanné gardait l'entrée jusqu'à l'échéance, alors que le patient pensait l'avoir coupé. | `revokeShare` supprime aussi les `ConsentRecord` de l'entrée, dans la même transaction. |
| R11 | 🟠 Haute | **Admin : fuite de contenu médical dans le journal d'audit** (§4) — valeurs critiques de labo (`LAB_CRITICAL`) et coordonnées GPS des SOS lisibles par l'admin. | Méta minimisées **à l'écriture** (`{orderId, criticalCount}`, `{hasLocation, …}`) **et** masquage à la lecture admin (`redactAuditMetaForAdmin`) pour les lignes historiques (la table est append-only : on ne réécrit pas). |
| R12 | 🟡 Moyenne | **Admin `users:write` pouvait suspendre un SUPER_ADMIN ou lui-même** ; un profil admin sans scope ou suspendu n'était pas refusé partout. | Suspension/réactivation refusées sur un compte ADMIN et sur soi ; garde `requireActiveAdminProfile` sur toutes les routes admin. |
| R13 | 🟡 Moyenne | **Pharmacie : ré-délivrance** d'une ordonnance déjà délivrée / expirée / annulée. | Seules `ACTIVE` et `PARTIALLY_DISPENSED` sont délivrables. |
| — | 🟡 Moyenne | Jeton de service des crons comparé avec `!==` (fuite temporelle) ; `RECONCILE_TOKEN` court accepté ; WebSocket sans limite de taille ni de sockets. | `isValidServiceToken` (temps constant, fail-closed) sur les 5 générateurs + dispatch ; `RECONCILE_TOKEN` ≥ 32 hors test ; WS `maxPayload` 4 Ko et 5 sockets max par utilisateur. |

⚠️ **Effet de bord assumé (R7)** : un médecin ne peut plus prescrire à un patient avec lequel il
n'a **aucun** rendez-vous, consentement ou orientation. C'est l'objectif ; en recette, créer d'abord
le rendez-vous (les fixtures de test passent désormais par `src/test/care-fixture.ts`).

## 3. Zone gelée §5 (FedaPay)

| Constat | Statut |
|---|---|
| Idempotence du webhook non atomique (deux livraisons simultanées du même évènement peuvent créditer deux fois un portefeuille) | **✅ Corrigé le 22/09/2026 sur autorisation explicite du porteur** : transition conditionnelle + crédit/reversal dans la même transaction. Reproduit avant (4 crédits / 4 reversals), 1/1 après, 10/10 exécutions ; re-tests webhooks verts. Reste : S7 en bac à sable (`RECETTE_FedaPay_Sandbox.md` §1). |
| Corps d'erreur FedaPay bruts journalisés | Résiduel — même régime (revue §5). La route de réconciliation garde sa propre comparaison de jeton pour la même raison. |

## 4. Résiduels (non corrigés — motif)

| # | Constat | Pourquoi pas maintenant |
|---|---|---|
| X1 | L'échéance d'un consentement par-entrée est écrasée par la dernière réclamation | Exige une colonne d'échéance sur `ConsentRecord` (migration) |
| X2 | Aucune colonne « auteur » sur les entrées du DMP | Migration + reprise de données |
| X3 | Un laboratoire non vérifié peut prendre en charge le pool (anonymisé) de demandes | Pas de KYC laboratoire dans le schéma ; données anonymisées jusqu'à la prise en charge |
| X4 | Énumération de comptes via `/otp/request` (404) et `/register` (409) | Arbitrage UX ; atténué par le rate-limit Nginx + applicatif |
| X5 | Fraude au trafic SMS vers numéros internationaux | Restreindre aux préfixes attendus côté Twilio (Geo Permissions) — réglage console, pas code |
| X6 | Le rate-limit échoue fermé si Redis tombe | Choix conservateur ; `skipOnError` à arbitrer avec l'exploitation |
| X7 | Jeton de partage DMP dans l'URL ⇒ journal d'accès Nginx | Étendre `digisante_noquery` aux routes DMP concernées au déploiement |
| X8 | CSP permissive (`unsafe-inline`/`unsafe-eval`) ; **HSTS absent** | CSP : contrainte Next (§8). HSTS : à poser **après** validation du certificat en production |
| X9 | URL de paiement renvoyée au client non vérifiée contre une liste blanche | Chemin de paiement (§5) |
| X10 | Jeton de réunion Daily émis mais non utilisé par le client | Salles privées à activer côté Daily lors de la recette fournisseur |
| X11 | Vérification de lien du service worker contournable par `\` | Risque faible (même origine) ; à normaliser |
| X12 | Chaîne d'audit : `writeAudit` lit le dernier maillon par `createdAt desc` sans départage à horodatage égal | Le verrou consultatif sérialise les écritures (collision improbable) ; la requête d'export de `verify-chain.mjs` trie déjà par `createdAt, id`. Ajouter `id` au tri d'écriture |
| X13 | Empreinte OTP non « poivrée » (sans clé) | OTP à 6 chiffres, durée de vie courte, verrou 5 essais |
| X14 | `JWT_REFRESH_TTL` défini mais jamais lu | Nettoyage de configuration |
| X15 | Pas de test d'intrusion externe | Hors capacité de ce dépôt — recommandé avant ouverture au public |

## 5. Ce que ce rapport n'atteste PAS

- Aucune vérification sur le VPS réel, les fournisseurs réels ou un appareil physique.
- Aucune revue par un tiers ; aucune validation humaine n'est inventée ici.
- Les correctifs sont vérifiés par tests automatisés **locaux** (la CI GitHub reste bloquée au niveau
  du compte : aucun runner n'est attribué aux jobs).

## Addendum L5 — 7 octobre 2026 : X10 traité dans la candidate

X10 (table historique §3) est corrigé côté code candidat : SDK officiel avec `join({url,token})` hors URL/stockage/log, salle privée relue sans frappe, jetons nominatifs sans owner/admin à validité bornée, contrôles d'état/identité/suspension/KYC, coupure média et surveillance. Refus des accès fictifs après erreur fournisseur ; éjection/ban à clôture suivie de DELETE best effort. Contrat, auto-revue et preuves : `CONTRAT_Teleconsultation_L5.md`, `REVUE_L5_2026-10.md`, `suivi/LOT_L5.md`. La recette fournisseur deux appareils, token expiré/URL seule et éjection réelle reste à attester en L10 avant GO L11 ; aucune révocation instantanée absolue d'un bearer copié ni validation APDP n'est promise. Les compteurs de l'audit d'origine sont historiques, pas les compteurs de la candidate L5.
