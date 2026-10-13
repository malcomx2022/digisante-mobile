// ─────────────────────────────────────────────────────────────
// Recette S8 (B1) — hôte EXACT du lien de paiement FedaPay en BAC À SABLE.
//
// Le relevé « pendant S1 » ne montre rien si l'hôte n'est pas déjà autorisé : l'API
// répond 502 sans l'afficher (createTransaction, zone gelée §5, non modifiée). Cette
// sonde opt-in crée UNE transaction bac à sable non payée, demande son lien
// (POST /transactions/{id}/token), puis s'arrête : aucun paiement, aucune visite du
// lien, aucune écriture locale (ni Payment, ni audit), aucun autre appel.
//
// Sortie publiable : hôte, forme du chemin, verdict. JAMAIS le lien complet, le
// jeton, la clé ni l'identifiant entier de la transaction (4 derniers caractères).
// Le verdict s'appuie sur le contrôle de PRODUCTION (`isFedapayCheckoutUrl`),
// injecté par l'appelant : la sonde ne réimplémente pas la liste blanche.
// ─────────────────────────────────────────────────────────────
import { assertFedapaySandbox } from './smoke-guard.mjs';

export const SANDBOX_API = 'https://sandbox-api.fedapay.com/v1';
/** Montant de la transaction de recette (XOF entier, jamais payée). */
export const S8_AMOUNT_XOF = 100;
const TIMEOUT_MS = 15_000;
/** Au-delà, une étiquette d'hôte pourrait porter un jeton : seule sa forme est affichée. */
const MAX_LABEL_SHOWN = 24;

/** Décision opérateur par code de verdict (reprise mot pour mot dans la recette). */
export const S8_DECISIONS = {
  HOTE_AUTORISE: 'PASS : hôte autorisé pour la clé bac à sable. Poursuivre S1 (redirection effective dans le navigateur) ; consigner l’hôte observé.',
  HOTE_LIVE: 'FAIL : une clé bac à sable renvoie un hôte LIVE. Arrêter la recette FedaPay, ne rien élargir, signaler au porteur et à FedaPay.',
  HOTE_NON_LISTE: 'FAIL : hôte absent de la liste blanche (S1 répondrait 502). Ne pas élargir ; consigner l’hôte exact, revue §5 puis ajout de CET hôte seul, avec tests.',
  FORME_REFUSEE: 'FAIL : hôte listé mais lien refusé par le contrôle de production (schéma, port, identifiants ou caractères). Consigner la forme, revue §5 avant toute modification.',
  URL_INVALIDE: 'FAIL : réponse sans lien exploitable. Consigner les champs reçus et les codes HTTP ; ne pas poursuivre S1.',
  CREATION_HTTP: 'FAIL : création de transaction refusée par l’API bac à sable. Vérifier la clé, le compte sandbox et le montant ; aucun lien obtenu.',
  CREATION_RESEAU: 'FAIL : création sans réponse exploitable (délai ou réseau). Rechercher la référence dans le tableau de bord sandbox AVANT toute relance ; une transaction a pu être créée.',
  ID_INVALIDE: 'FAIL : transaction créée sans identifiant valide. Consigner les champs de la réponse ; aucun lien demandé.',
  TOKEN_HTTP: 'FAIL : génération du lien refusée par l’API bac à sable. Consigner le code HTTP et l’identifiant masqué.',
  TOKEN_RESEAU: 'FAIL : demande de lien sans réponse exploitable (délai ou réseau). La transaction existe : la retrouver par sa référence, consigner l’identifiant masqué, relancer une seule fois.',
};

const maskId = (id) => `••••${String(id).slice(-4)}`;

/** Forme non sensible d'une chaîne : longueur et classes de caractères, jamais le contenu. */
function shapeOf(value) {
  const classes = [
    /[a-z]/.test(value) && 'a-z', /[A-Z]/.test(value) && 'A-Z',
    /[0-9]/.test(value) && '0-9', /[^A-Za-z0-9]/.test(value) && 'autres',
  ].filter(Boolean).join(',');
  return `<${value.length} car. ${classes || 'vide'}>`;
}

/**
 * Hôte affichable : chaque étiquette courte en clair, toute étiquette longue (où un jeton
 * pourrait se loger) remplacée par sa forme. Les hôtes connus restent toujours lisibles.
 */
