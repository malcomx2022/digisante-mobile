// Tests unitaires du triage/orientation hors-ligne (@digisante/shared, pur).
import { evaluateTriage, TRIAGE_BY_ID, TRIAGE_FLOWS } from '@digisante/shared';
import { describe, expect, it } from 'vitest';

describe('evaluateTriage', () => {
  const fever = TRIAGE_BY_ID.FEVER;

  it('un seul signe ROUGE → URGENCE (biais conservateur)', () => {
    expect(evaluateTriage(fever, { fever_convulsion: true })).toBe('EMERGENCY');
    // Même si un ORANGE est aussi présent, le ROUGE prime.
    expect(evaluateTriage(fever, { fever_convulsion: true, fever_3days: true })).toBe('EMERGENCY');
  });

  it('aucun ROUGE mais un ORANGE → CONSULTER', () => {
    expect(evaluateTriage(fever, { fever_3days: true })).toBe('CONSULT');
    expect(evaluateTriage(fever, { fever_infant: true })).toBe('CONSULT');
  });

  it('aucun signe → SURVEILLANCE À DOMICILE', () => {
    expect(evaluateTriage(fever, {})).toBe('HOME');
    expect(evaluateTriage(fever, { fever_convulsion: false, fever_3days: false })).toBe('HOME');
  });

  it('les questions sans réponse comptent comme « non »', () => {
    expect(evaluateTriage(fever, { fever_breathing: false })).toBe('HOME');
  });

  it('tous les motifs ont ≥ 1 signe ROUGE (garantie de sécurité)', () => {
    for (const flow of TRIAGE_FLOWS) {
      expect(flow.questions.some((q) => q.severity === 'RED')).toBe(true);
    }
  });
});
