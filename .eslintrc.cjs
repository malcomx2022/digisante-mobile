// ─────────────────────────────────────────────────────────────
// Config ESLint racine — DigiSanté Mobile (packages TS : api, shared)
// ESLint 8 « eslintrc » classique. apps/web a sa propre config (next).
// La cascade ESLint remonte jusqu'à ce fichier depuis apps/api et packages/shared.
// ─────────────────────────────────────────────────────────────
/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  env: { node: true, es2022: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: ['dist/', '.next/', 'node_modules/', 'apps/web/'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    // Sécurité §4 : interdit `console.*` dans le code applicatif de l'API — un
    // log console peut exposer des données sensibles (jetons, identifiants) et
    // court-circuite l'assainissement du logger. La journalisation passe par
    // pino via `app.log` / `request.log` (sérialiseur `req` qui masque les
    // secrets, cf. server.ts + lib/log-sanitize.ts).
    'no-console': 'error',
  },
  overrides: [
    {
      // `env.ts` s'exécute AU DÉMARRAGE, avant que le logger Fastify n'existe
      // (parsing/validation de la configuration à l'import). Sur échec fatal, la
      // console est la seule sortie possible juste avant `process.exit(1)`.
      files: ['apps/api/src/lib/env.ts'],
      rules: { 'no-console': 'off' },
    },
  ],
};
