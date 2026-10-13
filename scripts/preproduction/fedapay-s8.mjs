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

/** Décision opérateur par code de verdict (reprise mot pour mot dans la recette). */
export const S8_DECISIONS = {
  HOTE_AUTORISE: 'PASS : hôte autorisé pour la clé bac à sable. Poursuivre S1 (redirection effective dans le navigateur) ; consigner l’hôte observé.',
  HOTE_LIVE: 'FAIL : une clé bac à sable renvoie un hôte LIVE. Arrêter la recette FedaPay, ne rien élargir, signaler au porteur et à FedaPay.',
  HOTE_NON_LISTE: 'FAIL : hôte absent de la liste blanche (S1 répondrait 502). Ne pas élargir ; consigner l’hôte exact, revue §5 puis ajout de CET hôte seul, avec tests.',
  FORME_REFUSEE: 'FAIL : hôte listé mais lien refusé par le contrôle de production (schéma, port, identifiants ou caractères). Consigner la forme, revue §5 avant toute modification.',
  URL_INVALIDE: 'FAIL : réponse sans lien exploitable. Consigner les champs reçus et les codes HTTP ; ne pas poursuivre S1.',
  CREATION_HTTP: 'FAIL : création de transaction refusée par l’API bac à sable. Vérifier la clé, le compte sandbox et le montant ; aucun lien obtenu.',
  ID_INVALIDE: 'FAIL : transaction créée sans identifiant valide. Consigner les champs de la réponse ; aucun lien demandé.',
  TOKEN_HTTP: 'FAIL : génération du lien refusée par l’API bac à sable. Consigner le code HTTP et l’identifiant masqué.',
};

const maskId = (id) => `••••${String(id).slice(-4)}`;

/** Forme non sensible d'un segment : longueur et classes de caractères, jamais le contenu. */
function segmentShape(segment) {
  const classes = [
    /[a-z]/.test(segment) && 'a-z', /[A-Z]/.test(segment) && 'A-Z',
    /[0-9]/.test(segment) && '0-9', /[^A-Za-z0-9]/.test(segment) && 'autres',
  ].filter(Boolean).join(',');
  return `<${segment.length} car. ${classes || 'vide'}>`;
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
    path: segments.length ? `/${segments.map(segmentShape).join('/')}` : '/',
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

/** Clés de premier niveau d'une réponse JSON (forme, jamais les valeurs). */
const fieldsOf = (json) => (json && typeof json === 'object' && !Array.isArray(json) ? Object.keys(json).sort() : []);

/**
 * Exécute la sonde. Gardes AVANT chaque appel (clé bac à sable explicite, intégration
 * activée et complète). Deux POST au plus, vers la seule API bac à sable, sans
 * redirection, bornés à 15 s. Ne lève que sur garde ; toute réponse amont devient un
 * verdict FAIL codé, sans corps recopié.
 */
export async function runS8Probe({ enabled, secrets, request = fetch, parseId, isAllowedSandbox, hosts, reference }) {
  assertFedapaySandbox({ enabled, secrets });
  if (typeof reference !== 'string' || !/^[a-z0-9-]{8,64}$/.test(reference)) throw new Error('Référence de recette invalide (minuscules, chiffres, tirets).');
  const call = (path, body) => {
    // Recontrôle juste avant le réseau : une clé modifiée en cours de route n'atteint jamais l'API.
    assertFedapaySandbox({ enabled, secrets });
    return request(`${SANDBOX_API}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secrets.secretKey}`, 'Content-Type': 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  };
  const created = await call('/transactions', {
    description: 'DigiSanté — recette S8 (synthétique, jamais payée)',
    amount: S8_AMOUNT_XOF,
    currency: { iso: 'XOF' },
    merchant_reference: reference,
  });
  const createJson = await created.json().catch(() => null);
  if (!created.ok) return { verdict: 'FAIL', code: 'CREATION_HTTP', createStatus: created.status, createFields: fieldsOf(createJson) };
  const id = parseId(createJson?.['v1/transaction']?.id ?? createJson?.id);
  if (!id) return { verdict: 'FAIL', code: 'ID_INVALIDE', createStatus: created.status, createFields: fieldsOf(createJson) };
  const token = await call(`/transactions/${encodeURIComponent(id)}/token`);
  const tokenJson = await token.json().catch(() => null);
  const base = { transaction: maskId(id), createStatus: created.status, tokenStatus: token.status, tokenFields: fieldsOf(tokenJson) };
  if (!token.ok) return { ...base, verdict: 'FAIL', code: 'TOKEN_HTTP' };
  return { ...base, ...s8Verdict(tokenJson?.url, { isAllowedSandbox, hosts }) };
}

/** Lignes publiables pour l'opérateur (aucun secret, lien, jeton ni identifiant complet). */
export function formatS8(result, reference) {
  const s = result.shape;
  const link = s?.valid
    ? `lien ${s.protocol}://${s.host}${s.port ? `:${s.port}` : ''} chemin ${s.path} · identifiants=${s.credentials ? 'OUI' : 'non'} · paramètres de requête=${s.queryParams} · fragment=${s.fragment ? 'oui' : 'non'}`
    : 'lien absent ou non analysable';
  return [
    `[s8:fedapay] verdict=${result.verdict} · code=${result.code} · référence=${reference} · transaction=${result.transaction ?? '—'}`,
    `[s8:fedapay] création HTTP ${result.createStatus ?? '—'}${result.createFields ? ` (champs : ${result.createFields.join(',') || 'aucun'})` : ''} · lien HTTP ${result.tokenStatus ?? '—'} (champs : ${(result.tokenFields ?? []).join(',') || 'aucun'})`,
    `[s8:fedapay] ${link}`,
    `[s8:fedapay] décision : ${S8_DECISIONS[result.code]}`,
  ];
}
