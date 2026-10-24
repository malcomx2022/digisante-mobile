# Checklist finale de déploiement — DigiSanté Mobile (VPS IONOS partagé)

> Cible (dérogation porteur 13/10/2026) : VPS IONOS **partagé** `srv1.immipro.app` (Ubuntu 26.04,
> PostgreSQL 18.6 natif, Valkey 6379, Nginx + SSL Certbot), avec ImmiPro et BeninLink. Préproduction et
> production y cohabitent : PM2 (API cluster ×2 + web) par environnement. **Aucun Docker pour DigiSanté**
> (CLAUDE.md §3). Procédure détaillée et à jour : `infra/deploy/README.md` (elle prime sur cette liste).
>
> 🔒 **`DIGISANTE_ENV` (`preproduction` | `production`) est OBLIGATOIRE** sur chaque commande d'exploitation
> et pour `ecosystem.config.cjs` : il fixe noms PM2, ports (3100/3101 · 3200/3201), chemins, crontab
> `/etc/cron.d/digisante[-preprod]` et copie root `/usr/local/lib/digisante[-preprod]`. Dans cette liste,
> `<env>` = `preproduction` ou `production`, `${SUFFIX}` = `-preprod` ou vide. Root n'exécute JAMAIS un
> fichier du checkout (B3) : toujours la copie root de l'environnement.

> État au 8 octobre 2026 : L0–L8 code livrés ; L9 technique livré #189/a3f80a1, humain ouvert ; L10 outillage candidat et accès ultérieurs décidés par le porteur. Aucun déploiement ou GO pilote attesté ; recettes réelles et L11 restent ouverts.

## 0. Pré-requis
- [ ] DNS vers l'IP du VPS : `preprod.digisantemobile.app` (préproduction), `digisantemobile.app` + `www` (production).
- [ ] Accès SSH root/sudo.
- [ ] Dépôt GitHub accessible depuis le miroir root (`/var/lib/digisante${SUFFIX}/ops.git`).

