# CLAUDE.md — DigiSanté Mobile

> Instructions persistantes pour Claude Code. Ce fichier est la source de vérité du projet :
> en cas de contradiction avec une consigne ponctuelle, **demander confirmation avant de dévier**.

---

## 1. Contexte projet

**DigiSanté Mobile** — Progressive Web App de e-santé pour le Bénin.
Programme **NEXT IMPACT** (FP2E / Sèmè City / Banque Mondiale) — convention `FP2E/NI/IDÉ/2025`, subvention 7 000 USD.
Porteur : **SEGLA E. Ulrich Gislain** (full-stack, 10+ ans). Collaboratrice : **Viviane EWEDJE** (junior dev).

**Mission** : répondre aux défis sanitaires béninois — infrastructure médicale limitée, dossiers perdus, connectivité rurale faible — par une plateforme **offline-first**, **multilingue** (FR, Fɔ̀ngbè, Yorùbá, Baatɔnum, Dendi), avec téléconsultation, DMP patient, ordonnances QR, SOS, et paiements Mobile Money + wallet diaspora.

**État** : codebase feature-complete — **105 endpoints** (dont 1 canal WebSocket temps réel) / **24 modules** + 5 intégrations, **45 pages frontend** (dont 19 espace patient), **35 modèles Prisma**, 28 enums, 11 migrations. Phase actuelle : **déploiement production VPS Infomaniak** + **extension de l'optimisation aux profils non-patient** (cf. feuille de route ci-dessous).

**Ajouts récents (juin 2026)** :
- *Plateforme* : inscription multi-rôles + création des profils de rôle à l'inscription ; déconnexion universelle ; module **Chat** patient↔médecin (chiffré au repos) **temps réel WebSocket** (fan-out Redis pub/sub, heartbeat) ; **consentement DMP par soignant** (`Consent`, réclamation par token, révocation persistante + **ré-octroi**) ; **scan caméra QR** (`BarcodeDetector` + repli **jsQR** iOS) ; **push FCM réel** (HTTP v1 serveur + token web) ; **paiements FedaPay réels** (init + réconciliation, §5 levé de façon encadrée) ; QR générés **localement** (offline/confidentialité) ; install **PWA** + toast de mise à jour ; i18n EN complet + outillage de parité (`pnpm i18n:check`).
- *Espace patient* : **fiche médicale d'urgence**, **auto-mesures** (constantes), **centre de notifications**, **conseils santé** (+ lecture vocale), **observance médicamenteuse** (prises, streak, % + **rappels horaires**), **gestion des RDV** (+ rappels), **annuaire enrichi** (filtre par langue parlée, fiche médecin, **avis & notes**), **couverture d'assurance santé** (catalogue ARCH/AMU, CNSS, mutuelles ; déclaration + statut, modèles `Insurance`/`PatientInsurance` activés).
- *Espace pharmacie* : **délivrance granulaire par ligne** (délivré / partiel / indisponible) en réutilisant l'API existante, **journal de dispensation** privacy-safe (modèle `Dispensation`, la pharmacie ne voit que ses propres délivrances).
- *Modèles ajoutés* : `Pharmacy`, `ChatThread`, `ChatMessage`, `Consent`, `MedicationIntake`, `MedicationReminder`, `DoctorReview`, `Insurance`/`PatientInsurance` (activés), `Dispensation`.

**Feuille de route — extension de l'optimisation aux profils non-patient** (même démarche que les 8 vagues patient : 1 vague = 1 gap #1 par profil, réutilisant modèles/endpoints existants, privacy by design §4) :
- ✅ **Vague 8 — Pharmacie** : délivrance granulaire + journal de dispensation (`Dispensation`). *(livré)*
- ✅ **Vague 9 — Laboratoire** : inbox des demandes (pool **anonymisé** → prise en charge → `PROCESSING` → résultat → notif patient) ; `submitResult` sécurisé (appartenance) ; `listOrders` gère LABORATOIRE. *(livré)*
- ⬜ **Vague 10 — Médecin** : **réception & interprétation des résultats de labo** (boucle prescrire→résultat ; `LabResult.interpretedById`/`interpretedAt` dormants) + historique des consultations.
- ⬜ **Vague 11 — Admin** : **file KYC enrichie** (affichage des pièces `KycDocument` + checklist de revue déjà acceptée par `/kyc/submissions/:id/review`) ; respecte le cloisonnement §4 (identité, pas de DMP).
- ⬜ **Vague 12 — Diaspora** : **gestion des bénéficiaires/proches** (nouveau modèle `Beneficiary`) — socle pour payer/abonner un proche. ⚠️ **hors zone gelée paiement §5** (écrans en lecture/au-dessus uniquement).

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

