# Suivi du chantier B3 — mise en production VPS

> **Lancé le 2 septembre 2026** · Chantier **B3** de l'état des lieux
> (`docs/ETAT_DES_LIEUX_Finalisation_2026-09.md` §4.4). Déroulé détaillé :
> `docs/DEPLOIEMENT_Checklist.md` (référence pas-à-pas) ; ce document est le **pilotage** du
> chantier : audit préalable de l'infra, ce que le porteur doit fournir, phases d'exécution,
> critère de sortie. Cocher au fur et à mesure.

---

## 1. Audit préalable de l'infra livrée — passé le 02/09/2026 ✅

L'infra scriptée a été re-vérifiée **après** le passage au runtime Node 24 (PR #149/#150) et
les lots récents. **Aucune dérive trouvée** — tout est prêt à exécuter :

| Élément | Vérifié | État |
|---|---|---|
| `provision.sh` | Node **24** (NodeSource), aligné sur `node-version: 24` de `ci.yml` (commentaire d'alignement présent) ; PostgreSQL 16 PGDG, Redis, Nginx, Certbot, UFW, PM2 au boot | ✅ |
| `deploy.sh` | install `--frozen-lockfile` → `prisma generate` → **`migrate deploy`** (jamais `db push`) → `pnpm build` → `pm2 startOrReload` + **healthcheck `/api/v1/ready`** (10 tentatives, échec = sortie 1 sans rollback silencieux) | ✅ |
| `ecosystem.config.cjs` | `digisante-api` **cluster ×2** + `digisante-web` fork ×1 | ✅ |
| `crontab.example` | **5 générateurs** (traitements 5 min · RDV 15 min · vaccination 06:30 · CPN 06:40 · dispatch 2 min) + sauvegarde 02:00 + réconciliation FedaPay 02:30 + renouvellement SSL ; `RECONCILE_TOKEN` en tête (placeholder `changeme` à remplacer) | ✅ |
| `pg_dump_encrypted.sh` | **Double archive** : base (`digisante_<stamp>.sql.gz.enc`) **et** magasin de fichiers `KYC_STORAGE_DIR` (`digisante_files_<stamp>.tar.gz.enc`, données de santé DMP) ; avertissement bruyant si magasin introuvable ; rétention commune | ✅ |
| `nginx/digisante.conf` | upgrade WebSocket sur `/api/v1/chat/ws` + `proxy_read_timeout 3600s` + **`access_log … digisante_noquery`** (JWT jamais journalisé) | ✅ |
| `ci.yml` job `deploy` | opt-in `vars.DEPLOY_ENABLED == 'true'`, `needs: [build-and-test, e2e]` (les e2e gardent la porte) | ✅ |

> **Préflight statique du 22/09/2026** : 11 défauts de dépôt corrigés (mot de passe DB interpolé
> dans le SQL, fuseau, propriété du clone, magasin 0700, jeton en clair dans la crontab, `/tmp`
> fixe en root, `.env`, en-têtes/limites Nginx…) — voir `docs/PREFLIGHT_VPS_2026-09.md`. La ligne
> « `RECONCILE_TOKEN` en tête (placeholder `changeme`) » ci-dessus est **obsolète** : le jeton vit
> désormais dans `/etc/digisante/reconcile.token` (source unique, lue par `internal_job.sh`).

## 2. À fournir par le porteur (bloquant — rien ne se déploie sans ça)

- [ ] **VPS Infomaniak** Ubuntu 22.04 LTS (accès SSH root/sudo).
- [ ] **Nom de domaine** (ex. `digisante.bj` + `www`), enregistrements **A** pointés vers l'IP du VPS.
- [ ] **Paire de clés SSH** dédiée au déploiement (la publique ira dans `authorized_keys` de
      l'utilisateur `digisante`, la privée dans les secrets GitHub).
- [ ] **Secrets applicatifs** générés (aléatoires, ≥ 32 caractères) : `JWT_SECRET`,
      `HEALTH_ENCRYPTION_KEY`, `RECONCILE_TOKEN`, mot de passe DB, clé de sauvegarde.
      Cf. `docs/SECRETS_Production.md`.

## 3. Phases d'exécution (checklist de référence : `DEPLOIEMENT_Checklist.md` §0→§8)

### Phase 1 — Provision (≈ 1 h, une seule fois)
- [ ] `git clone` du dépôt dans `/var/www/digisante-mobile`.
- [ ] `sudo BASE_DOMAIN=… DB_PASSWORD='…' bash infra/deploy/scripts/provision.sh`
- [ ] `sudo timedatectl set-timezone Africa/Porto-Novo`

### Phase 2 — Secrets sur le VPS
- [ ] `apps/api/.env` complet (`NODE_ENV=production` ; l'API **refuse de démarrer** si
      incomplet — fail-safe voulu, ne pas contourner).
- [ ] `apps/web/.env.production` : `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SOS_NUMBER`
      (+ `NEXT_PUBLIC_FIREBASE_*` dès que B4/Firebase les fournit — inlinés au build).
- [ ] `/etc/digisante/backup.key` — **copie hors VPS obligatoire**.
- [ ] `/etc/digisante/reconcile.token` (= `RECONCILE_TOKEN` du `.env`).

### Phase 3 — Premier déploiement + Nginx/SSL
- [ ] `sudo -u digisante bash infra/deploy/scripts/deploy.sh` → `pm2 status` : api ×2 + web online.
- [ ] Confs Nginx copiées, domaine substitué, `nginx -t`, Certbot (`-d domaine -d www`).

### Phase 4 — Crons
- [ ] `RECONCILE_TOKEN` remplacé en tête de `crontab.example` (sinon **tous les générateurs
      répondent 401 en silence**), puis `sudo crontab infra/deploy/crontab.example`.
- [ ] Les 5 générateurs répondent 200 (curl de contrôle, cf. checklist §5).

### Phase 5 — Armement du déploiement continu
- [ ] Secrets GitHub : `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` (+ `VPS_SSH_PORT` si besoin).
- [ ] Variable GitHub : `DEPLOY_ENABLED=true`.
- [ ] Clé publique dans `~digisante/.ssh/authorized_keys`.
- [ ] Un push sur `main` déroule CI (`build-and-test` + `e2e`) puis `deploy` — vérifier un run complet.

### Phase 6 — Vérifications post-déploiement (checklist §7)
- [ ] `/api/v1/health` → ok · `/api/v1/ready` → db+redis up.
- [ ] PWA installable ; `grep -c 'token=' /var/log/nginx/digisante-ws.log` → **0**.
- [ ] Sauvegarde lancée une fois → **deux** fichiers dans `/var/backups/digisante/`.
- [ ] Trigger d'audit actif (UPDATE sur `audit_logs` → rejet).

## 4. Articulation avec les autres chantiers

- **B4** : dès la Phase 3 finie, saisir les clés fournisseurs via `/admin/integrations`
  (compte SUPER_ADMIN à créer d'abord : inscription puis attribution du preset en base ou via
  un admin existant) ; configurer le webhook FedaPay sur le domaine réel.
- **B5** : dès la Phase 6, dérouler le **test de restauration à blanc** des deux archives sur
  une machine tierce (`docs/ETAT_DES_LIEUX_Finalisation_2026-09.md` §4.5) — c'est le chantier
  suivant, il ne demande rien d'autre que la clé de sauvegarde et un poste.

## 5. Critère de sortie B3

Application servie en HTTPS sur le domaine réel, `health`/`ready` verts, PM2 stable (api ×2 +
web), crons actifs et vérifiés, sauvegarde double produite, déploiement continu armé et
éprouvé par un push sur `main`.
