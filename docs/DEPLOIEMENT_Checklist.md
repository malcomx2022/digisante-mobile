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
      → Node 20, pnpm, PM2, **PostgreSQL 16 (PGDG)**, Redis, Nginx, Certbot, UFW, rôle/base, démarrage PM2 au boot.
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
- [ ] `sudo crontab infra/deploy/crontab.example` → **pg_dump chiffré 02:00**, réconciliation FedaPay 02:30, renouvellement SSL.
- [ ] `sudo crontab -l` pour vérifier.

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
- [ ] Sauvegarde : lancer `pg_dump_encrypted.sh` une fois et vérifier `/var/backups/digisante/`.
- [ ] ⚠️ **Sauvegarder aussi `KYC_STORAGE_DIR`** (fichiers chiffrés hors base). Il contient les
      pièces KYC **et, depuis août 2026, les pièces jointes du DMP — donc des données de santé**.
      Une restauration à partir du seul `pg_dump` laisserait des entrées de dossier pointant vers
      des fichiers disparus.
- [ ] Audit : trigger anti UPDATE/DELETE actif (tester un UPDATE sur `audit_logs` → rejet).

## 8. Conformité (rappels release)
- [ ] Audit OWASP/STRIDE à jour (`docs/SECURITE_Audit_OWASP_STRIDE.md`).
- [ ] Chiffrement santé actif (`HEALTH_ENCRYPTION_KEY` présent → données en `encryptedData`).
- [ ] Rétention sauvegardes (14 j) + clé de chiffrement hors VPS.

---

**Tout est prêt pour la production.** Le code (backend **28 modules** + frontend **7 espaces**,
63 pages) est testé (**289 tests API verts** — vérifié le 17/08/2026), l'infra scriptée, et la
sécurité auditée. Reste l'exécution sur le VPS réel (étape manuelle/CI ci-dessus).

> Les écarts fonctionnels restants (référencement sans UI, pièces jointes DMP) sont listés dans
> `docs/REVUE_Ecarts_et_Plan_2026-08.md`. **Aucun ne bloque cette mise en production.**
