import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/lib/api/auth';
import { sessionCache } from './storage';

let values: Map<string, string>;
let set: ReturnType<typeof vi.fn>;
beforeEach(() => {
  values = new Map(); set = vi.fn((key: string, value: string) => { values.set(key, value); });
  vi.stubGlobal('window', {});
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: set, removeItem: (key: string) => values.delete(key) });
});
afterEach(() => vi.unstubAllGlobals());
it('cache de session réduit : aucun téléphone, email ni jeton conservé', () => {
  sessionCache.set({ id: 'A', role: 'PATIENT', lang: 'FR', status: 'ACTIVE', phone: 'PRIVATE-PHONE', email: 'PRIVATE-EMAIL', accessToken: 'PRIVATE-JWT' } as AuthUser);
  expect(JSON.parse(values.get('digisante.session')!)).toEqual({ id: 'A', role: 'PATIENT', lang: 'FR', status: 'ACTIVE' });
});
it('ancien cache réduit dès lecture, sans écritures répétées ni boucle storage inter-onglets', () => {
  values.set('digisante.session', JSON.stringify({ id: 'A', role: 'PATIENT', lang: 'FR', phone: 'PRIVATE-PHONE', email: 'PRIVATE-EMAIL' }));
  expect(sessionCache.get()?.phone).toBe(''); expect(values.get('digisante.session')).not.toContain('PRIVATE');
  sessionCache.get(); expect(set).toHaveBeenCalledOnce();
});
it('cache corrompu sans identité : aucune session locale créée', () => {
  values.set('digisante.session', '{broken'); expect(sessionCache.get()).toBeNull();
  values.set('digisante.session', JSON.stringify({ role: 'PATIENT', lang: 'FR' })); expect(sessionCache.get()).toBeNull();
});
it('accès localStorage refusé : aucune session locale optimiste ni exception de démarrage', () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw new DOMException('blocked', 'SecurityError'); } });
  expect(sessionCache.get()).toBeNull();
});