## 1. Provisioning (une fois par environnement, root) — `infra/deploy/README.md` §1
- [ ] Miroir root + copie root des scripts (B3) : `sudo DIGISANTE_ENV=<env> bash /root/install_root_scripts${SUFFIX}.sh <SHA_COMPLET_QUALIFIE>` → `/usr/local/lib/digisante${SUFFIX}` + `root-scripts.manifest` (`environment=<env>`).
- [ ] Vérifications de l'hôte AVANT `--apply` (README §1.b, points 1–11, lecture seule, aucun secret affiché) : index Valkey **5/6 libres** et non utilisés par ImmiPro/BeninLink/Grafana, `CONFIG GET databases` ≥ 7, **`noeviction`** et persistance ; règle `pg_hba` `host <base> <rôle> 127.0.0.1/32 scram-sha-256` (+ `::1/128`) ajoutée **à la main, avant toute règle `trust` plus large** ; groupe `sshusers` / `AllowGroups`, **aucune règle sudoers `%sshusers`** ; DNS A → 31.70.148.167, **aucun AAAA** vers un autre hôte ; Certbot (chemin, `certbot.timer`, hooks `/etc/letsencrypt/renewal-hooks/{pre,post,deploy}` relus : `pre`/`post` s'exécutent au `renew --dry-run`, `deploy` au premier vrai renouvellement) ; `nginx -t` vert et **`default_server` explicite** sur 443 (site `default` sur 80) ; ports 3100–3201 libres ; mémoire/swap/disque et `max_connections` ; sauvegarde de `/etc/nginx`, `/etc/cron.d`, `/etc/logrotate.d` et des rôles PG ; fenêtre convenue avec les autres applications.
- [ ] **`provision-ionos.sh`** depuis la copie root, shell root (jamais `bash -x` : refusé), secrets par `read -rs` (jamais en argument ; `PG_APP_PASSWORD` (propriétaire) et `PG_RUNTIME_PASSWORD` (rôle d'exécution `<base>_app`, **distinct**) 24–256 caractères ASCII imprimables sans espace, ex. `openssl rand -hex 24`) : `bash $P` (**dry-run** : gardes + plan, aucune écriture, relu intégralement) → `bash $P --apply --only users,dirs,pg,valkey,runtime` → `--only nginx` → `--only cron`. Jamais `provision.sh` (ancien VPS 22.04, refuse cet OS).
- [ ] Checkout `/var/www/digisante${SUFFIX}` cloné **par** `digisante${SUFFIX}` (données seulement), `.env` créés (§2), puis `bash $P --apply --only secrets`.
- [ ] `bash $P --verify` (avec `VALKEY_PASSWORD` exporté, sinon FAIL) → **0 FAIL** (comptes sans sudo, clés SSH `restrict`, modes, rôle/base, `pg_hba` exigeant un mot de passe, marqueur Valkey et absence d'éviction, utilisateur ACL de l'API (droits mesurés par `ACL DRYRUN`) et `.env` sous cet utilisateur et ce préfixe, PM2 au boot, `corepack pnpm` = 9.12.0, vhost/certificat, maintenance signalée, cron B3 et aucune planification root sous le checkout, logrotate, `backup.key`, **B4** `KYC_STORAGE_DIR` absolu + présence du fichier ordinaire exact de chaque référence dans la base du profil) ; relancé après le premier déploiement.
- [ ] Rollback préparé : `bash $P --rollback` (dry-run) retire vhost/maintenance/cron/rotation/service PM2 seulement ; base, rôle, index Valkey, magasin, comptes, certificat **conservés** (suppression = décision humaine après sauvegarde, jamais `FLUSHDB`/`FLUSHALL`). Re-provisionnement après rollback : amorçage ACME réinstallé avant `renew --dry-run`.
- [ ] **À arbitrer avant GO production** (README, résiduel 6) : plafond mémoire de l'hôte partagé. Fuseau (résiduel 3) traité le 24/10/2026 : fuseau de l'hôte conservé, API épinglée et tâches quotidiennes gardées sur l'heure de Porto-Novo (décalage de l'hôte en heures entières exigé). Port squatté (résiduel 1) traité le 23/10/2026 pour le jeton de service et la readiness ; trafic Nginx seulement détecté (sonde `ports`), sockets Unix = décision porteur. Traités le 22/10/2026 (revue GO, à installer) : rôle PG d'exécution non propriétaire (résiduel 5) et isolement Valkey par utilisateur ACL + préfixe (résiduel 2 ; limites restantes : utilisateur `default` de l'hôte, mémoire/éviction communes — instance dédiée = décision porteur). Prérequis Valkey : **fichier ACL déclaré** par l'administrateur de l'hôte (`CONFIG GET aclfile`).
- [ ] Fuseau : `timedatectl` de l'hôte partagé à constater ; tout changement est une décision porteur (dérogation I2, L11) — il affecte aussi ImmiPro/BeninLink.

