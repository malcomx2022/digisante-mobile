# Lot L0 — Baseline et livraison des corrections

> Date : 6 octobre 2026. Responsable d'exécution/revue : Codex, sur demande du porteur.
> Branche : `feat/l0-baseline-review`. Base main vérifiée via GitHub : `8f2f6ca24ad0543d6a08218932c783809eada9b1`.
> Statut : **LIVRÉ SUR MAIN — PR #178 et #179 fusionnées, CI candidate verte**. Aucune ouverture pilote ni recette production attestée.

## Périmètre et décisions

Le lot reprend le diff local existant sans l'écraser : quatre corrections de code et la documentation du plan. Il ajoute la matrice `docs/MATRICE_Perimetre_Pilote_2026-10.md`, cette fiche et la revue `docs/REVUE_L0_2026-10.md`. **Décision explicite du porteur du 6 octobre :** plan actuel, sept rôles, abonnements médecins L6 ; les abonnements patient/pharmacie/laboratoire/diaspora sont reportés après le pilote.

La structure initiale Claude Code, la stack, les droits, le design et la zone paiements sont conservés. L0 n'implémente ni L1–L11, ni les extensions CDC. Les PR se font par lot, avec revue avant fusion ; aucun merge automatique.

## Environnement de vérification

- Node **24.19.0** ; pnpm disponible **11.19.0**. Le dépôt/CI restent épinglés à **9.12.0**, sans changement du packageManager.
- Dépendances déjà provisionnées, lockfiles racine et node_modules concordants : SHA-256 `33a3f9fd827d3c3f082bcc7750242853ca5375ed0748137fae0f6a79a9f853eb`.
- `pnpm_config_verify_deps_before_run=false` utilisé uniquement dans l'environnement de test : pnpm 11 tente sinon une réinstallation dans un répertoire home indisponible. Aucune modification de configuration du dépôt pour masquer cet écart. Installation neuve avec pnpm 9 : non prouvée localement, **confirmée en CI** sur la candidate `6edcd427f5759c4b90c7bf58184193a55f456ac5` via `pnpm install --frozen-lockfile`, suivie des tests et builds verts.
- Conteneurs temporaires PostgreSQL **16** et Redis **7**, distincts des services dev préexistants ; bases séparées `digisante_l0_test`, `digisante_l0_e2e`, `digisante_l0_upgrade` ; Redis /1 et /2. Aucun outil ni test connecté à la production. Conteneurs L0 supprimés après les vérifications ; les services dev préexistants sont conservés.
- Chromium système **151.0.7922.173**, émulation Pixel 5. `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium` ; ne remplace pas un appareil Android réel.
- Build E2E : `NEXT_PUBLIC_API_URL=` et `E2E_API_PROXY=http://127.0.0.1:3011` au build. API en mode test, fournisseurs simulés.

## Commandes et résultats exécutés

| Contrôle | Résultat du 6 octobre |
|---|---|
| prisma generate | Client généré depuis le schéma candidat |
| prisma migrate deploy, bases API et E2E vierges | 29 migrations appliquées, aucun échec |
| pnpm release:check | **11 étapes vertes**, 87 s ; pas de skip demandé |
| Tests API / web | **390 / 50 passed**, aucun test d'intégration sauté |
| Tests scripts | **28 passed**, aucun échec/skip |
| Lint / typecheck / build shared, API, web | Verts |
| Schéma / statut / migrate diff | Valide, base à jour, aucune différence |
| Scan bundle web | 110 fichiers, aucun secret serveur détecté |
| pnpm test:e2e | **8 passed**, 14,8 s ; auth/routage et triage hors réseau |
| Répétition 28→29 | REFUND et TRANSFER_IN existants et solde 10 conservés ; REFUND_IN disponible ; aucun recrédit historique automatique ; aucune dérive |
| Revue finance admin | Assertions renforcées : **9 tests admin verts**, lint/typecheck API verts après ajout |
| metrics:check / i18n | Compteurs conformes ; EN complet ; FON/YOR manquants explicités dans la matrice |
| Plan DOCX | Régénéré et validé : ZIP/XML/relations/A4/tableaux/concordance source ; rendu visuel et signatures humaines non contrôlés |

Traces locales : `/workspace/work/digisante-l0/` (non versionnées, aucun secret réel). Les chiffres ci-dessus sont des résultats exécutés ; ils ne certifient pas la CI, le VPS ou les fournisseurs réels. Après l'ajout d'assertions de supervision finance : 9 tests ciblés verts, lint/typecheck API verts, puis **suite finale 390 API + 50 web verts** à 14:05 UTC, sans skip. Les sources applicatives sont identiques à celles du build/E2E validés ; seules les assertions et la documentation ont été complétées après cette baseline.

Le diagnostic de remboursement ci-dessous a été exécuté dans une transaction READ ONLY sur la base synthétique de migration : **1 candidat historique**, puis **0** après ajout d'un REFUND_IN synthétique de contrôle. Aucun compte réel n'a été lu ni crédité.

### Reproduction sur une pile dédiée

Utiliser Node 24 et pnpm 9.12.0, installer avec `pnpm install --frozen-lockfile`, puis fournir DATABASE_URL/REDIS_URL de **test** (Redis /1) et NODE_ENV=test. Générer Prisma et migrer cette base au préalable. Exécuter :

```text
pnpm release:check
NEXT_PUBLIC_API_URL= E2E_API_PROXY=http://127.0.0.1:3011 pnpm build
# Passer ensuite aux base PostgreSQL et Redis /2 dédiées aux E2E :
pnpm test:e2e
node scripts/docs/generate-implementation-plan.js
python scripts/docs/validate-implementation-plan.py
```

