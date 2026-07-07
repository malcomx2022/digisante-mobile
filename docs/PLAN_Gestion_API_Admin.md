# Plan — Gestion des API externes depuis l'administration (super admin)

> Objectif : permettre à un **super administrateur** d'ajouter/roter les **clés des API
> tierces** et de **gérer les webhooks** depuis le back-office, sans éditer le `.env`.
> Statut : **PLANIFIÉ** (à exécuter par lots après validation). Contraintes §3/§4/§5 ci-dessous.

---

## 0. Décisions & invariants de sécurité (VERROUILLÉS)

1. **Frontière des secrets — CRITIQUE.**
   - **Secrets d'INFRASTRUCTURE** — restent en `.env` **UNIQUEMENT**, jamais en base :
     `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `HEALTH_ENCRYPTION_KEY`, `RECONCILE_TOKEN`.
     Raison : ils sont nécessaires **au démarrage** et pour **déchiffrer** les secrets stockés
     en base → les mettre en base créerait une **dépendance circulaire** (on ne pourrait pas
     démarrer / déchiffrer) et un point de compromission unique.
   - **Secrets d'INTÉGRATION** — gérables via l'admin, **chiffrés au repos** :
     FedaPay, Twilio, Daily.co, Firebase FCM, Resend.
2. **Chiffrement au repos** (AES-256-GCM via `lib/crypto.ts`, clé = `HEALTH_ENCRYPTION_KEY`).
   Les secrets ne sont **JAMAIS** : renvoyés en clair au client, loggés, ni écrits dans l'audit.
   L'UI n'affiche qu'un **statut masqué** (`configuré`, 4 derniers caractères, date de MAJ).
3. **RBAC** : nouveau scope `integrations:write` (+ `integrations:read` pour la vue masquée),
   réservé au preset **SUPER_ADMIN** uniquement. Toute modification est **auditée**
   (`INTEGRATION_UPDATE` / `INTEGRATION_TEST` / `WEBHOOK_SECRET_ROTATE`) — sans la valeur.
4. **`.env` = fallback / bootstrap.** Tant qu'aucune config n'existe en base pour un provider,
   le service lit le `.env` (migration douce, aucun big-bang, rétro-compatible).
5. **FedaPay = zone gelée §5.** Basculer la résolution des clés FedaPay (et du secret webhook)
   vers ce mécanisme est une **modification du chemin de paiement** → **revue explicite +
   re-tests des webhooks** (HMAC valide/invalide, idempotence, crédit wallet). ⇒ **dernier lot, isolé.**
6. **§3 respecté** : PostgreSQL 16 natif (pas de secret manager externe), VPS Infomaniak.

---

## 1. Architecture cible

```
Admin (SUPER_ADMIN)                Service métier (twilio/daily/…)
      │  PUT /admin/integrations/:provider     │  getIntegration(app, 'TWILIO')
      ▼                                         ▼
 ┌─────────────────────┐  chiffre    ┌────────────────────────────┐
 │  IntegrationConfig   │◀───────────│  Resolver lib/integrations  │
 │  (Postgres, chiffré) │  déchiffre │  cache Redis + fallback .env│
 └─────────────────────┘─────────────▶└────────────────────────────┘
