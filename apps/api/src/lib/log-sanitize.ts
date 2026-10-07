// ─────────────────────────────────────────────────────────────
// Assainissement des URL avant journalisation (CLAUDE.md §4).
// Le canal WebSocket du chat reçoit le JWT d'accès en query string
// (`/chat/ws?token=…`) car les navigateurs ne posent pas d'en-tête
// Authorization sur un WS (§8). Ce secret ne doit JAMAIS finir en clair
// dans les journaux applicatifs / d'agrégation.
// ─────────────────────────────────────────────────────────────

/** Aucun argument/fragment journalisé, même une clé encodée ou inconnue. */
export function sanitizeLogUrl(url: string): string {
  return url.split(/[?#]/, 1)[0];
}

/**
 * Sérialiseur d'erreur pour les journaux (pino `serializers.err`).
 * Les erreurs Prisma de VALIDATION recopient l'appel complet dans leur message —
 * arguments compris (identifiants, titres, mesures, contenu saisi…) : journalisées
 * telles quelles, une 500 déposerait des données de santé dans les logs (§4).
 * Pour toute erreur `PrismaClient*`, on ne garde que le type, le code, l'opération
 * (`prisma.<modèle>.<méthode>()`) et les NOMS de champs en cause — jamais les valeurs.
 * Les autres erreurs passent par le sérialiseur standard.
 */
export interface LoggedError {
  type: string;
  message: string;
  stack: string;
  [key: string]: unknown;
}

export function serializeErrorForLog(err: unknown): LoggedError {
  if (!(err instanceof Error)) return { type: typeof err, message: '[erreur masquée]', stack: '' };
  if (err.name.startsWith('PrismaClient')) {
    const e = err as Error & { code?: string; meta?: Record<string, unknown>; clientVersion?: string };
    const op = /prisma\.(\w+)\.(\w+)\(\)/.exec(err.message);
    const target = e.meta?.target;
    return {
      type: err.name,
      ...(e.code ? { code: e.code } : {}),
      ...(op ? { operation: `prisma.${op[1]}.${op[2]}()` } : {}),
      // `target` = noms de colonnes (contrainte d'unicité) — jamais des valeurs.
      ...(Array.isArray(target) || typeof target === 'string' ? { target } : {}),
      ...(typeof e.meta?.modelName === 'string' ? { model: e.meta.modelName } : {}),
      message: '[message Prisma masqué — peut contenir des données de la requête]',
      stack: (err.stack ?? '').split('\n').filter((l) => l.trimStart().startsWith('at ')).slice(0, 8).join('\n'),
    };
  }
  return { type: err.name, message: '[message masqué — peut contenir des données ou secrets]', stack: '' };
}
