// Non-régression (préprod IONOS, 15/10/2026) : sous PM2, le script est IMPORTÉ depuis
// ProcessContainer(Fork).js, donc process.argv[1] n'est pas le script. L'ancienne garde
// `import.meta.url === process.argv[1]` de server.ts était fausse : workers « online »,
// aucune écoute, journaux vides. L'entrée main.ts doit démarrer quel que soit argv[1].
import { afterEach, describe, expect, it, vi } from 'vitest';

const { start } = vi.hoisted(() => ({ start: vi.fn(async () => undefined) }));
vi.mock('@/server.js', () => ({ start }));

const argv1 = process.argv[1];
afterEach(() => {
  process.argv[1] = argv1;
  vi.resetModules();
  start.mockClear();
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
  });
});
