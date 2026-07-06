# CLAUDE.md — DigiSanté Mobile

> Instructions persistantes pour Claude Code. Ce fichier est la source de vérité du projet :
> en cas de contradiction avec une consigne ponctuelle, **demander confirmation avant de dévier**.

---

## 1. Contexte projet

**DigiSanté Mobile** — Progressive Web App de e-santé pour le Bénin.
Programme **NEXT IMPACT** (FP2E / Sèmè City / Banque Mondiale) — convention `FP2E/NI/IDÉ/2025`, subvention 7 000 USD.
Porteur : **SEGLA E. Ulrich Gislain** (full-stack, 10+ ans). Collaboratrice : **Viviane EWEDJE** (junior dev).

**Mission** : répondre aux défis sanitaires béninois — infrastructure médicale limitée, dossiers perdus, connectivité rurale faible — par une plateforme **offline-first**, **multilingue** (FR, EN, Fɔ̀ngbè, Yorùbá — périmètre recentré juin 2026, cf. §8), avec téléconsultation, DMP patient, ordonnances QR, SOS, et paiements Mobile Money + wallet diaspora.

**État** : codebase feature-complete — **127 endpoints REST + 1 canal WebSocket** temps réel / **25 modules** + 5 intégrations, **53 pages frontend** (dont 19 espace patient), **37 modèles Prisma**, 28 enums, 20 migrations. **Tous les profils optimisés** (patient + médecin + pharmacie + laboratoire + diaspora + admin — vagues 1-12 livrées). Phase actuelle : **déploiement production VPS Infomaniak**.

**Ajouts récents (juin 2026)** :
- *Plateforme* : inscription multi-rôles + création des profils de rôle à l'inscription ; déconnexion universelle ; module **Chat** patient↔médecin (chiffré au repos) **temps réel WebSocket** (fan-out Redis pub/sub, heartbeat) ; **consentement DMP par soignant** (`Consent`, réclamation par token, révocation persistante + **ré-octroi**) ; **scan caméra QR** (`BarcodeDetector` + repli **jsQR** iOS) ; **push FCM réel** (HTTP v1 serveur + token web) ; **paiements FedaPay réels** (init + réconciliation, §5 levé de façon encadrée) ; QR générés **localement** (offline/confidentialité) ; install **PWA** + toast de mise à jour ; i18n EN complet + outillage de parité (`pnpm i18n:check`).
- *Espace patient* : **fiche médicale d'urgence**, **auto-mesures** (constantes), **centre de notifications**, **conseils santé** (+ lecture vocale), **observance médicamenteuse** (prises, streak, % + **rappels horaires**), **gestion des RDV** (+ rappels), **annuaire enrichi** (filtre par langue parlée, fiche médecin, **avis & notes**), **couverture d'assurance santé** (catalogue ARCH/AMU, CNSS, mutuelles ; déclaration + statut, modèles `Insurance`/`PatientInsurance` activés).
- *Espace pharmacie* : **délivrance granulaire par ligne** (délivré / partiel / indisponible) en réutilisant l'API existante, **journal de dispensation** privacy-safe (modèle `Dispensation`, la pharmacie ne voit que ses propres délivrances).
- *Espace diaspora* : **carnet de bénéficiaires** (modèle `Beneficiary`, CRUD isolé par propriétaire) remplaçant la liste « famille » codée en dur — au-dessus de la logique de paiement gelée (§5).
- *Modèles ajoutés* : `Pharmacy`, `ChatThread`, `ChatMessage`, `Consent`, `MedicationIntake`, `MedicationReminder`, `DoctorReview`, `Insurance`/`PatientInsurance` (activés), `Dispensation`, `Beneficiary`.

**Extension de l'optimisation aux profils non-patient — TERMINÉE** (même démarche que les 8 vagues patient : 1 vague = 1 gap #1 par profil, réutilisant modèles/endpoints existants, privacy by design §4) :
- ✅ **Vague 8 — Pharmacie** : délivrance granulaire + journal de dispensation (`Dispensation`).
- ✅ **Vague 9 — Laboratoire** : inbox des demandes (pool **anonymisé** → prise en charge → `PROCESSING` → résultat → notif patient) ; `submitResult` sécurisé (appartenance) ; `listOrders` gère LABORATOIRE.
- ✅ **Vague 10 — Médecin** : réception & interprétation des résultats de labo (boucle prescrire→résultat fermée ; `LabResult.interpretation`/`interpretedById`/`interpretedAt` ; réservé au prescripteur ; notif patient).
- ✅ **Vague 11 — Admin** : file KYC enrichie (détail des pièces `KycDocument` + checklist `verified` + aperçu CNOM ; `GET /kyc/submissions/:id`, `POST /kyc/documents/:id/verify`) ; cloisonnement §4 respecté (identité, pas de DMP).
- ✅ **Vague 12 — Diaspora** : gestion des bénéficiaires/proches (modèle `Beneficiary`, CRUD isolé par propriétaire). ⚠️ **hors zone gelée paiement §5** (au-dessus de FedaPay/wallet uniquement).

