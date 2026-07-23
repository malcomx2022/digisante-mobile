// Tests purs du schéma de pagination partagé (@digisante/shared).
// Garde-fou anti-offset-profond : le champ `page` est plafonné (MAX_PAGE) pour
// qu'une requête forgée ne puisse pas imposer un OFFSET Postgres non borné.
import { MAX_PAGE, paginationSchema } from '@digisante/shared';
import { describe, expect, it } from 'vitest';

describe('paginationSchema — garde-fou d’offset', () => {
  it('applique les valeurs par défaut (page 1, pageSize 20)', () => {
    const parsed = paginationSchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(20);
  });

  it('accepte une page jusqu’à MAX_PAGE inclus', () => {
    expect(paginationSchema.safeParse({ page: MAX_PAGE }).success).toBe(true);
  });

  it('rejette une page au-delà de MAX_PAGE (offset non borné → 422 côté API)', () => {
    const res = paginationSchema.safeParse({ page: MAX_PAGE + 1 });
    expect(res.success).toBe(false);
  });

  it('rejette une page absurde (requête forgée)', () => {
    expect(paginationSchema.safeParse({ page: 1_000_000_000 }).success).toBe(false);
  });

  it('borne toujours pageSize à 100', () => {
    expect(paginationSchema.safeParse({ pageSize: 101 }).success).toBe(false);
  });

  it('reste un ZodObject .extend()-able (les modules l’étendent)', () => {
    // Si `paginationSchema` devenait un ZodEffects (superRefine), `.extend`
    // n'existerait plus et cet appel casserait à la compilation ET au runtime.
    const extended = paginationSchema.extend({ action: paginationSchema.shape.sort });
    const parsed = extended.parse({ page: 2 });
    expect(parsed.page).toBe(2);
  });
});
