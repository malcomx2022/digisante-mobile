import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { enableVault } from './vault-helpers';

// API simulée, cookies HttpOnly réellement traités par Chromium. Ces tests
// vérifient l'ordre réseau/publication locale ; ils ne prouvent pas la révocation
// Redis ni l'identité d'un acteur serveur (couvertes par les suites API).
const userA = { id: 'auth-race-A-fixture', role: 'PATIENT', status: 'ACTIVE', lang: 'FR', phone: '', email: null };
const userB = { ...userA, id: 'auth-race-B-fixture', phone: '+2290199999999' };
const cookie = (value: string) => `digisante_rt=${value}; Path=/api/v1/auth; HttpOnly; SameSite=Strict`;

async function installAuthFixture(context: BrowserContext, mode: 'refresh-success' | 'refresh-refused' | 'logout') {
  let release!: () => void;
  let markStarted!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  let firstRefresh = true;
  let refreshCalls = 0;
  let verifyCalls = 0;
  const order: string[] = [];
  await context.addCookies([{ name: 'digisante_rt', value: 'refresh-A-fixture', domain: '127.0.0.1', path: '/api/v1/auth', httpOnly: true, sameSite: 'Strict' }]);
  await context.addInitScript((cached) => {
    if (!localStorage.getItem('digisante.session')) localStorage.setItem('digisante.session', JSON.stringify(cached));
    localStorage.setItem('digisante.lang', 'FR');
  }, userA);
  await context.route('**/api/v1/auth/refresh', async (route) => {
    refreshCalls += 1;
    const currentCookie = route.request().headers().cookie ?? '';
    if (firstRefresh && mode !== 'logout') {
      firstRefresh = false; markStarted(); await gate;
      if (mode === 'refresh-refused') {
        order.push('refresh-A-refused');
        await route.fulfill({ status: 401, json: { code: 'UNAUTHORIZED', message: 'Ancienne session révoquée' } });
      } else {
        order.push('refresh-A-complete');
        await route.fulfill({ headers: { 'set-cookie': cookie('refresh-A-rotated-fixture') }, json: { user: userA, accessToken: 'access-A-fixture' } });
      }
      return;
    }
    firstRefresh = false;
    if (currentCookie.includes('digisante_rt=refresh-B-fixture')) {
      order.push('refresh-B-valid');
      await route.fulfill({ headers: { 'set-cookie': cookie('refresh-B-fixture') }, json: { user: userB, accessToken: 'access-B-fixture' } });
    } else if (currentCookie.includes('digisante_rt=refresh-A')) {
      await route.fulfill({ headers: { 'set-cookie': cookie('refresh-A-fixture') }, json: { user: userA, accessToken: 'access-A-fixture' } });
    } else await route.fulfill({ status: 401, json: { code: 'UNAUTHORIZED', message: 'Cookie absent' } });
  });
  await context.route('**/api/v1/appointments?*', (route) => route.request().headers().authorization
    ? route.fulfill({ json: [] })
    : route.fulfill({ status: 401, json: { code: 'UNAUTHORIZED', message: 'Jeton expiré' } }));
  await context.route('**/api/v1/auth/logout', async (route) => {
    markStarted(); await gate; order.push('logout-A-complete');
    await route.fulfill({ status: 204, headers: { 'set-cookie': `${cookie('')}; Max-Age=0` } });
  });
  await context.route('**/api/v1/auth/otp/request', (route) => route.fulfill({ json: { channel: 'SMS', expiresInSec: 300, devCode: '123456' } }));
  await context.route('**/api/v1/auth/otp/verify', (route) => {
    verifyCalls += 1; order.push('verify-B');
    return route.fulfill({ headers: { 'set-cookie': cookie('refresh-B-fixture') }, json: { user: userB, accessToken: 'access-B-fixture' } });
  });
  return { started, release, order, verifyCalls: () => verifyCalls, refreshCalls: () => refreshCalls };
}

async function beginLoginB(page: Page) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Numéro de téléphone', exact: true }).fill(userB.phone);
  await page.getByRole('button', { name: 'Recevoir le code', exact: true }).click();
  await page.getByRole('textbox', { name: 'Code à 6 chiffres', exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Vérifier', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Vérifier', exact: true })).toBeDisabled();
}

async function assertSessionB(page: Page, context: BrowserContext) {
  await expect(page).toHaveURL(/\/patient$/);
  await expect(page.getByRole('heading', { name: `Bonjour, ${userB.phone}` })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('digisante.session') ?? 'null')?.id)).toBe(userB.id);
  expect((await context.cookies()).find((entry) => entry.name === 'digisante_rt')?.value).toBe('refresh-B-fixture');
  await page.reload();
  await expect(page.getByRole('heading', { name: `Bonjour, ${userB.phone}` })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('digisante.session') ?? 'null')?.id)).toBe(userB.id);
}

async function refreshRace(page: Page, context: BrowserContext, outcome: 'success' | 'refused') {
  const fixture = await installAuthFixture(context, outcome === 'success' ? 'refresh-success' : 'refresh-refused');
  const secondPage = await context.newPage();
  try {
    await page.goto('/patient');
    await fixture.started;
    await beginLoginB(secondPage);
    expect(fixture.verifyCalls()).toBe(0);
    fixture.release();
    await assertSessionB(secondPage, context);
    expect(fixture.order.indexOf('verify-B')).toBeGreaterThan(fixture.order.indexOf(outcome === 'success' ? 'refresh-A-complete' : 'refresh-A-refused'));
    expect(fixture.order).toContain('refresh-B-valid');
  } finally { fixture.release(); await secondPage.close(); }
}

