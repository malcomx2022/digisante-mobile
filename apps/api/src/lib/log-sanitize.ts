// ─────────────────────────────────────────────────────────────
// Assainissement des URL avant journalisation (CLAUDE.md §4).
// Le canal WebSocket du chat reçoit le JWT d'accès en query string
// (`/chat/ws?token=…`) car les navigateurs ne posent pas d'en-tête
// Authorization sur un WS (§8). Ce secret ne doit JAMAIS finir en clair
// dans les journaux applicatifs / d'agrégation.
// ─────────────────────────────────────────────────────────────

/** Masque les paramètres de query sensibles (token / access_token) d'une URL loggée. */
export function sanitizeLogUrl(url: string): string {
  return url.replace(/([?&](?:token|access_token)=)[^&]*/gi, '$1[redacted]');
}
