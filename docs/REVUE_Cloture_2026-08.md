# Revue de clôture — dernières implémentations & écarts restants

> **Date** : 19 août 2026 · **Périmètre** : `main` @ `36e8cbf` · **Auteur** : revue de code assistée
> **Nature** : revue **de clôture**. Elle vérifie *à la commande* ce que les lots 1→11 et la refonte
> PWA prétendent avoir livré, puis liste ce qui reste **pour boucler le projet**.
>
> À lire avec : `docs/REVUE_Ecarts_et_Plan_2026-08.md` (C1→C9, **close**),
> `docs/AUDIT_Fonctionnel_2026-08.md` (D1→D10, **close**), `docs/DEPLOIEMENT_Checklist.md`.

---

## 1. État vérifié — tout a été exécuté, rien n'est déduit de la documentation

Environnement de contrôle : PostgreSQL 16.13 natif (port 5434) + Redis 7.0.15 (port 6380),
`NODE_ENV=test`, base Redis dédiée `…/1` (tests d'intégration) et `…/2` (e2e).

| Contrôle | Commande | Résultat |
|---|---|---|
| Typage | `pnpm typecheck` | ✅ 3/3 projets |
| Lint | `pnpm lint` | ✅ 0 warning, 0 erreur |
| Tests API | `pnpm test` (api) | ✅ **318 / 318** (64 fichiers, 52 s) |
| Tests web | `pnpm test` (web) | ✅ **32 / 32** (4 fichiers) |
| **Total unitaire/intégration** | | ✅ **350** |
| Tests e2e | `pnpm test:e2e` | ✅ **8 / 8** sur la pile réelle (16 s) |
| Build | `pnpm build` | ✅ shared + api + web (**66 pages**) |
| Migrations | `prisma migrate deploy` | ✅ **27** appliquées, 0 en attente |
| i18n | `pnpm i18n:check` | EN **100 %** · FON/YOR **93 %** (68 manquantes, **6 critiques**) |

> Chiffres **mesurés à la revue**, avant correction. Les correctifs **E1** et **E4** livrés dans le
> même lot portent la suite web à **37 tests** (total **355**) et ajoutent 1 clé i18n
> (`wallet.topup_queued`, FR/EN ; repli FR en FON/YOR, **aucune clé critique nouvelle**).

### 1.1 Compteurs — documentation et code sont **synchronisés**

C'est un progrès net : la revue de juillet et l'audit d'août trouvaient tous deux des compteurs
périmés (C8, D9). Cette fois **tout concorde**, dans CLAUDE.md, `README.md` et
`docs/DEPLOIEMENT_Checklist.md`.

| Métrique | Documenté | Mesuré | Écart |
|---|---|---|---|
| Endpoints | 163 REST + 1 WS | 164 déclarations (163 REST + 1 WS `/chat/ws`) | ✅ |
| Modules API | 27 | 27 | ✅ |
| Pages frontend | 66 | 66 | ✅ |
| Modèles Prisma | 48 | 48 | ✅ |
| Enums Prisma | 31 | 31 | ✅ |
| Migrations | 27 | 27 | ✅ |
| Tests | 350 (318 + 32) + 8 e2e | 350 + 8 | ✅ |

> Compteurs resynchronisés à **355** (318 API + 37 web) dans CLAUDE.md et la checklist de déploiement après les correctifs E1/E4.

### 1.2 Les invariants de §8 tiennent

Les balayages de contrôle consignés dans CLAUDE.md renvoient tous **0 violation réelle**
(les seules occurrences restantes sont les **commentaires** qui documentent la règle) :

| Invariant | Attendu | Mesuré |
|---|---|---|
| `card-pagne` sans anneau de focus | 0 | ✅ 0 |
| `min-h-screen` imbriqué | 0 | ✅ 0 (1 commentaire) |
| `text-[Npx]` (police en px) | 0 | ✅ 0 |
| `window.confirm()` | 0 | ✅ 0 (1 commentaire dans `ConfirmDialog`) |
| Fausse horloge « 9:41 » | 0 | ✅ 0 (1 commentaire dans `StatusBar`) |

### 1.3 Hygiène structurelle — saine

- **Aucun modèle mort** : les 48 modèles sont écrits. Les 5 qui n'apparaissent pas en
  `prisma.x.create` direct le sont par **création imbriquée** (`Profile`, `PrescriptionItem`,
  `AntenatalVisit`, `Vaccination`) ou par le **seed** (`Insurance`, catalogue ARCH/AMU-CNSS).
- **Aucun module orphelin** : les 27 modules API ont au moins un consommateur web.
- **Aucun `TODO` / `FIXME` / `HACK`** dans le code de production.
- **Les 4 générateurs de rappels sont planifiés** (`reminders`, `appointments`, `vaccinations`,
  `maternity`) — le correctif du lot 6 tient, la règle « un générateur = une ligne de crontab
  dans le même lot » est respectée.
- Les **stubs** restants (FedaPay, Twilio, Daily, Firebase, Resend) sont **intentionnels** : ils
  basculent dynamiquement dès qu'une clé est résolue (`/admin/integrations`), sans redéploiement.

---

## 2. Écarts NOUVEAUX — non catalogués par les revues précédentes

Quatre trouvailles. La première était bloquante. **E1, E2 et E4 sont corrigés ; E3 reste ouvert.**

### E1 — ✅ CORRIGÉ (19/08/2026) · 🔴 MAJEUR · La recharge du portefeuille diaspora ne redirige jamais vers le paiement

> **Corrigé.** La règle « un `paymentUrl` se consomme » est extraite dans `apps/web/src/lib/payments.ts`
> (`paymentOutcome`), **partagée par les deux chemins** (recharge du portefeuille et paiement de
> consultation) et **testée** (`lib/payments.test.ts`, 5 tests). Elle vivait en double dans deux
> composants : c'est ce qui a permis au lot 8 d'en corriger un seul. §5 non touché — on interprète une
> réponse serveur, on ne modifie aucune logique de paiement.

`apps/web/src/app/diaspora/wallet/page.tsx:38`

```ts
await post('/wallet/topup', { amountEur: Number(eur), method: 'VISA_MC' });
setMsg(`✓ ${t('wallet.topup_initiated')}`);
```

`POST /wallet/topup` délègue à `payments.initiate` et renvoie `paymentUrl`
(`payments.service.ts:245`). **Le frontend jette cette valeur.** L'utilisateur voit
« ✓ recharge initiée », la page de paiement FedaPay n'est **jamais ouverte**, la transaction
reste `PENDING`, et le solde n'est **jamais** crédité.

**C'est exactement le défaut que le lot 8 a corrigé — sur un seul des deux chemins.** La
redirection a été ajoutée à `/patient/appointments` (`page.tsx:66-67`,
`if (res.paymentUrl) window.location.href = res.paymentUrl`) et **pas** au chemin de recharge.
Le piège §8 « Redirection vers la page de paiement » décrit précisément ce symptôme
(« l'interface affichait *payé* sans jamais rediriger ») ; il reste donc **ouvert à moitié**.

**Conséquence métier** : la recharge du wallet est **la** porte d'entrée de l'argent de la
diaspora — le cas d'usage qui finance les soins de la famille restée au pays. Elle est
aujourd'hui inopérante, et **silencieusement** : rien n'indique l'échec à l'utilisateur, et la
réconciliation de 02:30 ne rattrapera rien puisque aucun paiement n'a réellement eu lieu.

**Correctif** : une ligne, strictement symétrique à celle du lot 8, **hors logique de paiement**
(§5 non touché — on ne modifie pas `payments.initiate`, on consomme sa réponse).

### E2 — ✅ CORRIGÉ (19/08/2026) · 🟠 MOYEN · `POST /wallet/pay` : orphelin *et* sémantiquement incomplet

> **Arbitrage du porteur : suppression.** La route est retirée, avec `paySchema`, le champ
> `beneficiaryUserId` et la branche `TRANSFER` devenue inatteignable. `wallet.debit` est
> **conservé** — `payments.initiate` (méthode WALLET) l'appelle, avec la garde de solde
> anti-TOCTOU. La valeur `TRANSFER` reste dans l'enum Prisma (aucune migration, pour ne pas
> invalider d'éventuelles lignes historiques). Un test exige désormais **404** sur la route,
> et la « Chaîne 3 » des parcours règle sa consultation par le **chemin de production**
> (`POST /payments`) au lieu de la route fantôme : elle teste enfin un paiement réel.
> Même signature que le module `translations` au lot 11 — un endpoint que rien n'appelle est
> un piège pour le prochain contributeur.

**Seul endpoint du produit sans aucun appelant** (vérifié par appariement des 164 déclarations
de routes aux URL réellement appelées par le web + les e2e).

Deux problèmes cumulés, au-delà du simple code mort :

1. Il accepte `beneficiaryUserId` et étiquette la transaction `TRANSFER`
   (`wallet.service.ts:80`), mais **ne crédite personne et ne règle aucun soin** : le solde du
   payeur est débité, et l'argent ne se retrouve nulle part. Ce n'est pas un transfert, c'est
   une disparition.
2. `beneficiaryUserId` **n'est jamais vérifié** contre le carnet `Beneficiary` du payeur (ni
   même contre l'existence du compte). N'importe quel cuid passe.

Latent tant que rien ne l'appelle — mais c'est un piège armé pour le prochain contributeur qui,
voyant un endpoint « paiement pour un proche » déjà écrit et testé, le branchera.

**À trancher** : le brancher correctement (avec règlement réel + contrôle d'appartenance), ou le
**supprimer** comme le module `translations` au lot 11. La seconde option se défend : depuis le
lot 8, le débit du portefeuille passe par `payments.initiate` (méthode `WALLET`), qui est le
chemin gardé, atomique et testé.

### E3 — ⏳ OUVERT · 🟠 MOYEN · Le parcours diaspora ne se referme pas

> **Toujours ouvert, et désormais seul.** La suppression de E2 retire le faux-semblant, elle
> n'ajoute pas la fonctionnalité : payer les soins d'un proche reste **non implémenté**, et le
> carnet `Beneficiary` reste un CRUD sans débouché. Le rebrancher exige un vrai règlement
> (à quoi l'argent se rattache) et un contrôle d'appartenance — pas une route de débit.

Conséquence conjointe de E1 et E2, mais c'est un écart **fonctionnel** à part entière.

L'espace diaspora expose 4 pages (`/diaspora`, `/wallet`, `/beneficiaries`, `/profile`). Le
titulaire peut **recharger** (E1 le bloque) et **gérer un carnet de bénéficiaires** — mais il ne
peut **pas payer les soins d'un proche** : aucun écran ne le propose, et le seul endpoint qui
s'en approcherait (E2) ne transfère rien.

Le carnet `Beneficiary`, livré à la vague 12 pour remplacer la liste « famille » codée en dur,
est donc aujourd'hui un **CRUD sans débouché**. La promesse « financer les soins de la famille
depuis l'étranger » n'est pas tenue de bout en bout.

### E4 — ✅ CORRIGÉ (19/08/2026) · 🟡 MINEUR · `.env.example` : ports incohérents avec `docker-compose.dev.yml`

> **Corrigé.** `.env.example` pose désormais **5434/6380**, avec un commentaire expliquant pourquoi
> (et non un simple changement de chiffre, pour que le prochain contributeur ne « corrige » pas en sens
> inverse). Vérifié à la commande : `cp .env.example apps/api/.env` puis `prisma migrate deploy`
> se connecte et applique les 27 migrations.

`.env.example:9,12` pose `localhost:5432` (Postgres) et `localhost:6379` (Redis).
`infra/docker-compose.dev.yml` publie **5434** et **6380**.

La séquence d'onboarding documentée à l'identique dans `README.md:30-41` et `SETUP_GIT.md:11-17`
est donc cassée :

```bash
cp .env.example apps/api/.env   # → 5432 / 6379
pnpm services:up                # → publie 5434 / 6380
pnpm db:migrate                 # → connexion refusée
```

**C'est le défaut D8 déplacé, pas résolu.** La correction d'août a supprimé
`apps/api/.env.example` en lui reprochant explicitement de « pointer les ports 5432/6379 au lieu
de 5434/6380 » — et a laissé **les mêmes valeurs** dans le fichier survivant, promu source
unique. Rencontré à la commande pendant cette revue (il a fallu corriger les ports à la main
pour faire tourner les migrations et les tests).

La CI n'est pas concernée : elle pose `DATABASE_URL`/`REDIS_URL` en variables de job (ports
5432/6379 des services GitHub). D'où, une fois de plus, une **CI verte et un poste local rouge** —
la même signature que C7.

---

## 3. Écarts DÉJÀ catalogués — confirmés encore ouverts

Aucun n'est une régression ; tous sont assumés et documentés. Rappelés ici pour que la liste de
clôture soit complète.

### Bloquants avant les premiers patients réels

| # | Écart | État vérifié |
|---|---|---|
| **B1** 🔴 | **6 clés i18n CRITIQUES `sos.*` non traduites FON/YOR** — `sos.active_title`, `sos.im_ok`, `sos.false_alarm`, `sos.history`, `sos.status.RESOLVED`, `sos.status.FALSE_ALARM` | ✅ confirmé : `pnpm i18n:check` compte **6 critiques** manquantes par locale ; exportées `CRITIQUE` dans `docs/i18n/todo.{fon,yor}.csv`. Le repli FR fonctionne (rien ne casse), mais un locuteur FON/YOR lit du **français sur un écran d'urgence**. **Relecture native obligatoire — jamais par traduction machine** (§6). |
| **B2** 🔴 | **Validation clinique non contresignée par un professionnel de santé** | Décision du porteur du 19/08/2026 actée (triage OMS/PCIME, PEV, phrasier, format CNOM retenus en l'état), mais `docs/VALIDATION_Clinique.md` **énonce lui-même** que ce n'est pas une signature médicale. `docs/Dossier_Validation_Clinique.docx` reste prêt à signer. |

### Mise en production

| # | Écart | État vérifié |
|---|---|---|
| **B3** 🔴 | **Le déploiement n'a jamais été armé ni exécuté** | Le job `deploy` de `ci.yml` est **opt-in** (`if: vars.DEPLOY_ENABLED == 'true'`) et requiert `VPS_HOST` / `VPS_USER` / `VPS_SSH_KEY`. Aucun secret ni variable n'est posé. Exige des accès que le dépôt ne contient pas (VPS, domaine, DNS). |
| **B4** 🟠 | **Aucune clé d'intégration tierce fournie** | FedaPay, Twilio, Daily, Firebase, Resend tournent **tous en stub**. La bascule est dynamique via `/admin/integrations` (aucun redéploiement), donc ce n'est pas un chantier de code — mais rien n'est fonctionnel en réel tant que les comptes ne sont pas ouverts. ⚠️ Le secret webhook FedaPay doit être roté **avec** la clé API (sinon 401 systématique). |
| **B5** 🟠 | **Restauration de sauvegarde jamais testée** | Case non cochée de la checklist §7. Depuis le lot 3, `KYC_STORAGE_DIR` contient des **données de santé** (pièces jointes DMP) et fait l'objet d'une **seconde archive** : il faut restaurer **les deux**. Une sauvegarde jamais restaurée n'est pas une sauvegarde. |

### Décisions produit en suspens (hors périmètre assumé)

| # | Sujet | Position actuelle |
|---|---|---|
| **P1** | **Console SOS admin** | Hors périmètre — une alerte géolocalisée et nominative touche la frontière §4. Ouverture = **décision explicite requise**. Aujourd'hui, une alerte n'est visible que du patient. |
| **P2** | **Interprète humain en consultation** (3ᵉ participant) | Hors périmètre (rôle / disponibilité / rémunération). Mitigé par le phrasier embarqué + l'appariement par langue parlée. |
| **P3** | **Fan-out des campagnes non borné** | `createMany` d'un coup pour toute l'audience (`campaigns.service.ts:138`). Acceptable aux volumes actuels ; **batch/curseur à prévoir en v2**. Même motif signalé pour la file de relecture éducation (modèle « pull » assumé, sans notification). |
| **P4** | **Vérification CNOM** | **Aucune API publique n'existe** au Bénin (investigué juin 2026). Le format `BJ-XXX-#####` reste une **hypothèse à confirmer auprès de l'ONMB**. Ce n'est pas un stub en attente — la vérification repose par conception sur la revue manuelle des pièces. |
| **P5** | **Vrai remboursement FedaPay** | `payments.refund()` est un reversal **interne** ; le retour d'argent côté opérateur reste une étape **manuelle tracée**. Hors périmètre tant qu'aucun bac à sable FedaPay n'est en place. |

---

## 4. Ce que les derniers lots ont réellement apporté — appréciation

La séquence lots 7→11 + lot 6 (infra) + refonte PWA a une qualité commune qui mérite d'être
relevée : **elle a cherché les défauts là où aucun test ne pouvait les voir**, et elle en a
trouvé quatre de premier ordre.

| Lot | Défaut trouvé | Pourquoi aucun test ne l'attrapait |
|---|---|---|
| **4b** (e2e) | `content-type: application/json` sur les POST **sans corps** ⇒ 400 Fastify sur ~20 sites, dont `/auth/refresh` (**déconnexion à chaque rechargement**) | Les tests unitaires simulaient `fetch` ; `app.inject` ne pose pas ce content-type. Il fallait un **vrai navigateur**. |
| **8** (FedaPay) | Vérification de signature webhook **fausse depuis l'origine** (`HMAC(body)` comparé à l'en-tête entier, au lieu de `t=…,s=HMAC(ts.body)`) ⇒ **tout webhook réel rejeté en 401** | Les tests **fabriquaient la signature avec la même formule erronée que celle vérifiée** : le test confirmait le bug. Il fallait relire la **doc du fournisseur**. |
| **6** (infra) | Générateurs vaccination + CPN **jamais planifiés** ⇒ aucun rappel émis en production, **en silence** | Le code était livré et testé ; c'est le **crontab** qui manquait. Aucune suite ne lit le crontab. |
| **6** (infra) | Sauvegarde **incomplète** — `KYC_STORAGE_DIR` (données de santé hors base) absent du dump | Symptôme visible **seulement à la restauration**. |
| **PWA** | Zone sûre **haute** absente + fausse horloge figée « 9:41 » | Invisibles hors **mode installé** sur iPhone. |

C'est la bonne façon de finir un projet : les défauts restants ne sont plus dans le code écrit,
ils sont dans les **jonctions** (client↔serveur, app↔fournisseur, app↔système d'exploitation,
app↔exploitation). **E1 et E4 ci-dessus sont exactement de cette famille** — et c'est pourquoi
ils ont survécu à 350 tests verts.

---

## 5. Plan de clôture proposé

Ordonné par ce qui **bloque** la mise en service, pas par facilité.

| Ordre | Action | Charge | Zone gelée |
|---|---|---|---|
| ~~1~~ | ✅ **E1 fait** — règle partagée `paymentOutcome` + 5 tests de non-régression | — | §5 non touché |
| ~~2~~ | ✅ **E4 fait** — `.env.example` aligné sur 5434/6380 | — | — |
| ~~3~~ | ✅ **E2 fait** — route supprimée (arbitrage porteur) + test de non-régression 404 | — | §5 non touché |
| 4 | **E3** — écran « payer les soins d'un proche » (dépend de la décision E2) | 1 j | §5 |
| 5 | **B1** — faire relire les 6 clés `sos.*` par des locuteurs natifs FON et YOR | externe | — |
| 6 | **B2** — obtenir le contreseing médical (`Dossier_Validation_Clinique.docx`) | externe | — |
| 7 | **B3/B4** — ouvrir les comptes fournisseurs, poser les secrets, armer `DEPLOY_ENABLED`, dérouler la checklist | 1-2 j + délais tiers | — |
| 8 | **B5** — test de restauration à blanc des **deux** archives | 0,5 j | — |

**Les points 1 et 2 sont faits (19/08/2026).** Les points 5, 6, 7 dépendent de
tiers (locuteurs natifs, professionnel de santé, fournisseurs, hébergeur) et devraient être
lancés **en parallèle**, dès maintenant : ce sont eux qui déterminent la date de mise en service,
pas le développement.

---

## 6. Conclusion

Le code est **sain et vérifiable** : 350 tests + 8 e2e verts, typecheck et lint propres, build
complet, 27 migrations appliquées, compteurs exacts, invariants de design respectés, aucun modèle
mort, aucun module orphelin, aucun `TODO`. Les revues C1→C9 et D1→D10 sont effectivement closes.

Il reste **quatre écarts nouveaux**, dont **un bloquant** (E1, la recharge du portefeuille
diaspora ne redirige pas vers le paiement — la porte d'entrée de l'argent est fermée en
silence), et **cinq points de mise en service** dont trois dépendent de tiers et devraient être
engagés sans attendre.

Aucun de ces écarts ne remet en cause l'architecture ni les décisions verrouillées (§3), et aucun
ne touche la logique de paiement gelée (§5) — E1 se corrige en consommant une valeur déjà
renvoyée par le serveur.
