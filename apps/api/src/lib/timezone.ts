// ─────────────────────────────────────────────────────────────
// Fuseau de l'application — Porto-Novo (UTC+1, sans heure d'été), indépendant du fuseau de
// l'hôte PARTAGÉ (revue GO du 23/10/2026, résiduel 3 : l'hôte IONOS garde le sien pour
// ImmiPro et BeninLink).
//
// Plusieurs calculs utilisent l'heure LOCALE du processus Node : heure des rappels de
// traitement (`setHours`), début de journée des générateurs idempotents (PEV, CPN,
// observance), série d'observance, dates affichées dans les rappels. Sur un hôte en
// Europe/Madrid, un rappel de 08:00 partirait à 07:00 ou 06:00 à Porto-Novo selon la saison.
// main.ts épingle donc TZ AVANT tout autre module ; ecosystem.config.cjs le pose aussi.
// Les calculs déjà explicites (Africa/Lagos, abonnements et finances) restent inchangés.
// ─────────────────────────────────────────────────────────────
export const APP_TIME_ZONE = 'Africa/Porto-Novo';

/**
 * Impose le fuseau de l'application au processus et vérifie qu'il est réellement appliqué
 * (données de fuseau présentes). Échec ⇒ erreur au message sûr, le démarrage s'arrête.
 */
export function pinProcessTimeZone(): void {
  process.env.TZ = APP_TIME_ZONE;
  const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Porto-Novo est un alias de Lagos dans certaines versions de la base IANA/ICU.
  const offsetMinutes = -new Date(Date.UTC(2026, 0, 15, 12)).getTimezoneOffset();
  const summerOffset = -new Date(Date.UTC(2026, 6, 15, 12)).getTimezoneOffset();
  if (!['Africa/Porto-Novo', 'Africa/Lagos'].includes(resolved) || offsetMinutes !== 60 || summerOffset !== 60) {
    throw Object.assign(new Error(`Fuseau ${APP_TIME_ZONE} indisponible pour le processus (résolu : ${resolved}) : données de fuseau (tzdata/ICU) à installer`), {
      code: 'API_TZ_UNAVAILABLE',
    });
  }
}