Ne jamais passer des variables production à cette séquence : les tests écrivent des fixtures et purgent Redis. `release:check` ne lance ni E2E ni recette fournisseur ; le contrôle linguistique strict reste attendu à L9.

## Migration et rapprochement des remboursements historiques

Migration additive : `apps/api/prisma/migrations/20261006130000_wallet_refund_in/migration.sql`. Répétée après les 28 migrations de main sur données synthétiques ; aucun enum existant retiré, aucune écriture de solde ou transaction historique dans le SQL. Appliquer avant le processus API qui peut écrire REFUND_IN. Au rollback code, conserver la valeur additive ; aucun retrait de l'enum ni reclassification des mouvements.

**Diagnostic en lecture seule**, à exécuter par l'opérateur habilité dans une session protégée ; aucune requête production effectuée pendant L0 :

```sql
BEGIN READ ONLY;
SELECT p.id, p."userId", p.amount, p."createdAt", p."updatedAt"
FROM payments p
WHERE p.method = 'WALLET'
  AND p.status = 'REFUNDED'
  AND p.type <> 'WALLET_TOPUP'
  AND NOT EXISTS (
    SELECT 1 FROM wallet_transactions t
    JOIN wallets w ON w.id = t."walletId"
    WHERE w."userId" = p."userId"
      AND t.reference = p.id
      AND t.type::text = 'REFUND_IN'
  )
ORDER BY p."updatedAt", p.id;
COMMIT;
```

Ces lignes sont des **candidates à examiner**, pas des crédits autorisés. Le débit initial porte une référence distincte, retrouvable dans `PAYMENT_CONFIRMED.meta.reference` ; vérifier débit réel, remboursement, éventuel crédit manuel déjà effectué, solde et justificatifs. La comparaison `type::text` rend le diagnostic utilisable même avant ajout de la valeur REFUND_IN. Valider ce diagnostic sur la fixture historique ; tracer chaque décision/correction dans le circuit financier L7, sans script de recrédit massif.

## CI et livraison

Base initiale vérifiée : main `8f2f6ca24ad0543d6a08218932c783809eada9b1`. Le run du 22 septembre était en échec ; les nouvelles preuves ci-dessous établissent la validation de L0.

- Candidate applicative **`6edcd427f5759c4b90c7bf58184193a55f456ac5`**, tree `f30df3685c76036fdfe2085b54390b7fd07bf0e9`, identique au tree local. [CI initiale](https://github.com/malcomx2022/digisante-mobile/actions/runs/37477134921) : **build-and-test et e2e réussis**, installation neuve pnpm 9.12.0 avec lockfile figé, migrations, lint/typecheck/tests/builds verts.
- [PR #178](https://github.com/malcomx2022/digisante-mobile/pull/178) **fusionnée le 6 octobre à 14:16:50 UTC**, merge `e9667c6940470bb80867304ccd05f9a6d5e18e14`. Sa tête figée était celle d'une PR déjà fusionnée, pas une anomalie de synchronisation. L'interprétation antérieure est corrigée par ce suivi.
- Complément documentaire **`fd2114e50587b37e7852ab6fbc0344e6ae37375b`** : aucune modification des sources applicatives après `6edcd427`. [CI finale](https://github.com/malcomx2022/digisante-mobile/actions/runs/37479080272) : **build-and-test et e2e réussis**, deploy sauté dans le contexte PR.
- [PR #179](https://github.com/malcomx2022/digisante-mobile/pull/179) **fusionnée le 6 octobre à 14:31:01 UTC**, merge **`2ee3cfb247a5283553aacec0527ca0582c7c21f9`**, tree `6d656d9bdf10c8bc9eb370d9ece6141143732bff`.
- [CI push main après fusion](https://github.com/malcomx2022/digisante-mobile/actions/runs/37479625121) : consulter son résultat et la condition deploy avant toute décision d'exploitation. Une fusion Git et les tests simulés ne certifient ni livraison VPS ni ouverture clinique.

Ces fusions ont été constatées via GitHub ; cette session n'a pas appelé l'API de merge. Les commits distants exacts, y compris les merges signés, ont été importés localement. La correction de ce constat est portée sur `docs/l0-merge-evidence`, sans changement applicatif. Pour les lots suivants : vérifier aussi `merged`/`merged_at`, la tête main et les événements de livraison avant de conclure à une discordance de refs ou de modifier une PR.

## Critères de clôture

| Critère | État |
|---|---|
| Branche L0 et préservation du diff | Fait |
| Main distant vérifié | Fait |
| Quatre corrections et régression | Validés localement |
| E2E et migration/reprise conservatrice | Validés localement |
| Matrice périmètre / écarts CDC | Produite ; report des autres abonnements confirmé par le porteur |
| Revue finale et documentation Claude Code | Produites ; DOCX et concordance Markdown validés |
| Candidate versionnée, PR et CI complète | `6edcd427` puis `fd2114e` : deux jobs CI verts ; PR #178/#179 fusionnées |
| Fusion sur main | Constatée : `2ee3cfb` après PR #178 et #179 |
| Déploiement / ouverture pilote | Aucun PV de déploiement ou validation externe produit par L0 |

Le lot dépendant suivant repart du main fusionné et vérifié, sur une nouvelle branche L1, en conservant les limites de la matrice. Les validations externe/clinique et les lots L1–L11 restent à réaliser.
