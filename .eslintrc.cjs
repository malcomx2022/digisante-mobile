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
  },
};
