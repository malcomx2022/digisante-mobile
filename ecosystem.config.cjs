// ─────────────────────────────────────────────────────────────
// PM2 — DigiSanté Mobile (production VPS Infomaniak)
// cf. CLAUDE.md §2 (Fastify clustering PM2 ×2) et §7 (déploiement).
//
// Lancement / reload :
//   pm2 start  ecosystem.config.cjs --env production
//   pm2 reload ecosystem.config.cjs --update-env
//
// Les SECRETS ne sont JAMAIS ici (cf. CLAUDE.md §3/§4) : ils sont lus
// depuis les fichiers .env présents sur le VPS, chargés par Node via
// --env-file (API) et par Next.js automatiquement (web).
//   - API : /var/www/digisante-mobile/apps/api/.env
//   - Web : /var/www/digisante-mobile/apps/web/.env.production
// ─────────────────────────────────────────────────────────────
module.exports = {
  apps: [
    {
      // ── API Fastify — clustering ×2 (partage du port via cluster Node) ──
      name: 'digisante-api',
      cwd: './apps/api',
      script: 'dist/server.js',
      // Node 20 charge le .env du cwd (apps/api) au démarrage de chaque worker.
      node_args: '--env-file=.env',
      instances: 2,
      exec_mode: 'cluster',
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: '/var/log/digisante/api-error.log',
      out_file: '/var/log/digisante/api-out.log',
      merge_logs: true,
      time: true,
    },
    {
      // ── Web Next.js 14 (App Router) — instance unique ──
      name: 'digisante-web',
      cwd: './apps/web',
      // Binaire next résolu dans apps/web/node_modules (pnpm, non hoisté).
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
      },
      error_file: '/var/log/digisante/web-error.log',
      out_file: '/var/log/digisante/web-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