- **Consentement par soignant** : l'accès soignant au DMP passe par un **consentement nominatif** (modèle `Consent` : couple patient↔soignant, avec date d'expiration), réclamé à la présentation d'un token de partage puis valable sans token. **Révocation persistante** (un soignant révoqué ne peut pas re-réclamer via l'ancien token) ; le patient liste/révoque ses consentements. Accès refusé = journalisé (`DMP_DENIED`).
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

- **Langue** : UI et contenus en français (+ i18n 5 langues via clés `namespace.key`) ; code, commits et noms de variables en anglais ; commentaires en français acceptés.
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

- **openpyxl** : la validation par liste exige une correspondance de chaîne EXACTE — préserver les espaces insécables et typos des feuilles de référence ; recalcul des formules via script dédié après écriture.
- **docx-js** : page A4 à définir explicitement ; jamais de `\n` (Paragraphs séparés) ; jamais de puces unicode (numbering config) ; tables = `columnWidths` + `width` par cellule en DXA ; `ShadingType.CLEAR`.
- **Daily.co** : prévoir la bascule auto téléconsultation → chat (D-10) quand la bande passante chute.
- **Twilio Bénin** : sender ID alphanumérique non garanti chez tous les opérateurs — fallback numéro long.
- **FedaPay webhooks** : idempotence obligatoire (un même événement peut arriver plusieurs fois) ; vérifier HMAC avant tout traitement.
- **WebSocket (chat)** : auth par token JWT en **query** (`?token=`) — les navigateurs ne posent pas d'en-tête `Authorization` sur un WS. En cluster PM2 ×2, **fan-out obligatoire via Redis pub/sub** (un socket peut être sur l'autre worker). Nginx : relayer l'upgrade (`Upgrade`/`Connection`) + `proxy_read_timeout` long sur `/api/v1/chat/ws`. L'événement WS ne transporte que `{ threadId }` ; le contenu (chiffré) est re-fetché via REST.
- **Firebase FCM** : envoi serveur en **HTTP v1** sans `firebase-admin` (JWT compte de service signé via `node:crypto`, OAuth2 mis en cache). `FIREBASE_PRIVATE_KEY` contient des `\n` littéraux → reconvertir au démarrage. Sur token rejeté (`UNREGISTERED`/`INVALID_ARGUMENT`), purger `user.fcmToken`. Côté web : SDK `firebase` en import dynamique + SW `firebase-messaging-sw.js` (config publique passée en query), gated sur `NEXT_PUBLIC_FIREBASE_*`.
- **Scan QR** : via l'API native `BarcodeDetector` (Chrome/Android) avec **repli jsQR** (décodeur pur-JS, import dynamique) sur iOS Safari ; saisie manuelle en dernier recours. Les QR (ordonnances, partage DMP) sont **générés localement** (`qrcode`, import dynamique) — ne JAMAIS envoyer un jeton à un service QR tiers (confidentialité §4).
- **FedaPay réel** : `createTransaction` (POST /v1/transactions + /token) et `reconcile` (GET statut) sont branchés derrière `isFedapayConfigured` ; stub conservé sinon. La résolution de statut est **partagée** entre webhook et réconciliation (`applyPaymentStatus`). ⚠️ §5 : toute modif de cette logique = revue + **re-tests des webhooks** (HMAC valide/invalide, idempotence, crédit wallet).
- **Générateurs de rappels (cron)** : observance (`/reminders/generate`) et RDV (`/appointments/reminders/generate`) créent des Notifications PENDING **idempotentes par jour/RDV** (`MedicationReminder.lastGeneratedOn`, `Appointment.reminderSentAt`), envoyées par le dispatch. Protégés par `x-service-token`. Crontab : génération AVANT le dispatch.
- **Tests d'intégration** : Redis isolé par run (`vitest.global-setup.ts` FLUSHDB) sur une **base Redis dédiée** (`…/1`) ; lancer avec `REDIS_URL=…6380/1`. Sinon le test de verrouillage OTP flake (verrou résiduel 30 min).
- **Inscription** : `auth.register` DOIT créer l'enregistrement de rôle en transaction (Patient+Wallet / Doctor / Pharmacy / Lab / Wallet diaspora) — sinon DMP/SOS/wallet/RDV/KYC cassés pour le compte. ADMIN interdit à l'auto-inscription.
- **Consentement DMP** : la **révocation est persistante** (`Consent.revokedAt`) — ne pas la « ré-octroyer » silencieusement lors d'une nouvelle réclamation par token, sinon la révocation serait vaine tant que le token reste valide.
- **CNOM / Ordre des médecins (KYC)** : **aucune API publique de vérification n'existe** au Bénin (ONMB `ordremedecinsbenin.bj` = espace membre authentifié, pas d'annuaire/endpoint public — investigué juin 2026). La vérification soignant repose **par conception** sur l'heuristique de format (`kyc.cnom.ts`) **+ la revue manuelle des pièces** (workflow KYC) — ce n'est PAS un stub en attente d'API. Le format `BJ-XXX-#####` est une hypothèse à confirmer auprès de l'ONMB. ⚠️ L'ancien domaine `ordremedecinsbenin.org` est **compromis** (redirige vers un site tiers) : ne jamais le référencer.
- **Profils métier (pharmacie/labo/diaspora) ⇒ profil de rôle requis** : les routes qui résolvent l'entité du compte (`pharmacyIdOf` → `Pharmacy`, idem labo/diaspora) renvoient **403** si l'enregistrement de rôle n'existe pas. En prod il est créé à l'inscription (`auth.register`, cf. piège dédié) ; **dans les tests/fixtures, créer explicitement le profil** (`pharmacy: { create: … }`) sinon 403. Confidentialité §4 : un acteur métier ne voit **que ses propres** données (la pharmacie ne liste que **ses** délivrances `Dispensation` — pas de file globale des ordonnances de tous les patients). Même principe à appliquer aux vagues 9-12 (labo : ses commandes `LabOrder` via `labId` ; diaspora : ses bénéficiaires).

