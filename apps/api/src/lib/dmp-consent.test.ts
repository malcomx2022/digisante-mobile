import { describe, expect, it } from 'vitest';

import { decideDmpAccess } from './dmp-consent.js';

describe('decideDmpAccess', () => {
  it('autorise le patient propriétaire de son dossier', () => {
    expect(decideDmpAccess({ role: 'PATIENT', isOwner: true, hasValidShare: false })).toEqual({
      allowed: true,
      reason: 'OWNER',
    });
  });

  it('refuse à un patient le dossier d’un autre', () => {
    expect(decideDmpAccess({ role: 'PATIENT', isOwner: false, hasValidShare: false })).toEqual({
      allowed: false,
      reason: 'NOT_OWNER',
    });
  });

  it("refuse TOUJOURS l'admin (cloisonnement), même avec partage", () => {
    expect(decideDmpAccess({ role: 'ADMIN', isOwner: false, hasValidShare: true })).toEqual({
      allowed: false,
      reason: 'ADMIN_FORBIDDEN',
    });
  });

  it('autorise un soignant avec partage consenti actif', () => {
    expect(decideDmpAccess({ role: 'MEDECIN', isOwner: false, hasValidShare: true })).toEqual({
      allowed: true,
      reason: 'CONSENT',
    });
  });

  it('refuse un soignant sans partage consenti', () => {
    expect(decideDmpAccess({ role: 'MEDECIN', isOwner: false, hasValidShare: false })).toEqual({
      allowed: false,
      reason: 'NO_CONSENT',
    });
  });

  it('applique la même règle de consentement à la diaspora et aux labos', () => {
    expect(decideDmpAccess({ role: 'DIASPORA', isOwner: false, hasValidShare: false }).allowed).toBe(false);
    expect(decideDmpAccess({ role: 'LABORATOIRE', isOwner: false, hasValidShare: true }).allowed).toBe(true);
  });
});
