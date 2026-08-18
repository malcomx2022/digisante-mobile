# Audit fonctionnel complet — août 2026

> **Date** : 18 août 2026 · **Périmètre** : `chore/lot5-drop-admin-audit-log` (= `main` + lot 5)
> **Nature** : audit **fonctionnel** — on ne demande pas « le code est-il propre ? » mais
> « **l'utilisateur peut-il réellement faire ce que le produit promet ?** ».
> **Méthode** : chaque endpoint de l'API est confronté aux appels réels du frontend
> (script d'appariement d'URL, `apps/api/src/server.ts` → `apps/web/src/**`), puis chaque
> orphelin est vérifié à la main. Tous les chiffres ci-dessous ont été **exécutés**, pas déduits.
>
> Fait suite à `docs/REVUE_Ecarts_et_Plan_2026-08.md` (C1→C9, tous livrés) — cet audit-ci ouvre
> la série **D1→D10**.

---

## 1. État vérifié de la codebase

| Contrôle | Commande | Résultat |
|---|---|---|
| Typage | `pnpm typecheck` | ✅ 3/3 projets |
| Lint | `pnpm lint` | ✅ 0 warning, 0 erreur |
| Tests API | `pnpm test` (env CI) | ✅ **305 / 305** (64 fichiers) |
| Tests web | `pnpm --filter @digisante/web test` | ✅ **32 / 32** (4 fichiers) |
| Tests e2e | `pnpm test:e2e` | 8 scénarios (job CI séparé) |
| Migrations | `prisma migrate deploy` | ✅ **27** appliquées, 0 en attente |
| i18n | `pnpm i18n:check` | EN **100 %** · FON/YOR **96 %** (35 clés, **0 critique**) |
| Git | `git status` | ✅ arbre propre après lot 5 |

### 1.1 Compteurs mesurés (reproductibles à la commande)

| Métrique | Mesuré | Commande |
|---|---|---|
| Endpoints | **163 REST + 1 WS** | `grep -rhoE "app\.(get\|post\|put\|patch\|delete)\(" apps/api/src/modules --include=*.routes.ts \| wc -l` → 164 |
| Pages frontend | **64** | `find apps/web/src/app -name page.tsx \| wc -l` |
| Modules API | **28** | `ls apps/api/src/modules` (hors `journeys.test.ts`) |
| Modèles Prisma | **48** | `grep -c '^model ' apps/api/prisma/schema.prisma` |
| Enums Prisma | **31** | `grep -c '^enum ' apps/api/prisma/schema.prisma` |
| Migrations | **27** | `ls apps/api/prisma/migrations` |
| Scopes admin | **17** | `packages/shared/src/scopes.ts` |
| Tests | **337** (305 API + 32 web) + 8 e2e | |

