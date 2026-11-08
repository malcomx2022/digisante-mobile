import { describe, expect, it } from 'vitest';

import { beninDayStartMs, freeSlots, isFuture, overlaps } from './appointments.rules.js';

const T = (h: number, m = 0) => new Date(2026, 5, 12, h, m).getTime();

describe('overlaps', () => {
  it('détecte un chevauchement', () => {
    expect(overlaps(T(9, 0), 30, T(9, 15), 30)).toBe(true);
  });

  it('créneaux adjacents = pas de chevauchement', () => {
    expect(overlaps(T(9, 0), 30, T(9, 30), 30)).toBe(false);
  });

  it('créneaux disjoints', () => {
    expect(overlaps(T(9, 0), 30, T(11, 0), 30)).toBe(false);
  });
});

describe('isFuture', () => {
  it('vrai dans le futur, faux dans le passé', () => {
    expect(isFuture(T(12), T(10))).toBe(true);
    expect(isFuture(T(8), T(10))).toBe(false);
  });
});

describe('créneaux libres (heure du Bénin)', () => {
  it('beninDayStartMs : minuit local = 23:00 UTC la veille ; date invalide refusée', () => {
    expect(new Date(beninDayStartMs('2026-11-10')!).toISOString()).toBe('2026-11-09T23:00:00.000Z');
    expect(beninDayStartMs('2026-02-30')).toBeNull();
    expect(beninDayStartMs('10/11/2026')).toBeNull();
  });

  it('pas = durée de créneau, 8 h–17 h, le dernier créneau finit avant la fermeture', () => {
    const day = beninDayStartMs('2026-11-10')!;
    const slots = freeSlots({ dayStartMs: day, slotDurationMin: 45, busyStartsMs: [], nowMs: 0 });
    expect(new Date(slots[0]!).toISOString()).toBe('2026-11-10T07:00:00.000Z'); // 8 h locale
    const last = slots[slots.length - 1]!;
    expect(last + 45 * 60_000).toBeLessThanOrEqual(day + 17 * 3_600_000);
    expect(slots).toHaveLength(12);
  });

  it('exclut les créneaux passés et ceux qui chevauchent un RDV actif', () => {
    const day = beninDayStartMs('2026-11-10')!;
    const at = (h: number, m = 0) => day + (h * 60 + m) * 60_000;
    const slots = freeSlots({ dayStartMs: day, slotDurationMin: 30, busyStartsMs: [at(9, 15)], nowMs: at(8, 30) });
    expect(slots).not.toContain(at(8));
    expect(slots).not.toContain(at(8, 30)); // non futur
    expect(slots).not.toContain(at(9));
    expect(slots).not.toContain(at(9, 30));
    expect(slots).toContain(at(10));
  });

  it('durée invalide → aucun créneau', () => {
    expect(freeSlots({ dayStartMs: 0, slotDurationMin: 0, busyStartsMs: [], nowMs: 0 })).toEqual([]);
  });
});
