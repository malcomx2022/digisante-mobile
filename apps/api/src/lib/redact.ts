// ─────────────────────────────────────────────────────────────
// Masquage des données personnelles dans les JOURNAUX applicatifs (§4, RGPD/APDP).
// Les journaux sont conservés, tournés et parfois exportés : ils ne doivent porter
// ni numéro complet, ni adresse e-mail complète, ni code OTP, ni contenu de message.
// (Le journal d'AUDIT, lui, est un registre de conformité distinct — hors périmètre.)
// Sans dépendance à `env.ts` : utilisable (et testable) sans configuration.
// ─────────────────────────────────────────────────────────────
/** `+2290196700001` → `+229••••••0001` (indicatif + 4 derniers chiffres). */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '—';
  const s = phone.replace(/\s+/g, '');
  const cc = s.startsWith('+229') ? '+229' : s.startsWith('+') ? s.slice(0, 3) : '';
  const rest = s.slice(cc.length);
  if (rest.length <= 4) return `${cc}••••`;
  return `${cc}${'•'.repeat(rest.length - 4)}${rest.slice(-4)}`;
}

/** `ulrich.segla@example.com` → `u•••@example.com` (domaine conservé : utile au diagnostic). */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return '—';
  const at = email.lastIndexOf('@');
  if (at <= 0) return '•••';
  return `${email[0]}•••${email.slice(at)}`;
}

/** Identifiant fournisseur (SID Twilio, id Resend…) : 4 derniers caractères. */
export function maskId(id: string | null | undefined): string {
  if (!id) return '—';
  return id.length <= 4 ? '••••' : `••••${id.slice(-4)}`;
}

/**
 * Contenu d'un message en mode STUB : lisible en dev/test (utile au développeur),
 * JAMAIS en production — où un stub signifie « fournisseur non configuré » et où le
 * contenu (code OTP, SMS SOS avec coordonnées) finirait en clair dans les journaux.
 */
export function stubContent(value: string, nodeEnv: string | undefined = process.env.NODE_ENV): string {
  return nodeEnv === 'production' ? `[masqué — ${value.length} car.]` : value;
}