Le lot 5 (suppression d'`AdminAuditLog`) fait passer **49 → 48 modèles** et **32 → 31 enums**,
et ajoute la **27ᵉ** migration. Compteurs resynchronisés dans `CLAUDE.md`, `README.md` et
`docs/DEPLOIEMENT_Checklist.md`.

### 1.2 Santé structurelle — ce qui est sain

- **Aucun modèle Prisma mort** : les 48 modèles ont au moins une écriture en code de production
  (vérifié modèle par modèle). C'était le dernier reproche de C5, il est levé.
- **Aucun module API orphelin** : les 28 modules sont registrés et consommés — `referrals`, le
  seul orphelin de la revue précédente, est branché depuis le lot 2.
- **Zéro `TODO`/`FIXME`** en attente dans le code de production (les 3 occurrences sont des
  hypothèses documentées : format CNOM, exemples de numéros).

---

## 2. Écarts fonctionnels trouvés (D1 → D10)

### La signature commune

Les trois écarts majeurs partagent **exactement** la signature de C1/C2 : un backend **complet,
registré et testé**, et **aucun écran ne l'appelle**. Ce n'est pas de la dette technique — c'est du
travail livré à 90 % dont les 10 % manquants sont précisément les seuls visibles par l'utilisateur.

Détection : `146` endpoints appariés aux `110` URL réellement appelées par le web → `25` sans
appelant, dont **19 légitimes** (sondes `/health` `/ready`, crons `x-service-token`, webhook
FedaPay, WebSocket, `getBlob` de pièces jointes, lectures unitaires REST non utilisées) et
**6 réellement problématiques**, ci-dessous.

---

### D1 — 🔴 MAJEUR · Téléconsultation : aucune interface médecin, la boucle est cassée

**Constat.** Deux endpoints réservés au médecin n'ont **aucun appelant** dans `apps/web` :

| Endpoint | Rôle | Appelants web |
|---|---|---|
| `POST /api/v1/consultations` | `doctorOnly` — crée la salle Daily.co | **0** |
| `POST /api/v1/consultations/:id/end` | `doctorOnly` — clôture la consultation | **0** |

`prisma.consultation.create` n'existe qu'à un seul endroit (`consultations.service.ts:48`),
atteignable uniquement par `POST /consultations`.

**Chaîne de conséquences.** `appointments.service.ts:108` expose `consultationId` au patient ;
`patient/appointments/page.tsx:86` conditionne le bouton « Rejoindre » à
`a.status === 'CONFIRMED' && a.type === 'TELECONSULTATION' && a.consultationId`. Comme aucune
`Consultation` ne peut être créée, `consultationId` **vaut toujours `null`** →
**le bouton « Rejoindre » ne s'affiche jamais**, et `/patient/teleconsult` n'est atteignable qu'en
forgeant l'URL à la main. Symétriquement, `POST /:id/end` n'étant jamais appelé, une consultation
qui existerait ne se refermerait pas.

**Aggravant.** `/pro/agenda` est en **lecture seule** — un seul `get()`, **zéro bouton**. Le médecin
n'y démarre pas une téléconsultation, n'y confirme pas un rendez-vous (le bouton « confirmer »
n'existe que sur le tableau de bord `/pro`), n'y trie pas une demande (cf. D5).

**Portée métier.** La téléconsultation est la fonctionnalité phare du cahier des charges et la
réponse directe au défi « infrastructure médicale limitée » (§1 CLAUDE.md). Backend + intégration
Daily.co + dégradation `VIDEO→AUDIO→CHAT` sont **complets et testés** ; le geste médecin manque.

---

### D2 — 🔴 MAJEUR · Le paiement « Wallet » ne débite jamais le portefeuille (zone §5)

**Constat.** L'interface propose trois moyens de paiement d'une consultation
(`apps/web/src/app/patient/appointments/page.tsx:16-19`) : MTN MoMo, Moov Money et
**« Wallet 🇫🇷 »**. Les trois partent sur le même appel :

```ts
await post('/payments', { type: 'CONSULTATION', method, appointmentId: id });
```

Or `payments.initiate` (`payments.service.ts:115`) traite `method: 'WALLET'` **exactement comme une
méthode Mobile Money** : il appelle `createTransaction` (FedaPay) et crée un `Payment` en `PENDING`.
**Il ne touche pas au solde du portefeuille.** Le seul débit atomique du produit — `wallet.debit`,
avec sa garde de solde conditionnelle anti-TOCTOU — n'est atteignable que par
`POST /api/v1/wallet/pay`, qui **n'a aucun appelant côté web**.

**Conséquence.** Le portefeuille est un **entonnoir à sens unique** : `POST /wallet/topup` le
crédite, rien ne le débite jamais. L'utilisateur qui choisit « Wallet » croit payer avec son solde ;
en réalité une transaction FedaPay est initiée (ou un stub, sans clés) et le solde reste intact.
C'est la proposition de valeur « wallet diaspora » qui ne se referme pas.

**⚠️ Zone gelée §5.** `payments.initiate` est sur le chemin de paiement gelé. La correction exige une
**revue explicite + re-tests des webhooks** (HMAC valide/invalide, idempotence, crédit wallet,
réconciliation). **Ne pas patcher à la volée** — d'où son classement en lot dédié (§3, lot 8).

---

### D3 — 🔴 MAJEUR · Le pipeline éditorial « éducation » est bloqué à `MEDICAL_REVIEW`

**Constat.** `POST /api/v1/education/:id/medical-review` (réservé aux **médecins vérifiés**, ce qui
est correct au regard de §4 : l'admin n'a pas à valider un contenu médical) n'a **aucun appelant**.
Il n'existe **ni écran `/pro/education`**, ni entrée de navigation PRO, **ni notification** au
médecin qu'un contenu attend sa relecture.

Côté admin (`admin/education/page.tsx:124`), l'écran soumet bien `DRAFT → MEDICAL_REVIEW`, puis
affiche « ⏳ En attente de relecture » — **définitivement**. La transition
`MEDICAL_REVIEW → TRANSLATION` (`education.rules.ts:10`) n'est franchissable par personne.

**Conséquence.** **Aucun contenu de prévention ne peut être publié par le pipeline.** Les trois
contenus visibles en démo viennent du seed, déjà en `PUBLISHED`. Le CMS livré au lot H du
back-office est fonctionnellement inerte au-delà de la première étape.

---

### D4 — 🟠 MOYEN · Le médecin ne peut pas éditer son profil professionnel

`PATCH /api/v1/professionals/me` (`professionals.routes.ts:150`, `requireRole('MEDECIN')`) n'a aucun
appelant. `/pro/profile` ne rend que le composant générique `ProfileSettings` (nom, langue,
déconnexion) — rien de métier.

Ce qui est donc **figé à la valeur du seed / de la saisie KYC**, sans moyen de correction :

- `consultFee` — et c'est le montant **autoritatif serveur** du paiement d'une consultation
  (`payments.service.ts:134`, durcissement CSO v1.12). Un médecin ne peut pas changer son tarif.
- `spokenLangs` — utilisé par l'appariement linguistique et le filtre « parle ma langue » de
  l'annuaire patient (item #6). Une langue non déclarée ne peut pas être ajoutée.
- Spécialité, biographie, disponibilités.

---

### D5 — 🟠 MOYEN · `POST /appointments/:id/triage` orphelin

Endpoint `doctorOnly` de tri/priorisation d'une demande de rendez-vous : aucun appelant.
Combiné à D1 (agenda en lecture seule), le médecin ne dispose d'**aucune action** sur sa file de
rendez-vous en dehors du bouton « confirmer » du tableau de bord.

---

### D6 — 🟠 MOYEN · Une alerte SOS ne se clôt jamais

`model Sos` (`schema.prisma:602`) porte `status SosStatus @default(ACTIVE)` et `resolvedAt`.
Le module n'expose que deux endpoints, **tous deux patient** : créer une alerte, lister les siennes.
`status` et `resolvedAt` **ne sont écrits nulle part** après la création.

Conséquence : toute alerte reste `ACTIVE` indéfiniment. Ni le patient (« fausse alerte », « je vais
bien »), ni un opérateur ne peut la clore ; aucune console SOS n'existe côté PRO ou ADMIN.
Le SMS vers le contact d'urgence et le numéro public part bien (`sos.service.ts:69`) — c'est le
**suivi** de l'alerte qui manque, pas le déclenchement.

---

### D7 — 🟡 FAIBLE · Le module `translations` n'a aucun consommateur

`GET /translations/namespaces` et `POST /translations/validate` exposent la cartographie i18n et la
règle de double validation des namespaces critiques (§6). Aucun des deux n'est appelé, et le module
ne persiste rien : il renvoie des constantes partagées et le résultat d'une fonction pure.
La gouvernance i18n se fait en réalité **hors application** (`pnpm i18n:check` / `i18n:export`).

**Trancher** : soit brancher un écran `/admin` de suivi des traductions, soit supprimer le module
(2 endpoints, 1 fichier de règles + ses 4 tests). Ne pas laisser un troisième « module vitrine ».

---

### D8 — ✅ CORRIGÉ ICI · 🟡 `apps/api/.env.example` périmé — l'API refuse de démarrer

`apps/api/.env.example` (9 lignes) disait « voir le `.env.example` à la racine » **puis redéfinissait
quand même** sept variables, avec trois valeurs fausses :

- `JWT_SECRET="change-me-in-prod"` → **17 caractères**, alors que `env.ts` en exige **≥ 32** hors
  `test` (fail-safe v1.12) ;
- **`HEALTH_ENCRYPTION_KEY` totalement absente**, alors qu'elle est **obligatoire** hors `test` ;
- ports `5432`/`6379` au lieu des `5434`/`6380` du `docker-compose.dev.yml`.

Un développeur qui copiait ce fichier obtenait un `process.exit(1)` sur un message de validation zod
— sans rapport apparent avec le fichier qu'il venait de copier. C'était précisément l'état du `.env`
local de la machine de développement (l'API ne démarrait pas). `CLAUDE.md` affirmait
« `.env.example` fournit des placeholders DEV ≥ 32 » : vrai pour la racine, **faux** pour celui-ci.

**Correction appliquée** : le fichier est **supprimé**. Le `.env.example` de la racine (79 lignes,
commenté, valeurs correctes) est la source unique — c'est déjà ce que prescrivent `README.md:33` et
`SETUP_GIT.md:13` (`cp .env.example apps/api/.env`). Même famille que C7 : un piège d'onboarding, pas
un bug de code.

---

### D9 — ✅ CORRIGÉ ICI · 🟡 Compteurs de documentation

`49 → 48` modèles, `32 → 31` enums, `26 → 27` migrations après le lot 5 ; `README.md` était resté à
« 47 modèles / 160 endpoints / 63 pages » et `DEPLOIEMENT_Checklist.md` à « 289 tests / 63 pages ».
Synchronisés sur les valeurs mesurées de §1.1. Sur un projet à redevabilité bailleur
(NEXT IMPACT / Banque Mondiale), un chiffre cité dans un livrable doit être reproductible à la
commande près.

---

### D10 — 🟡 Dette i18n FON/YOR : 35 clés

`26 referrals.*` (lot 2) + `9 dmpdoc.*` (lot 3), **0 clé critique** (`sos.` / `labo.` / `payments.`).
Dette **assumée et documentée** (§6 : la traduction machine n'est jamais publiée telle quelle) ; les
clés sortent dans `docs/i18n/todo.{fon,yor}.csv` pour relecture par locuteurs natifs. Le repli FR est
automatique — l'utilisateur voit du français, jamais une clé brute.

---

## 3. Planification des corrections restantes

Les lots 1→5 de la revue précédente sont **tous livrés**. La suite reprend la numérotation.

| Lot | Contenu | Charge | Risque | Dépendances |
|---|---|---|---|---|
| **7** | **D1** — geste médecin de téléconsultation | ≈ 2 j | faible | aucune |
| **8** | **D2** — paiement wallet (**§5**) | ≈ 1,5 j | **élevé** | revue §5 + sandbox |
| **9** | **D3** — écran de relecture médicale | ≈ 1 j | faible | aucune |
| **10** | **D4 + D5 + D6** — actions métier manquantes | ≈ 2 j | faible | lot 7 (agenda) |
| **11** | **D7** — trancher `translations` | ≈ 0,5 j | nul | décision produit |
| **6** | Déploiement VPS Infomaniak | — | — | **indépendant** |

### Lot 7 — Fermeture de la téléconsultation (≈ 2 j) · *valeur métier la plus haute*

1. `/pro/agenda` : bouton **« Démarrer la téléconsultation »** sur un RDV `CONFIRMED` de type
   `TELECONSULTATION` → `POST /consultations { appointmentId }`, puis redirection vers la salle.
2. Écran médecin de la salle (réutiliser la logique de `patient/teleconsult`, thème indigo PRO) avec
   `join` / `downgrade` / **`end`**.
3. **Notification** au patient à l'ouverture de la salle, dans SA langue (le patient ne surveille pas
   son agenda en continu) — même motif que `referrals` au lot 2.
4. i18n FR/EN (`teleconsult.*` existe déjà en partie), FON/YOR en repli FR.
5. Tests : e2e Playwright du parcours médecin (création de salle → `consultationId` non nul côté
   patient) — c'est exactement le type de défaut que seul un e2e attrape.

**Réutilise** : `ProHeader`, `SkeletonCards`, `ConfirmDialog`, client `appointments`. **0 dépendance
nouvelle, 0 migration.**

### Lot 8 — Paiement par portefeuille (≈ 1,5 j) · **⚠️ zone gelée §5**

**Prérequis bloquant** : décision écrite du porteur + `/freeze` levé de façon encadrée, comme au
Lot E de la gestion des API.

Deux options, à arbitrer **avant** d'écrire la moindre ligne :

- **(a) — recommandée** : `payments.initiate` court-circuite FedaPay quand `method === 'WALLET'` et
  appelle `wallet.debit` dans la même transaction, créant un `Payment` directement `COMPLETED`.
  Un seul chemin de paiement, un seul état, réconciliation inchangée.
- **(b)** : l'interface appelle `POST /wallet/pay` au lieu de `POST /payments` pour cette méthode.
  Diff plus petit, mais le paiement d'une consultation n'existerait plus comme `Payment` → trou dans
  les finances admin et dans la réconciliation. **À écarter** sauf raison contraire.

**Re-tests obligatoires** (§5) : HMAC valide **et** invalide, idempotence sur événement rejoué, crédit
wallet sur `WALLET_TOPUP`, remboursement, cron de réconciliation. Tant que le lot n'est pas livré,
**retirer « Wallet 🇫🇷 » de la liste des moyens de paiement** est un correctif d'une ligne qui
supprime la promesse fausse — à faire immédiatement si le lot 8 est repoussé.

### Lot 9 — Relecture médicale des contenus (≈ 1 j)

Écran `/pro/education` : liste des `HealthContent` en `MEDICAL_REVIEW` → approuver / renvoyer en
brouillon (`POST /education/:id/medical-review { approve }`) + **notification au médecin** à la
soumission (sinon personne ne sait qu'il y a quelque chose à relire) + entrée de navigation PRO
gated sur médecin vérifié. i18n FR/EN.

### Lot 10 — Actions métier manquantes (≈ 2 j)

- **D4** : formulaire de profil professionnel (`PATCH /professionals/me`) — tarif, spécialité,
  langues parlées, bio, disponibilités. Contrôler que le tarif reste **imposé serveur** au paiement.
- **D5** : action de tri sur `/pro/agenda` (`POST /appointments/:id/triage`).
- **D6** : clôture d'une alerte SOS. Le minimum utile est **côté patient** (« je vais bien » →
  `RESOLVED` + `resolvedAt`) ; une console SOS ADMIN est une v2, à ne pas ouvrir ici — l'admin n'a
  pas à voir de contenu médical (§4), une alerte SOS géolocalisée en est à la frontière.

### Lot 11 — Trancher `translations` (≈ 0,5 j)

Décision produit, puis soit un écran `/admin/translations` (état de couverture + traçabilité de la
double validation), soit la suppression du module. **Recommandé** : suppression — l'outillage CLI
couvre déjà le besoin réel et un module non appelé est un piège pour le prochain contributeur.

### Ordonnancement conseillé

```
Lot 6 (VPS) ────────────────────── chemin critique, indépendant
Lot 7 (téléconsult) ──▶ Lot 10 (actions médecin)
Lot 9 (relecture) ─────┘
Lot 8 (wallet §5) ── conditionné à la décision porteur
Lot 11 (translations) ── conditionné à la décision produit
```

**Rien dans cette liste ne bloque la mise en production**, à une nuance près : **D2** fait apparaître
un moyen de paiement qui ne fait pas ce qu'il annonce. Si le lot 8 n'est pas livré avant les premiers
patients réels, retirer le bouton « Wallet » est **impératif**.

---

## 4. Points déjà tracés — ne pas recompter

Inchangés depuis `docs/REVUE_Ecarts_et_Plan_2026-08.md` §3 : validation clinique (triage OMS/PCIME,
PEV, phrasier), format CNOM sans API publique ONMB, relecture native FON/YOR, batch du fan-out des
campagnes, vetting géographique des ASC, refund FedaPay externe, stubs d'intégration sans clés,
`suggestGeneric` à 6 marques.

---

## 5. Conclusion

La codebase est **saine** : 337 tests verts, typage et lint propres, aucun modèle mort, aucun module
orphelin, zéro `TODO` en attente. Le lot 5 clôt la série C1→C9.

Les trois écarts majeurs (**D1** téléconsultation, **D2** wallet, **D3** relecture médicale) ont la
même forme que ceux de la revue de juillet : **le backend est là, l'écran ne l'est pas**. Ensemble,
ils représentent environ **4,5 jours** — dont 1,5 sur la zone gelée §5, qui demande un feu vert
explicite avant d'être touchée.

**D2 est le seul point qui mérite une décision immédiate** : ce n'est pas une fonctionnalité
manquante, c'est une promesse affichée à l'utilisateur que le code ne tient pas.
