# Audit sécurité CSO — DigiSanté Mobile (juillet 2026)

**Périmètre** : OWASP Top 10 + STRIDE, ciblé sur auth/OTP/JWT/RBAC, paiements FedaPay (§5),
wallet, DMP/consentement, chiffrement, upload KYC (P1), chat WebSocket, plateforme/infra.
**Méthode** : 4 revues indépendantes du code (lecture intégrale des fichiers, preuves `fichier:ligne`),
puis consolidation par sévérité. Rien n'est rapporté sans preuve dans le code.

Ce document distingue **✅ corrigé dans le lot P4** (cette PR) de **⏸ différé** (décision requise —
zone gelée §5, changement produit, ou refonte non triviale).

---

## Synthèse

| # | Sévérité | Constat | Statut |
|---|---|---|---|
| C1 | ÉLEVÉ | Suspension utilisateur inopérante (refresh/OTP ne vérifient pas `SUSPENDED`) | ✅ Corrigé |
| C2 | ÉLEVÉ | Double-dépense wallet (débit non atomique, TOCTOU sous cluster) | ✅ Corrigé |
| C3 | ÉLEVÉ | JWT d'accès en query WS journalisé en clair (fuite de secret dans les logs) | ✅ Atténué (redaction) |
| C4 | ÉLEVÉ | `payments.initiate` : montant + `appointmentId` non contrôlés | ⏸ Différé (§5) |
| C5 | ÉLEVÉ | Portée du consentement DMP = dossier entier alors que le partage est par-entrée | ⏸ Différé (produit/§4) |
| C6 | ÉLEVÉ | Refresh token (30 j) en `localStorage` → vol de session sur XSS | ⏸ Différé (refonte cookie) |
| C7 | ÉLEVÉ | Durcissement prod conditionné à `NODE_ENV` (non fail-safe) | ⏸ Différé (risque CI) |
| M1 | MOYEN | Rate-limit en mémoire non partagé entre workers PM2 | ✅ Corrigé (store Redis) |
| M2 | MOYEN | Chaîne d'audit « forkable » sous concurrence (pas de verrou) | ✅ Corrigé (advisory lock) |
| M3 | MOYEN | Trigger d'immuabilité audit ne couvre pas `TRUNCATE` | ✅ Corrigé (trigger) |
| M4 | MOYEN | WebSocket chat : pas de restriction de rôle ni de fermeture à l'expiration | ✅ Corrigé |
| M5 | MOYEN | `genReqId` reflète `x-request-id` brut (injection de logs) | ✅ Corrigé (borné) |
| M6 | MOYEN | Aucune CSP / en-tête de sécurité sur l'app Next.js | ✅ Corrigé (headers + CSP) |
| M7 | MOYEN | `refresh()` reconduit le rôle du token sans relecture DB | ✅ Corrigé |
| F1 | FAIBLE | Algorithme JWT non épinglé | ✅ Corrigé (HS256) |
| F2 | FAIBLE | Rejeu de refresh non audité | ✅ Corrigé (audit) |
| F3 | FAIBLE | MIME KYC déclaratif (pas de magic bytes) ; PDF servi `inline` | ✅ Corrigé |
| F4 | FAIBLE | Jeton de service comparé sans temps constant | ⏸ Différé (local-only) |
| F5 | FAIBLE | Énumération de comptes (`requestOtp` 404 vs 200) | ⏸ Différé (UX) |
| F6 | FAIBLE | OTP `SHA-256(phone:code)` brute-forçable hors-ligne si Redis compromis | ⏸ Différé (HMAC) |
| F7 | FAIBLE | Médecin peut ouvrir un fil avec n'importe quel patient (pas de relation de soin) | ⏸ Différé (produit) |

---

## Corrigés dans ce lot (P4)

### C1 — Suspension utilisateur inopérante *(ÉLEVÉ)*
`verifyOtp` ne traitait que `PENDING_VERIFICATION` et `refresh` ne relisait pas la DB : un compte
`SUSPENDED` se reconnectait par OTP et **rafraîchissait des jetons pendant 30 j**. La suspension
était cosmétique.
**Correctif** (`auth.service.ts`) : `verifyOtp` refuse `SUSPENDED` (audité `AUTH_FAIL`) ; `refresh`
relit `status` **et** `role` en DB et refuse un compte suspendu. Un compte suspendu perd donc l'accès
au plus tard à l'expiration de son access token (15 min). Test de non-régression ajouté.
> Note : bloquer la fenêtre ≤ 15 min exigerait une vérification de statut par requête (coût DB) —
> délibérément non retenu ; le verrou au `refresh` est la barrière autoritaire.

