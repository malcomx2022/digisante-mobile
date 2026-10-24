// Fuseau de l'application (résiduel 3) : l'API calcule en heure de Porto-Novo quel que soit le
// fuseau de l'hôte partagé — rappel « 08:00 » = 07:00 UTC toute l'année, même depuis un
// processus lancé en Europe/Madrid (UTC+1/+2).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { APP_TIME_ZONE, pinProcessTimeZone } from './timezone.js';

const initial = process.env.TZ;

describe('fuseau de l’application', () => {
  afterEach(() => {
    if (initial === undefined) delete process.env.TZ;
    else process.env.TZ = initial;
  });

  it.each(['Europe/Madrid', 'UTC', 'America/New_York'])('hôte en %s : heure locale = Porto-Novo, hiver comme été', (hostTz) => {
    process.env.TZ = hostTz;
    pinProcessTimeZone();
    expect(process.env.TZ).toBe(APP_TIME_ZONE);
    for (const day of ['2026-01-15', '2026-07-15']) {
      // Même calcul que le générateur des rappels de traitement (startOfDay + setHours).
      const due = new Date(`${day}T12:00:00Z`);
      due.setHours(0, 0, 0, 0);
      due.setHours(8, 0, 0, 0);
      expect(due.toISOString()).toBe(`${day}T07:00:00.000Z`);
    }
  });

  it('main.ts épingle le fuseau avant de charger la configuration et le serveur', () => {
    const main = readFileSync(fileURLToPath(new URL('../main.ts', import.meta.url)), 'utf8');
    const pin = main.indexOf('pinProcessTimeZone();');
    expect(pin).toBeGreaterThan(0);
    expect(pin).toBeLessThan(main.indexOf("await import('@/lib/env.js')"));
    expect(main).toMatch(/SAFE_MESSAGE_CODES = new Set\(\[[^\]]*'API_TZ_UNAVAILABLE'/);
  });
});
