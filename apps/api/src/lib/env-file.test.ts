// Non-régression : apps/api/.env chargé par l'API elle-même (préprod IONOS, 15/10/2026).
// Même analyseur que `node --env-file` (util.parseEnv) et même priorité : l'environnement
// du processus (PM2, CI, deploy.sh) n'est jamais remplacé par le fichier.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { API_ENV_FILE, loadApiEnvFile } from './env-file.js';

// Chemins réellement lus : le fichier par défaut ne doit jamais dépendre du cwd du lanceur.
const { reads } = vi.hoisted(() => ({ reads: [] as string[] }));
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return {
    ...fs,
    readFileSync: ((path: Parameters<typeof fs.readFileSync>[0], ...rest: unknown[]) => {
      reads.push(String(path));
      return (fs.readFileSync as (...a: unknown[]) => unknown)(path, ...rest);
    }) as typeof fs.readFileSync,
  };
});

const dirs: string[] = [];
function envFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'digisante-env-'));
  dirs.push(dir);
  const file = join(dir, '.env');
  writeFileSync(file, content);
  return file;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  reads.splice(0);
  vi.restoreAllMocks();
});

describe('loadApiEnvFile', () => {
  it('résout apps/api/.env depuis le module, jamais depuis le répertoire courant', () => {
    const apiDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));
    expect(API_ENV_FILE).toBe(join(apiDir, '.env'));
  });

  it('fichier par défaut = API_ENV_FILE, même lancé depuis un autre répertoire (PM2 resurrect depuis /)', () => {
    vi.spyOn(process, 'cwd').mockReturnValue(tmpdir());
    loadApiEnvFile(undefined, { NODE_ENV: 'production' });
    expect(reads).toEqual([API_ENV_FILE]);
  });

  it('complète l’environnement sans jamais remplacer une variable déjà posée (même vide)', () => {
    const file = envFile('NODE_ENV=development\nDATABASE_URL=postgresql://fichier\nAPI_PORT=3001\nJWT_SECRET=depuis-le-fichier\nVIDE=fichier\n');
    const target: NodeJS.ProcessEnv = { NODE_ENV: 'production', API_PORT: '3101', VIDE: '' };
    expect(loadApiEnvFile(file, target)).toBe('loaded');
    expect(target).toEqual({
      NODE_ENV: 'production',
      API_PORT: '3101',
      VIDE: '',
      DATABASE_URL: 'postgresql://fichier',
      JWT_SECRET: 'depuis-le-fichier',
    });
  });

  it('analyse comme --env-file : commentaires, guillemets, export, \\n d’une clé privée', () => {
    const file = envFile('# commentaire\nexport A="deux mots"\nB=\'simple\'\nFIREBASE_PRIVATE_KEY="-----BEGIN-----\\nligne\\n-----END-----"\n');
    const target: NodeJS.ProcessEnv = {};
    loadApiEnvFile(file, target);
    expect(target.A).toBe('deux mots');
    expect(target.B).toBe('simple');
    expect(target.FIREBASE_PRIVATE_KEY).toBe('-----BEGIN-----\nligne\n-----END-----');
  });

  it('NODE_ENV=test : rien n’est chargé (un .env de développement ne modifie pas les tests)', () => {
    const file = envFile('DATABASE_URL=postgresql://dev\n');
    const target: NodeJS.ProcessEnv = { NODE_ENV: 'test' };
    expect(loadApiEnvFile(file, target)).toBe('skipped');
    expect(target).toEqual({ NODE_ENV: 'test' });
  });

  it('sous Vitest, même avec un NODE_ENV exporté (development/production) : rien n’est chargé', () => {
    const file = envFile('DATABASE_URL=postgresql://dev\nREDIS_URL=redis://dev\n');
    for (const NODE_ENV of ['development', 'production']) {
      const target: NodeJS.ProcessEnv = { NODE_ENV, VITEST: 'true' };
      expect(loadApiEnvFile(file, target)).toBe('skipped');
      expect(target).toEqual({ NODE_ENV, VITEST: 'true' });
    }
    expect(reads).toEqual([]);
  });

  it('fichier absent : rien chargé, la validation de env.ts signalera les manques', () => {
    const target: NodeJS.ProcessEnv = {};
    expect(loadApiEnvFile(join(tmpdir(), 'digisante-env-absent', '.env'), target)).toBe('absent');
    expect(target).toEqual({});
  });

  it('fichier illisible : échec explicite, sans contenu dans le message', () => {
    const dir = mkdtempSync(join(tmpdir(), 'digisante-env-'));
    dirs.push(dir);
    const notAFile = join(dir, '.env');
    mkdirSync(notAFile);
    // Code dédié : main.ts affiche ce message (chemin seul) tel quel.
    expect(() => loadApiEnvFile(notAFile, {})).toThrow(
      expect.objectContaining({ code: 'API_ENV_FILE_UNREADABLE', message: `Fichier d'environnement de l'API illisible : ${notAFile}` }),
    );
  });
});
