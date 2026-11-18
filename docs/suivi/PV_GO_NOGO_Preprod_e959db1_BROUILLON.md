# PV GO/NO-GO préproduction — candidate `e959db1` (BROUILLON)

> **Brouillon préparé le 17/11/2026 à 23h45 WAT, §2 complété le 18/11/2026 à 11h45 WAT, non signé.** Les cases ☐ attendent une observation réelle. Le verdict
> (§8) revient au porteur ; rien dans ce document ne vaut décision tant qu'il n'est pas daté et signé.
> Règle (comme dans `GO_NOGO_2026-09-22.md`) : **une case sans preuve d'exécution datée vaut NO-GO**. Un plan, un
> script prêt ou une CI verte ne sont pas des preuves.

| Élément | Valeur |
|---|---|
| Environnement | préproduction `preprod.digisantemobile.app` (hôte partagé `srv1.immipro.app`, dérogation du 13/10/2026) |
| Candidate | `e959db1cf297c1f29787f5643c7c872be012386e` (`main` après #260) |
| CI `main` | run 43887123511 : `build-and-test` + `e2e` réussis ; `preprod:qualify` code 0 |
| Déclaration au registre | PR #261 fusionnée (`main` = `4e95663`, documentation seule, instantané L10 inchangé `4c1e9558…`) |
| Outillage de déploiement | `4e9566339cb374066942bc6bec5a791cd76bf578` |
| Version précédente | `ace0c689` (recette abandonnée le 08/11, aucune preuve transférée) |
| Journal de la fenêtre | `~/digisante-fenetre-L10/journal.log` (VPS, hors dépôt) |

## 1. Fenêtre de déploiement du 17/11/2026 (20h14 → 21h02 WAT)

Déroulé selon `PLAN_Deploiement_Preprod_2026-11-08.md` §3.

| # | Étape | Constat daté | Verdict |
|---|---|---|---|
| W1 | Vérifications préalables (candidate dans `main`, gel du code, CI verte, maintenance, clé de sauvegarde, R2, `/ready`) | 19h08 : 8/8 OK | ✅ |
| W2 | Arrêt PM2 prod + suspension des crons préprod | 20h14 : crons sauvegardés dans `/root/cron-suspendu-digisante-preprod` | ✅ |
| W3 | Sauvegarde **avant** | trio `20261117_201503` conforme (DB + fichiers + manifeste SHA256, 1/1 fichier) ; copie R2 `immipro-backups/digisante-preprod-fenetre-L10/avant-20261117_201503` | ✅ |
| W4 | Copies root préprod **et** prod à `e959db1` (P7) | 20h17–20h18 : 20 fichiers chacune, même installeur | ✅ |
| W5 | Provisioning `pg,valkey,nginx,cron` + `.env` | rôle PG `digisante_preprod_app` et utilisateur ACL Valkey `digisante-preprod` créés ; `.env` API mis à jour (0600) ; connexion PG + PONG Valkey vérifiés 20h29 | ✅ |
| W6 | Déploiement par workflow | 1er essai 20h49 **FAILED stage=migrations** (secret, voir §5) ; 2e essai run 44163350040, `deploy_history` 20h56:35 `status=SUCCESS stage=complete` | ✅ |
| W7 | Vérifications post-déploiement | `/ready` OK, CSP à nonce variable, `/showcase` 404, maintenance 403 hors liste blanche ; 36/36 migrations appliquées (contrôle direct). FAIL attendus : crons suspendus ; 1 FAIL migrations = défaut de `verify_deploy.sh` (§5, I-3) | ✅ avec réserve I-3 |
| W8 | Sauvegarde **après** | trio `20261117_210156` conforme (1/1 fichier) ; copie R2 `…/apres-20261117_210156` | ✅ |
| W9 | Reprise | crons préprod repris 21h02:00 ; PM2 prod relancé ; `PREPROD_DEPLOY_ENABLED=false` ; maintenance préprod et prod **laissées** | ✅ |

Production : reste en `ec6b0dc` sous maintenance ; seule sa copie root est passée à `e959db1`.

## 2. Observation des crons (contrat L10 §4)

Une ligne installée ou un appel manuel ne prouve pas l'exécution planifiée : il faut une exécution réelle **après 21h02
le 17/11**.

| Tâche | Horaire | Exécution observée | Verdict |
|---|---|---|---|
| `notifications/dispatch` | */2 min | 23h34:02 HTTP 200 `processed 0` | ✅ |
| `reminders/generate` (médicaments) | */5 min | 23h30:04 HTTP 200 | ✅ |
| `appointments/reminders/generate` | */15 min | 23h30:04 HTTP 200 | ✅ |
| `healthwatch.sh` | 30 min | 23h30:06, backlog OK, webhooks OK | ✅ |
| `pg_dump_encrypted.sh` | 01:30 | 18/11 01h30:07 « Terminé ✓ », trio `20261118_013005` publié, purge > 14 j : 3 fichiers ; `check-backup.mjs` (11h41) code 0 : DB + fichiers + manifeste SHA256 conformes, `files_missing=0` (1/1) | ✅ |
| `fedapay_reconcile.sh` | 02:30 | 18/11 02h30:07 « Réconciliation acceptée (HTTP 200) » `{"scanned":4,"resolved":0,"failed":0}` | ✅ |
| `sync/receipts/prune` | 03:10 | 18/11 03h10:03 HTTP 200 `{"deleted":0}` | ✅ |
| **`retention/purge` (purge D-8)** | **03:20** | 18/11 03h20:03, **première exécution** : `retention.log` créé, HTTP 200, `dryRun:false` ; `NOTIFICATIONS` et `SOS_CLOSED` `enabled:false`, `retentionDays:null`, 0 trouvé / 0 supprimé : conforme à l'attendu (aucune durée configurée, D-8 ouverte) | ✅ |
| certbot | 03:45 / 15:45 | 18/11 03h45:11 (`letsencrypt.log`, `certbot.log` vide en `--quiet`) : certificat non dû (expire le 12/01/2027), `no renewal failures` | ✅ |
| `vaccinations/reminders/generate` | 06:30 | 18/11 06h30:05 HTTP 200 `{"generated":0}` | ✅ |
| `maternity/reminders/generate` | 06:40 | 18/11 06h40:04 HTTP 200 `{"generated":0}` | ✅ |
| `verify_deploy.sh` rejoué **après** reprise des crons | 18/11 11h41 | 33 PASS, 0 avertissement, **plus aucun FAIL cron** ; seul FAIL : migrations (I-3, faux positif) ; contrôle direct `_prisma_migrations` : 36/36 terminées, 0 annulée, 36 dossiers dans le dépôt. Sortie : `~/digisante-fenetre-L10/verify_deploy_18-11.txt` | ✅ avec réserve I-3 |

Crons fréquents : aucun appel en échec ni HTTP ≠ 200 entre le 17/11 21h02 et le 18/11 11h38 (dernier `dispatch` 11h38:02 HTTP 200, `med_reminders` 11h35:02, `appt_reminders` 11h30:04, `healthwatch` sans alerte).

**Bilan §2 : 12/12 ✅** (dont `verify_deploy` avec la seule réserve I-3). La condition de la proposition A (§8) est remplie.

## 3. Sauvegardes

| Point | Constat | Verdict |
|---|---|---|
| Trio avant / après fenêtre, SHA256 conformes | §1 W3 / W8 | ✅ |
| Copie hors VPS | R2 `immipro-backups/digisante-preprod-fenetre-L10/` | ✅ |
| Sauvegarde planifiée post-déploiement | §2 : trio `20261118_013005` conforme (`check-backup.mjs` code 0) ; non copié sur R2 (hors portée de la fenêtre) | ✅ |
| Restauration réelle par un tiers sur hôte distinct | non faite : **L11**, hors portée de ce PV | — |

## 4. Recette L10 sur `e959db1` (registre)

`pnpm preprod:gate --expected-sha e959db1…` le 17/11 à 23h40 : bloc candidat accepté, **100 points ouverts**
(registre vide, aucune preuve de `ace0c689` transférable).

| Famille | Cas ouverts |
|---|---:|
| Infrastructure (I1–I9) | 9 |
| FedaPay sandbox (S1–S10, S8 en premier) | 10 |
| Twilio (T1–T12) | 12 |
| Firebase (Android + iPhone, F9) | 17 |
| Resend (R1–R6) | 6 |
| Daily (D1–D21) | 21 |
| Abonnements (A1–A17) | 17 |
| Finances (F1–F8) | 8 |
| **Total** | **100** |

Gestes de recette préalables (plan §5) : ré-acceptation des CGU par les comptes de recette ☐, nouveau KYC des
pharmacies de recette ☐, verrous OTP (nouvelle époque) ☐, bandeau « Projet de texte » sur les textes légaux ☐.

Points à observer en plus (plan §6) : CSP à nonce sur Android ancien / iPhone / WebView ☐, verrou OTP par IP derrière NAT
opérateur ☐, effacement APDP de bout en bout ☐, refus `TRUNCATE`/`UPDATE` d'audit sous le rôle d'exécution et aucune
erreur `NOPERM` ☐, purge D-8 (§2) ☐.

## 5. Incidents de la fenêtre

| # | Incident | Traitement | Suite |
|---|---|---|---|
| I-1 | Secret GitHub `PREPROD_DB_MIGRATION_URL` faux → 1er déploiement `FAILED stage=migrations` (20h49), aucune migration appliquée | 20h51 : URL du rôle propriétaire vérifiée par connexion réelle puis secret remplacé ; 2e essai SUCCESS | Clos |
| I-2 | `VALKEY_APP_PASSWORD` affiché à l'écran par erreur | 20h42 : mot de passe changé, nouveau actif dans le `.env` | Clos ; vérifier que le coffre contient le **nouveau** ☐ |
| I-3 | `verify_deploy.sh` l.119 lance `prisma migrate status` avec le rôle d'exécution → faux FAIL « base non à jour » (36/36 appliquées) | PR #262 (brouillon) : lecture sous `postgres` | Fusion après ce PV, puis réinstallation des copies root (préprod **et** prod) ; **change l'instantané L10 ?** à vérifier avant fusion |
| I-4 | Script d'opérateur 05 : faux « ÉCHEC » (motif `grep` sur l'ancienne ligne FAILED) | Corrigé dans le script local | Clos |

