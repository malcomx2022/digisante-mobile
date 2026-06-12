import { describe, expect, it } from 'vitest';

import { isRoleAllowed } from './rbac.js';

describe('isRoleAllowed', () => {
  it('autorise un rôle présent dans la liste', () => {
    expect(isRoleAllowed('MEDECIN', ['MEDECIN', 'ADMIN'])).toBe(true);
  });

  it('refuse un rôle absent', () => {
    expect(isRoleAllowed('PATIENT', ['MEDECIN', 'ADMIN'])).toBe(false);
  });

  it('refuse un rôle indéfini (non authentifié)', () => {
    expect(isRoleAllowed(undefined, ['PATIENT'])).toBe(false);
  });

  it('refuse si la liste est vide', () => {
    expect(isRoleAllowed('ADMIN', [])).toBe(false);
  });
});
