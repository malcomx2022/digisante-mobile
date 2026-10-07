import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

function worker(client?: any) {
  const handlers: Record<string, (event: any) => void> = {};
  const openWindow = vi.fn(async () => undefined); let background: any;
  const self = { location: { origin: 'https://synthetic.example' }, registration: { showNotification: vi.fn() }, clients: { matchAll: async () => client ? [client] : [], openWindow }, addEventListener: (key: string, fn: any) => { handlers[key] = fn; } };
  const firebase = { initializeApp: vi.fn(), messaging: () => ({ onBackgroundMessage: (fn: any) => { background = fn; } }) };
  runInNewContext(readFileSync(new URL('../../../public/firebase-messaging-sw.js', import.meta.url), 'utf8'), { self: { ...self, location: { ...self.location, toString: () => 'https://synthetic.example/firebase-messaging-sw.js?apiKey=public&projectId=p&messagingSenderId=m' } }, URL, importScripts: vi.fn(), firebase });
  async function click(link: unknown) {
    let waiting: Promise<unknown> | undefined;
    handlers.notificationclick({ notification: { close: vi.fn(), data: { link } }, waitUntil: (p: Promise<unknown>) => { waiting = p; } }); await waiting;
  }
  return { click, openWindow, background, self };
}
describe('L8 — liens notifications FCM', () => {
  it('backslash brut/encodé, double slash, contrôle et URL externe reviennent à accueil', async () => {
    for (const link of ['/\\evil.test/pay', '//evil.test/pay', '/%5cevil.test', '/%2fevil.test', '/\t/evil.test', 'https://evil.test', 'javascript:alert(1)', 42]) {
      const w = worker(); await w.click(link); expect(w.openWindow).toHaveBeenCalledWith('/');
    }
  });
  it('chemin interne normalisé avec query conservé', async () => {
    const w = worker(); await w.click('/patient/../patient/appointments?id=synth'); expect(w.openWindow).toHaveBeenCalledWith('/patient/appointments?id=synth');
  });
  it('onglet même origine : attend navigation avant focus', async () => {
    const client = { url: 'https://synthetic.example/patient', navigate: vi.fn(async () => undefined), focus: vi.fn(async () => undefined) }; const w = worker(client);
    await w.click('/patient/notifications'); expect(client.navigate).toHaveBeenCalledWith('/patient/notifications'); expect(client.focus).toHaveBeenCalledOnce(); expect(w.openWindow).not.toHaveBeenCalled();
  });
  it('onglet externe ignoré et donnée push normalisée avant notification', async () => {
    const w = worker({ url: 'https://evil.test', focus: vi.fn() });
    w.background({ data: { link: '/\\evil.test' } }); expect(w.self.registration.showNotification.mock.calls[0][1].data.link).toBe('/');
    await w.click('/patient'); expect(w.openWindow).toHaveBeenCalledWith('/patient');
  });
});