**Refonte design responsive, a11y & densité desktop — TERMINÉE (juin 2026)** (10 PR, frontend uniquement, 0 dépendance ajoutée ; §4/§5 intacts) :
- *PWA / mobile* : police des champs **≥ 16px** (anti-zoom iOS au focus) ; **icônes PNG** 192/512 + maskable + **apple-touch-icon** + métadonnées `appleWebApp` ; utilitaire **`.min-h-dvh-screen`** (100dvh + repli vh) remplaçant les `min-h-screen` imbriqués ; cadre auth/onboarding **centré** sur desktop (plus de zone vide).
- *A11y* : anneau de focus en **`ring-inset`** (le `clip-path` de `card-pagne` rognait l'anneau externe → WCAG 2.4.7) ; **polices en `rem`** partout (`text-[Npx]` → `text-[(N/16)rem]`, respect du réglage système de taille — public senior).
- *Layout desktop* : **2 largeurs canoniques** (lecture/formulaire `2xl` centré · pages-grilles `5xl`) portées par les en-têtes (`PatientHeader`/`SpaceHeader`/`ProHeader`, prop `wide`) ; le titre se recentre sur la colonne du contenu (fond plein-cadre conservé).
- *Espace ADMIN — densité desktop* : nouvelle coquille **`AdminShell`** (sidebar indigo nuit + bogolan/kenté, desktop ; **BottomNav mobile inchangée**) ; pages Utilisateurs/Dashboard/Audit/KYC/Éducation en **tables denses** + panneau détail + pagination réelle sur desktop, **cartes sur mobile** ; profil admin en 2 colonnes (`ProfileSettings columns`). Fidèle à la maquette opposable `AdminDesktop_LotFinal.html`. §4 respecté (aucun contenu médical).
- *Composants réutilisables* : **`ConfirmDialog`** (modal stylé, i18n, Échap/backdrop/focus) — **plus aucun `window.confirm()`** dans l'app ; **`Skeleton`/`SkeletonCards`** sur toutes les listes principales (réseaux lents 2G/rural ; `animate-pulse` neutralisé sous `prefers-reduced-motion`).

**Back-office administration fort — TERMINÉ (juin 2026)** (8 lots A→H, 0 dépendance ajoutée, faible-conso PWA, §4 respecté) :
- *RBAC & profilage admins* (Lot B) : modèle **`AdminProfile`** (`scopes[]` + `preset`), **14 scopes** (`admin:manage`, `users:read/write`, `kyc:review`, `ops:read`, `finance:read/write`, `support:write`, `otp:write`, `webhooks:read/replay`, `audit:read/export`, `education:write`) et **presets** (SUPER_ADMIN, OPERATIONS, FINANCE, SUPPORT, MODERATION, CONTENT) dans `@digisante/shared`. Middleware **`requireScope(...)`** (mémoïsé/requête, refuse un admin suspendu) ; un admin **sans profil = aucun droit** ; garde-fous anti-verrouillage (pas de retrait de son propre `admin:manage`, pas d'auto-suspension). UI de gestion des admins (`/admin/admins`). Nav `AdminShell` **gated par scope**.
- *Audit conformité* (Lot A) : KYC_SUBMIT/KYC_REVISION journalisés (en plus de KYC_APPROVE/REJECT déjà émis).
- *Gestion utilisateurs* (Lot C) : filtres serveur (recherche `q`, rôle, statut, langue) — pas de dump client.
- *Support / OTP* (Lot D) : console compte (`/admin/support`) — état du verrou OTP (Redis), **déverrouillage** (purge `otp:lock/attempts/send`, audit `OTP_RESET`, scope `otp:write`), activité d'auth, notes internes (`SupportNote`, `support:write`).
- *Finances (lecture seule)* (Lot E) : `/admin/finance` — volumes par statut/méthode (XOF), file de réconciliation, agrégats wallets ; **journal webhooks FedaPay dérivé de l'audit** (aucune écriture sur le chemin gelé §5). Scopes `finance:read` / `webhooks:read`.
- *Remboursement* (Lot F, §5 encadré) : cf. piège dédié §8.
- *Ops / monitoring* (Lot G) : `/admin/ops` — sondes Redis/DB tolérantes, uptime, file de notifications, jobs cron (réconciliation, rappels), événements sécurité/ops 24 h. Scope `ops:read`.
- *CMS éducation* (Lot H) : pipeline éditorial complet sur `/admin/education` (`GET /education/manage` tous statuts + filtre ; actions par état : soumettre→relecture médecin→**éditeur de traductions** multilingue→publier). Scope `education:write` ; la relecture médicale reste réservée aux **médecins vérifiés** (`MEDECIN`, pas l'admin).

**Durcissement sécurité — audit CSO (juillet 2026) — TERMINÉ** (11 correctifs hors zone gelée §5, 0 dépendance ajoutée ; rapport `docs/AUDIT_Securite_CSO_2026-07.md`) : suspension utilisateur **effective** (refus au verify OTP + relecture statut/rôle au refresh) ; **débit wallet atomique** (garde de solde conditionnelle, anti double-dépense TOCTOU en cluster) ; masquage du JWT en query WS dans les logs ; **rate-limit partagé** via store Redis (inter-workers) ; **verrou consultatif + trigger `BEFORE TRUNCATE`** sur l'audit (anti-fork / anti-purge) ; WebSocket chat restreint (rôles PATIENT/MEDECIN + fermeture à l'expiration du token) ; `x-request-id` borné, **algo JWT épinglé HS256**, rejeu de refresh audité ; **magic bytes** sur l'upload KYC + PDF servi en `attachment` ; **CSP + en-têtes de sécurité** côté Next.js. ✅ **Corrigés depuis** : montant de consultation **imposé serveur** + RDV vérifié (`payments.initiate`, §5 encadré, re-tests webhooks) ; **durcissement fail-safe `NODE_ENV`** (config requise ; `HEALTH_ENCRYPTION_KEY` + `JWT_SECRET` ≥ 32 imposés hors `test`). ✅ **Corrigés depuis (suite)** : portée du consentement DMP **restreinte par-entrée** (§4, `ConsentRecord` — un soignant ne lit/exporte que ses entrées consenties). ⏸ **Reste (décision requise)** : refresh token en cookie `HttpOnly`.

---

## 2. Stack canonique (ne pas proposer d'alternatives)

| Couche | Technologie |
|---|---|
| Frontend | **Next.js 14** (App Router) + Tailwind CSS — PWA, service worker |
| Backend | **Fastify** (Node.js) — clustering PM2 ×2 |
| ORM / DB | **Prisma** + **PostgreSQL 16 natif** |
| Cache / files | **Redis** (cache, OTP, allowlist refresh, **pub/sub temps réel chat**) |
| Temps réel | **WebSocket** (`@fastify/websocket`) — chat ; fan-out inter-workers via Redis pub/sub |
| Téléconsultation | **Daily.co** (WebRTC) |
| Paiements | **FedaPay** — MTN MoMo, Moov, Wave, cartes intl. (wallet diaspora) |
| Push | **Firebase FCM** |
| SMS / OTP / urgences | **Twilio** |
| Email transactionnel | **Resend** |
| Tests | Vitest (+ e2e type Playwright) |
| Infra | **VPS Infomaniak** Ubuntu 22.04 LTS — Nginx reverse proxy, Certbot SSL, PM2, GitHub Actions (deploy SSH), cron `pg_dump` chiffré nocturne |

---

## 3. Décisions architecturales VERROUILLÉES 🔒

Ces décisions sont définitives. Ne **jamais** les remettre en question, ne jamais générer de code qui les contourne :

1. **PostgreSQL 16 natif sur le VPS** — PAS de Supabase en production. PAS de base managée.
2. **VPS Infomaniak** — PAS de Railway, PAS de Vercel, PAS de déploiement serverless.
3. **Tout outillage IA** (ex. GBrain de GStack) utilise **sa propre base locale (PGLite)**, strictement séparée de la base de production DigiSanté. Aucun outil de dev ne se connecte à la DB prod.
4. **DOCX uniquement** pour les livrables documentaires (pas de conversion PDF), générés via la lib Node `docx` avec le workflow **build → validate** (et unpack → edit → pack pour les modifications).
5. La logique de paiement FedaPay validée est **gelée** (`/freeze` GStack) : toute modification exige une revue explicite + re-tests des webhooks (HMAC, retry ×5, DLQ, réconciliation cron 02:30).

---

## 4. Conformité & sécurité (RGPD / APDP — Loi n°2017-20)

À respecter dans **chaque** ligne de code générée :

- **Consentement par soignant** : l'accès soignant au DMP passe par un **consentement nominatif** (modèle `Consent` : couple patient↔soignant, avec date d'expiration), réclamé à la présentation d'un token de partage puis valable sans token. **Portée PAR-ENTRÉE** (minimisation) : le token ne consent QUE l'entrée partagée (`ConsentRecord`) — le soignant ne lit/exporte que ses entrées consenties, **jamais tout le dossier**. **Révocation persistante** (un soignant révoqué ne peut pas re-réclamer via l'ancien token) ; le patient liste/révoque ses consentements. Accès refusé = journalisé (`DMP_DENIED`).
- **Audit trail immuable** : table append-only (trigger anti UPDATE/DELETE), hash SHA-256 chaîné, rétention 5 ans. Tout événement sensible est journalisé : `DMP_ACCESS`, `DMP_DENIED`, `DMP_CONSENT_GRANT`, `DMP_CONSENT_REVOKE`, `KYC_*`, `PAYMENT_*`, `AUTH_FAIL`, `AUTH_LOCKOUT`, `DATA_EXPORT`, `LAB_CRITICAL`, `SOS_ALERT`, `USER_SUSPEND`.
- **Cloisonnement admin** : l'admin ne peut JAMAIS lire le contenu médical du DMP (chiffré, soignants consentis uniquement).
- **Portabilité** : export FHIR/PDF en libre-service patient.
- **Chiffrement** : données de santé chiffrées au repos (AES-256) et en transit (TLS) ; secrets dans `.env` jamais commités ; OTP verrouillage 30 min après 5 échecs.
- **SMS critiques** (SOS, rappels, labo) : toujours dans la langue du destinataire.
- Audits sécurité périodiques : rôle **CSO** GStack (OWASP Top 10 + STRIDE), priorité aux modules paiement, auth, DMP.

---

## 5. Design System — « Wax & Terre » v2

La skill **`digisante-design-system`** (installée dans `~/.claude/skills/`) est la référence UI obligatoire pour tout code frontend. Résumé des invariants :

- Fond app `creme #FAF6F0` ; motifs africains 100% CSS/SVG data-URI (zéro image bitmap) — copier depuis `references/patterns.css`, **jamais ré-encoder**.
- **Thèmes par espace, jamais mélangés** : Patient `sante-600` vert / Médecin PRO `indigo-600` / Diaspora-Pharma-Labo or `ocre-400` / Admin indigo nuit + actions `terre-500`.
- `card-pagne` (coin coupé 18px) sur cartes/boutons/avatars ; `kente-bar` ferme les headers sombres ; `nkyinkyim` remplace les `<hr>` ; 1 seule couture `.stitch` par groupe.
- Typo : **Bricolage Grotesque** (display) + **DM Sans** (corps). Jamais Sora (réservé ANaTT).
- Signature « fait main » : rotations ±1-3°, ombres dures — **ne pas nettoyer**.
- Pill langue `FR ▾` sur chaque écran ; langues parlées 🗣 sur chaque fiche personne ; audio Fɔ̀ngbè sur les contenus clés.
- Registre des écrans : D-01→D-26 + DT-1→DT-7 dans `references/screens.md` (respecter la continuité des parcours documentée).

---

## 6. Conventions de code

- **Langue** : UI et contenus en français (+ i18n 4 langues FR/EN/FON/YOR via clés `namespace.key`) ; code, commits et noms de variables en anglais ; commentaires en français acceptés.
- **Commits** : Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`…) ; une feature = une branche ; `main` = déployable.
- **API Fastify** : modules sous `src/modules/<domaine>/` (routes + schemas JSON + service) ; validation par schémas ; erreurs normalisées `{ code, message }` ; jamais de logique métier dans les routes.
- **Prisma** : toute évolution du schéma passe par `prisma migrate dev` (jamais de `db push` en prod) ; migrations revues avant merge.
- **i18n** : aucune chaîne en dur dans les composants ; clés critiques `sos.*`, `labo.*`, `payments.*` = double validation (cf. vue DT-3).
- **Tests** : Vitest pour services et helpers ; tout bugfix ajoute un test de non-régression ; webhooks FedaPay testés avec signatures HMAC valides ET invalides.
- **Secrets** : `.env.example` tenu à jour ; jamais de secret en clair dans le code, les tests ou les fixtures.

---

## 7. Workflows outillés

### Documents (DOCX)
```bash
# Génération : script Node + lib docx (installée en global)
export NODE_PATH=$(npm root -g)
node scripts/docs/<script>.js          # build
python <skill docx>/scripts/office/validate.py <fichier>.docx   # validate — obligatoire
```
Exigences NEXT IMPACT : page de garde conventionnée, marqueurs « Conforme audit » en pied de page, IFU sur les documents fiduciaires, structure PTF en quatre parties.

### GStack (skills globales, PAS des dépendances du repo)
- **GBrain** : mémoire projet sur **PGLite local** (`.gbrain/`, gitignoré) — jamais la DB prod.
- **CSO** : audits OWASP/STRIDE avant chaque release.
- **/freeze** : appliqué à `src/modules/payments/**` — modification = revue explicite.
- **/retro** : rétrospectives de sprint alignées sur le reporting NEXT IMPACT.

### Déploiement (VPS Infomaniak)
```
GitHub Actions (main) → SSH deploy → pnpm build → prisma migrate deploy → pm2 reload digisante
Nginx (reverse proxy + SSL Certbot) · Redis local · pg_dump chiffré cron 02:00 · réconciliation FedaPay cron 02:30
```
Les scripts shell complets sont dans la Documentation technique v2 (`DocTech_DigiSante_Mobile_v2.docx`).

---

## 8. Pièges connus (ne pas re-découvrir)

- **Langues (périmètre recentré, juin 2026)** : l'app cible **FR · EN · FON · YOR** (enum `Lang` + `LANGS` partagé). **Baatɔnum/Dendi retirés**, **Yorùbá ajouté**. Le retrait de valeurs d'enum PostgreSQL impose une **recréation du type `Lang`** (migration `..._lang_fr_en_fon_yor` : rename → create → bascule colonne `users.lang` en repliant BARIBA/DENDI sur FR → drop ancien type). FR = **source de vérité**, EN **complet** ; FON/YOR complétés par un **1er jet machine (NLLB-200 exécuté EN LOCAL — l'API serverless HF ne sert plus NLLB ; `pip install transformers torch sentencepiece`)** PUIS **relecture par locuteurs natifs** — la MT n'est JAMAIS publiée telle quelle, et `sos.*`/`labo.*`/`payments.*` exigent une **double validation** (§4/§6). Outillage : `pnpm i18n:check` (parité) / `i18n:export` (todo CSV) / `i18n:draft` (brouillons NLLB, dev-only : `translate-draft.mjs` + `nllb_translate.py`). **Aucune traduction au runtime** (offline-first, faible conso). Licence NLLB = **CC-BY-NC** (usage projet santé non lucratif assumé).
- **openpyxl** : la validation par liste exige une correspondance de chaîne EXACTE — préserver les espaces insécables et typos des feuilles de référence ; recalcul des formules via script dédié après écriture.
- **docx-js** : page A4 à définir explicitement ; jamais de `\n` (Paragraphs séparés) ; jamais de puces unicode (numbering config) ; tables = `columnWidths` + `width` par cellule en DXA ; `ShadingType.CLEAR`.
- **Daily.co** : prévoir la bascule auto téléconsultation → chat (D-10) quand la bande passante chute.
- **Twilio Bénin** : sender ID alphanumérique non garanti chez tous les opérateurs — fallback numéro long.
- **FedaPay webhooks** : idempotence obligatoire (un même événement peut arriver plusieurs fois) ; vérifier HMAC avant tout traitement.
- **WebSocket (chat)** : auth par token JWT en **query** (`?token=`) — les navigateurs ne posent pas d'en-tête `Authorization` sur un WS. En cluster PM2 ×2, **fan-out obligatoire via Redis pub/sub** (un socket peut être sur l'autre worker). Nginx : relayer l'upgrade (`Upgrade`/`Connection`) + `proxy_read_timeout` long sur `/api/v1/chat/ws`. L'événement WS ne transporte que `{ threadId }` ; le contenu (chiffré) est re-fetché via REST.
- **Firebase FCM** : envoi serveur en **HTTP v1** sans `firebase-admin` (JWT compte de service signé via `node:crypto`, OAuth2 mis en cache). `FIREBASE_PRIVATE_KEY` contient des `\n` littéraux → reconvertir au démarrage. Sur token rejeté (`UNREGISTERED`/`INVALID_ARGUMENT`), purger `user.fcmToken`. Côté web : SDK `firebase` en import dynamique + SW `firebase-messaging-sw.js` (config publique passée en query), gated sur `NEXT_PUBLIC_FIREBASE_*`.
- **Scan QR** : via l'API native `BarcodeDetector` (Chrome/Android) avec **repli jsQR** (décodeur pur-JS, import dynamique) sur iOS Safari ; saisie manuelle en dernier recours. Les QR (ordonnances, partage DMP) sont **générés localement** (`qrcode`, import dynamique) — ne JAMAIS envoyer un jeton à un service QR tiers (confidentialité §4).
- **FedaPay réel** : `createTransaction` (POST /v1/transactions + /token) et `reconcile` (GET statut) sont branchés derrière `isFedapayConfigured` ; stub conservé sinon. La résolution de statut est **partagée** entre webhook et réconciliation (`applyPaymentStatus`). ⚠️ §5 : toute modif de cette logique = revue + **re-tests des webhooks** (HMAC valide/invalide, idempotence, crédit wallet).
- **Remboursement (Lot F, §5 encadré)** : `payments.refund()` est un **reversal INTERNE** (aucun appel FedaPay externe — le retour d'argent côté opérateur reste une étape manuelle tracée). **Idempotent** (un paiement déjà `REFUNDED` n'est pas retraité ; seul un `COMPLETED` est remboursable), journalisé `PAYMENT_REFUND`. Pour un `WALLET_TOPUP`, le crédit est reversé via `wallet.refund()` (`WalletTransaction` type `REFUND`, décrément **sans garde de solde** → un solde négatif signale des fonds déjà dépensés et bloque les débits ultérieurs, c'est voulu). Déclencheurs : action admin `POST /admin/finance/payments/:id/refund` (scope `finance:write`) **et** l'annulation d'un RDV payé par le médecin (couture « Phase 4 » désormais branchée dans `appointments.cancel`). Un vrai refund FedaPay (mouvement externe) reste **hors périmètre** tant qu'un bac à sable (sandbox) FedaPay n'est pas en place.
- **Générateurs de rappels (cron)** : observance (`/reminders/generate`) et RDV (`/appointments/reminders/generate`) créent des Notifications PENDING **idempotentes par jour/RDV** (`MedicationReminder.lastGeneratedOn`, `Appointment.reminderSentAt`), envoyées par le dispatch. Protégés par `x-service-token`. Crontab : génération AVANT le dispatch.
- **Tests d'intégration** : Redis isolé par run (`vitest.global-setup.ts` FLUSHDB) sur une **base Redis dédiée** (`…/1`) ; lancer avec `REDIS_URL=…6380/1`. Sinon le test de verrouillage OTP flake (verrou résiduel 30 min).
- **Inscription** : `auth.register` DOIT créer l'enregistrement de rôle en transaction (Patient+Wallet / Doctor / Pharmacy / Lab / Wallet diaspora) — sinon DMP/SOS/wallet/RDV/KYC cassés pour le compte. ADMIN interdit à l'auto-inscription.
- **Consentement DMP** : la **révocation est persistante** (`Consent.revokedAt`) — ne pas la « ré-octroyer » silencieusement lors d'une nouvelle réclamation par token, sinon la révocation serait vaine tant que le token reste valide. **Portée par-entrée** (`ConsentRecord`, §4) : la réclamation d'un token scope le consentement à l'entrée partagée ; `resolveDmpScope` renvoie `'ALL'` (propriétaire) ou l'ensemble des `recordId` consentis, et `listRecords`/`getRecord`/`export` filtrent dessus. Les `ConsentRecord` **persistent** à travers révocation→ré-octroi (la révocation bloque via `Consent.revokedAt`, le ré-octroi restaure la même portée). Un `Consent` sans `ConsentRecord` (ancien schéma) n'accorde plus aucun accès — re-partager.
- **CNOM / Ordre des médecins (KYC)** : **aucune API publique de vérification n'existe** au Bénin (ONMB `ordremedecinsbenin.bj` = espace membre authentifié, pas d'annuaire/endpoint public — investigué juin 2026). La vérification soignant repose **par conception** sur l'heuristique de format (`kyc.cnom.ts`) **+ la revue manuelle des pièces** (workflow KYC) — ce n'est PAS un stub en attente d'API. Le format `BJ-XXX-#####` est une hypothèse à confirmer auprès de l'ONMB. ⚠️ L'ancien domaine `ordremedecinsbenin.org` est **compromis** (redirige vers un site tiers) : ne jamais le référencer.
- **Profils métier (pharmacie/labo/diaspora) ⇒ profil de rôle requis** : les routes qui résolvent l'entité du compte (`pharmacyIdOf` → `Pharmacy`, idem labo/diaspora) renvoient **403** si l'enregistrement de rôle n'existe pas. En prod il est créé à l'inscription (`auth.register`, cf. piège dédié) ; **dans les tests/fixtures, créer explicitement le profil** (`pharmacy: { create: … }`) sinon 403. Confidentialité §4 : un acteur métier ne voit **que ses propres** données (la pharmacie ne liste que **ses** délivrances `Dispensation` — pas de file globale des ordonnances de tous les patients). Même principe à appliquer aux vagues 9-12 (labo : ses commandes `LabOrder` via `labId` ; diaspora : ses bénéficiaires).
- **Frontend / UI responsive (refonte juin 2026)** : ① le `clip-path` de `card-pagne` **rogne** l'anneau de focus externe → toujours `focus-visible:ring-inset` sur les éléments `card-pagne`. ② Police des `<input>` **≥ 16px** sinon zoom iOS au focus (règle globale `globals.css` ; ne pas remettre `text-[<16px]` sur un champ). ③ Tailles de police en **`rem`**, pas `px` (`text-[(N/16)rem]`) — accessibilité. ④ Pleine hauteur via **`.min-h-dvh-screen`** (jamais de `min-h-screen` imbriqué). ⑤ Largeur desktop : **2xl** (lecture) / **5xl** (grilles, en-tête `wide`) — pas de page non contrainte qui s'étire sur tout le `5xl`. ⑥ Admin = coquille **`AdminShell`** (PAS `AppShell`) : sidebar desktop + tables denses, cartes mobile ; ne JAMAIS exposer de contenu médical (§4). ⑦ Confirmations via **`ConfirmDialog`** (jamais `window.confirm`) ; listes en chargement via **`SkeletonCards`** (jamais `<Loading>` pour une liste).
- **Sécurité — suspension = barrière au refresh, pas au token en cours** : `verifyOtp` **et** `refresh` refusent un compte `SUSPENDED` (le refresh relit statut/rôle en DB → à jour). L'access token en cours reste valide ≤ 15 min (pas de vérification par requête, choix de perf assumé) — ne pas compter sur la suspension pour couper l'accès instantanément.
- **Débit wallet atomique** : `wallet.debit` fait un `updateMany({ where:{ id, balance:{ gte: amount } } })` conditionnel **dans la transaction** — ne JAMAIS revenir à `findUnique` + `update` non gardé (double-dépense TOCTOU sous PM2 ×2). Le `refund` reste volontairement **sans garde** de solde (solde négatif voulu, cf. §5 encadré).
- **Audit immuable = 3 triggers + verrou** : anti UPDATE/DELETE **et** `BEFORE TRUNCATE` (migration `..._audit_truncate_guard`) ; `writeAudit` prend un `pg_advisory_xact_lock` pour sérialiser les écritures entre workers (sinon fork de la chaîne de hash). En prod, faire tourner l'app sous un rôle DB **non-propriétaire** des tables d'audit.
- **Rate-limit** : store **Redis** passé à `@fastify/rate-limit` (comptage partagé entre workers ; désactivé en `NODE_ENV=test`). Un compteur en mémoire double la limite effective en cluster.
- **Config fail-safe (`env.ts`)** : `NODE_ENV` est **requis** (aucun repli silencieux vers `development`) ; **hors `test`**, `HEALTH_ENCRYPTION_KEY` et `JWT_SECRET` **≥ 32** sont **obligatoires** → un déploiement resté par erreur en `development` ne peut PAS tourner en clair. Seul `NODE_ENV=test` reste permissif (CI). `.env.example` fournit des placeholders **DEV** ≥ 32 (à remplacer par des secrets aléatoires en prod). Schéma exporté (`envSchema`) et couvert par `env.test.ts`.
- **JWT & logs** : algo **épinglé HS256** (sign + verify) ; refresh rejoué (jti hors allowlist) → audité `AUTH_FAIL`. Le JWT du WS chat passe en query (`?token=`) — un sérialiseur `req` (`lib/log-sanitize.ts`) masque `token`/`access_token` de l'URL et n'émet jamais les en-têtes ; ne jamais logguer `request.url` brut sur `/chat/ws` (Nginx idem).
- **Upload KYC** : vérification des **magic bytes** (le contenu doit correspondre au MIME déclaré jpeg/png/webp/pdf) ; les PDF sont servis en `Content-Disposition: attachment` (jamais `inline`).
- **Frontend / CSP** : `next.config.mjs` pose une CSP + en-têtes de sécurité ; `frame-src` autorise **Daily.co** (téléconsult), `connect-src` large pour FCM/WebSocket ; `script-src` conserve `'unsafe-inline'/'unsafe-eval'` requis par Next (pas de nonce). Ne pas resserrer sans tester Daily/FCM.

---

## 9. Références projet

| Document | Rôle |
|---|---|
| `CDC_DigiSante_Mobile_v1.0.docx` | Cahier des charges fonctionnel & technique |
| `DocTech_DigiSante_Mobile_v2.docx` | Doc technique complète (API, scripts VPS) — ⚠️ compteurs à régénérer (127 endpoints / 36 modèles réels) |
| `Specs_UI_DigiSante_v2.docx` | Spécifications UI « Wax & Terre » (annexe NEXT IMPACT) |
| Skill `digisante-design-system` | Référence d'intégration frontend |
| Prototypes `DigiSante_DesignV2_Lot1..4 + AdminDesktop_LotFinal.html` | Maquettes haute-fidélité opposables |

---

*Dernière mise à jour : 6 juillet 2026 — v1.13 (**consentement DMP par-entrée §4** : la réclamation d'un token de partage ne consent QUE l'entrée partagée (`ConsentRecord`) — `resolveDmpScope` renvoie `'ALL'` (propriétaire) ou les seuls `recordId` consentis ; `listRecords`/`getRecord`/`export` filtrent dessus → un soignant ne lit/exporte jamais tout le dossier. Migration `..._dmp_consent_per_record` (+1 modèle = 37, 20 migrations) ; test de minimisation ajouté. Reste différé : refresh en cookie `HttpOnly`. Cf. §4 et pièges §8). Cumul v1.12 (**findings CSO différés — 2 fermés** : `payments.initiate` montant de consultation **imposé serveur** + RDV vérifié/appartenance (§5 encadré, re-tests webhooks HMAC/idempotence/crédit wallet verts) ; **fail-safe `NODE_ENV`** (config requise, chiffrement santé + JWT ≥ 32 imposés hors `test`, `.env.example` placeholders DEV). Restent différés : consentement DMP par-entrée §4, refresh en cookie `HttpOnly`. Cf. §1 et pièges §8). Cumul v1.11 (**durcissement sécurité — audit CSO TERMINÉ** : 11 correctifs hors zone gelée §5 — suspension effective, débit wallet atomique, audit anti-`TRUNCATE` + advisory lock, rate-limit Redis partagé, JWT HS256 épinglé, redaction du token WS dans les logs, WS chat durci, magic bytes KYC, CSP/en-têtes Next.js ; différés : `payments.initiate` §5, portée consentement DMP, cookie `HttpOnly`, fail-safe `NODE_ENV` ; rapport `docs/AUDIT_Securite_CSO_2026-07.md`. **Synchronisation documentation** : compteurs corrigés dans CLAUDE.md/README/PLAYBOOK/SETUP_GIT/schema.prisma — **127 endpoints REST + 1 WS**, **53 pages**, **36 modèles**, **19 migrations**, périmètre **4 langues FR/EN/FON/YOR** ; ⚠️ les 3 `.docx` opposables et les maquettes HTML « Lot » restent à régénérer par le workflow docx. Cf. §1 et pièges §8). Cumul v1.10 (**back-office administration fort TERMINÉ** : 8 lots A→H — RBAC `AdminProfile`/scopes/presets + `requireScope`, audit conformité, filtres users serveur, console support/OTP, finances + journal webhooks en lecture, **remboursement reversal interne §5 encadré**, ops/monitoring, CMS éducation pipeline complet ; 0 dépendance, §4 respecté, §5 intact hors refund encadré ; cf. §1 et pièges §8). Cumul v1.9 (**refonte design responsive, a11y & densité desktop TERMINÉE** : 10 PR frontend — anti-zoom iOS, focus `ring-inset`, icônes PWA + apple-touch, `min-h-dvh-screen`, recentrage desktop 2 largeurs, espace ADMIN en densité desktop via `AdminShell` + tables, polices `rem`, `ConfirmDialog`, skeletons ; cf. §1 et pièges §8 ; 0 dépendance ajoutée, §4/§5 intacts). Cumul v1.8 : vague 12 diaspora — carnet de bénéficiaires `Beneficiary` ; **extension à tous les profils non-patient**, vagues 8-12 ; v1.3 : assurance santé patient ; v1.2 : FedaPay réel encadré, observance + rappels, RDV, annuaire + avis, fiche d'urgence, auto-mesures, notifications, conseils + lecture vocale, QR local, PWA, isolation Redis des tests ; vagues 1-7 : optimisation patient. Maintenir ce fichier à jour à chaque décision structurante (section 3) ou nouveau piège (section 8).*