test('un refresh A réussi publie son cookie et son cache avant la connexion B en attente', async ({ page, context }) => {
  await refreshRace(page, context, 'success');
});

test('un refresh A refusé ne supprime pas la connexion B qui attend le verrou', async ({ page, context }) => {
  await refreshRace(page, context, 'refused');
});

test('une déconnexion A retardée termine son cookie et sa purge avant la session et le coffre B', async ({ page, context }) => {
  const fixture = await installAuthFixture(context, 'logout');
  const secondPage = await context.newPage();
  try {
    await page.goto('/patient');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Se déconnecter', exact: true }).click();
    await fixture.started;
    await beginLoginB(secondPage);
    expect(fixture.verifyCalls()).toBe(0);
    fixture.release();
    await assertSessionB(secondPage, context);
    expect(fixture.order.indexOf('verify-B')).toBeGreaterThan(fixture.order.indexOf('logout-A-complete'));
    await enableVault(secondPage);
    await expect(secondPage.getByText('Coffre déverrouillé', { exact: true })).toBeVisible();
    await secondPage.reload();
    await expect(secondPage.getByText('Coffre verrouillé', { exact: true })).toBeVisible();
    await expect(secondPage.getByRole('button', { name: 'Déverrouiller le coffre', exact: true })).toBeVisible();
  } finally { fixture.release(); await secondPage.close(); }
});

test('cache B modifié sans événement storage : un GET 401 de A ne renouvelle ni ne rejoue sous B', async ({ page, context }) => {
  const fixture = await installAuthFixture(context, 'logout');
  let recordCalls = 0;
  await context.route('**/api/v1/dmp/records', (route) => {
    recordCalls += 1;
    return route.fulfill({ status: 401, json: { code: 'UNAUTHORIZED', message: 'Jeton A expiré' } });
  });
  await context.route('**/api/v1/users/me', (route) => route.fulfill({ json: { ...userA, patient: { id: 'patient-A-fixture' } } }));
  await context.route('**/api/v1/dmp/consents', (route) => route.fulfill({ json: [] }));
  await page.goto('/patient');
  await page.waitForLoadState('networkidle');
  expect(fixture.refreshCalls()).toBe(1);
  // Le navigateur n'émet pas de storage event dans l'onglet qui écrit : ceci
  // reproduit de façon déterministe la fenêtre avant traitement inter-onglets.
  await page.evaluate((next) => localStorage.setItem('digisante.session', JSON.stringify({ id: next.id, role: next.role, status: next.status, lang: next.lang })), userB);
  await context.addCookies([{ name: 'digisante_rt', value: 'refresh-B-fixture', domain: '127.0.0.1', path: '/api/v1/auth', httpOnly: true, sameSite: 'Strict' }]);
  await page.getByRole('link', { name: 'Mon dossier', exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  expect(recordCalls).toBe(1);
  expect(fixture.refreshCalls()).toBe(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('digisante.session') ?? 'null')?.id)).toBe(userB.id);
  expect((await context.cookies()).find((entry) => entry.name === 'digisante_rt')?.value).toBe('refresh-B-fixture');
});

test('cache B modifié sans événement storage : le logout local A ne contacte pas B et ne purge pas son ticket', async ({ page, context }) => {
  const fixture = await installAuthFixture(context, 'logout');
  fixture.release();
  await page.goto('/patient');
  await page.waitForLoadState('networkidle');
  await page.evaluate(async (next) => {
    localStorage.setItem('digisante.session', JSON.stringify({ id: next.id, role: next.role, status: next.status, lang: next.lang }));
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('digisante-offline', 4);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('pendingSealed', 'readwrite');
        tx.objectStore('pendingSealed').put({ id: 'ticket-B-fixture', owner: next.id, ts: Date.now(), onlineOnly: true });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
  }, userB);
  await context.addCookies([{ name: 'digisante_rt', value: 'refresh-B-fixture', domain: '127.0.0.1', path: '/api/v1/auth', httpOnly: true, sameSite: 'Strict' }]);
  await page.getByRole('button', { name: 'Se déconnecter', exact: true }).click();
  // Protected ferme l'espace sur onboarding ; le bouton propose login. Les
  // deux routes sont publiques, l'invariant est la fermeture locale de A.
  await expect(page).toHaveURL(/\/(?:login|onboarding)$/);
  await expect(page.getByRole('button', { name: 'Se déconnecter', exact: true })).toHaveCount(0);
  expect(fixture.order).not.toContain('logout-A-complete');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('digisante.session') ?? 'null')?.id)).toBe(userB.id);
  expect((await context.cookies()).find((entry) => entry.name === 'digisante_rt')?.value).toBe('refresh-B-fixture');
  expect(await page.evaluate(() => new Promise<boolean>((resolve, reject) => {
    const request = indexedDB.open('digisante-offline', 4);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction('pendingSealed').objectStore('pendingSealed').get('ticket-B-fixture');
      read.onsuccess = () => { db.close(); resolve(Boolean(read.result)); };
      read.onerror = () => { db.close(); reject(read.error); };
    };
  }))).toBe(true);
});
