# Back-office DigiSanté — Proposition d'architecture (administration forte & fonctionnelle)

> **Statut : PROPOSITION (à acter).** Document de référence opposable, à valider avant tout code.
> Cadre : PWA offline-first, faible consommation de données ; design « Wax & Terre » via `AdminShell` ;
> conformité §4 (cloisonnement DMP, audit append-only) ; zone gelée paiements §5 (FedaPay).
> Préparé le 18 juin 2026.

---

## 0. Principes directeurs

1. **RBAC d'abord (profilage des administrateurs).** Aujourd'hui un seul rôle `ADMIN` monolithique. On introduit des **profils admin par périmètre de permissions** — socle dont dépendent tous les modules.
2. **Audit-first (§4).** Toute action admin sensible est journalisée dans le registre append-only (hash SHA-256 chaîné, rétention 5 ans). L'admin ne lit **jamais** le contenu médical du DMP.
3. **§5 paiements gelé.** Tout ce qui touche FedaPay reste **lecture seule** d'abord. Les écritures (audit `PAYMENT_*`, reversements praticiens, replay DLQ, remboursements) = **revue explicite + re-tests des webhooks** (HMAC valide/invalide, idempotence, crédit wallet).
4. **PWA / faible conso.** Pagination + filtres **serveur** (jamais de dump complet), **projections** de champs, recherche **debouncée** (300 ms), cache HTTP **ETag/304** + SWR client, **0 dépendance ajoutée** (graphes en SVG maison), skeletons. Pas de polling ; rafraîchissement à la demande.
5. **Design.** Tout dans `AdminShell` (sidebar desktop indigo nuit / cartes mobile), tables denses + panneau détail, actions terre, fidèle à `AdminDesktop_LotFinal.html`.

---

## 1. 🔑 Profilage des administrateurs (RBAC) — *le socle*

### Modèle de permissions
Permissions **par scope** (granulaire) + **presets** lisibles (UX). Un admin a un ensemble de scopes ; les presets ne sont que des raccourcis d'attribution.

| Scope | Permet |
|---|---|
| `admin:manage` | Créer/éditer/suspendre des admins, attribuer des scopes (super-admin) |
| `users:read` / `users:write` | Lister/voir / suspendre-réactiver les comptes |
| `kyc:review` | Vérifier les soignants (pièces, décision) |
| `ops:read` | Monitoring opérations (consultations, RDV, labo, pharmacie, SOS — agrégé) |
| `finance:read` | Paiements, commissions, reversements (lecture) |
| `finance:write` | **§5** — déclencher reversements, remboursements |
| `support:write` | Console support : notes, renvois |
| `otp:write` | Reset OTP / déverrouillage compte |
| `webhooks:read` / `webhooks:replay` | Journal webhooks (lecture) / **§5** replay DLQ |
| `audit:read` / `audit:export` | Journal d'audit / export (journalisé `DATA_EXPORT`) |
| `education:write` | CMS éducation |

### Presets proposés
| Preset | Scopes |
|---|---|
| **Super-admin** | tous + `admin:manage` |
| **Opérations** | `ops:read`, `users:read`, `audit:read` |
| **Finances** | `finance:read`, `webhooks:read`, `audit:read` (+ `finance:write`/`webhooks:replay` réservés, §5) |
| **Support** | `support:write`, `users:read`, `otp:write` |
| **Modération / KYC** | `kyc:review`, `users:write`, `audit:read` |
| **Contenu** | `education:write` |

