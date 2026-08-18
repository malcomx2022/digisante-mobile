# Revue fonctionnelle — écarts & plan de correction

> **Date** : 17 août 2026 · **Périmètre** : `main` @ `a367b23` · **Auteur** : revue de code assistée
> **Nature** : revue d'**écarts** (ce qui manque / ce qui cloche). Complète `docs/REVUE_FONCTIONNELLE.md`
> (juillet 2026) qui décrit, elle, le **périmètre livré**. À lire ensemble : l'une dit ce que le produit
> fait, celle-ci dit ce qu'il reste à faire.

---

## 1. État vérifié de la codebase

Tous les contrôles ci-dessous ont été **exécutés** sur le dépôt local (Postgres 5434 / Redis 6380),
pas déduits de la documentation.

| Contrôle | Commande | Résultat |
|---|---|---|
| Typage | `pnpm typecheck` | ✅ 3/3 projets |
| Lint | `pnpm lint` | ✅ 0 warning, 0 erreur |
| Tests API | `pnpm test` | ✅ **289 / 289** (63 fichiers, 74 s) |
| Build web | `next build` | ✅ **63 pages** |
| Build API | `tsc + tsc-alias` | ✅ |
| Migrations | `prisma migrate deploy` | ✅ 26 appliquées, 0 en attente |
| i18n | `pnpm i18n:check` | ✅ EN / FON / YOR **100 %** (868 clés, dont 41 critiques) |
| Git | `git status` / `gh pr list` | ✅ arbre propre, `main` = `origin/main`, **0 PR ouverte** |

### 1.1 Deux prérequis non automatisés (à connaître)

Sur un clone frais, `pnpm typecheck` **échoue** (34 erreurs `Property 'x' does not exist on
PrismaClient`) tant que `prisma generate` n'a pas tourné, et `pnpm lint` **échoue** tant que
`pnpm install` n'a pas installé `@next/bundle-analyzer` (importé en tête de `next.config.mjs`).
La CI enchaîne les deux dans le bon ordre, donc elle est verte ; le poste de développement, non.
Ce n'est pas un bug de code — c'est un piège d'onboarding (cf. **C7**).

### 1.2 Compteurs réels vs documentés

| Métrique | Documenté (CLAUDE.md v1.30) | Mesuré | Écart |
|---|---|---|---|
| Endpoints REST | 160 + 1 WS | 160 + 1 WS | ✅ |
| Pages frontend | 63 | 63 | ✅ |
| Modules API | 28 | 28 | ✅ |
| Enums Prisma | 32 | 32 | ✅ |
| Migrations | 26 | 26 | ✅ |
| **Modèles Prisma** | **47** | **49** | ⚠️ −2 |
| **Tests API** | **263** | **289** | ⚠️ −26 |

`docs/DEPLOIEMENT_Checklist.md` est plus décalé encore : « 179 tests API verts », « backend 25 modules ».

---

## 2. Corrections restantes

Classées par impact fonctionnel réel, pas par facilité.

> **État d'avancement au 17/08/2026** — lots 1, 2 et 3 livrés :
> **C1 ✅ · C2 ✅ · C3 ✅ · C6 ✅ · C7 ✅ · C8 ✅ · C9 ✅** — restent **C4** et **C5** (lots 4 et 5).
> Les sections ci-dessous conservent l'énoncé d'origine du constat ; le statut est rappelé en tête
> de chacune.

### C1 — ✅ LIVRÉ (lot 2) · 🔴 MAJEUR · Le référencement médecin → médecin n'a aucune interface

Le module `apps/api/src/modules/referrals/` est **complet et testé** (3 endpoints, 10 tests verts) :
un médecin oriente un patient vers un confrère, le destinataire accepte / termine / annule.

Côté frontend : **zéro occurrence** de `referrals` dans `apps/web/src` — pas de client
`lib/api/referrals.ts`, pas d'écran, pas d'entrée de navigation. La fonctionnalité est **inaccessible
en production**.

C'est le seul module API dans ce cas : `subscriptions`, `consultations`, `payments`, `wallet`, `sos`,
`prescriptions` et `translations` sont tous consommés par au moins un écran (vérifié par grep).