### C2 — Double-dépense wallet *(ÉLEVÉ)*
`debit()` lisait le solde puis décrémentait sans condition : sous cluster PM2 ×2, deux débits
concurrents passaient tous deux le contrôle `lessThan` → solde négatif.
**Correctif** (`wallet.service.ts`) : décrément **atomique conditionné** (`updateMany where balance ≥ amount`)
dans la même transaction que l'écriture au registre ; `reference` en `randomUUID()` (au lieu de
`Date.now()` collisionnable). Test de concurrence ajouté (deux débits simultanés → un seul réussit,
solde jamais négatif). *Hors zone gelée §5 (module wallet, pas payments).*

### C3 — Fuite du JWT WS dans les logs *(ÉLEVÉ)*
Le handshake `/chat/ws?token=<JWT>` était journalisé (`req.url` + hook « requête lente ») en clair.
**Correctif** : sérialiseur de logs qui n'émet jamais les en-têtes et masque `token`/`access_token`
de l'URL (`lib/log-sanitize.ts`), appliqué au logger serveur et au hook `request-context`.
> La suppression totale du token en query (sous-protocole WS) reste recommandée (cf. C6/roadmap).

### M1 — Rate-limit partagé *(MOYEN)* · `server.ts`
Store Redis dédié passé à `@fastify/rate-limit` (comptage partagé entre workers ; désactivé en test).

### M2 — Chaîne d'audit sérialisée *(MOYEN)* · `lib/audit.ts`
`pg_advisory_xact_lock` dans la transaction d'écriture : empêche deux workers de lire le même
`prevHash` et de forker la chaîne d'intégrité.

### M3 — Immuabilité audit vs TRUNCATE *(MOYEN)* · migration `20260705120000_audit_truncate_guard`
Triggers `BEFORE TRUNCATE` ajoutés sur `audit_logs` et `admin_audit_logs` (les triggers
UPDATE/DELETE existants ne couvraient pas `TRUNCATE`).
> Recommandation d'exploitation complémentaire : faire tourner l'application sous un rôle DB
> **non-propriétaire** des tables d'audit (INSERT/SELECT seulement).

### M4 — WebSocket chat durci *(MOYEN)* · `chat.routes.ts`
Restriction aux rôles `PATIENT`/`MEDECIN` et fermeture du socket à l'échéance (`exp`) du token.

### M5 — `x-request-id` borné *(MOYEN)* · `server.ts`
Charset `[\w-]` + longueur ≤ 64 : anti-injection/pollution de logs.

