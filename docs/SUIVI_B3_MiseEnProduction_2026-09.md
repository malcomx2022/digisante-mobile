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
      (règle aussi le fuseau, `/etc/digisante` 0700, magasin 0700, propriété du clone)

### Phase 2 — Secrets sur le VPS
- [ ] `apps/api/.env` complet (`NODE_ENV=production` ; l'API **refuse de démarrer** si
      incomplet — fail-safe voulu, ne pas contourner).
- [ ] `apps/web/.env.production` : `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SOS_NUMBER`
      (+ `NEXT_PUBLIC_FIREBASE_*` dès que B4/Firebase les fournit — inlinés au build).
- [ ] `/etc/digisante/backup.key` — **copie hors VPS obligatoire**.
- [ ] `/etc/digisante/reconcile.token` (root 0400) — **source unique** du jeton ; même valeur
      dans `RECONCILE_TOKEN` du `.env` ; `apps/api/.env` en 0600.

### Phase 3 — Premier déploiement + Nginx/SSL
- [ ] `sudo -u digisante${SUFFIX} DEPLOY_REF=<SHA> DEPLOY_ENVIRONMENT=<env> DEPLOY_MAINTENANCE_READY=1 bash infra/deploy/scripts/deploy.sh` → `pm2 status` : `digisante${SUFFIX}-api` ×2 + `digisante${SUFFIX}-web` online (hôte IONOS partagé, 13/10/2026 : `DIGISANTE_ENV` obligatoire, cf. `infra/deploy/README.md`).
- [ ] Vhost dédié de l'environnement installé depuis la copie root (`nginx/digisante${SUFFIX}.conf`, domaine et ports déjà fixés), `nginx -t`, Certbot.

### Phase 4 — Crons
- [ ] Fichier `/etc/cron.d/digisante${SUFFIX}` installé depuis la copie root (`sudo install -o root -g root -m 0644 …`), **jamais** `crontab <fichier>` sur l'hôte partagé (aucun secret dedans : `internal_job.sh` lit
      `/etc/digisante${SUFFIX}/reconcile.token` et journalise `ÉCHEC` si absent ou ≠ 2xx).
- [ ] Les 5 tâches répondent 200 (vérifié par `verify_deploy.sh`, phase 6).

### Phase 5 — Armement du déploiement continu
- [ ] Secrets GitHub : `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` (+ `VPS_SSH_PORT` si besoin).
- [ ] Variable GitHub : `DEPLOY_ENABLED=true`.
- [ ] Clé publique dans `~digisante/.ssh/authorized_keys`.
- [ ] Un push sur `main` déroule CI (`build-and-test` + `e2e`) puis `deploy` — vérifier un run complet.

### Phase 6 — Vérifications post-déploiement (checklist §7)
- [ ] `sudo DOMAIN=<domaine> bash infra/deploy/scripts/verify_deploy.sh` → tous **PASS**
      (PM2 api ×2 + web, migrations à jour, certificat ≥ 14 j, health/ready, upgrade WS 101,
      **0 `token=`** dans le log WS après sonde, 5 tâches en 2xx, crontab, fuseau, `.env` 600).
- [ ] `/api/v1/health` → ok · `/api/v1/ready` → db+redis up.
- [ ] PWA installable ; `grep -c 'token=' /var/log/nginx/digisante-ws.log` → **0**.
- [ ] Sauvegarde lancée une fois → **deux** fichiers dans `/var/backups/digisante/`.
- [ ] Trigger d'audit actif (UPDATE sur `audit_logs` → rejet).

### Rollback (à éprouver une fois pendant la recette)
- [ ] Version précédente : `tail -n 3 /var/log/digisante/deploy_history.log` (`<avant> -> <après>`).
- [ ] `sudo -u digisante DEPLOY_REF=<sha avant> bash infra/deploy/scripts/deploy.sh` puis
      `verify_deploy.sh` → PASS. ⚠️ Si une **migration** a été appliquée entre-temps, le code
      ancien peut ne plus correspondre au schéma : restauration de base (SUIVI_B5) requise —
      les migrations sont à sens unique.

### État au 22/09/2026 (prompt 13) — ⛔ BLOQUÉ, aucune phase exécutée

Aucun accès n'est disponible depuis l'environnement de Claude Code : ni `<VPS_HOST>`, ni
domaine pointé, ni compte SSH, ni secrets. **Rien n'est coché** ci-dessus. Pour débloquer,
l'opérateur exécute, sur son poste puis sur le VPS :

```bash
# 0. Vérifier l'hôte cible AVANT toute mutation (empreinte de clé SSH, IP, nom)
ssh -o VisualHostKeyVerification=yes root@<VPS_HOST> 'hostnamectl; ip -4 addr show scope global; lsb_release -ds'
dig +short A <domaine>          # doit renvoyer l'IP du VPS
# 1→6. Dérouler les phases ci-dessus dans l'ordre, s'arrêter au premier échec,
#      puis : sudo DOMAIN=<domaine> bash infra/deploy/scripts/verify_deploy.sh
```

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


## Actualisation L10 — 8 octobre 2026 (historique ci-dessus conservé)

L9 technique fusionné #189, main a3f80a1/CI 37757404974 réussie ; humain encore ouvert. Le porteur décide de préparer l’outillage L10, accès à fournir ultérieurement. Aucun VPS/compte fournisseur réel sollicité ou résultat B3/B4 coché dans cette session. Reprendre CONTRAT_Preproduction_L10, suivi/LOT_L10, revue L10, inventaire de secrets et dossier de 94 cas ; workflow préproduction manuel isolé, CI/SHA exact et maintenance/arrêt homogène, crontab DB_NAME préprod et première sauvegarde complète à éprouver sur cible. Smoke indépendant sans purge Redis, NODE_ENV=production et un seul fournisseur ; commandes historiques complétées par les métadonnées du contrat. Gates production DEPLOY_ENABLED **et** DEPLOY_MAINTENANCE_READY ; aucune activation par la seule PR. Preuves locales synthétiques distinctes des réceptions/appareils/crons/backup cible ; restauration réelle et GO restent L11.
