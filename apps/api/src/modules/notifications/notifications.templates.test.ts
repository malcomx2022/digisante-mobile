import { describe, expect, it } from 'vitest';

import { localize } from './notifications.templates.js';

const fallback = { title: 'stocké', body: 'corps stocké' };

describe('localize', () => {
  it('renvoie le gabarit de la langue demandée', () => {
    expect(localize('SOS_ALERT', 'EN', fallback).title).toBe('SOS alert');
  });

  it('repli sur FR si la langue n’a pas de gabarit (FON)', () => {
    expect(localize('SOS_ALERT', 'FON', fallback).title).toBe('Alerte SOS');
  });

  it('repli sur le contenu stocké si aucun gabarit pour le type', () => {
    expect(localize('SYSTEM', 'FR', fallback)).toEqual(fallback);
  });
});