### M6 — En-têtes de sécurité Next.js *(MOYEN)* · `next.config.mjs`
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`,
et une **CSP de base** autorisant explicitement les intégrations légitimes (Daily.co en `frame-src`,
`connect-src` large pour FCM/WebSocket). `script-src` conserve `'unsafe-inline'/'unsafe-eval'` requis
par Next (hydratation sans nonce) — à resserrer via nonces ultérieurement.

### M7 / F1 / F2 — Refresh & JWT *(MOYEN/FAIBLE)* · `auth.service.ts`, `server.ts`
Rôle relu en DB au refresh (M7, couvert par C1) ; algorithme JWT épinglé **HS256** en signature et
vérification (F1) ; rejeu d'un refresh déjà tourné audité `AUTH_FAIL` (F2).

### F3 — Upload KYC *(FAIBLE)* · `kyc.service.ts`, `kyc.routes.ts`
Vérification des **magic bytes** à l'upload (le contenu doit correspondre au MIME déclaré parmi
jpeg/png/webp/pdf) ; les PDF sont servis en `Content-Disposition: attachment` (jamais `inline`).

---

## Différés — décision requise

### C4 — `payments.initiate` : montant & `appointmentId` non contrôlés *(ÉLEVÉ — ZONE GELÉE §5)*
Le montant est choisi par le client (aucun rapprochement avec `Doctor.consultFee`) et `appointmentId`
n'est pas vérifié en appartenance : un patient peut « payer » 1 XOF, ou rattacher son paiement au RDV
d'un tiers. **Correctif interdit sans revue §5 explicite + re-tests des webhooks** (HMAC valide/invalide,
idempotence, crédit wallet). À planifier comme changement encadré du module `payments`.

### C5 — Portée du consentement DMP *(ÉLEVÉ — produit/§4)*
Partager **une** entrée (token/QR par `MedicalRecord`) crée un `Consent` couvrant **tout** le DMP :
le soignant peut alors lister/exporter l'intégralité du dossier. Atteinte à la minimisation
(RGPD / Loi 2017-20). **Choix requis** : (a) lier le `Consent` au `recordId` et filtrer
`listRecords`/`getRecord`/`export` sur les entrées consenties, ou (b) rendre explicite au patient que
le partage est global. Recommandation CSO : option (a).

### C6 — Refresh token en `localStorage` *(ÉLEVÉ — refonte)*
Le refresh (30 j) accessible au JS : une XSS exfiltre une session longue durée. **Correctif** : refresh
en cookie `HttpOnly; Secure; SameSite=Strict` (touche l'API auth + le client web) — refonte à cadrer.

### C7 — Durcissement prod non fail-safe *(ÉLEVÉ — risque CI)*
Les exigences prod (chiffrement santé, JWT ≥ 32) sont conditionnées à `NODE_ENV === 'production'`,
dont le défaut est `development`. Un `.env` VPS sans `NODE_ENV=production` démarrerait en mode lax.
Atténué par `ecosystem.config.cjs` (PM2 force `production`). **Correctif proposé** : exiger
`HEALTH_ENCRYPTION_KEY` inconditionnellement (hors test) — non appliqué ici car un changement du
défaut `NODE_ENV` risque de casser les étapes CI/scripts sans secrets prod ; à valider avec la CI.

### Autres différés
- **F4** jeton de service en `timingSafeEqual` (endpoints cron **local-only** 127.0.0.1 — impact faible).
- **F5** énumération de comptes sur `requestOtp` (404 vs 200) — corriger casse l'UX « aucun compte » ;
  décision produit.
- **F6** OTP en `HMAC(secret, phone:code)` plutôt que `SHA-256` (durcissement hors-ligne).
- **F7** exiger une relation de soin (RDV/consultation) avant l'ouverture d'un fil médecin→patient (produit).

---

## Bons points confirmés (défenses correctes)

- **Webhook FedaPay** : HMAC vérifié **avant** tout traitement, comparaison à temps constant,
  idempotence par statut terminal, logique partagée webhook/réconciliation (§5 respecté).
- **DMP** : garde de consentement pure et testée, cloisonnement ADMIN strict (jamais de médical),
  révocation **persistante** réelle, tout accès journalisé (`DMP_ACCESS`/`DMP_DENIED`), export audité.
- **Chiffrement** : AES-256-GCM, **IV aléatoire** par opération, **tag GCM vérifié**, clé imposée ≥ 32
  en prod, pas de clé en dur ; mode clair strictement dev.
- **KYC (P1)** : pièces chiffrées sur disque, id de stockage opaque (regex, anti-traversée), lecture
  réservée propriétaire/`kyc:review` non suspendu, `Cache-Control: no-store`, taille bornée.
- **RBAC admin** : scopes rechargés en DB par requête, admin suspendu refusé en bloc, anti-verrouillage,
  toutes les actions admin auditées ; aucun endpoint admin sans `requireScope`.
- **Service Worker** : n'intercepte que GET, **exclut `/api/`** du cache (aucune donnée santé en cache).
- **Front** : aucun `dangerouslySetInnerHTML`, `window.open` toujours en `noopener`.
- **Injection** : aucun `$queryRawUnsafe`/`$executeRawUnsafe` ; Prisma paramétré partout.
- **Endpoints cron internes** : `x-service-token` requis **et** refusés si le secret n'est pas configuré.
- **Secrets** : aucun secret réel dans `.env.example`, CI ou docker-compose (placeholders uniquement).

---

*Correctifs P4 validés : typecheck + lint verts, 179 tests API au vert (dont 2 non-régressions
ajoutées : suspension effective, débit wallet atomique concurrent). Différés C4–C7 + F4–F7 à
arbitrer (§5 / produit / CI).*