### Mise en œuvre
- **Donnée** : `AdminProfile` (1-1 avec un `User` rôle `ADMIN`) → `{ scopes: string[], preset, createdById, suspendedAt? }`. (Alternative : champ `adminScopes String[]` sur `User` ; un modèle dédié est préférable pour la traçabilité.)
- **Backend** : middleware `requireScope('finance:read')` sur chaque route (compose avec le garde `admin` existant).
- **Frontend** : `AdminShell` masque entrées de nav + actions hors scope (l'UI ne montre **que** le permis) ; route guard par scope.
- **Amorçage** : le 1er super-admin est **seedé** (jamais d'auto-inscription, §4). Les suivants sont créés par un super-admin.
- **Audit** : `ADMIN_CREATE`, `ADMIN_SCOPE_CHANGE`, `ADMIN_SUSPEND`.
- ⚠️ **À clarifier** : il existe déjà `AdminAuditLog` **et** `AuditLog` + un enum `AdminAction`. Décider du **journal unique** (recommandé : tout converger vers `AuditLog` append-only, et documenter le rôle d'`AdminAuditLog`).

---

## 2. 🧩 Modules back-office cibles

| # | Module | État | Scope | §5 |
|---|---|---|---|---|
| 1 | **Tableau de bord** | existant | (selon scopes) | — |
| 2 | **Utilisateurs** | existant → +filtres/recherche serveur, détail enrichi | `users:*` | — |
| 3 | **KYC soignants** | existant → +audit `KYC_*` | `kyc:review` | — |
| 4 | **Opérations** (consultations, RDV, labo, pharmacie, SOS — vue agrégée, **sans contenu médical**) | nouveau (lecture) | `ops:read` | — |
| 5 | **Finances — Paiements** (volume, commissions, table transactions, statuts) | nouveau (lecture) | `finance:read` | lecture |
| 6 | **Finances — Reversements praticiens** (suivi des montants dûs/versés aux médecins, par période, net de commission) | nouveau | `finance:read` (suivi) / `finance:write` (exécution) | **exécution = §5** |
| 7 | **Webhooks & intégrations** (FedaPay : reçu/HMAC/retries/DLQ ; FCM ; Twilio) | nouveau (lecture) | `webhooks:read` | lecture |
| 8 | **Support / OTP** (lookup compte, activité récente, reset OTP/verrou, renvoi code, note interne) | nouveau | `support:write`, `otp:write` | — |
| 9 | **Audit** | existant → +filtres (action/acteur/plage) + export | `audit:read` | — |
| 10 | **Éducation CMS** | existant → complétion (édition, publication, traductions, audio, vues) | `education:write` | — |
| 11 | **Admins & rôles** (gestion des administrateurs, §1) | nouveau | `admin:manage` | — |

### Focus « Reversements praticiens » (module 6)
- **Concept** : chaque consultation payée génère un dû praticien = montant − commission plateforme (ex. 3 %). Le back-office suit, par médecin et par période : **encaissé**, **commission**, **net à reverser**, **déjà reversé**, **en attente** ; canal (MoMo/Moov) ; échéance (ex. J+2).
- **Phase 1 (lecture, `finance:read`)** : agrégation/suivi à partir des `Payment` COMPLETED liés aux RDV du médecin. Aucun mouvement d'argent. Pas de §5 (lecture seule).
- **Phase 2 (exécution, `finance:write`, §5)** : déclencher un reversement (création d'un `Payout` + ordre MoMo). **Nouvelle logique de paiement sortant** → revue §5 obligatoire + tests. Nécessite de **nouveaux modèles** : `Payout` (médecin, montant, période, statut, canal, ref opérateur) et éventuellement `PayoutBatch`.
- ⚠️ Aucune table `Payout` n'existe aujourd'hui → à concevoir en Phase 2.

---

## 3. 🔌 Conventions API (PWA faible conso)

- **Lecture paginée** : `GET …?page&pageSize&sort` + filtres typés (schémas JSON Fastify), réponse `{ data, total, page, pageSize }` (standard `paginate` déjà en place).
- **Projections** : ne renvoyer que les champs nécessaires (Prisma `select`), surtout sur les listes.
- **Cache** : `Cache-Control: private, max-age=…` + **ETag** → `304 Not Found` sur re-fetch des vues semi-statiques (métriques, listes) ; SWR/stale-while-revalidate côté client.
- **Recherche** : debounce 300 ms (comme l'annuaire médecins), index DB sur les colonnes filtrées.
- **Sécurité** : `requireScope` + journalisation des **lectures sensibles** (consultation des pièces KYC = identité).
- **Compression** : gzip/brotli au niveau Nginx (déjà prévu infra).
- **Pas de gros payloads** : exports volumineux en **stream**/CSV à la demande, jamais chargés en mémoire client.

---

## 4. 🪝 Webhooks & observabilité (module 7)

- **Constat** : aujourd'hui l'idempotence FedaPay se fait sur `Payment.fedapayId`/statut — **pas de table d'évènements webhook** persistée.
- **Proposition (lecture/observabilité, hors logique gelée)** : ajouter un modèle `WebhookEvent` (source, type, reçu le, HMAC valide ?, traité/idempotent ?, tentatives, DLQ ?, payload tronqué/haché). Le **handler existant reste inchangé** ; on y **ajoute seulement une écriture d'observabilité** (à valider §5 car le fichier touche `payments/**`).
- **UI** : journal filtrable (source, statut, plage), focus « **en échec / DLQ** ».
- **Replay manuel** (`webhooks:replay`) = action §5 → lot ultérieur, revue + re-tests.
- **Étendre** aux intégrations FCM (token rejeté → purge) et Twilio (fallback numéro long) pour une vraie console d'intégrations.

---

## 5. ✅ Conformité audit (§4) — à compléter

Évènements **déjà journalisés** (vérifiés) : `DMP_ACCESS`, `DMP_DENIED`, `DMP_CONSENT_GRANT/REVOKE`, `DMP_SHARE`, `AUTH_FAIL`, `AUTH_LOCKOUT`, `DATA_EXPORT`, `LAB_CRITICAL`, `SOS_ALERT`, `USER_SUSPEND/ACTIVATE`, `LAB_ORDER_CLAIM`.

**Manquants (à câbler)** :
- `KYC_*` (approbation/rejet soignant) — **0 référence** alors que la décision est persistée dans `KycReview`. **Lot A (P0)**, hors §5.
- `PAYMENT_*` (statut résolu) — **0 référence**. **Lot F**, **§5** (modifie la résolution de statut partagée webhook/réconciliation).
- Actions admin du nouveau périmètre : `ADMIN_*`, `OTP_RESET`, `PAYOUT_*`, `WEBHOOK_REPLAY`.

---

## 6. 🗄️ Impacts modèle de données (nouveaux modèles proposés)

| Modèle | Pour | Lot | §5 |
|---|---|---|---|
| `AdminProfile` (scopes, preset) | RBAC | B | — |
| `WebhookEvent` (observabilité) | Webhooks | E | écriture d'obs. encadrée |
| `Payout` / `PayoutBatch` | Reversements praticiens (exécution) | F | **oui** |
| `SupportNote` (note interne par compte) | Support | D | — |
| (réutilise `AuditLog`, `KycReview`, `Payment`, `Wallet`) | — | — | — |

Toute évolution passe par `prisma migrate dev` (jamais `db push` en prod), migration revue.

---

## 7. 🔒 Sécurité admin

- **Moindre privilège** par scope ; super-admin seul peut élever des droits.
- **2FA admin recommandé** (au-delà de l'OTP SMS) pour les scopes sensibles (`finance:*`, `admin:manage`).
- **Cloisonnement §4** strict : aucun module admin n'expose le DMP médical (KYC = identité uniquement).
- **Journalisation des lectures sensibles** + des changements de scope.
- Sessions admin : expiration courte, révocation par super-admin.

---

## 8. 🗺️ Découpage en lots & ordre conseillé

| Lot | Contenu | §5 | Dépend de |
|---|---|---|---|
| **A — Conformité** | Audit `KYC_*` + audit actions admin + filtres/export Audit UI | Non | — |
| **B — RBAC socle** | `AdminProfile` + scopes + middleware + UI gestion admins + gating nav | Non | — |
| **C — Utilisateurs** | Filtres/recherche serveur + détail enrichi | Non | B |
| **D — Support / OTP** | Console support, reset OTP/verrou, renvoi, notes | Non | B, C |
| **E — Finances + Webhooks (lecture)** | Endpoints lecture paiements + reversements (suivi) + page + journal webhooks | Lecture (encadré) | B |
| **F — Paiements écritures** | Audit `PAYMENT_*`, reversements (exécution `Payout`), replay DLQ | **Oui §5** | E |
| **G — Opérations** | Monitoring agrégé | Non | B |
| **H — Éducation CMS** | Complétion CMS | Non | B |

**Ordre** : **A** (conformité, rapide) → **B** (socle RBAC) → **C / D** → **E** → **F** (§5, revue dédiée) → **G / H**.

---

## 9. Décisions à acter

1. **RBAC scope-based + presets** (§1) et la liste des presets.
2. **Journal d'audit unique** : converger vers `AuditLog` ? (clarifier `AdminAuditLog`/`AdminAction`).
3. **§5** : préparer **E (lecture seule)** maintenant ; **réserver F** (audit `PAYMENT_*`, `Payout`, replay) à une revue §5 dédiée.
4. **Nouveaux modèles** acceptés : `AdminProfile`, `WebhookEvent`, `SupportNote` (lecture/obs.) ; `Payout`/`PayoutBatch` en Phase 2.
5. **0 dépendance ajoutée** (graphes SVG maison) — confirmé.
6. **Ordre des lots** : A → B → … confirmé.

*À mettre à jour au fil des décisions ; ce document est la référence du chantier back-office.*
