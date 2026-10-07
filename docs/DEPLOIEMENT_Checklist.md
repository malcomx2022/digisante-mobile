# Checklist finale de déploiement — DigiSanté Mobile (VPS Infomaniak)

> Cible : VPS Ubuntu 22.04 LTS. PostgreSQL 16 **natif**, Redis natif, Nginx + SSL Certbot,
> PM2 (API cluster ×2 + web). **Aucun Docker en prod** (CLAUDE.md §3). Scripts : `infra/deploy/`.

> État de finalisation au 7 octobre 2026 : L0–L3 livrés sur main ; L4 candidate (LOT_L4/PR). Aucun déploiement ou GO pilote attesté ; L5–L11 et la recette réelle restent à traiter.

## 0. Pré-requis
- [ ] Nom de domaine pointant (A) vers l'IP du VPS (`digisante.example.bj` + `www`).
- [ ] Accès SSH root/sudo.
- [ ] Dépôt GitHub privé accessible depuis le VPS.

## 1. Provisioning (une fois, root)
- [ ] `git clone … /var/www/digisante-mobile`
- [ ] `sudo BASE_DOMAIN=… DB_PASSWORD='…' bash infra/deploy/scripts/provision.sh`
      → Node 24, pnpm, PM2, **PostgreSQL 16 (PGDG)**, Redis, Nginx, Certbot, UFW, rôle/base, démarrage PM2 au boot.
- [ ] Fuseau `Africa/Porto-Novo`, `/etc/digisante` (0700), magasin `apps/api/storage/kyc` (0700) et propriété du dépôt : **faits par `provision.sh`** (vérifier `timedatectl`).

## 2. Secrets (jamais commités — cf. `docs/SECRETS_Production.md`)
- [ ] `apps/api/.env` rempli (DATABASE_URL, REDIS_URL, JWT_SECRET ≥32, **HEALTH_ENCRYPTION_KEY**, RECONCILE_TOKEN, FedaPay, Twilio, Resend, Daily, Firebase, `NODE_ENV=production`).
- [ ] `apps/web/.env.production` : `NEXT_PUBLIC_API_URL=https://…` + `NEXT_PUBLIC_SOS_NUMBER`.
- [ ] `/etc/digisante/backup.key` (AES-256) — **sauvegardé hors VPS**.
- [ ] `/etc/digisante/reconcile.token` (root, 0400) = **source unique** du jeton des tâches internes ; même valeur dans `RECONCILE_TOKEN` du `.env`.
- [ ] `apps/api/.env` en **0600** (`deploy.sh` refuse de déployer sans `.env` et corrige les permissions).

## 3. Premier déploiement
- [ ] Mise à jour du 06/10/2026 : migration `20261006130000_wallet_refund_in` appliquée avant le code de remboursement WALLET ; vérifier restitution + signe entrant dans l’historique.
- [ ] L1 : sauvegarde validée, maintenance et anciens workers API arrêtés avant `20261006144830_dmp_entry_expiry_authorship` ; redémarrer uniquement le code avec contrôle d'échéance par entrée. Prévenir les patients que les anciens liens nécessitent un nouveau partage. Pas de retour à l'ancien guard sur les liens NULL ; procédure détaillée `docs/suivi/LOT_L1.md`.
- [ ] L2 : annoncer la validation obligatoire des laboratoires, arrêter les anciens workers puis appliquer `20261006154628_laboratory_verification` avant le nouveau code. Aucune approbation héritée, commandes conservées/gelées jusqu'à habilitation ; procédure complète dans LOT_L2.
- [ ] L3 : sauvegarde, arrêt des anciens workers et migration `20261006164320_mutation_receipts` avant démarrage homogène ; renouveler les clients/SW, valider rejeu et cron `/sync/receipts/prune` à 03:10. Aucun backfill/rejeu des anciennes files ambiguës, aucun rollback vers un serveur ignorant les clés ; contrat et reprise dans LOT_L3.
- [ ] L4 : déployer API/client/SW v3 homogènes, fermer les anciens onglets ; tester upgrade IndexedDB v3→v4, erreur quota/blocked et tickets GET. Migrer chaque compte ou effacer volontairement après vérification des effets ; aucun appareil partagé/pilote avec héritage en clair. Vérifier cache public sans API/RSC/jetons, API Cache-Control et fetch no-store, vider les anciens caches HTTP navigateur avant partage ; reload sans réseau puis phrase, lock/TTL/purge. Contrat/limites dans LOT_L4 et CONTRAT_Hors_Ligne_L4 ; rollback client v3 incompatible, privilégier correction en avant.
- [ ] Revue administrative explicite de chaque structure : responsable + autorisation, identité figée et toutes les pièces vérifiées. Tester non-vérifié/refusé/suspendu, concurrence d'attribution et lecture patient/médecin. Pas de retour au guard sans badge ni réattribution automatique.
- [ ] `sudo -u digisante bash infra/deploy/scripts/deploy.sh`
      → install gelé → `prisma generate` → **`migrate deploy`** → `pnpm build` → `pm2 startOrReload`.
