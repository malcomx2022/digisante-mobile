// Revue indépendante (13/10/2026) : `KYC_STORAGE_DIR=""` (valeur de .env.example)
// envoyait les fichiers chiffrés dans le répertoire courant, hors sauvegarde.
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveStorageDir } from './filestore.js';

describe('filestore — répertoire du magasin', () => {
  it('valeur vide ou blanche : répertoire par défaut, jamais le répertoire courant', () => {
    for (const value of ['', '   ', undefined]) expect(resolveStorageDir(value)).toBe(resolve('storage/kyc'));
    expect(resolveStorageDir('')).not.toBe(resolve(''));
  });
  it('chemin explicite conservé', () => {
    expect(resolveStorageDir('/srv/digisante/files')).toBe('/srv/digisante/files');
  });
});