export function displayHost(host) {
  return host.split('.').map((label) => (label.length <= MAX_LABEL_SHOWN && /^[a-z0-9-]*$/.test(label) ? label : shapeOf(label))).join('.');
}

/**
 * Description publiable d'un lien : schéma, hôte, port, présence d'identifiants, forme
 * du chemin, NOMBRE de paramètres de requête et présence d'un fragment. Le jeton,
 * qui vit dans le chemin (ou la requête), n'apparaît jamais.
 */
export function describeCheckoutUrl(value) {
  if (typeof value !== 'string' || !value) return { valid: false };
  let url;
  try { url = new URL(value); } catch { return { valid: false }; }
  const segments = url.pathname.split('/').filter(Boolean);
  return {
    valid: true,
    protocol: url.protocol.replace(/:$/, ''),
    host: url.hostname.toLowerCase(),
    port: url.port || null,
    credentials: Boolean(url.username || url.password),
    path: segments.length ? `/${segments.map(shapeOf).join('/')}` : '/',
    queryParams: [...url.searchParams.keys()].length,
    fragment: Boolean(url.hash),
  };
}

/**
 * Verdict S8. `isAllowedSandbox` = contrôle de production lié à l'environnement
 * bac à sable ; `hosts` = listes de production (pour qualifier un refus).
 */
export function s8Verdict(url, { isAllowedSandbox, hosts }) {
  const shape = describeCheckoutUrl(url);
  if (!shape.valid) return { verdict: 'FAIL', code: 'URL_INVALIDE', shape };
  if (isAllowedSandbox(url)) return { verdict: 'PASS', code: 'HOTE_AUTORISE', shape };
  if (hosts.live.includes(shape.host)) return { verdict: 'FAIL', code: 'HOTE_LIVE', shape };
  if (hosts.sandbox.includes(shape.host)) return { verdict: 'FAIL', code: 'FORME_REFUSEE', shape };
  return { verdict: 'FAIL', code: 'HOTE_NON_LISTE', shape };
}

/** Clés de premier niveau d'un objet JSON (forme, jamais les valeurs). */
const fieldsOf = (json) => (json && typeof json === 'object' && !Array.isArray(json) ? Object.keys(json).sort() : []);

/**
 * Lien ↔ jeton, sans rien afficher : le chemin est-il exactement `/<jeton>` ; le jeton
 * est-il un JWT dont `sub` désigne cette transaction ; durée de validité arrondie.
 */
export function tokenFacts(url, token, id, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (typeof token !== 'string' || !token) return { pathIsToken: null, jwt: null };
  let pathIsToken = null;
  try { const u = new URL(url); pathIsToken = u.pathname === `/${token}` && !u.search && !u.hash; } catch { /* lien déjà jugé */ }
  const parts = token.split('.');
  let jwt = null;
  if (parts.length === 3) {
    try {
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      jwt = {
        subMatches: claims?.sub === undefined ? null : String(claims.sub) === String(id),
        validityHours: Number.isFinite(claims?.exp) ? Math.round((claims.exp - nowSeconds) / 3600) : null,
      };
    } catch { jwt = null; }
  }
  return { pathIsToken, jwt };
}

/** Code d'erreur de transport, jamais son message (qui peut recopier des en-têtes). */
const transportError = (err) => (typeof err?.name === 'string' && /^[A-Za-z]{1,40}$/.test(err.name) ? err.name : 'Error');

/**
 * Exécute la sonde. Gardes AVANT chaque appel (clé bac à sable explicite, intégration
 * activée et complète). Deux POST au plus, vers la seule API bac à sable, sans
 * redirection, bornés à 15 s. Ne lève que sur garde ; toute réponse ou panne amont
 * devient un verdict FAIL codé, sans corps ni message d'erreur recopié.
 */
