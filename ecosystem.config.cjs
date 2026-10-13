// ─────────────────────────────────────────────────────────────
// PM2 — DigiSanté Mobile (VPS IONOS partagé, dérogation porteur 13/10/2026)
// cf. CLAUDE.md §2 (Fastify clustering PM2 ×2) et §7 (déploiement).
//
// Cible : VPS IONOS partagé `srv1.immipro.app` (31.70.148.167) — cohabite
// avec ImmiPro prod et BeninLink prod/recette. Ports 3000 (ImmiPro) et
// 3001 (Grafana) pris sur l'hôte : ne jamais les réutiliser pour DigiSanté.
//   - Préprod :  DIGISANTE_ENV=preproduction → web 3100 / api 3101,
//     noms PM2 `digisante-preprod-api/web`, checkout /var/www/digisante-preprod,
//     logs /var/log/digisante-preprod.
//   - Prod :     DIGISANTE_ENV=production → web 3200 / api 3201,
//     noms PM2 `digisante-api/web`, checkout /var/www/digisante,
//     logs /var/log/digisante.
//
// DIGISANTE_ENV est OBLIGATOIRE (aucun défaut : un oubli démarrerait l'autre
// environnement). infra/deploy/scripts/deploy.sh le dérive de DEPLOY_ENVIRONMENT ; les
// noms et ports ci-dessous sont repris À L'IDENTIQUE par le profil `digisante_profile`
// des scripts d'exploitation (test de cohérence scripts/infra/environments.test.mjs).
// Lancement / reload (depuis le checkout de l'environnement) :
//   DIGISANTE_ENV=preproduction pm2 startOrReload ecosystem.config.cjs --update-env
//
// L'API lit API_PORT/API_HOST (apps/api/src/lib/env.ts), PAS `PORT` : ils sont posés ici,
// et l'environnement PM2 prime sur `--env-file` (Node ne remplace jamais une variable déjà
// définie) — l'API_PORT=3001 d'un .env copié de .env.example ne s'applique donc pas.
// Écoute sur 127.0.0.1 uniquement : seul Nginx (même hôte) est un client légitime.
//
// Les SECRETS ne sont JAMAIS ici (cf. CLAUDE.md §3/§4) : ils sont lus
// depuis les fichiers .env présents sur le VPS, chargés par Node via
// --env-file (API) et par Next.js automatiquement (web).
//   - API préprod : /var/www/digisante-preprod/apps/api/.env
//   - Web préprod : /var/www/digisante-preprod/apps/web/.env.production
//   - API prod : /var/www/digisante/apps/api/.env
//   - Web prod : /var/www/digisante/apps/web/.env.production
// ─────────────────────────────────────────────────────────────
const ENV = process.env.DIGISANTE_ENV ?? '';
const CONFS = {
  preproduction: {
    apiName: 'digisante-preprod-api',
    webName: 'digisante-preprod-web',
    apiPort: '3101',
    webPort: '3100',
    logDir: '/var/log/digisante-preprod',
  },
  production: {
    apiName: 'digisante-api',
    webName: 'digisante-web',
    apiPort: '3201',
    webPort: '3200',
    logDir: '/var/log/digisante',
  },
};
if (!Object.hasOwn(CONFS, ENV)) {
  throw new Error(`DIGISANTE_ENV requis : preproduction ou production (reçu : ${ENV || 'absent'})`);
}
const CONF = CONFS[ENV];
module.exports = {
  apps: [
    {
      // ── API Fastify — clustering ×2 (partage du port via cluster Node) ──
      name: CONF.apiName,
      cwd: './apps/api',
      script: 'dist/server.js',
      // Node 24 charge le .env du cwd (apps/api) au démarrage de chaque worker.
      node_args: '--env-file=.env',
      instances: 2,
      exec_mode: 'cluster',
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        API_PORT: CONF.apiPort,
        API_HOST: '127.0.0.1',
      },
      error_file: `${CONF.logDir}/api-error.log`,
      out_file: `${CONF.logDir}/api-out.log`,
      merge_logs: true,
      time: true,
    },
    {
      // ── Web Next.js 14 (App Router) — instance unique ──
      name: CONF.webName,
      cwd: './apps/web',
      // Binaire next résolu dans apps/web/node_modules (pnpm, non hoisté).
      script: 'node_modules/next/dist/bin/next',
      args: `start -p ${CONF.webPort} -H 127.0.0.1`,
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: CONF.webPort,
      },
      error_file: `${CONF.logDir}/web-error.log`,
      out_file: `${CONF.logDir}/web-out.log`,
      merge_logs: true,
      time: true,
    },
  ],
};
