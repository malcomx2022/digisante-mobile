# CLAUDE.md — DigiSanté Mobile

> Instructions persistantes pour Claude Code. Ce fichier est la source de vérité du projet :
> en cas de contradiction avec une consigne ponctuelle, **demander confirmation avant de dévier**.

---

## 1. Contexte projet

**DigiSanté Mobile** — Progressive Web App de e-santé pour le Bénin.
Programme **NEXT IMPACT** (FP2E / Sèmè City / Banque Mondiale) — convention `FP2E/NI/IDÉ/2025`, subvention 7 000 USD.
Porteur : **SEGLA E. Ulrich Gislain** (full-stack, 10+ ans). Collaboratrice : **Viviane EWEDJE** (junior dev).

**Mission** : répondre aux défis sanitaires béninois — infrastructure médicale limitée, dossiers perdus, connectivité rurale faible — par une plateforme **offline-first**, **multilingue** (FR, Fɔ̀ngbè, Yorùbá, Baatɔnum, Dendi), avec téléconsultation, DMP patient, ordonnances QR, SOS, et paiements Mobile Money + wallet diaspora.

**État** : codebase feature-complete — ~195 fichiers TS/TSX, **84 endpoints** (dont 1 canal WebSocket temps réel) / **22 modules** + 4 intégrations, **35 pages frontend**, **31 modèles Prisma**, 28 enums. Phase actuelle : **déploiement production VPS Infomaniak**.

**Ajouts récents (juin 2026)** : inscription multi-rôles + création des profils de rôle à l'inscription (patient/médecin/pharmacie/labo/diaspora) ; déconnexion universelle ; module **Chat** patient↔médecin (corps chiffré au repos) **temps réel par WebSocket** (fan-out Redis pub/sub) ; **consentement DMP par soignant** (modèle `Consent`, réclamation via token de partage, révocation persistante) ; **scan caméra du QR** (partage DMP + ordonnances, via `BarcodeDetector`) ; **push FCM réel** (serveur HTTP v1 + token web navigateur).

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
- **Scan QR** : via l'API native `BarcodeDetector` (Chrome/Android — audience principale). **Absente sur iOS Safari** → repli sur la saisie manuelle (toujours prévoir le champ texte de secours).
- **Inscription** : `auth.register` DOIT créer l'enregistrement de rôle en transaction (Patient+Wallet / Doctor / Pharmacy / Lab / Wallet diaspora) — sinon DMP/SOS/wallet/RDV/KYC cassés pour le compte. ADMIN interdit à l'auto-inscription.
- **Consentement DMP** : la **révocation est persistante** (`Consent.revokedAt`) — ne pas la « ré-octroyer » silencieusement lors d'une nouvelle réclamation par token, sinon la révocation serait vaine tant que le token reste valide.

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

*Dernière mise à jour : 14 juin 2026 — v1.1 (chat temps réel, FCM réel, consentement DMP par soignant, scan QR, inscription multi-rôles). Maintenir ce fichier à jour à chaque décision structurante (section 3) ou nouveau piège (section 8).*