## 6. Décisions du porteur à reprendre pour cette candidate

Les décisions prises pour `ace0c689` (`PLAN_GO_Preprod_ace0c689.md` §6) **ne se transfèrent pas d'office** : à
reconfirmer, dater et signer pour `e959db1`.

| # | Objet | Décision sur `ace0c689` | Pour `e959db1` |
|---|---|---|---|
| D-1 | OTP vocal Bénin (T7) | ouverte | ☐ |
| D-2 | T11 en N/A (aucun numéro SOS public) | décision du 21/10 | ☐ reconfirmer |
| D-3 | Paiement d'abonnement par wallet médecin (A8) | ouverte | ☐ |
| D-5 | Phase 2 Finances en LIVE (F1, F3, F4) | ouverte | ☐ |
| D-6 | Remboursement REQUESTED 6 560 XOF (F2) | ouverte | ☐ |
| D-7 | Second admin finance (F5) | ouverte | ☐ |
| D-8 | Politique de conservation (F8, purge D-8) | ouverte, L11 | ☐ |
| D-9 | I2 hôte partagé | dérogation 13/10, arbitrage L11 | ☐ reconfirmer |
| D-10 | Approbation FedaPay tardive (S10) | ouverte | ☐ |
| D-11 | Moov (T2, T12) et iOS (F*-IPHONE, A17) | ouverte | ☐ |
| D-12 | F9 (rebuild = nouveau candidat) | ouverte | ☐ |
| D-13 | Alertes healthwatch en syslog local | tranchée (a) le 22/10 pour la préprod | ☐ reconfirmer ; `ALERT_CMD` requis avant prod |
| D-15 | 3 clés `subscriptions.method_*` FON/YOR (gate L9) : intégrer = nouveau déploiement et nouvelle candidate | ouverte (`LOT_L10.md`, 17/11) | ☐ |

