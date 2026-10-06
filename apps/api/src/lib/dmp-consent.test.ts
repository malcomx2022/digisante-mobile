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

  it('refuse DIASPORA même avec un partage', () => {
    expect(decideDmpAccess({ role: 'DIASPORA', isOwner: false, hasValidShare: true }).allowed).toBe(false);
  });

  it('refuse LABORATOIRE même avec un partage', () => {
    expect(decideDmpAccess({ role: 'LABORATOIRE', isOwner: false, hasValidShare: true }).allowed).toBe(false);
  });

  it('refuse PHARMACIE même avec un partage', () => {
    expect(decideDmpAccess({ role: 'PHARMACIE', isOwner: false, hasValidShare: true }).allowed).toBe(false);
  });

  it('refuse ASC même avec un partage', () => {
    expect(decideDmpAccess({ role: 'ASC', isOwner: false, hasValidShare: true }).allowed).toBe(false);
  });
});
