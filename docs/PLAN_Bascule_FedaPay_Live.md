# Plan de bascule FedaPay SANDBOX → LIVE (quatre yeux) — prompt 11

> **Date de rédaction** : 22 septembre 2026 · **Nature** : plan d'exécution, **aucun code modifié**.
> Claude Code **ne saisit aucune clé** et ne prétend pas l'avoir fait : toutes les saisies sont
> faites par l'**opérateur** (SUPER_ADMIN) sous le contrôle d'un **second** membre de l'équipe
> (principe des quatre yeux). Toutes les valeurs restent masquées (4 derniers caractères au plus).

## 0. Portes d'entrée — état au 22/09/2026 : **NO-GO**

| # | Condition préalable | Preuve attendue | État |
|---|---|---|---|
| P1 | Recette sandbox **signée** (S1, S2, S3, S5, S6, S7 de `RECETTE_FedaPay_Sandbox.md`) | fiche datée, opérateur + relecteur | ❌ non exécutée (aucune clé sandbox) |
| P2 | Patch §5 d'idempotence atomique **appliqué et revu** + S7 rejoué | commit + PR + re-tests webhooks | 🟠 partiel — **appliqué le 22/09/2026** (accord du porteur, re-tests webhooks verts, cf. `RECETTE_FedaPay_Sandbox.md` §1) ; **S7 à rejouer en bac à sable** (aucune clé sandbox) |
| P3 | Production B3 opérationnelle (HTTPS, `health`/`ready`, crons dont réconciliation 02:30) | `SUIVI_B3` phases 1→6 cochées | ❌ VPS non provisionné |
| P4 | Sauvegarde **pré-bascule** + restauration testée (B5) | archives `digisante_db_<stamp>` + `digisante_files_<stamp>` du jour, B5 validé | ❌ |
| P5 | Compte FedaPay **live** validé (KYC marchand) | statut « activé » côté FedaPay | ❌ |
| P6 | Deux personnes disponibles dans la même fenêtre (opérateur + contrôleur) | noms consignés §4 | ☐ |

**Tant qu'une ligne est ❌, ne pas exécuter la suite.**

## 1. Fenêtre de bascule (≈ 45 min, heure creuse, ni 02:00–03:00 — sauvegarde + réconciliation)

| Étape | Qui | Action | Contrôle (par le 2ᵉ) |
|---|---|---|---|
| 1 | Opérateur | Sauvegarde immédiate : `sudo /var/www/digisante-mobile/infra/deploy/scripts/pg_dump_encrypted.sh` | 2 archives du même horodatage présentes |
| 2 | Opérateur | Dashboard FedaPay **live** : créer l'endpoint webhook `https://<domaine>/api/v1/payments/webhook`, **révéler** son secret | URL exacte (HTTPS, bon domaine) |
| 3 | Opérateur | `/admin/integrations` → **FEDAPAY** → saisir **dans le même `PUT`** : `secretKey` (`sk_live_…`), `publicKey` (`pk_live_…`), `webhookSecret` (**le nouveau**, live) | le `PUT` remplace TOUT : les 3 clés présentes ; affichage masqué `••••` ; `source=db` |
| 4 | Contrôleur | **Tester** (readiness) | `ok: true, missing: []` |
| 5 | Contrôleur | `/admin/audit` : `INTEGRATION_UPDATE` (clés **nommées**, aucune valeur) + `INTEGRATION_TEST` | ligne présente, pas de secret |
| 6 | Opérateur | Transaction **réelle minimale** (recharge du plus petit montant accepté, compte synthétique de l'équipe) | redirection vers la page FedaPay **live** |
| 7 | Contrôleur | `/admin/finance` : le paiement passe **PENDING → COMPLETED** en < 2 min ; audit `PAYMENT_CONFIRMED source=webhook` ; solde crédité **une seule fois** | capture non sensible |
| 8 | Contrôleur | Logs : `grep -Eic 'sk_live|wh_live' /var/log/digisante/*.log` → **0** | 0 occurrence |
| 9 | Opérateur | Dashboard FedaPay : **renvoyer** l'événement de l'étape 6 | réponse `idempotent: true`, **aucun** crédit supplémentaire |
| 10 | Les deux | Rapprochement : montant FedaPay = montant `/admin/finance` ; commission 3 % cohérente | écart = 0 |
| 11 | Opérateur | Remboursement : le reversal interne (`/admin/finance`) + **retour opérateur manuel** côté FedaPay (étape tracée, hors API) | `PAYMENT_REFUND` + preuve FedaPay |

⚠️ L'environnement est **déduit de la clé** : il n'existe **pas** de `FEDAPAY_ENV`. Remplacer la clé
suffit — **et** le secret webhook doit être roté **dans le même `PUT`**, sinon 401 systématiques.

## 2. Rollback (décision du contrôleur, immédiat)

| Symptôme | Action |
|---|---|
| Webhooks en 401 (secret désynchronisé) | re-`PUT` le jeu complet avec le secret affiché par FedaPay ; rattrapage par réconciliation 02:30 ou `POST /payments/reconcile` |
| Transaction refusée / comportement anormal | `PUT` du jeu **sandbox** précédent (clés conservées hors dépôt) **ou** `PATCH enabled=false` (paiements en stub : aucun encaissement possible — prévenir) |
| Double crédit / montant incohérent | `PATCH enabled=false` **immédiat**, remboursement admin des écritures en trop, analyse ; ne réactiver qu'après correctif revu (§5) |
| Incident de données | restauration depuis l'étape 1 (`SUIVI_B5`) |

## 3. Vérifications post-bascule (J+0 → J+1)

- [ ] Audit `INTEGRATION_UPDATE` / `INTEGRATION_TEST` présents, **sans valeur** de secret.
- [ ] Aucune occurrence de secret dans les journaux (étape 8, rejouée à J+1).
- [ ] Réconciliation de 02:30 exécutée (J+1) : aucun paiement PENDING > 1 h non résolu.
- [ ] Paiement unique, crédit unique (étapes 7 et 9).

## 4. Traçabilité (à remplir le jour J — jamais de valeur de clé)

| Champ | Valeur |
|---|---|
| Date / heure (Africa/Porto-Novo) | |
| Opérateur (SUPER_ADMIN) | |
| Contrôleur | |
| Clé live — 4 derniers caractères | •••• |
| Secret webhook live — 4 derniers caractères | •••• |
| ID transaction de contrôle — 4 derniers caractères | •••• |
| Résultat (GO / rollback) | |

Une fois rempli, reporter la ligne **FedaPay (live)** de `SUIVI_B4_Comptes_2026-09.md` avec cette
date, l'opérateur et la preuve non sensible — et seulement alors.
