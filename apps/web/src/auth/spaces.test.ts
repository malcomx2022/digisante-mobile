// Routage par rôle. Le repli `?? '/patient'` de `spaceFor` est un filet SILENCIEUX :
// un 8ᵉ rôle ajouté côté backend sans entrée ici enverrait ses utilisateurs dans
// l'espace patient sans le moindre signal. Ce test transforme cet oubli en échec.
import { ROLES, type Role } from '@digisante/shared';
import { describe, expect, it } from 'vitest';

import { spaceFor, SPACE_PATH } from './spaces';

describe('routage par rôle', () => {
  it('couvre TOUS les rôles déclarés côté partagé', () => {
    const missing = ROLES.filter((r) => !(r in SPACE_PATH));
    expect(missing).toEqual([]);
  });

  it('donne à chaque rôle un espace DISTINCT (pas de thème mélangé, §5)', () => {
    const paths = ROLES.map((r) => spaceFor(r));
    expect(new Set(paths).size).toBe(ROLES.length);
  });

  it('mappe chaque rôle sur son espace attendu', () => {
    expect(spaceFor('PATIENT')).toBe('/patient');
    expect(spaceFor('MEDECIN')).toBe('/pro');
    expect(spaceFor('PHARMACIE')).toBe('/pharmacie');
    expect(spaceFor('LABORATOIRE')).toBe('/labo');
    expect(spaceFor('DIASPORA')).toBe('/diaspora');
    expect(spaceFor('ASC')).toBe('/asc');
    expect(spaceFor('ADMIN')).toBe('/admin');
  });

  it('ne renvoie jamais une valeur vide', () => {
    for (const role of ROLES) {
      expect(spaceFor(role)).toMatch(/^\/[a-z]+$/);
    }
  });

  it('retombe sur l’espace patient pour un rôle inconnu (défensif)', () => {
    expect(spaceFor('INEXISTANT' as Role)).toBe('/patient');
  });
});