- [ ] `pm2 status` : `digisante-api` (×2, online) + `digisante-web` (online).

## 4. Nginx + SSL + rate-limit
- [ ] `sudo cp infra/deploy/nginx/rate-limit.conf /etc/nginx/conf.d/digisante-rate-limit.conf`
- [ ] `sudo cp infra/deploy/nginx/digisante.conf /etc/nginx/sites-available/digisante && ln -sf … sites-enabled/`
- [ ] Remplacer `digisante.example.bj` par le domaine réel.
- [ ] `sudo rm -f /etc/nginx/sites-enabled/default && sudo nginx -t && sudo systemctl reload nginx`
- [ ] `sudo certbot --nginx -d digisante.example.bj -d www.digisante.example.bj` (redirection 80→443 auto).

## 5. Crons
- [ ] **Aucun secret dans la crontab** : les tâches passent par `internal_job.sh`, qui lit `/etc/digisante/reconcile.token` et journalise `ÉCHEC` (code 1) si le jeton manque ou si l'API répond ≠ 2xx.
- [ ] `sudo crontab infra/deploy/crontab.example` → rappels **traitements** (5 min), **RDV** (15 min), **vaccination PEV** (06:30), **CPN maternité** (06:40), **dispatch** des notifications (2 min), **pg_dump + fichiers chiffrés 02:00**, réconciliation FedaPay 02:30, renouvellement SSL.
- [ ] `sudo crontab -l` pour vérifier.
- [ ] Vérifier que les générateurs + le dispatch répondent 200 (sans exposer le jeton) :
      `for p in reminders appointments/reminders vaccinations/reminders maternity/reminders; do sudo infra/deploy/scripts/internal_job.sh /api/v1/$p/generate; done; sudo infra/deploy/scripts/internal_job.sh /api/v1/notifications/dispatch` → lignes `OK (HTTP 200)`
      ⚠️ Les générateurs **vaccination** et **CPN** n'étaient PAS planifiés avant août 2026 : sans eux, aucun rappel de vaccination ni de consultation prénatale n'est émis — en silence.

## 6. Déploiement continu (GitHub Actions)
- [ ] Secrets repo : `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` (+ `VPS_SSH_PORT`).
- [ ] **Variable** `DEPLOY_ENABLED=true` (active le job `deploy`).
- [ ] Clé publique dans `~digisante/.ssh/authorized_keys`.
- [ ] Push sur `main` → CI (`build-and-test` **et** `e2e`) → `deploy` SSH (`deploy.sh`) si l'opt-in est actif. La PR L0 ne déploie pas.

## 7. Vérifications post-déploiement
- [ ] `curl https://digisante.example.bj/api/v1/health` → `{ "status": "ok" }`
- [ ] `curl https://digisante.example.bj/api/v1/ready` → `db: up, redis: up`
- [ ] PWA installable, `/onboarding` accessible ; SOS testé **avec réseau**, preuve d'envoi au contact/numéro de secours. Hors réseau : repli vers les numéros d'urgence validés, aucune promesse de SMS transmis sans connexion.
- [ ] Webhook FedaPay : URL `https://…/api/v1/payments/webhook` configurée côté FedaPay (HMAC).
- [ ] Sauvegarde : lancer `pg_dump_encrypted.sh` une fois et vérifier que **DEUX** fichiers
      apparaissent dans `/var/backups/digisante/` :
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

**Contrôles techniques actuels ; ouverture pilote non attestée.** Le code (backend **28 modules** / **168 endpoints REST + 1 WS**
+ frontend **7 espaces**, **67 pages**) est testé (**611 tests verts** — 499 API + 112 web, + 15 e2e
Playwright — preuves du 7 octobre 2026 dans LOT_L4), l'infra scriptée. Restent la finalisation L5–L11, la validation humaine et l'exécution sur
le VPS réel (étapes ci-dessus).

> Les revues d'écarts sont **closes** : `docs/REVUE_Ecarts_et_Plan_2026-08.md` (C1→C9) et
> `docs/AUDIT_Fonctionnel_2026-08.md` (D1→D10). Ces clôtures historiques ne ferment pas le plan actif L5–L11 ni ses conditions de GO pilote.

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