---

## 9. Références projet

| Document | Rôle |
|---|---|
| `CDC_DigiSante_Mobile_v1.0.docx` | Cahier des charges fonctionnel & technique |
| `DocTech_DigiSante_Mobile_v2.docx` | Doc technique complète (112 endpoints, scripts VPS) |
| `Specs_UI_DigiSante_v2.docx` | Spécifications UI « Wax & Terre » (annexe NEXT IMPACT) |
| Skill `digisante-design-system` | Référence d'intégration frontend |
| Prototypes `DigiSante_DesignV2_Lot1..4 + AdminDesktop_LotFinal.html` | Maquettes haute-fidélité opposables |

---

*Dernière mise à jour : 15 juin 2026 — v1.5 (vague 9 : laboratoire — inbox des demandes, pool anonymisé §4, prise en charge/transitions, `submitResult` sécurisé + notif patient ; cumul v1.4 : pharmacie — délivrance granulaire + journal `Dispensation` ; feuille de route profils vagues 10-12 en §1 ; v1.3 : assurance santé patient ; v1.2 : FedaPay réel encadré, observance + rappels, RDV, annuaire + avis, fiche d'urgence, auto-mesures, notifications, conseils + lecture vocale, QR local, PWA, isolation Redis des tests). Maintenir ce fichier à jour à chaque décision structurante (section 3) ou nouveau piège (section 8).*