**Impact métier** : l'orientation vers un spécialiste est précisément le geste que l'infrastructure
médicale béninoise rend difficile — c'est un des défis cibles du projet (§1 CLAUDE.md). Le backend
répond au besoin, l'utilisateur ne peut pas s'en servir.

### C2 — ✅ LIVRÉ (lot 3) · 🔴 MAJEUR · Les pièces jointes du DMP sont lisibles mais non téléversables

`model Document` (fichier chiffré rattaché à un `MedicalRecord`) est **lu** par le DMP —
`dmp.service.ts:87` fait `include: { documents: { select: { id, filename, mimeType, size } } }` et
`dmp.service.ts:101` les renvoie au client.

Mais **aucun endpoint n'en crée** : les 9 routes de `dmp.routes.ts` couvrent records, partage,
consentements et export — pas l'attachement de fichier. `prisma.document.create` n'existe nulle part
dans le code de production.

Résultat : un patient ne peut pas joindre un compte-rendu scanné, une radio ou une ordonnance papier
à son dossier. La liste s'affichera éternellement vide.

**Le chemin technique existe déjà** : `lib/filestore.ts` + le contrôle de *magic bytes* du KYC
(`POST /kyc/documents`) font exactement ce travail. Il manque le branchement côté DMP, pas la brique.

### C3 — ✅ LIVRÉ (lot 2) · 🟠 MOYEN · `referrals.create` : ni notification, ni audit, ni consentement (§4)

> **Arbitrage rendu par le porteur (17/08/2026) : journalisation seule.** L'orientation vaut acte de
> soin coordonné — aucun `Consent` créé, aucun accès DMP ouvert, mais `Notification` systématique au
> destinataire dans SA langue et audit `REFERRAL_CREATE`. L'audit ne porte **que des identifiants** :
> le motif clinique (`reason`) en est exclu, l'admin n'ayant pas à le lire (§4). Consigné en §8 de
> CLAUDE.md.

Trois manques dans `referrals.routes.ts` (lignes 32-48) :

1. **Aucune `Notification`** n'est créée pour le médecin destinataire. Même une fois C1 livré,
   l'orientation resterait invisible jusqu'à ce que le confrère pense à ouvrir la liste.
   Le module ASC fait pourtant exactement ça correctement (`asc.service.ts:99 relayToDoctor`).
2. **Aucune entrée d'audit**, alors que le champ `reason` est du **texte clinique libre**
   (« Suspicion HTA, avis cardiologique ») transmis avec l'identité du patient à un tiers soignant.
   §4 impose la journalisation de tout événement sensible.
3. **Aucun `Consent`** n'est vérifié ni créé. L'orientation ne donne pas accès au DMP (le scope
   reste piloté par `resolveDmpScope`), donc la fuite est bornée au motif — mais transmettre un
   motif clinique nominatif sans trace ni accord du patient est une décision à **arbitrer
   explicitement**, pas à laisser implicite.

**À trancher (décision produit/DPO)** : soit l'orientation vaut acte de soin coordonné et il suffit
de journaliser, soit elle requiert un consentement patient. Les deux se défendent ; l'absence de
choix documenté, non.

### C4 — 🟠 MOYEN · Aucun test frontend, aucun e2e

63 pages, **0 test**. `apps/web/package.json` n'a pas de script `test`, donc `pnpm -r test`
**saute l'application web en silence** : la suite affiche « 289 passed » et paraît complète.

CLAUDE.md §2 annonce pourtant « Vitest (+ e2e type Playwright) » dans la stack canonique. Aucun
fichier Playwright n'existe dans le dépôt.

**Conséquence concrète** : les parcours traversants décrits en §8 de la revue de juillet
(triage → téléconsultation → ordonnance → dispensation) ne sont validés à aucun niveau
au-dessus de l'unité. Une régression de routing, de garde de rôle ou de rendu passe la CI.

### C5 — 🟡 FAIBLE · `AdminAuditLog` : table morte sur une surface de conformité

