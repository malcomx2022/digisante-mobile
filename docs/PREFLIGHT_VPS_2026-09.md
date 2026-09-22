# Préflight VPS — audit statique GO/NO-GO (prompt 12)

> **Date** : 22 septembre 2026 · **Nature** : audit **statique** du dépôt, **sans connexion
> distante ni mutation** d'un serveur. Aucune case d'exécution distante n'est cochée ici :
> elles vivent dans `docs/SUIVI_B3_MiseEnProduction_2026-09.md` et ne se cochent que sur
> preuve observée. Contrôles automatisés : `node --test scripts/infra/check-infra.test.mjs`
> (inclus dans `pnpm test:scripts` et donc dans `pnpm release:check`).

## 1. Défauts trouvés dans le dépôt et corrigés (22/09/2026)

| # | Élément | Défaut | Risque | Correctif |
|---|---|---|---|---|
| V1 | `provision.sh` | mot de passe DB **interpolé** dans le SQL (`PASSWORD '${DB_PASSWORD}'`) | un `'` casse le provisioning ; injection SQL en superutilisateur | `\getenv` + `format('%L')` ; testé sur PostgreSQL 16 avec `p'a;ss"DROP`, idempotent (2 exécutions) |
| V2 | `provision.sh` | fuseau non réglé (étape manuelle séparée) | crons 02:00/02:30/06:30 décalés d'1 h (UTC) | `timedatectl set-timezone Africa/Porto-Novo` dans le script |
| V3 | `provision.sh` / README | dépôt cloné en **root** avant provisioning, seul le dossier racine re-possédé | `deploy.sh` (utilisateur `digisante`) échoue sur `git fetch` / le build | `chown -R digisante` du dépôt |
| V4 | `provision.sh` | magasin de fichiers (KYC + **pièces jointes DMP**) créé à la volée en 0755 | listing des fichiers de santé chiffrés par tout compte local | `apps/api/storage/kyc` pré-créé en **0700** ; `/etc/digisante` 0700 |
| V5 | `crontab.example` | jeton de service **en clair dans la crontab** (`RECONCILE_TOKEN=changeme`), en argument de `curl` | placeholder oublié ⇒ **toutes les tâches en 401, en silence** ; jeton visible dans `ps` ; deux sources à synchroniser | `internal_job.sh` : jeton lu dans `/etc/digisante/reconcile.token` (source unique), passé par `--config -` (stdin), `ÉCHEC` + code 1 si absent ou ≠ 2xx — testé contre l'API réelle (200 / 401 / fichier absent) |
| V6 | `fedapay_reconcile.sh` | réponse écrite en root dans **`/tmp/reconcile_resp.json`** (chemin fixe) ; jeton en argument | attaque par lien symbolique (écrasement d'un fichier système) ; jeton dans `ps` | `mktemp` + `trap`, jeton via `--config -` ; testé (HTTP 200) — **aucune logique de paiement touchée** |
| V7 | `deploy.sh` | aucun contrôle du `.env` | déploiement lancé sans configuration ; `.env` lisible par tous (umask 0644) | échec explicite si absent, `chmod 600` sinon |
| V8 | Nginx | `X-Frame-Options: SAMEORIGIN` alors que Next.js envoie `DENY` | deux en-têtes contradictoires sur les pages | aligné sur `DENY` |
| V9 | Nginx | `/auth/refresh` sous la zone stricte **10 req/min par IP** | les opérateurs mobiles partagent des IP (CGNAT) : reprises de session en 429 ⇒ utilisateurs déconnectés | `/auth/refresh` et `/auth/logout` sous la zone générale ; l'OTP reste strict |
| V10 | Nginx | version annoncée | empreinte | `server_tokens off` |
| V11 | README déploiement | « Node 20 », `rate-limit.conf` jamais copié dans le pas-à-pas | `nginx -t` en échec (zones / `log_format` introuvables) | Node 24 ; étape de copie ajoutée |

## 2. Vérifié sans défaut

- `deploy.sh` : lockfile gelé, `prisma generate`, **`migrate deploy`** (jamais `db push`), build,
  `pm2 startOrReload`, healthcheck `/api/v1/ready` (10 × 3 s, sortie 1 sinon).
- PM2 : `digisante-api` cluster ×2 (cwd `apps/api`, donc `KYC_STORAGE_DIR` par défaut =
  `apps/api/storage/kyc` = défaut de `pg_dump_encrypted.sh`), `digisante-web` fork ×1.
- Nginx : upgrade WebSocket + `proxy_read_timeout 3600s` sur `/api/v1/chat/ws`, `access_log`
  **`digisante_noquery`** (le JWT en query n'est jamais journalisé).
- Sauvegarde : double archive chiffrée (base + fichiers), clé root-only, rétention 14 j, alerte si
  magasin introuvable.
- UFW : OpenSSH + Nginx Full ; Redis et PostgreSQL non exposés (écoute locale par défaut Ubuntu).
- CI : job `deploy` opt-in (`DEPLOY_ENABLED`), gardé par `build-and-test` **et** `e2e`.

## 3. Points ouverts (décision ou exécution humaine)

| # | Point | Nature | Suite |
|---|---|---|---|
| O1 | **HSTS** absent (Certbot ne l'ajoute pas) | à poser dans le bloc 443 généré, **après** validation TLS : `add_header Strict-Transport-Security "max-age=31536000" always;` | B3 phase 4 |
| O2 | ~~Rotation des journaux~~ — **fait (prompt 15)** : `infra/deploy/logrotate/digisante` installé par `provision.sh`, `healthwatch.sh` au cron | — | ✅ |
| O3 | Rôle PostgreSQL applicatif **propriétaire** des tables d'audit (CLAUDE.md §8 recommande un rôle non propriétaire) | durcissement : un compte applicatif compromis pourrait `ALTER`/désactiver les triggers | arbitrage porteur (migrations = propriétaire) |
| O4 | Sauvegardes **hors VPS** (copie distante des archives + de `backup.key`) | procédure manuelle, non scriptée | B5 / porteur |
| O5 | **CI GitHub Actions bloquée** au 22/09 (jobs sans runner, `main` inclus) | le job `deploy` ne peut pas s'exécuter | vérifier *Settings → Billing* du compte |
| O6 | ~~Patch §5 d'idempotence des webhooks non appliqué~~ — **appliqué le 22/09/2026** (accord porteur) | ~~double crédit possible~~ fermé | S7 à rejouer en bac à sable (`RECETTE_FedaPay_Sandbox.md` §1) |

## 4. Décision

| Porte | Verdict |
|---|---|
| Dépôt prêt à provisionner (scripts, conf, docs) | **GO** — défauts V1→V11 corrigés, contrôles statiques verts |
| Exécution sur le VPS (B3 phases 1→6) | **NO-GO tant que** VPS, domaine/DNS, clé SSH et secrets ne sont pas fournis (SUIVI_B3 §2) et que O5 n'est pas levé pour le déploiement continu |
| Ouverture au public | **NO-GO** — O1, O2, O6 + B1/B2/B4/B5 |