export async function runS8Probe({ enabled, secrets, request = fetch, parseId, isAllowedSandbox, hosts, reference, nowSeconds }) {
  assertFedapaySandbox({ enabled, secrets });
  if (typeof reference !== 'string' || !/^[a-z0-9-]{8,64}$/.test(reference)) throw new Error('Référence de recette invalide (minuscules, chiffres, tirets).');
  const call = async (path, body) => {
    // Recontrôle juste avant le réseau : une clé modifiée en cours de route n'atteint jamais l'API.
    assertFedapaySandbox({ enabled, secrets });
    try {
      const res = await request(`${SANDBOX_API}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${secrets.secretKey}`, 'Content-Type': 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { res, json: await res.json().catch(() => null) };
    } catch (err) {
      return { failure: transportError(err) };
    }
  };
  const created = await call('/transactions', {
    description: 'DigiSanté — recette S8 (synthétique, jamais payée)',
    amount: S8_AMOUNT_XOF,
    currency: { iso: 'XOF' },
    merchant_reference: reference,
  });
  if (created.failure) return { verdict: 'FAIL', code: 'CREATION_RESEAU', failure: created.failure };
  // Création : enveloppe `v1/transaction` (SDK, ancienne doc) ou objet plat (OpenAPI actuelle).
  const wrapped = created.json?.['v1/transaction'] && typeof created.json['v1/transaction'] === 'object';
  const transaction = wrapped ? created.json['v1/transaction'] : created.json;
  const createInfo = {
    createStatus: created.res.status,
    createWrapper: created.json ? (wrapped ? 'v1/transaction' : 'racine') : 'illisible',
    createFields: fieldsOf(transaction),
    // Lien éventuellement fourni dès la création (intégrations tierces) : son hôte seul.
    createPaymentUrlHost: describeCheckoutUrl(transaction?.payment_url).host ?? null,
  };
  if (!created.res.ok) return { verdict: 'FAIL', code: 'CREATION_HTTP', ...createInfo };
  const id = parseId(transaction?.id);
  if (!id) return { verdict: 'FAIL', code: 'ID_INVALIDE', ...createInfo };
  const token = await call(`/transactions/${encodeURIComponent(id)}/token`);
  const base = { transaction: maskId(id), ...createInfo };
  if (token.failure) return { ...base, verdict: 'FAIL', code: 'TOKEN_RESEAU', failure: token.failure };
  const tokenInfo = { tokenStatus: token.res.status, tokenFields: fieldsOf(token.json) };
  if (!token.res.ok) return { ...base, ...tokenInfo, verdict: 'FAIL', code: 'TOKEN_HTTP' };
  const url = token.json?.url;
  return { ...base, ...tokenInfo, ...s8Verdict(url, { isAllowedSandbox, hosts }), facts: tokenFacts(url, token.json?.token, id, nowSeconds) };
}

const yesNo = (value) => (value === null || value === undefined ? 'inconnu' : value ? 'oui' : 'non');

/** Lignes publiables pour l'opérateur (aucun secret, lien, jeton ni identifiant complet). */
export function formatS8(result, reference) {
  const s = result.shape;
  const link = s?.valid
    ? `lien ${s.protocol}://${displayHost(s.host)}${s.port ? `:${s.port}` : ''} chemin ${s.path} · identifiants=${s.credentials ? 'OUI' : 'non'} · paramètres de requête=${s.queryParams} · fragment=${s.fragment ? 'oui' : 'non'}`
    : 'lien absent ou non analysable';
  const facts = result.facts
    ? `chemin = /<jeton> : ${yesNo(result.facts.pathIsToken)} · jeton JWT : ${result.facts.jwt ? `oui (sub = transaction : ${yesNo(result.facts.jwt.subMatches)}, validité ≈ ${result.facts.jwt.validityHours ?? '?'} h)` : 'non'}`
    : null;
  const create = result.createStatus === undefined ? '—' : `${result.createStatus} (forme : ${result.createWrapper} ; champs : ${result.createFields.join(',') || 'aucun'}${result.createPaymentUrlHost ? ` ; payment_url sur ${displayHost(result.createPaymentUrlHost)}` : ''})`;
  return [
    `[s8:fedapay] verdict=${result.verdict} · code=${result.code} · référence=${reference} · transaction=${result.transaction ?? '—'}${result.failure ? ` · panne=${result.failure}` : ''}`,
    `[s8:fedapay] création HTTP ${create} · lien HTTP ${result.tokenStatus ?? '—'} (champs : ${(result.tokenFields ?? []).join(',') || 'aucun'})`,
    `[s8:fedapay] ${link}`,
    ...(facts ? [`[s8:fedapay] ${facts}`] : []),
    `[s8:fedapay] décision : ${S8_DECISIONS[result.code]}`,
  ];
}