`model AdminAuditLog` (table `admin_audit_logs`) porte une FK vers `users`, 3 index et
**3 triggers de durcissement** (anti UPDATE / DELETE / TRUNCATE). Elle n'est **jamais écrite** :
`prisma.adminAuditLog` a 0 occurrence dans tout le code, tests inclus.

Toutes les actions admin partent en réalité dans `AuditLog` — la table à chaîne de hachage SHA-256,
qui est la bonne. `AdminAuditLog`, elle, n'a ni `prevHash` ni `hash` : elle est structurellement
**moins** protégée.

Le risque n'est pas technique (une table vide ne fuit rien) mais **auditable** : un contrôle APDP
qui ouvre le schéma trouve deux registres d'audit, dont un sans chaînage cryptographique, et devra
se faire expliquer lequel fait foi. Sur une surface de conformité, l'ambiguïté coûte.

### C6 — ✅ LIVRÉ (lot 2) · 🟡 FAIBLE · Machine à états laxiste sur `referrals.respond`

`referrals.routes.ts:68` ne garde que `ACCEPT` :

```ts
if (referral.status !== 'PENDING' && action === 'ACCEPT') throw badRequest('Orientation déjà traitée');
```

`COMPLETE` et `CANCEL` sont donc acceptés depuis **n'importe quel statut** — on peut « terminer »
une orientation annulée, ou annuler une orientation déjà terminée. Sans conséquence de sécurité,
mais les statistiques d'orientation deviennent non fiables.

### C7 — ✅ LIVRÉ (lot 1) · 🟡 FAIBLE · Le typecheck est rouge sur un clone frais

Pas de `postinstall` dans `apps/api/package.json`. Un développeur qui clone et lance `pnpm typecheck`
obtient 34 erreurs qui ressemblent à des bugs et n'en sont pas (§1.1). Coût direct pour Viviane
(dev junior) et pour tout futur contributeur.

### C8 — ✅ LIVRÉ (lot 1) · 🟡 FAIBLE · Compteurs faux dans la documentation

Cf. §1.2. Concerne `CLAUDE.md`, `docs/DEPLOIEMENT_Checklist.md`, `docs/REVUE_FONCTIONNELLE.md`
et les `.docx` opposables (`DocTech` porte déjà la mention « compteurs à régénérer »).

Sur un projet à redevabilité bailleur (NEXT IMPACT / Banque Mondiale), les chiffres cités dans les
livrables doivent être reproductibles à la commande près.

### C9 — ✅ LIVRÉ (lot 1) · 🟡 FAIBLE · 5 branches distantes obsolètes

`claude/app-design-corrections-0si9u9`, `claude/cool-dijkstra-r7peec`,
`claude/remove-console-logs-prod-j03eyr`, `docs-revue-fonctionnelle-9322362368973895115`,
`feat/design-sync-wax-terre` — 0 PR ouverte.

**Résolution (17/08/2026)** : 4 branches vérifiées à **0 commit non fusionné** dans `main` →
supprimées. La cinquième, `docs-revue-fonctionnelle-…`, a été **conservée** : elle porte 2 commits
jamais fusionnés, soit deux documents de revue inédits —
`docs/REVUE_DESIGN_RESPONSIVITE_BUGS.md` (120 l.) et `docs/REVUE_I18N_TRADUCTIONS.md` (83 l.).

⚠️ **Ne pas les fusionner tels quels** : la revue i18n est **factuellement périmée** par rapport à
`main`. Elle annonce « FON ~15 % / YOR ~5 % » alors que les deux langues ont été portées à 100 %
(commit `6290ca4`), et situe les clés dans `packages/shared/src/i18n.ts` avec « 18 namespaces »,
alors qu'elles vivent dans `apps/web/src/i18n/messages.ts` en dictionnaire **plat**. La revue
design, elle, contient des points de vigilance encore valables (pagination des graphes de
constantes, TTS absent sur Android bas de gamme, repli SOS sans GPS).

**Décision à prendre** : corriger puis fusionner la revue design, réécrire ou abandonner la revue
i18n. En attendant, la branche reste en place — rien n'est perdu.

---

## 3. Points déjà tracés — non régressions

Pour éviter de les recompter comme des découvertes : ces éléments sont **connus, documentés et
assumés**. Ils ne sont pas des défauts d'implémentation.