## 7. Hors portée de ce PV

L9 humain (campagne `L9-2026-11-17` : clés FON/YOR, preuves natives, contreseings cliniques), L11 (restauration par un
tiers, rollback répété, recette 7 rôles, pentest, arbitrage I2, conservation), ouverture de la production. Un GO ici ne
vaut ni GO pilote ni GO production.

## 8. Verdict

Deux décisions distinctes, à cocher par le porteur :

**A. Déploiement technique de `e959db1` en préproduction**
Proposition : **GO**, sous réserve que toutes les cases ☐ du §2 soient ✅ (exécutions nocturnes du 18/11 + `verify_deploy`
rejoué) — **remplie le 18/11 à 11h45, voir le bilan §2**. En cas d'échec d'une tâche : NO-GO jusqu'à correction ; le retour arrière suit le plan §4.
☐ GO ☐ NO-GO — motif : ……………………………………………

**B. Levée de la maintenance préprod (accès hors liste blanche)**
Proposition : **NO-GO** en l'état : 0/100 cas L10 prouvés sur `e959db1`, gestes de recette §4 non faits, décisions §6 non
reconfirmées. La recette se déroule **sous maintenance** (IP de recette en liste blanche), comme pour `ace0c689`.
☐ GO ☐ NO-GO — motif : ……………………………………………

| Rôle | Nom | Date et heure (WAT) | Signature |
|---|---|---|---|
| Porteur | | | |
| Opérateur | | | |

## 9. Suite si A = GO

1. Fusionner #262 (après vérification de l'instantané L10), puis réinstaller les copies root préprod et prod.
2. Gestes de recette §4, puis rejouer les 100 cas dans l'ordre de `PLAN_GO_Preprod_ace0c689.md` §2 (infra → FedaPay S8
   d'abord → Twilio → Firebase → Resend → abonnements), chaque PASS inscrit au registre et le gate rejoué.
3. Nouveau PV (décision B) quand le gate ne laisse que des cas couverts par une décision signée.
