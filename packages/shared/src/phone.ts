// ─────────────────────────────────────────────────────────────
// Numérotation béninoise — réforme ARCEP 2024 : les numéros nationaux
// passent de 8 à 10 chiffres avec un préfixe « 01 » (ex. 96466777 → 0196466777).
// Source unique de vérité partagée web ⇄ api pour normaliser et formater.
// ─────────────────────────────────────────────────────────────

/** Indicatif pays du Bénin (E.164, sans le « + »). */
export const BENIN_DIAL_CODE = '229';

/** Longueur du numéro national béninois après la réforme (préfixe 01 inclus). */
export const BENIN_NATIONAL_LENGTH = 10;

/**
 * Normalise un numéro béninois vers l'E.164 canonique `+229` + 10 chiffres.
 *
 * Gère tous les formats d'entrée courants et applique la réforme :
 * - `+229…`, `00229…`, `229…`, ou le national seul (`01XXXXXXXX` ou ancien `XXXXXXXX`) ;
 * - un ancien numéro à **8 chiffres** se voit préfixer « 01 » (8 → 10) ;
 * - un numéro déjà à 10 chiffres est conservé (idempotent).
 *
 * Les numéros **non béninois** (diaspora, autre indicatif) sont seulement
 * nettoyés (`+` et chiffres) et renvoyés sans transformation.
 * Les formes inattendues sont renvoyées nettoyées (la validation décidera).
 */
export function normalizeBeninPhone(raw: string): string {
  if (!raw) return raw;
  // Ne conserver que « + » et les chiffres (supprime espaces, points, tirets, parenthèses).
  let s = raw.trim().replace(/[^\d+]/g, '');
  if (!s) return s;

  // 00229… (préfixe international composé) → +229…
  if (s.startsWith('00')) s = `+${s.slice(2)}`;

  if (!s.startsWith('+')) {
    if (s.startsWith(BENIN_DIAL_CODE)) {
      // 229… sans le « + »
      s = `+${s}`;
    } else if (/^\d{8}$/.test(s) || /^\d{10}$/.test(s)) {
      // National béninois sans indicatif (ancien 8 chiffres ou nouveau 10 chiffres).
      s = `+${BENIN_DIAL_CODE}${s}`;
    } else {
      // Forme inconnue : préfixer « + » et laisser la validation trancher.
      return `+${s}`;
    }
  }

  const prefix = `+${BENIN_DIAL_CODE}`;
  if (s.startsWith(prefix)) {
    const national = s.slice(prefix.length);
    // Ancien format à 8 chiffres → ajoute le préfixe national « 01 ».
    if (/^\d{8}$/.test(national)) return `${prefix}01${national}`;
    // Déjà 10 chiffres (ou autre longueur → la validation s'en chargera) : inchangé.
    return s;
  }

  // Autre indicatif (diaspora) : renvoyé nettoyé, sans transformation.
  return s;
}

/**
 * Formate un numéro béninois canonique (`+22901XXXXXXXX`) pour l'affichage :
 * `+229 01 96 46 67 77`. Renvoie l'entrée inchangée si le format ne correspond pas
 * (ex. numéro diaspora), après normalisation préalable.
 */
export function formatBeninPhone(input: string): string {
  if (!input) return input;
  const s = normalizeBeninPhone(input);
  const m = /^\+229(\d{10})$/.exec(s);
  if (!m) return s;
  const n = m[1];
  return `+229 ${n.slice(0, 2)} ${n.slice(2, 4)} ${n.slice(4, 6)} ${n.slice(6, 8)} ${n.slice(8, 10)}`;
}

/** Vrai si la chaîne est un numéro béninois canonique (`+229` + 10 chiffres). */
export function isCanonicalBeninPhone(value: string): boolean {
  return /^\+229\d{10}$/.test(value);
}