| Élément | Où c'est tracé | Nature |
|---|---|---|
| Validation clinique triage OMS/PCIME + calendrier PEV + phrasier | `docs/VALIDATION_Clinique.md` | Attente signature professionnel de santé |
| Format CNOM `BJ-XXX-#####` à confirmer | CLAUDE.md §8 | Aucune API publique ONMB — par conception |
| Relecture native FON / YOR | CLAUDE.md §8 | 1ᵉʳ jet NLLB local, jamais publié tel quel |
| Batch du fan-out des campagnes | CLAUDE.md §8 | `createMany` d'un bloc — v2 par curseur |
| Vetting géographique des ASC | Addendum CSO, résiduel A1 | Atténué par rate-limit |
| Refund FedaPay externe | CLAUDE.md §8, Lot F | Reversal interne seul — hors périmètre sans sandbox |
| Stubs Twilio / Daily / FCM / Resend / FedaPay | `lib/integrations.ts` | Dégradation gracieuse **voulue** sans clés |
| `suggestGeneric` — 6 marques | `pharmacy/generics.ts` | Table minimale assumée, base DCI réelle en v2 |

---

## 4. Planification

Six lots, ordonnés pour que rien ne bloque le déploiement VPS en cours. Les lots 1 et 5 sont sans
risque et peuvent partir immédiatement ; les lots 2 à 4 sont du développement à part entière.

### Lot 1 — ✅ LIVRÉ · Hygiène (≈ 0,5 j) · **sans risque**
- **C7** : `"postinstall": "prisma generate"` dans `apps/api/package.json`.
- **C8** : compteurs synchronisés (49 modèles, 289 tests) dans `CLAUDE.md` + `DEPLOIEMENT_Checklist.md`.
- **C9** : purge des 5 branches distantes fusionnées.

### Lot 2 — ✅ LIVRÉ · Fermeture du référencement (≈ 2 j) · **valeur métier la plus haute**

> **Dette i18n ouverte par ce lot** : les 26 clés `referrals.*` sont livrées en **FR/EN** seulement.
> FON et YOR sont **volontairement laissées vides** — le repli FR est automatique
> (`LocaleProvider`, chaîne `langue → FR → clé brute`), donc l'utilisateur voit du français plutôt
> qu'une traduction automatique non relue (§6 : la MT n'est jamais publiée telle quelle).
> Conséquence assumée : la couverture FON/YOR passe de 100 % à **97 %**, et les 26 clés
> apparaissent dans `pnpm i18n:export` pour la relecture par locuteurs natifs. **Aucune clé
> critique** (`sos.` / `labo.` / `payments.`) concernée. Remplir un FR déguisé en FON aurait
> maintenu un 100 % trompeur — c'est précisément ce qu'il fallait éviter.
- **C1** : client `lib/api/referrals.ts` + écran `/pro/referrals` (liste envoyées / reçues, création
  depuis la fiche patient, réponse) + entrée de navigation PRO + i18n FR/EN (`referrals.*`,
  FON/YOR en repli FR).
- **C3** : `Notification` au destinataire (calquée sur `asc.relayToDoctor`) + entrée d'audit.
  **Arbitrage consentement à obtenir avant d'écrire le code.**
- **C6** : garde d'état complète sur `respond` + test de non-régression.
- Réutilise `ProHeader`, `SkeletonCards`, `ConfirmDialog` — aucune dépendance nouvelle.

### Lot 3 — ✅ LIVRÉ · Pièces jointes du DMP (≈ 2 j)

> **Découverte d'exploitation faite pendant ce lot** : les fichiers chiffrés vivent dans
> `KYC_STORAGE_DIR`, **hors de `pg_dump`**. Jusqu'ici ce répertoire ne contenait que des pièces
> d'identité KYC ; il porte désormais des **données de santé**. Une restauration à partir du seul
> dump PostgreSQL laisserait des entrées de dossier pointant vers des fichiers disparus.
> → Ligne ajoutée à `docs/DEPLOIEMENT_Checklist.md` §7 et avertissement en tête de `lib/filestore.ts`.
> **À vérifier avant le premier patient réel.**
- **C2** : `POST /dmp/records/:id/documents` + `GET /dmp/documents/:id/file`, en **réutilisant**
  `lib/filestore.ts` et le contrôle de *magic bytes* du KYC.