```

### Modèle Prisma (nouveau) — `IntegrationConfig`
| Champ | Type | Note |
|---|---|---|
| `provider` | enum `IntegrationProvider` (FEDAPAY, TWILIO, DAILY, FIREBASE, RESEND) | `@unique` |
| `enabled` | Boolean | active/désactive sans effacer les clés |
| `secretsEnc` | String | **blob chiffré** AES-256-GCM d'un JSON `{ clé: valeur }` (jamais en clair) |
| `meta` | Json? | non-secret : `webhookUrl`, numéro émetteur, domaine… (affichable) |
| `lastTestAt` / `lastTestOk` | DateTime?/Bool? | dernier test de connectivité |
| `updatedById` | String | admin auteur (audit) |
| `updatedAt` | DateTime | |

> +1 modèle, +1 enum, +1 migration `..._integration_config`.

### Resolver — `lib/integrations.ts`
- `getIntegration(app, provider) → { enabled, secrets, meta } | null` : lit la base, **déchiffre**,
  **met en cache Redis** (TTL court + **invalidation à l'update**), **repli `.env`** si pas de ligne.
- `isConfigured(app, provider) → boolean` (remplace les `isXxxConfigured` statiques, version dynamique).
- Les services (`services/*.ts`) consomment le resolver au lieu de lire `env.XXX` directement.

---

## 2. API back-office (`/api/v1/admin/integrations`)

| Méthode & route | Scope | Rôle |
|---|---|---|
| `GET /admin/integrations` | `integrations:read` | Liste **masquée** (provider, `configured`, 4 derniers car., `enabled`, `updatedAt`, `meta`, dernier test) |
| `PUT /admin/integrations/:provider` | `integrations:write` | Enregistre/**rote** les clés (write-only) ; audit `INTEGRATION_UPDATE` |
| `PATCH /admin/integrations/:provider` | `integrations:write` | Active/désactive (`enabled`) |
| `POST /admin/integrations/:provider/test` | `integrations:write` | Test de connectivité (n'expose jamais le secret) ; audit `INTEGRATION_TEST` |
| `GET /admin/integrations/:provider/webhooks` | `webhooks:read` | Journal des événements webhook (déjà dérivé de l'audit — Lot E finance) |
| `POST /admin/integrations/:provider/webhooks/rotate-secret` | `integrations:write` | Rotation du secret webhook ; audit `WEBHOOK_SECRET_ROTATE` |
| `POST /admin/integrations/:provider/webhooks/:id/replay` | `webhooks:replay` | Rejeu d'un événement (existant, étendu) |

**Invariant** : aucune de ces réponses ne contient un secret déchiffré. `PUT` accepte les valeurs,
ne les relit jamais.

---

## 3. UI — page `/admin/integrations`

- Coquille **`AdminShell`** (densité desktop / cartes mobile), gated `integrations:*` (SUPER_ADMIN).
- Une **carte par provider** : badge `configuré / stub`, toggle actif, `•••• 4 derniers`, date de MAJ,
  bouton **Tester**, formulaire **write-only** (champs masqués), section **Webhooks** (URL + secret
  masqué + rotation + journal + rejeu). Design « Wax & Terre » (thème admin indigo nuit + actions terre).
- Nav `AdminShell` : entrée « Intégrations » gated par scope + ajout dans `/admin/menu` (mobile).

---

## 4. Lotissement (ordre d'exécution)

| Lot | Contenu | Zone | Dépend de |
|---|---|---|---|
| **A** ✅ | Modèle `IntegrationConfig` + enum + migration ; resolver `lib/integrations.ts` (chiffrement `sealSecret`/`openSecret`, cache Redis du blob **chiffré** + invalidation, fallback `.env`, `maskSecrets`) ; scopes `integrations:read/write` (shared, SUPER_ADMIN) ; tests. **LIVRÉ.** | back | — |
| **B** ✅ | API admin `/admin/integrations` : `GET` liste+détail (masqué) / `PUT` (rote, audit `INTEGRATION_UPDATE` **sans valeur**, clés inconnues rejetées) / `PATCH` (enabled, audit `INTEGRATION_TOGGLE`) / `POST test` (readiness, audit `INTEGRATION_TEST`) — secrets **jamais renvoyés** ; RBAC `integrations:read/write` ; **FedaPay refusé (§5 → Lot E)**. 8 tests. **LIVRÉ.** | back | A |
| **C** ✅ | Bascule des services **NON gelés** vers le resolver : **Twilio, Daily, Resend, Firebase** consomment `resolveConfiguredSecrets` (base chiffrée → `.env`), stub↔réel **dynamique** (fin des booléens statiques `isXxxConfigured`) ; `app` threadé dans les services ; cache OAuth FCM ré-clé par `clientEmail` (rotation). Tests. **LIVRÉ.** | back | A |
| **D** | Webhooks (hors FedaPay) : config `meta.webhookUrl` + rotation secret + journal (réutilise l'existant) | back | B |
| **E** | **FedaPay — §5 ENCADRÉ** : bascule des clés + secret webhook vers le resolver. **Revue explicite + re-tests webhooks** (HMAC valide/invalide, idempotence, crédit wallet). Isolé, dernier. | back (gelé) | A–D |
| **F** | UI `/admin/integrations` (AdminShell, SUPER_ADMIN, cartes + webhooks) + nav gated + `/admin/menu` | front | B, D |
| **G** | Docs & durcissement : `SECRETS_Production`, `DEPLOIEMENT_Checklist`, runbook de rotation ; tests sécurité (secret jamais renvoyé, cloisonnement scope, audit) ; mise à jour compteurs | docs/tests | tous |

**Estimation** : A–B ≈ 1 lot dense, C ≈ 1, D ≈ 1, E ≈ 1 (encadré §5), F ≈ 1, G ≈ 0,5. Une PR par lot.

---

## 5. Tests (non-régression)

- **Sécurité** : `GET`/`PUT` ne renvoient **jamais** un secret déchiffré (assert masquage) ;
  un admin **sans** `integrations:write` → 403 ; un `PUT` est audité **sans** la valeur.
- **Resolver** : DB > `.env` (override) ; fallback `.env` si pas de ligne ; invalidation du cache à l'update.
- **Chiffrement** : round-trip seal/open ; blob illisible sans la clé.
- **Services** : Twilio/Daily/Resend/Firebase lisent bien la config DB (stub si `enabled=false`).
- **FedaPay (Lot E)** : **re-tests webhooks complets** (HMAC ✓/✗, idempotence, crédit wallet) + init paiement.

---

## 6. Rollout & exploitation

1. Déployer A–D : `.env` reste la source tant qu'aucune config DB n'est saisie (0 régression).
2. Le super admin saisit les clés **non-FedaPay** via l'UI → elles priment sur le `.env`.
3. Lot E (FedaPay) déployé séparément après re-tests webhooks (§5).
4. `SECRETS_Production.md` : les secrets d'intégration deviennent **optionnels** en `.env` (fallback) ;
   les secrets d'**infra** restent **obligatoires**. Sauvegarde : la base (chiffrée) contient désormais
   des secrets → `pg_dump` chiffré déjà en place (cron 02:00) ; `HEALTH_ENCRYPTION_KEY` hors VPS (déjà requis).
5. Rotation : bouton dédié + audit ; invalider le cache Redis à chaque rotation.

---

## 7. Fichiers touchés (récap)

- **Schéma** : `apps/api/prisma/schema.prisma` (+ migration).
- **Back** : `lib/integrations.ts` (nouveau), `services/{twilio,daily,resend,firebase,fedapay}.ts`,
  `modules/admin/admin.routes.ts` (+ éventuel `modules/admin/integrations.*`), `packages/shared/src/admin.ts` (scopes).
- **Front** : `apps/web/src/app/admin/integrations/page.tsx`, `components/spaces/AdminShell.tsx` (nav), `/admin/menu`.
- **Docs** : ce plan, `CLAUDE.md` (§3/§4/§8/§9), `SECRETS_Production.md`, `DEPLOIEMENT_Checklist.md`, `ADMIN_Backoffice_Proposal.md`.
