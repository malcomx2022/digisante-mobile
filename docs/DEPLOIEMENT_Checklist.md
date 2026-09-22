# Checklist finale de déploiement — DigiSanté Mobile (VPS Infomaniak)

> Cible : VPS Ubuntu 22.04 LTS. PostgreSQL 16 **natif**, Redis natif, Nginx + SSL Certbot,
> PM2 (API cluster ×2 + web). **Aucun Docker en prod** (CLAUDE.md §3). Scripts : `infra/deploy/`.

## 0. Pré-requis
- [ ] Nom de domaine pointant (A) vers l'IP du VPS (`digisante.example.bj` + `www`).
- [ ] Accès SSH root/sudo.
- [ ] Dépôt GitHub privé accessible depuis le VPS.

## 1. Provisioning (une fois, root)
- [ ] `git clone … /var/www/digisante-mobile`
- [ ] `sudo BASE_DOMAIN=… DB_PASSWORD='…' bash infra/deploy/scripts/provision.sh`
      → Node 24, pnpm, PM2, **PostgreSQL 16 (PGDG)**, Redis, Nginx, Certbot, UFW, rôle/base, démarrage PM2 au boot.
- [ ] `sudo timedatectl set-timezone Africa/Porto-Novo`

## 2. Secrets (jamais commités — cf. `docs/SECRETS_Production.md`)
- [ ] `apps/api/.env` rempli (DATABASE_URL, REDIS_URL, JWT_SECRET ≥32, **HEALTH_ENCRYPTION_KEY**, RECONCILE_TOKEN, FedaPay, Twilio, Resend, Daily, Firebase, `NODE_ENV=production`).
- [ ] `apps/web/.env.production` : `NEXT_PUBLIC_API_URL=https://…` + `NEXT_PUBLIC_SOS_NUMBER`.
- [ ] `/etc/digisante/backup.key` (AES-256) — **sauvegardé hors VPS**.
- [ ] `/etc/digisante/reconcile.token` (= `RECONCILE_TOKEN`).

## 3. Premier déploiement
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
- [ ] Renseigner `RECONCILE_TOKEN` **en tête de `crontab.example`** (même valeur que le `.env` de l'API) — sans lui, tous les générateurs répondent 401 en silence.
- [ ] `sudo crontab infra/deploy/crontab.example` → rappels **traitements** (5 min), **RDV** (15 min), **vaccination PEV** (06:30), **CPN maternité** (06:40), **dispatch** des notifications (2 min), **pg_dump + fichiers chiffrés 02:00**, réconciliation FedaPay 02:30, renouvellement SSL.
- [ ] `sudo crontab -l` pour vérifier.
- [ ] Vérifier que les 5 générateurs répondent 200 : `curl -X POST -H "x-service-token: …" http://127.0.0.1:3001/api/v1/{reminders,appointments/reminders,vaccinations/reminders,maternity/reminders}/generate`
      ⚠️ Les générateurs **vaccination** et **CPN** n'étaient PAS planifiés avant août 2026 : sans eux, aucun rappel de vaccination ni de consultation prénatale n'est émis — en silence.

## 6. Déploiement continu (GitHub Actions)
- [ ] Secrets repo : `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` (+ `VPS_SSH_PORT`).
- [ ] **Variable** `DEPLOY_ENABLED=true` (active le job `deploy`).
- [ ] Clé publique dans `~digisante/.ssh/authorized_keys`.
- [ ] Push sur `main` → CI (`build-and-test`) → `deploy` SSH (`deploy.sh`).

## 7. Vérifications post-déploiement
- [ ] `curl https://digisante.example.bj/api/v1/health` → `{ "status": "ok" }`
- [ ] `curl https://digisante.example.bj/api/v1/ready` → `db: up, redis: up`
- [ ] PWA installable, `/onboarding` accessible, SOS (SMS) opérationnel hors-ligne.
- [ ] Webhook FedaPay : URL `https://…/api/v1/payments/webhook` configurée côté FedaPay (HMAC).
- [ ] Sauvegarde : lancer `pg_dump_encrypted.sh` une fois et vérifier que **DEUX** fichiers
      apparaissent dans `/var/backups/digisante/` :
      `digisante_<stamp>.sql.gz.enc` (base) **et** `digisante_files_<stamp>.tar.gz.enc` (magasin de fichiers).
- [ ] ⚠️ Si le script journalise « magasin de fichiers introuvable », **corriger `KYC_STORAGE_DIR`**
      dans `apps/api/.env` avant toute mise en service. Ce répertoire contient les pièces KYC **et,
      depuis août 2026, les pièces jointes du DMP — donc des données de santé** ; il ne vit pas dans
      PostgreSQL. Une restauration du seul `pg_dump` laisserait des entrées de dossier pointant vers
      des fichiers disparus. (Automatisé depuis août 2026 — ce n'est plus une étape manuelle.)
- [ ] Test de restauration à blanc (au moins une fois) : déchiffrer les deux archives sur une
      machine tierce. Une sauvegarde jamais restaurée n'est pas une sauvegarde.
- [ ] Audit : trigger anti UPDATE/DELETE actif (tester un UPDATE sur `audit_logs` → rejet).

## 8. Conformité (rappels release)
- [ ] Audit OWASP/STRIDE à jour (`docs/SECURITE_Audit_OWASP_STRIDE.md`).
- [ ] Chiffrement santé actif (`HEALTH_ENCRYPTION_KEY` présent → données en `encryptedData`).
- [ ] Rétention sauvegardes (14 j) + clé de chiffrement hors VPS.

---

**Tout est prêt pour la production.** Le code (backend **27 modules** / **163 endpoints REST + 1 WS**
+ frontend **7 espaces**, **66 pages**) est testé (**382 tests verts** — 345 API + 37 web, + 8 e2e
Playwright — vérifié le 19/08/2026), l'infra scriptée, et la sécurité auditée. Reste l'exécution sur
le VPS réel (étapes ci-dessus).

> Les revues d'écarts sont **closes** : `docs/REVUE_Ecarts_et_Plan_2026-08.md` (C1→C9) et
> `docs/AUDIT_Fonctionnel_2026-08.md` (D1→D10). **Aucun écart ouvert ne bloque cette mise en
> production.**

## 9. Deux points à traiter AVANT les premiers patients réels

1. **6 clés i18n CRITIQUES non traduites** (`sos.active_title`, `sos.im_ok`, `sos.false_alarm`,
   `sos.history`, `sos.status.RESOLVED`, `sos.status.FALSE_ALARM`) : un locuteur FON/YOR verra du
   **français sur un écran d'urgence**. Elles sont exportées `CRITIQUE` dans
   `docs/i18n/todo.{fon,yor}.csv` → relecture par locuteurs natifs. **Jamais par traduction
   machine** (§6).
2. **Validation clinique** (`docs/VALIDATION_Clinique.md`) : triage OMS/PCIME, calendrier PEV et
   phrasier attendent la signature d'un professionnel de santé.
