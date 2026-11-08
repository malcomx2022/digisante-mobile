import { expect, test } from '@playwright/test';

const scriptSrc = (csp: string) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src ')) ?? '';

test('L8 — CSP production et exception FCM sans élargissement global', async ({ request, page }) => {
  const response = await request.get('/login'); const csp = response.headers()['content-security-policy'];
  // Résiduel X8 fermé (08/11/2026) : nonce par requête + 'strict-dynamic', jamais 'unsafe-inline' pour les scripts.
  const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(scriptSrc(csp))?.[1];
  expect(nonce).toBeTruthy(); expect(scriptSrc(csp)).toContain("'strict-dynamic'");
  expect(scriptSrc(csp)).not.toContain('unsafe-inline'); expect(csp).not.toContain('unsafe-eval');
  const html = await response.text(); const tags = html.match(/<script\b[^>]*>/g) ?? [];
  expect(tags.length).toBeGreaterThan(0);
  for (const tag of tags) expect(tag).toContain(`nonce="${nonce}"`);
  const again = (await request.get('/login')).headers()['content-security-policy'];
  expect(/'nonce-([^']+)'/.exec(again)?.[1]).not.toBe(nonce);
  for (const path of ['/sw.js', '/offline.html']) {
    const fixed = (await request.get(path)).headers()['content-security-policy'];
    expect(scriptSrc(fixed)).toBe("script-src 'self'");
  }
  const connectSources = csp.split(';').map((directive) => directive.trim()).find((directive) => directive.startsWith('connect-src '))?.split(/\s+/).slice(1);
  expect(connectSources).toBeDefined();
  expect(connectSources).not.toContain('https:'); expect(connectSources).not.toContain('wss:'); expect(connectSources).not.toContain('*');
  expect(connectSources).toContain('https://*.daily.co'); expect(connectSources).toContain('https://*.googleapis.com');
  const sw = await request.get('/firebase-messaging-sw.js'); const swCsp = sw.headers()['content-security-policy'];
  expect(swCsp).toContain('https://www.gstatic.com'); expect(swCsp).not.toContain('unsafe-inline');
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (/Content Security Policy/i.test(message.text())) errors.push(message.text()); });
  await page.goto('/login'); await expect(page.getByRole('button', { name: /recevoir le code|send code/i })).toBeVisible(); expect(errors).toEqual([]);
});
