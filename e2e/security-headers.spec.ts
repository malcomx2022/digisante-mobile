import { expect, test } from '@playwright/test';

test('L8 — CSP production et exception FCM sans élargissement global', async ({ request, page }) => {
  const response = await request.get('/login'); const csp = response.headers()['content-security-policy'];
  expect(csp).toContain("script-src 'self' 'unsafe-inline'"); expect(csp).not.toContain('unsafe-eval');
  const connectSources = csp.split(';').map((directive) => directive.trim()).find((directive) => directive.startsWith('connect-src '))?.split(/\s+/).slice(1);
  expect(connectSources).toBeDefined();
  expect(connectSources).not.toContain('https:'); expect(connectSources).not.toContain('wss:'); expect(connectSources).not.toContain('*');
  expect(connectSources).toContain('https://*.daily.co'); expect(connectSources).toContain('https://*.googleapis.com');
  const sw = await request.get('/firebase-messaging-sw.js'); const swCsp = sw.headers()['content-security-policy'];
  expect(swCsp).toContain('https://www.gstatic.com'); expect(swCsp).not.toContain('unsafe-inline');
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/login'); await expect(page.getByRole('button', { name: /recevoir le code|send code/i })).toBeVisible(); expect(errors).toEqual([]);
});
