# Lot L0 — Baseline et livraison des corrections

> Date : 6 octobre 2026. Responsable d'exécution/revue : Codex, sur demande du porteur.
> Branche : `feat/l0-baseline-review`. Base main vérifiée via GitHub : `8f2f6ca24ad0543d6a08218932c783809eada9b1`.
> Statut : **VALIDÉ LOCAL + CI — PR #178 ouverte, fusion à effectuer**. Aucun déploiement ni ouverture pilote.

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

Le main distant a été revérifié via le connecteur le 6 octobre. Dernier run trouvé pour cette révision : [CI n°385](https://github.com/malcomx2022/digisante-mobile/actions/runs/35799186291), créé le **22 septembre**, en échec ; jobs build-and-test/e2e sans étape exécutée, deploy sauté. Ce constat historique ne suffit pas à diagnostiquer le compte GitHub aujourd'hui.

Candidate publiée : **`6edcd427f5759c4b90c7bf58184193a55f456ac5`**, tree `f30df3685c76036fdfe2085b54390b7fd07bf0e9`, identique au tree local. [PR #178](https://github.com/malcomx2022/digisante-mobile/pull/178), branche `feat/l0-baseline-review`, base `main`. Publication via le connecteur GitHub, l'accès Git terminal étant bloqué par le proxy ; le commit distant exact a été importé localement.

[CI candidate du 6 octobre](https://github.com/malcomx2022/digisante-mobile/actions/runs/37477134921) : **build-and-test et e2e réussis**. Installation avec lockfile figé, génération/migration Prisma, lint, typecheck, tests et build réussis ; Playwright exécuté dans son job dédié. Le job deploy est sauté conformément au déclenchement PR : aucun déploiement. La présente mise à jour documentaire ne modifie pas les sources applicatives ; ses checks de tête restent à vérifier sur la PR avant fusion.

La PR est destinée à la revue du porteur. Aucun merge automatique ; L0 est validé pour revue, sans attestation de déploiement ni d'ouverture clinique.

## Critères de clôture

| Critère | État |
|---|---|
| Branche L0 et préservation du diff | Fait |
| Main distant vérifié | Fait |
| Quatre corrections et régression | Validés localement |
| E2E et migration/reprise conservatrice | Validés localement |
| Matrice périmètre / écarts CDC | Produite ; report des autres abonnements confirmé par le porteur |
| Revue finale et documentation Claude Code | Produites ; DOCX et concordance Markdown validés |
| Candidate versionnée, PR et CI complète | Commit `6edcd427`, PR #178 ouverte, deux jobs CI verts ; revérifier les checks de tête avant fusion |
| Fusion / déploiement | Non effectués |

La fusion ne doit pas être déduite de cette validation locale et CI. Le lot dépendant suivant reprend main après la fusion convenue et sa revue, en conservant les limites de la matrice.
