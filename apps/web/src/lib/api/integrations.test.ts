import { describe, expect, it } from 'vitest';

import { expectedMask, PROVIDER_META, unconfirmedKeys } from './integrations';

// Recette L10 I2 : enregistrements du domaine Daily sans effet visible ni erreur.
describe('formulaire d’intégration — contrôle de la réponse après sauvegarde', () => {
  it('masque identique à la règle API (4 derniers caractères)', () => {
    expect(expectedMask('nouvelle-equipe.daily.co')).toBe('••••y.co');
    expect(expectedMask('abcd')).toBe('••••');
    expect(expectedMask('')).toBe('—');
  });

  it('réponse conforme → aucune clé non confirmée', () => {
    const sent = { apiKey: 'daily_key_1234', domain: 'equipe-a' };
    expect(unconfirmedKeys(sent, { secrets: { apiKey: '••••1234', domain: '••••pe-a' } })).toEqual([]);
  });

  it('valeur absente ou masque inchangé dans la réponse → sauvegarde signalée en échec', () => {
    const sent = { apiKey: 'daily_key_1234', domain: 'equipe-b' };
    expect(unconfirmedKeys(sent, { secrets: { apiKey: '••••1234', domain: '••••pe-a' } })).toEqual(['domain']);
    expect(unconfirmedKeys(sent, { secrets: { apiKey: '••••1234' } })).toEqual(['domain']);
  });

  it('le domaine Daily est saisi en clair (identifiant non secret), la clé API reste masquée', () => {
    const fields = Object.fromEntries(PROVIDER_META.DAILY.fields.map((f) => [f.key, f]));
    expect(fields.domain).toMatchObject({ required: true, plain: true });
    expect(fields.apiKey?.plain).toBeUndefined();
  });
});
