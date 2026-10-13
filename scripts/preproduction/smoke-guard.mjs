// Garde avant connexion : déclaration d'isolation + version, pas preuve d'accès cible.
export const SMOKE_PROVIDERS = [
  { flag: 'SMOKE_FEDAPAY', file: 'fedapay' },
  // Recette S8 (B1) : crée UNE transaction bac à sable non payée — opt-in distinct du préflight GET.
  { flag: 'SMOKE_FEDAPAY_S8', file: 'fedapay-s8' },
  { flag: 'SMOKE_TWILIO', file: 'twilio' },
  { flag: 'SMOKE_DAILY', file: 'daily' },
  { flag: 'SMOKE_FCM', file: 'firebase' },
  { flag: 'SMOKE_RESEND', file: 'resend' },
];
export function selectedSmokeFiles(env) {
  return SMOKE_PROVIDERS.filter((p) => env[p.flag] === '1').map((p) => `src/services/${p.file}.smoke.test.ts`);
}
export function smokeEnvironmentIssues(env, actualSha) {
  const issues = [];
  if (env.SMOKE_ENVIRONMENT !== 'preproduction') issues.push('SMOKE_ENVIRONMENT=preproduction requis ; aucune recette sur la production.');
  if (env.NODE_ENV !== 'production') issues.push('NODE_ENV=production requis : vraie configuration, aucun devCode ni mode test.');
  if (!/^[0-9a-f]{40}$/.test(env.SMOKE_EXPECTED_SHA ?? '') || env.SMOKE_EXPECTED_SHA !== actualSha) issues.push('SMOKE_EXPECTED_SHA doit correspondre au SHA complet du checkout qualifié.');
  if (selectedSmokeFiles(env).length !== 1) issues.push('Sélectionner exactement un fournisseur avec SMOKE_<PROVIDER>=1.');
  const local = (u) => ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  try {
    const u = new URL(env.DATABASE_URL);
    const name = decodeURIComponent(u.pathname.slice(1));
    if (!['postgres:', 'postgresql:'].includes(u.protocol) || !local(u) || !/^[a-z][a-z0-9_]*_preprod$/.test(env.SMOKE_DATABASE_NAME ?? '') || name !== env.SMOKE_DATABASE_NAME) issues.push('Base PostgreSQL native locale dédiée *_preprod et SMOKE_DATABASE_NAME concordant requis.');
  } catch { issues.push('DATABASE_URL invalide ou absente (valeur non affichée).'); }
  try {
    const u = new URL(env.REDIS_URL);
    if (!['redis:', 'rediss:'].includes(u.protocol) || !local(u) || !/^\d+$/.test(env.SMOKE_REDIS_DB ?? '') || u.pathname !== `/${env.SMOKE_REDIS_DB}` || Number(env.SMOKE_REDIS_DB) > 15) issues.push('Redis local dédié, index explicite /0…/15 et SMOKE_REDIS_DB concordant requis.');
  } catch { issues.push('REDIS_URL invalide ou absente (valeur non affichée).'); }
  return issues;
}
export function assertFedapaySandbox({ enabled, secrets }) {
  if (!enabled || !['secretKey', 'publicKey', 'webhookSecret'].every((key) => typeof secrets[key] === 'string' && secrets[key].trim())) throw new Error('FedaPay doit être activé avec secretKey, publicKey et webhookSecret ; valeurs non affichées.');
  if (!/^sk_sandbox_\S+$/i.test(secrets.secretKey.trim())) throw new Error('Seule une clé FedaPay explicitement SANDBOX est autorisée ; aucun appel effectué.');
}
export async function requestFedapaySandbox(secrets, request = fetch) {
  assertFedapaySandbox({ enabled: true, secrets });
  return request('https://sandbox-api.fedapay.com/v1/transactions?per_page=1', {
    headers: { Authorization: `Bearer ${secrets.secretKey}` },
    redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
}
