import { describe, expect, it } from 'vitest';

import { isCriticalNamespace, isTranslationApproved, requiredValidations } from './translations.rules.js';

describe('gouvernance des traductions', () => {
  it('identifie les namespaces critiques', () => {
    expect(isCriticalNamespace('sos')).toBe(true);
    expect(isCriticalNamespace('payments')).toBe(true);
    expect(isCriticalNamespace('onboarding')).toBe(false);
  });

  it('double validation requise pour les critiques, simple sinon', () => {
    expect(requiredValidations('sos')).toBe(2);
    expect(requiredValidations('common')).toBe(1);
  });

  it('approbation : critique nécessite 2 valideurs DISTINCTS', () => {
    expect(isTranslationApproved('sos', ['a'])).toBe(false);
    expect(isTranslationApproved('sos', ['a', 'a'])).toBe(false); // doublon
    expect(isTranslationApproved('sos', ['a', 'b'])).toBe(true);
  });

  it('approbation : non critique nécessite 1 valideur', () => {
    expect(isTranslationApproved('common', ['a'])).toBe(true);
    expect(isTranslationApproved('common', [])).toBe(false);
  });
});
