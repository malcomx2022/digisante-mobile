import { describe, expect, it } from 'vitest';

import { canTransition } from './education.rules.js';

describe('canTransition (workflow éditorial)', () => {
  it('chemin nominal', () => {
    expect(canTransition('DRAFT', 'MEDICAL_REVIEW')).toBe(true);
    expect(canTransition('MEDICAL_REVIEW', 'TRANSLATION')).toBe(true);
    expect(canTransition('TRANSLATION', 'PUBLISHED')).toBe(true);
  });

  it('retours autorisés', () => {
    expect(canTransition('MEDICAL_REVIEW', 'DRAFT')).toBe(true);
    expect(canTransition('TRANSLATION', 'MEDICAL_REVIEW')).toBe(true);
  });

  it('transitions interdites', () => {
    expect(canTransition('DRAFT', 'PUBLISHED')).toBe(false);
    expect(canTransition('DRAFT', 'TRANSLATION')).toBe(false);
    expect(canTransition('PUBLISHED', 'DRAFT')).toBe(false);
  });
});
