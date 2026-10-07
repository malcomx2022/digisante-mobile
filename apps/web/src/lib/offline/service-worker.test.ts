import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const origin = 'https://synthetic.example';
function worker() {
  const handlers: Record<string, (event: any) => void> = {};
  const stores = new Map<string, Map<string, Response>>();
  const key = (request: string | Request) => new URL(typeof request === 'string' ? request : request.url, origin).href;
  const fetch = vi.fn(async () => new Response('<script src="/_next/static/chunk.js"></script><link href="/_next/static/style.css"><a href="/api/v1/dmp">a</a>'));
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (request: string | Request) => { for (const store of stores.values()) { const response = store.get(key(request)); if (response) return response.clone(); } },
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map()); const store = stores.get(name)!;
      return {
        match: async (request: string | Request) => store.get(key(request))?.clone(),
        put: async (request: string | Request, response: Response) => { store.set(key(request), response); },
        addAll: async (requests: string[]) => { for (const request of requests) store.set(key(request), await fetch()); },
      };
    },
  };
  const self = { location: { origin }, clients: { claim: vi.fn() }, skipWaiting: vi.fn(), addEventListener: (name: string, handler: (event: any) => void) => { handlers[name] = handler; } };
  runInNewContext(readFileSync(new URL('../../../public/sw.js', import.meta.url), 'utf8'), { self, caches, fetch, URL });
  async function lifecycle(name: string) { const waits: Promise<unknown>[] = []; handlers[name]({ waitUntil: (promise: Promise<unknown>) => waits.push(promise) }); await Promise.all(waits); }
  async function request(path: string, options: { mode?: string; method?: string; rsc?: string } = {}) {
    const waits: Promise<unknown>[] = []; let response: Promise<Response> | undefined;
    handlers.fetch({ request: { url: origin + path, method: options.method ?? 'GET', mode: options.mode ?? 'cors', headers: new Headers(options.rsc ? { RSC: options.rsc } : {}) }, waitUntil: (promise: Promise<unknown>) => waits.push(promise), respondWith: (promise: Promise<Response>) => { response = promise; } });
    const result = await response; await Promise.all(waits); return result;
  }
  return { lifecycle, request, stores, fetch, caches, self };
}

describe('Service worker L4 — shell public uniquement', () => {
  it('installation précache les coquilles et leurs chunks, jamais API/RSC', async () => {
    const w = worker(); await w.lifecycle('install'); const urls = [...w.stores.values()].flatMap((store) => [...store.keys()]);
    expect(urls).toContain(origin + '/patient/offline'); expect(urls).toContain(origin + '/_next/static/chunk.js');
    expect(urls.some((url) => url.includes('/api/') || url.includes('_rsc'))).toBe(false); expect(w.self.skipWaiting).toHaveBeenCalledOnce();
  });
  it('API, RSC, POST et documents médicaux passent sans interception ni cache', async () => {
    const w = worker();
    for (const [path, options] of [['/api/v1/dmp', {}], ['/patient/dmp?_rsc=token', {}], ['/patient/offline', { rsc: '1' }], ['/api/v1/payments', { method: 'POST' }], ['/files/record.pdf', {}]] as const) expect(await w.request(path, options)).toBeUndefined();
    expect(w.fetch).not.toHaveBeenCalled(); expect(w.stores.size).toBe(0);
  });
  it('rechargement hors réseau du coffre utilise sa propre coquille', async () => {
    const w = worker(); await w.lifecycle('install'); w.fetch.mockRejectedValue(new Error('offline'));
    expect(await (await w.request('/patient/offline', { mode: 'navigate' }))!.text()).toContain('chunk.js');
  });
  it('route médicale non préparée retourne offline.html sans lui substituer un dossier', async () => {
    const w = worker(); await w.lifecycle('install'); const cache = await w.caches.open('digisante-shell-v3');
    await cache.put('/offline.html', new Response('GENERIC-OFFLINE')); w.fetch.mockRejectedValue(new Error('offline'));
    expect(await (await w.request('/patient/dmp', { mode: 'navigate' }))!.text()).toBe('GENERIC-OFFLINE');
  });
  it('assets statiques rafraîchis sous waitUntil et réutilisables sans réseau', async () => {
    const w = worker(); w.fetch.mockResolvedValue(new Response('PUBLIC-CHUNK'));
    expect(await (await w.request('/_next/static/another.js'))!.text()).toBe('PUBLIC-CHUNK');
    w.fetch.mockRejectedValue(new Error('offline')); expect(await (await w.request('/_next/static/another.js'))!.text()).toBe('PUBLIC-CHUNK');
  });
  it('activation purge les caches DigiSanté précédents, conserve ceux des autres applications', async () => {
    const w = worker(); await w.caches.open('digisante-runtime-v2'); await w.caches.open('other-application'); await w.caches.open('digisante-shell-v3');
    await w.lifecycle('activate'); expect(await w.caches.keys()).toEqual(['other-application', 'digisante-shell-v3']); expect(w.self.clients.claim).toHaveBeenCalledOnce();
  });
});
