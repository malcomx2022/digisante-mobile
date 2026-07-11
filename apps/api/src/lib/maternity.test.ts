// Tests unitaires du calendrier CPN + helpers purs (@digisante/shared).
import { ANC_SCHEDULE, buildAntenatalSchedule, computeDueDate, gestationalWeeks } from '@digisante/shared';
import { describe, expect, it } from 'vitest';

const lmp = new Date('2026-01-01T00:00:00.000Z');

describe('santé maternelle (CPN)', () => {
  it('terme = LMP + 280 jours', () => {
    const days = Math.round((computeDueDate(lmp).getTime() - lmp.getTime()) / 86_400_000);
    expect(days).toBe(280);
  });

  it('génère les 8 contacts CPN aux bonnes semaines', () => {
    const visits = buildAntenatalSchedule(lmp);
    expect(visits.length).toBe(ANC_SCHEDULE.length);
    const c1 = visits[0];
    expect(c1.contactNumber).toBe(1);
    expect(Math.round((c1.dueDate.getTime() - lmp.getTime()) / 86_400_000)).toBe(12 * 7);
    const last = visits[visits.length - 1];
    expect(Math.round((last.dueDate.getTime() - lmp.getTime()) / 86_400_000)).toBe(40 * 7);
  });

  it('âge gestationnel en semaines (borné 0..42)', () => {
    expect(gestationalWeeks(lmp, new Date('2026-01-01'))).toBe(0);
    expect(gestationalWeeks(lmp, new Date('2026-03-26'))).toBe(12); // ~12 SA
    expect(gestationalWeeks(lmp, new Date('2027-01-01'))).toBe(42); // borné
  });
});
