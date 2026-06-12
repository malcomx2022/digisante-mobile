# Audit de sécurité — DigiSanté Mobile (OWASP Top 10 + STRIDE)

> Revue de l'API (`apps/api`) et du frontend (`apps/web`). Périmètre prioritaire : auth, RBAC,
> consentement DMP, webhooks signés, injection, secrets, en-têtes HTTP, rate-limit (cf. P7.2).
> ⚠️ La logique de paiement (`modules/payments`, `modules/wallet`, `services/fedapay`) est **gelée**
> (CLAUDE.md §5) : les constats la concernant sont listés comme *recommandations à revue explicite*,
> non modifiés ici.

## Synthèse par criticité

| # | Constat | Criticité | État |
|---|---|---|---|
| 1 | Pas de limite d'envoi d'OTP (bombing SMS / abus de coût Twilio) | **Bloquant** | ✅ **Corrigé** |
| 2 | Comparaison du jeton de service (`/reconcile`, `/dispatch`) non constante | Moyen | ⚠️ Recommandation (reconcile = fichier gelé) |
| 3 | `JWT_SECRET` minimum 8 caractères (faible) | Moyen | ⚠️ Recommandation (durcir en prod) |
| 4 | CSP/headers : helmet par défaut (API JSON) | Faible | ✅ Acceptable |
| 5 | `devCode` OTP exposé hors production | Faible | ✅ Maîtrisé (gated `NODE_ENV`) |

## OWASP Top 10 — revue

- **A01 Broken Access Control** : RBAC (`requireRole`) sur chaque route sensible ; consentement DMP
  (`assertDmpAccess`) avec **cloisonnement admin** (jamais de contenu médical) ; vérif de participation
  (RDV, ordonnances, consultations) ; IDOR couverts. ✅
- **A02 Cryptographic Failures** : santé chiffrée au repos AES-256-GCM (`lib/crypto`) ; OTP **haché**
  en Redis ; mots de passe non utilisés (auth par OTP) ; TLS géré par Nginx (prod). ✅
- **A03 Injection** : Prisma (requêtes paramétrées) ; validation **zod** systématique (`zParse`) ;
  pas de SQL brut sauf migration contrôlée. ✅
- **A04 Insecure Design** : audit immuable (trigger anti UPDATE/DELETE + hash SHA-256 chaîné) ;
  idempotence webhooks ; verrouillage 30 min après 5 échecs OTP. ✅
- **A05 Security Misconfiguration** : helmet, CORS restreint (`CORS_ORIGIN`), rate-limit global
  (100/min). Voir constat #1 (rate-limit auth) — corrigé. ✅
- **A06 Vulnerable Components** : lockfile gelé (`--frozen-lockfile`), CI à jour ; suivi des
  dépréciations (rappel migration actions Node 24 programmé). ✅
- **A07 Identification & Auth Failures** : OTP TTL 5 min, lockout, refresh en allowlist Redis avec
  **rotation** ; refresh refusé sur routes protégées. ✅ (+ constat #1, #3)
- **A08 Software & Data Integrity** : webhooks FedaPay **HMAC vérifié AVANT traitement** ;
  signature numérique des ordonnances (sceau N° d'Ordre). ✅
- **A09 Logging & Monitoring** : audit append-only des événements sensibles (`AUTH_FAIL`,
  `DMP_ACCESS/DENIED`, `KYC_*`, `PAYMENT_*`, `LAB_CRITICAL`…) avec IP + hash chaîné. ✅
- **A10 SSRF** : pas d'appel sortant piloté par l'utilisateur (intégrations tierces à URL fixes). ✅

## STRIDE — revue

- **Spoofing** : JWT signé + OTP ; webhooks par HMAC. ✅
- **Tampering** : audit immuable (trigger) ; intégrité GCM des données chiffrées ; HMAC corps webhook. ✅
- **Repudiation** : audit chaîné horodaté + IP, rétention 5 ans. ✅
- **Information Disclosure** : erreurs 500 sans détail (`mapError`) ; admin cloisonné du DMP ;
  données santé chiffrées. ✅
- **Denial of Service** : rate-limit global + **anti-abus OTP (corrigé)** ; PM2 cluster. ⚠️ DLQ/retry
  webhooks (Bull) = TODO production.
- **Elevation of Privilege** : RBAC strict, refresh non utilisable comme access. ✅

## Correctif appliqué (#1 — bloquant)

`modules/auth/auth.service.ts` : **quota d'envoi d'OTP** par numéro (`OTP_SEND_MAX = 5` par fenêtre
de 15 min, compteur Redis), appliqué dans `generateAndSendOtp` (couvre `register` et `otp/request`).
Au-delà → `429 TOO_MANY_REQUESTS`. Empêche le bombing SMS et l'abus de coût Twilio.

## Recommandations (non bloquantes)

- **#2** Comparer les jetons de service en temps constant (`timingSafeEqual`). Pour `/payments/reconcile`,
  passe par une **revue explicite** (fichier de paiement gelé, §5) ; pour `/notifications/dispatch`,
  applicable directement à une prochaine itération.
- **#3** En production, exiger un `JWT_SECRET` ≥ 32 caractères (clé aléatoire) — à valider au boot prod.
- **#2bis** Envisager un rate-limit dédié plus strict sur `/auth/*` au niveau Nginx (déjà prévu :
  `limit_req_zone ... zone=auth ... rate=10r/m` dans la conf de déploiement).

*Audit réalisé dans le cadre du rôle CSO (GStack) — à reconduire avant chaque release (CLAUDE.md §4).*
