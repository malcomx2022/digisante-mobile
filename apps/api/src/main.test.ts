// Non-régression (préprod IONOS, 15/10/2026) : sous PM2, le script est IMPORTÉ depuis
// ProcessContainer(Fork).js, donc process.argv[1] n'est pas le script. L'ancienne garde
// `import.meta.url === process.argv[1]` de server.ts était fausse : workers « online »,
// aucune écoute, journaux vides. L'entrée main.ts doit démarrer quel que soit argv[1],
// et SORTIR en code 1 si le démarrage échoue (PM2 avale les promesses rejetées), APRÈS
// avoir écrit sa ligne (PM2 cluster écrit le journal par un flux asynchrone).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { start } = vi.hoisted(() => ({ start: vi.fn(async () => undefined) }));
vi.mock('@/server.js', () => ({ start }));

const argv1 = process.argv[1];
const order: string[] = [];
let written = '';
beforeEach(() => {
  order.length = 0;
  written = '';
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    order.push(`exit:${code}`);
  }) as typeof process.exit);
  vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string, cb?: () => void) => {
    written += chunk;
    order.push('write');
    cb?.(); // rappel = écriture effective
    return true;
  }) as typeof process.stderr.write);
});
afterEach(() => {
  process.argv[1] = argv1;
  process.exitCode = undefined;
  vi.doUnmock('@/lib/env.js');
  vi.resetModules();
  vi.restoreAllMocks();
  start.mockReset();
  start.mockImplementation(async () => undefined);
});

describe('main.ts — entrée de l’API', () => {
  it.each([
    ['PM2 cluster', '/usr/lib/node_modules/pm2/lib/ProcessContainer.js'],
    ['PM2 fork', '/usr/lib/node_modules/pm2/lib/ProcessContainerFork.js'],
    ['argv vide', undefined],
  ])('démarre l’API une seule fois (%s)', async (_label, launcher) => {
    if (launcher === undefined) process.argv.splice(1, 1, '');
    else process.argv[1] = launcher;
    await import('./main.js');
    expect(start).toHaveBeenCalledTimes(1);
    expect(order).toEqual([]);
  });

  it('démarrage en échec (base pas prête) : ligne écrite PUIS code 1 ; type et code, jamais le message', async () => {
    start.mockRejectedValueOnce(
      Object.assign(new Error('postgresql://user:SECRET@127.0.0.1/db injoignable'), {
        name: 'PrismaClientInitializationError',
        errorCode: 'P1001',
      }),
    );
    await import('./main.js');
    expect(order).toEqual(['write', 'exit:1']);
    expect(written).toMatch(/Démarrage de l'API impossible/);
    expect(written).toMatch(/PrismaClientInitializationError/);
    expect(written).toMatch(/P1001/);
    expect(written).not.toMatch(/SECRET|postgresql:\/\//);
  });

  it('erreur de code (TypeError) : lignes de pile conservées, jamais le message', async () => {
    start.mockRejectedValueOnce(new TypeError('Cannot read properties of undefined (reading "SECRET-42")'));
    await import('./main.js');
    expect(order).toEqual(['write', 'exit:1']);
    expect(written).toMatch(/"type":"TypeError"/);
    expect(written).toMatch(/at /);
    expect(written).not.toMatch(/SECRET-42|Cannot read/);
  });

  it('module introuvable : chemin du module conservé (aucune valeur)', async () => {
    start.mockRejectedValueOnce(
      Object.assign(new Error("Cannot find module '/srv/app/apps/api/dist/x.js'"), {
        code: 'ERR_MODULE_NOT_FOUND',
        url: 'file:///srv/app/apps/api/dist/x.js',
      }),
    );
    await import('./main.js');
    expect(written).toMatch(/"code":"ERR_MODULE_NOT_FOUND"/);
    expect(written).toMatch(/"url":"file:\/\/\/srv\/app\/apps\/api\/dist\/x\.js"/);
  });

  it('configuration invalide ou .env illisible : message sûr affiché tel quel, code 1', async () => {
    start.mockRejectedValueOnce(
      Object.assign(new Error("Fichier d'environnement de l'API illisible : /srv/app/apps/api/.env"), {
        code: 'API_ENV_FILE_UNREADABLE',
      }),
    );
    await import('./main.js');
    expect(order).toEqual(['write', 'exit:1']);
    expect(written).toContain("Fichier d'environnement de l'API illisible : /srv/app/apps/api/.env");
  });

  it('erreur à l’évaluation de la configuration : code 1, start jamais appelé', async () => {
    vi.doMock('@/lib/env.js', () => {
      throw new Error('évaluation impossible');
    });
    await import('./main.js');
    expect(start).not.toHaveBeenCalled();
    expect(order).toEqual(['write', 'exit:1']);
    expect(written).toMatch(/Démarrage de l'API impossible/);
  });
});