- Chiffrement au repos (§4) et respect de `resolveDmpScope` sur la lecture — un soignant ne
  télécharge que les pièces des entrées qu'il a le droit de voir.
- UI d'ajout dans `/patient/dmp` + affichage dans la fiche PRO.

### Lot 4a — ✅ LIVRÉ · Tests unitaires frontend

Script `test` dans `apps/web` (le trou principal : `pnpm -r test` **sautait l'app en silence**),
Vitest en environnement `node`, **29 tests** sur les deux chemins à vrai risque — file hors-ligne
et intercepteur de refresh — plus le routage par rôle et les formats localisés.

> **Un défaut réel trouvé et corrigé au passage** : `enqueue` horodatait avec `Date.now()`, dont la
> résolution est la milliseconde. Deux mutations mises en file dans la même milliseconde partageaient
> le même `ts`, et `allQueued()` les rejouait dans un ordre **arbitraire** — alors que rejouer dans
> l'ordre est toute la raison d'être de cette file (un `PATCH` puis un `DELETE` ne commutent pas).
> Corrigé par un horodatage strictement croissant, avec test de régression.
> C'est exactement le genre de bug qu'aucun test API ne pouvait attraper.

**Volontairement non fait** : jsdom + Testing Library. Le seul composant qui méritait un test est la
garde `Protected`, or l'enforcement réel du RBAC est côté serveur et **déjà couvert** (403 dans la
suite API) ; la garde frontend n'est que de la défense en profondeur. À ajouter le jour où un
composant portera de la logique métier non testable autrement.

### Lot 4b — Playwright (e2e) — à faire
Playwright sur les parcours traversants — triage → orientation, ordonnance → dispensation,
recharge wallet → paiement.

**L'authentification n'est PAS un obstacle** (vérifié) : `auth.service.ts:74` renvoie `devCode`
dans la réponse dès que `NODE_ENV !== 'production'`, donc un test e2e peut s'inscrire puis valider
son OTP sans passer par Twilio.

Reste à décider : le coût CI (binaires de navigateur + démarrage de l'API *et* du web en plus des
services Postgres/Redis déjà présents) justifie un **job séparé** dans `.github/workflows/ci.yml`,
pas un ajout au job `build-and-test`.

### Lot 5 — Nettoyage du schéma (≈ 0,5 j)
- **C5** : migration de suppression de `AdminAuditLog` (table + FK + index + triggers), ou
  décision inverse **écrite dans CLAUDE.md §4** si on la conserve comme registre distinct.
  Trancher, ne pas laisser en l'état.

### Lot 6 — Déploiement VPS Infomaniak (déjà scripté)
Exécuter `docs/DEPLOIEMENT_Checklist.md` (provisioning → secrets → Nginx/SSL → crons →
`DEPLOY_ENABLED=true`). **Indépendant des lots 1-5** : rien ci-dessus ne bloque la mise en ligne.

### Ordonnancement conseillé

```
Lot 1 ──┐
        ├──▶ Lot 2 ──▶ Lot 3 ──▶ Lot 4
Lot 6 ──┘                          │
  (en parallèle, chemin critique)  └──▶ Lot 5
```

Lot 6 sur le chemin critique : c'est la phase annoncée du projet, et les lots 1-5 sont livrables
en continu par le pipeline de déploiement une fois celui-ci actif.

---

## 5. Conclusion

La codebase est **saine** : 289 tests verts, typage et lint propres, builds fonctionnels, i18n à
100 % sur les 4 langues, zéro `TODO` / `FIXME` en attente dans le code de production.

Les deux écarts qui comptent (**C1** référencement, **C2** pièces jointes DMP) partagent la même
signature : un backend correct, testé, et **jamais branché à une interface**. Ce n'est pas de la
dette technique, c'est du travail livré à 80 % dont les 20 % restants sont visibles par
l'utilisateur final. Ils représentent ensemble environ 4 jours.

Rien dans cette liste ne conditionne la mise en production.