## 2. Secrets (jamais commités — cf. `docs/SECRETS_Production.md`)
- [ ] `apps/api/.env` (0600) depuis `.env.preprod.example` / `.env.prod.example` (noms seuls, secrets vides) puis rempli depuis le coffre : DATABASE_URL (`127.0.0.1:5432`, base de l'environnement, rôle **`<base>_app`** — jamais le propriétaire ; URL du propriétaire = secret GitHub `PREPROD_DB_MIGRATION_URL`/`DB_MIGRATION_URL` seulement), REDIS_URL (Valkey **/5** préproduction, **/6** production, sous l'**utilisateur ACL** `digisante-preprod`/`digisante` — `VALKEY_APP_PASSWORD`, jamais `default`) + `REDIS_KEY_PREFIX=digisante-preprod:`/`digisante:`, JWT_SECRET ≥32, **HEALTH_ENCRYPTION_KEY**, RECONCILE_TOKEN, `KYC_STORAGE_DIR=/var/lib/digisante${SUFFIX}-files`, `NODE_ENV=production` ; clés **distinctes** par environnement. Fournisseurs : base chiffrée via `/admin/integrations` (fallback `.env`).
- [ ] `apps/web/.env.production` : `NEXT_PUBLIC_API_URL` **vide** (même origine) + `NEXT_PUBLIC_FIREBASE_*` publics ; `NEXT_PUBLIC_SOS_NUMBER` seulement sur décision du porteur (vide en préproduction).
- [ ] `/etc/digisante${SUFFIX}/backup.key` (AES-256, générée par `--only secrets`) — **sauvegardée hors VPS**, distincte par environnement.
- [ ] `/etc/digisante${SUFFIX}/reconcile.token` (root, 0400) = **source unique** du jeton des tâches internes, aligné par `--only secrets` sur `RECONCILE_TOKEN` du `.env` de l'environnement.
- [ ] Compte **sans droits** des tâches `digisante${SUFFIX}-jobs` (créé par l'étape `users`, B3) : `internal_job.sh`/`fedapay_reconcile.sh` lisent le jeton en root puis lancent la requête sous ce compte (ni root, ni `digisante${SUFFIX}`) ; `verify_deploy.sh` → `PASS tâches : requêtes sous digisante${SUFFIX}-jobs`.
- [ ] `API_PORT`/`API_HOST` du `.env` sans effet : `ecosystem.config.cjs` impose le port de l'environnement et `127.0.0.1`.
- [ ] `apps/api/.env` en **0600** (`deploy.sh` refuse de déployer sans `.env` et corrige les permissions).

## 3. Premier déploiement
- [ ] Mise à jour du 06/10/2026 : migration `20261006130000_wallet_refund_in` appliquée avant le code de remboursement WALLET ; vérifier restitution + signe entrant dans l’historique.
- [ ] L1 : sauvegarde validée, maintenance et anciens workers API arrêtés avant `20261006144830_dmp_entry_expiry_authorship` ; redémarrer uniquement le code avec contrôle d'échéance par entrée. Prévenir les patients que les anciens liens nécessitent un nouveau partage. Pas de retour à l'ancien guard sur les liens NULL ; procédure détaillée `docs/suivi/LOT_L1.md`.
- [ ] L2 : annoncer la validation obligatoire des laboratoires, arrêter les anciens workers puis appliquer `20261006154628_laboratory_verification` avant le nouveau code. Aucune approbation héritée, commandes conservées/gelées jusqu'à habilitation ; procédure complète dans LOT_L2.
- [ ] L3 : sauvegarde, arrêt des anciens workers et migration `20261006164320_mutation_receipts` avant démarrage homogène ; renouveler les clients/SW, valider rejeu et cron `/sync/receipts/prune` à 03:10. Aucun backfill/rejeu des anciennes files ambiguës, aucun rollback vers un serveur ignorant les clés ; contrat et reprise dans LOT_L3.
- [ ] L4 : déployer API/client/SW v3 homogènes, fermer les anciens onglets ; tester upgrade IndexedDB v3→v4, erreur quota/blocked et tickets GET. Migrer chaque compte ou effacer volontairement après vérification des effets ; aucun appareil partagé/pilote avec héritage en clair. Vérifier cache public sans API/RSC/jetons, API Cache-Control et fetch no-store, vider les anciens caches HTTP navigateur avant partage ; reload sans réseau puis phrase, lock/TTL/purge. Contrat/limites dans LOT_L4 et CONTRAT_Hors_Ligne_L4 ; rollback client v3 incompatible, privilégier correction en avant.
- [ ] Revue administrative explicite de chaque structure : responsable + autorisation, identité figée et toutes les pièces vérifiées. Tester non-vérifié/refusé/suspendu, concurrence d'attribution et lecture patient/médecin. Pas de retour au guard sans badge ni réattribution automatique.
- [ ] Maintenance posée et vérifiée (README §3 : `snippets/digisante${SUFFIX}-maintenance.conf`, IP de recette + IP de l'hôte, IPv4 et IPv6 si AAAA, `nginx -t`, reload ; levée = suppression du fichier après autorisation) puis `deploy.sh` de **`origin/main` extrait hors du checkout** (commande exacte : README §3, comme les workflows ; jamais `bash infra/deploy/scripts/deploy.sh` du checkout, que bash relit après `git switch`), sous `digisante${SUFFIX}`, `DEPLOY_REF=<SHA_COMPLET_QUALIFIE> DEPLOY_ENVIRONMENT=<env> DEPLOY_MAINTENANCE_READY=1`
      → arrêt des anciens workers **de cet environnement** → SHA exact → install gelé (shim `pnpm` → `corepack pnpm`, version du `packageManager`, appels imbriqués compris ; version de la cible préparée **avant** l'arrêt PM2) → prisma generate → **build avant migrate deploy** → démarrage homogène/readiness 127.0.0.1:3101|3201 ; échec tracé, maintenance conservée.
- [ ] `sudo -u digisante${SUFFIX} pm2 status` : `digisante${SUFFIX}-api` (×2, online) + `digisante${SUFFIX}-web` (online).
- [ ] Après tout changement de `infra/deploy/root-scripts.list` : `sudo DIGISANTE_ENV=<env> /usr/local/lib/digisante${SUFFIX}/infra/deploy/scripts/install_root_scripts.sh <SHA_DEPLOYE>` (README §3 bis) ; si le diff touche `nginx/*`, `logrotate/*` ou `crontab*.example` : `bash $P --only nginx,cron` (dry-run) → `--apply --only nginx,cron` → `--verify` (deux copies root au même SHA pour les fichiers Nginx communs).

## 4. Nginx + SSL + rate-limit
- [ ] Installé par `provision-ionos.sh --apply --only nginx` depuis la copie root (B3) : `conf.d/digisante-rate-limit.conf`, `snippets/digisante-{headers,hsts}.conf` (communs, préfixés), vhost `digisante${SUFFIX}` (aucune édition à la main ; maintenance = fichier séparé `snippets/digisante${SUFFIX}-maintenance.conf`, README §3).
- [ ] Certificat `certbot certonly --webroot -w /var/www/digisante-acme --cert-name <domaine>` (dry-run Let's Encrypt d'abord) — **jamais `certbot --nginx`** ; `certbot renew --cert-name <domaine> --dry-run` vert avant HSTS.
- [ ] `sudo nginx -t` vert ; **ne pas** supprimer le site `default` ni toucher aux vhosts ImmiPro/BeninLink/supervision.
- [ ] `curl -sI https://<domaine>/` : HSTS, `X-Frame-Options`, `nosniff`, `Referrer-Policy` ; `curl -sI https://<domaine>/api/v1/health | grep -ci '^strict-transport-security'` = **1** (`max-age=86400`, HSTS de l'API masqué) ; production : `https://www.digisantemobile.app` → 301 vers l'apex.

## 5. Crons
- [ ] **Aucun secret dans la crontab** : les tâches passent par `internal_job.sh`, qui lit `/etc/digisante${SUFFIX}/reconcile.token` et journalise `ÉCHEC` (code 1) si le jeton manque ou si l'API répond ≠ 2xx.
- [ ] Fichier **`/etc/cron.d`** de l'environnement (JAMAIS `crontab <fichier>`, qui remplacerait la crontab root d'ImmiPro/BeninLink ; chargé ainsi, le 6ᵉ champ `root` ferait échouer chaque tâche) :
      `sudo install -o root -g root -m 0644 /usr/local/lib/digisante${SUFFIX}/infra/deploy/crontab.preproduction.example /etc/cron.d/digisante-preprod` (production : `crontab.example` → `/etc/cron.d/digisante`)
      → rappels **traitements** (5 min), **RDV** (15 min), **vaccination PEV** (06:30), **CPN maternité** (06:40), **dispatch** (2 min), **pg_dump + fichiers chiffrés** (production 02:00, préproduction 01:30), réconciliation FedaPay 02:30, renouvellement SSL.
- [ ] `sudo grep -E '^DIGISANTE_ENV=' /etc/cron.d/digisante${SUFFIX}` et `sudo crontab -l` sans aucune ligne DigiSanté.
- [ ] Vérifier que les générateurs + le dispatch répondent 200 (sans exposer le jeton ; préproduction synthétique uniquement — en production, observer les journaux cron) :
      `J=/usr/local/lib/digisante-preprod/infra/deploy/scripts/internal_job.sh; for p in reminders appointments/reminders vaccinations/reminders maternity/reminders; do sudo DIGISANTE_ENV=preproduction $J /api/v1/$p/generate; done; sudo DIGISANTE_ENV=preproduction $J /api/v1/notifications/dispatch` → lignes `OK (HTTP 200)`
      ⚠️ Les générateurs **vaccination** et **CPN** n'étaient PAS planifiés avant août 2026 : sans eux, aucun rappel de vaccination ni de consultation prénatale n'est émis — en silence.

## 6. Déploiement continu (GitHub Actions)
- [ ] Secrets repo : `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_FINGERPRINT` (empreinte d’hôte, obligatoire) (+ `VPS_SSH_PORT`).
- [ ] **Variables** `DEPLOY_ENABLED=true` ET `DEPLOY_MAINTENANCE_READY=true`, seulement dans une fenêtre autorisée/maintenance Nginx vérifiée ; désactiver hors fenêtre.
- [ ] Clé publique de déploiement installée par `provision-ionos.sh --apply --only users` (`DEPLOY_SSH_PUBKEY`) : ligne **`restrict <clé>`** dans `~digisante/.ssh/authorized_keys` (préproduction : `~digisante-preprod`, secrets `PREPROD_VPS_*`) ; à la main, toujours avec `restrict` (sinon `--verify` : FAIL).
- [ ] Les deux workflows de déploiement partagent le groupe de concurrence `deploy-ionos-srv1` : un seul build/déploiement DigiSanté à la fois sur l'hôte.
- [ ] Push sur `main` → CI (`build-and-test` **et** `e2e`) → `deploy` SSH (`deploy.sh`) si l'opt-in est actif. La PR L0 ne déploie pas.

## 7. Vérifications post-déploiement
- [ ] `sudo DIGISANTE_ENV=<env> DOMAIN=<domaine> /usr/local/lib/digisante${SUFFIX}/infra/deploy/scripts/verify_deploy.sh` → PASS (PM2, migrations, TLS, health/ready, WS, cron.d, copie root, **ports 3100/3101 — prod 3200/3201 — tenus par `digisante${SUFFIX}` seul**, sinon port squatté : ne pas lever la maintenance).
- [ ] `curl https://<domaine>/api/v1/health` → `{ "status": "ok" }` ; `/api/v1/ready` → `db: up, redis: up`
- [ ] PWA installable, `/onboarding` accessible ; SOS testé **avec réseau**, preuve d'envoi au contact/numéro de secours. Hors réseau : repli vers les numéros d'urgence validés, aucune promesse de SMS transmis sans connexion.
- [ ] Webhook FedaPay : URL `https://…/api/v1/payments/webhook` configurée côté FedaPay (HMAC).
- [ ] Sauvegarde : lancer `sudo DIGISANTE_ENV=<env> /usr/local/lib/digisante${SUFFIX}/infra/deploy/scripts/pg_dump_encrypted.sh` une fois et vérifier que **DEUX** fichiers
      apparaissent dans `/var/backups/digisante${SUFFIX}/` :
      `digisante_<stamp>.sql.gz.enc` (base) **et** `digisante_files_<stamp>.tar.gz.enc` (magasin de fichiers).
- [ ] ⚠️ Si le script journalise « magasin de fichiers introuvable », **corriger `KYC_STORAGE_DIR`**
      dans `apps/api/.env` avant toute mise en service. Ce répertoire contient les pièces KYC **et,
      depuis août 2026, les pièces jointes du DMP — donc des données de santé** ; il ne vit pas dans
      PostgreSQL. Une restauration du seul `pg_dump` laisserait des entrées de dossier pointant vers
      des fichiers disparus. (Automatisé depuis août 2026 — ce n'est plus une étape manuelle.)
- [ ] Sauvegarde : **trois** fichiers par horodatage — base, fichiers, et `digisante_manifest_<stamp>.txt`
      (comptages + SHA-256 + tête de chaîne d'audit, sans donnée personnelle).
- [ ] Test de restauration sur machine tierce : `verify_restore.sh` (SUIVI_B5 §2) → tous PASS, puis
      `--cleanup`. Une sauvegarde jamais restaurée n'est pas une sauvegarde.
- [ ] Audit : trigger anti UPDATE/DELETE actif (tester un UPDATE sur `audit_logs` → rejet).

## 8. Conformité (rappels release)
- [ ] Audit OWASP/STRIDE à jour (`docs/SECURITE_Audit_OWASP_STRIDE.md`).
- [ ] Chiffrement santé actif (`HEALTH_ENCRYPTION_KEY` présent → données en `encryptedData`).
- [ ] Rétention sauvegardes (14 j) + clé de chiffrement hors VPS.

---

**Contrôles techniques actuels ; ouverture pilote non attestée.** Le code (backend **28 modules** / **183 endpoints REST + 1 WS**
+ frontend **7 espaces**, **67 pages**) est testé (**856 tests verts** — 711 API + 145 web (déclarations statiques, résultats d’exécution détaillés dans LOT_Revue_2026-10-14), + 24 e2e
Playwright — preuves du 7 octobre 2026 dans LOT_L4), l'infra scriptée. Restent la livraison L7 et la finalisation L8–L11, la validation humaine et l'exécution sur
le VPS réel (étapes ci-dessus).

> Les revues d'écarts sont **closes** : `docs/REVUE_Ecarts_et_Plan_2026-08.md` (C1→C9) et
> `docs/AUDIT_Fonctionnel_2026-08.md` (D1→D10). Ces clôtures historiques ne ferment pas le plan actif L7–L11 et les recettes réelles L5/L6 ni ses conditions de GO pilote.

## 9. Deux points à traiter AVANT les premiers patients réels

1. **6 clés i18n CRITIQUES non traduites** (`sos.active_title`, `sos.im_ok`, `sos.false_alarm`,
   `sos.history`, `sos.status.RESOLVED`, `sos.status.FALSE_ALARM`) : un locuteur FON/YOR verra du
   **français sur un écran d'urgence**. Elles sont exportées `CRITIQUE` dans
   `docs/i18n/todo.{fon,yor}.csv` → relecture par locuteurs natifs. **Jamais par traduction
   machine** (§6).
2. **Validation clinique** (`docs/VALIDATION_Clinique.md`) : triage OMS/PCIME, calendrier PEV et
   phrasier attendent la signature d'un professionnel de santé.

## Addendum L5 — téléconsultation privée, avant ouverture

- [ ] Candidate L5 revue/fusionnée, CI vérifiée sur son SHA final ; API/client/en-têtes homogènes, anciens onglets fermés.
- [ ] Salles historiques Daily publiques/sans frappe interdite/échéance inconnue supprimées après clôture ; nouveaux accès contrôlés selon le contrat L5.
- [ ] Permissions-Policy/CSP effectivement servis après Nginx en HTTPS vérifiés sur Android et iOS ; caméra/micro délégués au domaine Daily.
- [ ] Smoke fournisseur réel et recette D1–D18 signés, dont URL seule, bearer expiré, éjection/ban de session déjà ouverte, AUDIO réel et CHAT.
- [ ] Qualification sous-traitant/région/télémétrie validée par le porteur ; absence de token dans historique/DOM/log/stockages/cache contrôlée.

En incident : désactiver Daily, garder la messagerie, corriger en avant. Les clients app surveillent l'accès, les bearers déjà copiés restent bornés par 15 min ; éjection/suppression best effort et salle 4 h comme filets. Ne pas revenir au stub externe ni à un propriétaire médecin. Lire `CONTRAT_Teleconsultation_L5.md`.

## Addendum L6 — abonnement médecin avant vente pilote

- [ ] PR L6 revue/fusionnée, CI vérifiée sur le SHA final ; sauvegarde et inventaire des anciens plans/paiements isolés.
- [ ] Migration 33 appliquée et rapprochement humain : anciens payants ACTIVE fermés, plan conservé ; aucun justificatif financier inventé.
- [ ] Catalogue approuvé FREE/PRO 5 000 XOF/mois, STARTER/CLINIC fermés ; API/client cohérents, anciens onglets fermés.
- [ ] Configuration FedaPay complète + secret webhook : abonnement absent en configuration refusé, sans stub.
- [ ] Recette A1–A17 (dont paiement sandbox réel, abandon tardif, restitution opérateur et expiration/soin ouvert) signée ; §5 HMAC/×5/reconcile/wallet/refund re-testés.
- [ ] L7 revenus/finance, L8 résiduels FedaPay et L9 textes validés ; aucun prélèvement automatique ni remboursement externe déclaré sur seule transition interne.

Lire `CONTRAT_Abonnements_L6.md`, `RECETTE_Abonnements_L6.md` et LOT_L6. Corriger en avant ; aucun retour à l’activation gratuite. Cases opérationnelles volontairement non cochées : preuves locales/CI ne prouvent pas un déploiement ou un règlement réel.

## Addendum L7 — revenus et opérations manuelles

- [ ] PR L7 revue/fusionnée et CI du SHA final vérifiée ; sauvegarde et arrêt des anciens workers avant migration 34.
- [ ] Inventaire legacy : paiements non prouvés exclus, aucun backfill date/commission ; retours déjà exécutés rapprochés sans second transfert.
- [ ] Recette finance F1–F8 signée : identité bénéficiaire, montant/devise, journal et pièce externe ; aucun payout/refund réel déduit d’une preuve synthétique.
- [ ] EXECUTING incertain reste à rapprocher ; aucune annulation/remise en file automatique ; procédure d’opérateur suspendu.
- [ ] CSV/receipt non fiscaux approuvés ; politique de conservation, effacement/archivage et sauvegarde journal/proofs validée au GO.

Lire contrat/recette/revue/LOT_L7. Cases opérationnelles non cochées tant que preuves requises absentes ; automatisation FedaPay et facture fiscale sont hors pilote de ce lot.

## Qualification sécurité L8 — aucune case signée par les tests locaux

- [ ] Vérifier `AUDIT_Securite_L8_2026-10.md` X1–X15 : X6 = Redis, X12 = tri audit. Arrêter les anciens workers, vérifier la chaîne historique sur copie restaurée avant bascule ; aucun maillon réécrit ou rollback vers l’ancien writer.
- [ ] Annoncer renvoi des OTP pendants SHA256/rotation JWT_SECRET, vérifier réponse générique et délivrance réelle/UX ; NODE_ENV=test interdit sur pilote réel, devCode réservé aux tests. JWT_REFRESH_TTL cohérent JWT/cookie/Redis.
- [ ] Installer format/site Nginx ensemble, tester `nginx -t` et journal DMP/WS avec sentinel synthétique : ni query ni Referer ni corps. Error_log de requête désactivé ; statuts dans digisante-access.log et diagnostic API structuré ; vérifier collecteurs/CDN/ancien historique sans purge arbitraire.
- [ ] Qualifier CSP sur vrai Daily/FCM et mobile, documenter stratégie nonce/hashes ou décision explicite sur unsafe-inline Next ; aucune acceptation de risque automatique.
- [ ] Après certificat/redirection/renouvellement vérifiés, inclure hsts-after-tls.conf dans HTTPS et toutes les locations définissant add_header. Vérifier header et 24 h ; aucun includeSubDomains/preload sans qualification.
- [ ] Console Twilio : Geo Permissions SMS ET Voice pour pays attendus seulement, Bénin OTP et diaspora selon besoin validé ; preuve et tests autorisés, y compris coût/quota et SOS.
- [ ] FedaPay : vraie URL HTTPS sur checkout.fedapay.com/sandbox-checkout.fedapay.com, S1–S7 sandbox/reconcile, aucun stub en production ; HMAC/CAS/commission/wallet/L6/L7 inchangés.
- [ ] Mandater pentest externe sur candidate exacte/préproduction synthétique, retester findings ; mesurer timings d’énumération et risques CSP avant décision humaine GO/NO-GO L11.


## L9 — validations humaines avant ouverture (8 octobre 2026)

Préparation technique et CI ne prouvent pas une validation native/clinique. Références des retours annoncées, différées ; aucune pièce vérifiée/importée ici. Lire le contrat L9 et `validation/L9/README.md`.

- [ ] Retours natifs/version exacte vérifiés ; deux relecteurs distincts sur critiques et phrasier, FR/EN/variables conservés, langues annoncées complètes.
- [ ] Contreseing habilité des portées triage/PEV/CPN/phrasier/prescriptions-posologie/constantes/éducation ; pièces privées, références et empreintes concordantes.
- [ ] Hypothèses de rendu posologie corrigées/arbitrées explicitement, limites/pictogrammes/audio relus sur appareil, aucun risque accepté fictivement.
- [ ] Corpus des articles DB réellement publiés inventorié/relu ; seed synthétique exclu comme preuve production.
- [ ] `validation:check`, DOCX et `validation:gate` concordants avec les pièces ; contrôle technique du registre seul ne prouve pas la signature.
- [ ] Version corrigée contresignée après toute correction clinique et réserves résolues avant GO humain L11.


## L10 — outillage préparé, recette cible non attestée

Décision du porteur : accès fournis ultérieurement. Lire contrat/revue/fiche L10 ; neuf contrôles infrastructure et recettes fournisseur dans le dossier de 100 cas. Aucune case cochée par les tests locaux.

- [ ] VPS Infomaniak **distinct** (critère I2 contractuel, **non conforme** : dérogation IONOS partagé du 13/10/2026 à arbitrer en L11), domaine/SSH/fingerprint autorisés ; base et cache natifs (sur IONOS : PG 18.6/Valkey partagés) avec base `*_preprod` et index /5 dédiés, comptes synthétiques, secrets privés et Firebase au build.
- [ ] SHA main exact/CI deux jobs réussis via preprod:qualify ; maintenance vérifiée, crons suspendus/repris, sauvegarde préalable cible alimentée, anciens workers arrêtés avant migrations.
- [ ] Workflow manuel préprod configuré volontairement ; aucun smoke automatique. Gardes L10 obligatoires, NODE_ENV=production et un fournisseur ; jamais tests ordinaires sur cible.
- [ ] S1–S7, T1–T12, D1–D18, F1–F9 Android/iPhone, R1–R6 et parcours L6/L7 observés/référencés. T11 uniquement destination de test autorisée ou N/A avec décision du porteur ; FCM logout via dispatch.
- [ ] Crons réellement observés (pas seulement lignes installées/invocation manuelle) ; tâches mutantes de verify_deploy seulement opt-in préprod autorisé.
- [ ] Première sauvegarde cible DB+fichiers+manifeste et SHA256/copie/clé hors VPS. Snapshot DB commun dump/comptages ; pas atomicité DB↔fichiers. Restauration indépendante L11 séparée.
- [ ] Références privées vérifiées et même candidate/source, preprod:check et gate cohérents ; gates natifs/cliniques L9, arbitrages sécurité et GO L11 toujours distincts.
