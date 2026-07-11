// Tests unitaires du calendrier PEV + helpers purs (@digisante/shared).
import { buildVaccinationSchedule, PEV_SCHEDULE, vaccinationDisplayStatus } from '@digisante/shared';
import { describe, expect, it } from 'vitest';

describe('buildVaccinationSchedule (PEV)', () => {
  const birth = new Date('2026-01-01T00:00:00.000Z');
  const schedule = buildVaccinationSchedule(birth);

  it('génère une échéance par dose du calendrier', () => {
    expect(schedule.length).toBe(PEV_SCHEDULE.length);
  });

  it('place le BCG à la naissance et PENTA1 à 6 semaines', () => {
    const bcg = schedule.find((d) => d.vaccineCode === 'BCG')!;
    expect(bcg.dueDate.getTime()).toBe(birth.getTime());
    const penta1 = schedule.find((d) => d.vaccineCode === 'PENTA1')!;
    const days = Math.round((penta1.dueDate.getTime() - birth.getTime()) / 86_400_000);
    expect(days).toBe(42); // 6 semaines
  });

  it('place la fièvre jaune (VAA) à 9 mois', () => {
    const vaa = schedule.find((d) => d.vaccineCode === 'VAA')!;
    const days = Math.round((vaa.dueDate.getTime() - birth.getTime()) / 86_400_000);
    expect(days).toBe(270); // 9 × 30
  });
});

describe('vaccinationDisplayStatus', () => {
  const now = new Date('2026-06-01T12:00:00.000Z');
  it('DONE si administrée', () => {
    expect(vaccinationDisplayStatus({ status: 'DONE', dueDate: new Date('2026-01-01') }, now)).toBe('DONE');
  });
  it('OVERDUE si l’échéance est dépassée', () => {
    expect(vaccinationDisplayStatus({ status: 'SCHEDULED', dueDate: new Date('2026-05-01') }, now)).toBe('OVERDUE');
  });
  it('DUE_SOON dans les 7 jours', () => {
    expect(vaccinationDisplayStatus({ status: 'SCHEDULED', dueDate: new Date('2026-06-05') }, now)).toBe('DUE_SOON');
  });
  it('UPCOMING au-delà de 7 jours', () => {
    expect(vaccinationDisplayStatus({ status: 'SCHEDULED', dueDate: new Date('2026-08-01') }, now)).toBe('UPCOMING');
  });
});
