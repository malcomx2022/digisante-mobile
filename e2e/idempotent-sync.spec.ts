import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '../apps/api/node_modules/@prisma/client';

import { registerAndLogin } from './helpers';
import { enableVault, unlockVault } from './vault-helpers';

async function pending(page: Page) {
  return page.evaluate(() => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open('digisante-offline', 4);
    request.onsuccess = () => {
      const db = request.result; const transaction = db.transaction('pendingSealed', 'readonly');
      const count = transaction.objectStore('pendingSealed').count(); let value = 0;
      count.onsuccess = () => { value = count.result; };
      transaction.oncomplete = () => { db.close(); resolve(value); }; transaction.onerror = () => reject(transaction.error);
    };
    request.onerror = () => reject(request.error);
  }));
}
async function fillSubject(page: Page, name: string) {
  await page.getByLabel('Nom', { exact: true }).fill(name);
  await page.getByLabel('Date de naissance').fill('2025-01-01');
  await page.getByRole('button', { name: 'Générer le calendrier' }).click();
}

test('réponse perdue après commit puis rechargement : même clé, un seul sujet PEV', async ({ page }) => {
  const prisma = new PrismaClient(); let userId: string | undefined; const keys: string[] = [];
  try {
    await page.setExtraHTTPHeaders({ 'x-forwarded-for': '192.0.2.210' });
    const phone = await registerAndLogin(page, { firstName: 'Reprise', lastName: 'L3' });
    userId = (await prisma.user.findUniqueOrThrow({ where: { phone } })).id;
    await enableVault(page);
    await page.locator('a[href="/patient"]').last().click();
    await page.locator('a[href="/patient/vaccinations"]').click();
    let drop = true;
    await page.route('**/api/v1/vaccinations/subjects', async (route) => {
      keys.push(route.request().headers()['idempotency-key']);
      const response = await route.fetch(); // effet réel validé par Fastify/PostgreSQL
      expect(response.status()).toBe(201);
      if (drop) { drop = false; await route.abort('failed'); } else await route.fulfill({ response });
    });
    await fillSubject(page, 'Enfant reprise L3');
    await expect.poll(() => pending(page)).toBe(1);
    await expect.poll(() => prisma.vaccinationSubject.count({ where: { patient: { userId } } })).toBe(1);
    await page.goto('/patient/offline'); // nouveau document = clé mémoire perdue
    await expect.poll(() => pending(page)).toBe(1);
    await unlockVault(page);
    await expect.poll(() => pending(page)).toBe(0);
    expect(keys).toHaveLength(2); expect(keys[1]).toBe(keys[0]);
    expect(await prisma.vaccinationSubject.count({ where: { patient: { userId } } })).toBe(1);
    expect(await prisma.mutationReceipt.count({ where: { userId, key: keys[0] } })).toBe(1);
    await page.goto('/patient/vaccinations'); await expect(page.getByText('Enfant reprise L3', { exact: true })).toBeVisible();
  } finally { if (userId) await prisma.user.delete({ where: { id: userId } }); await prisma.$disconnect(); }
});

test('deux onglets vérifient le ticket sans coffre : un seul POST réel, reçu minimal partagé', async ({ page, context }) => {
  const prisma = new PrismaClient(); let userId: string | undefined;
  const keys: string[] = []; const statuses: number[] = []; let mutationKey: string | undefined; let posts = 0;
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  let committed!: () => void; const commit = new Promise<void>((resolve) => { committed = resolve; });
  try {
    await context.setExtraHTTPHeaders({ 'x-forwarded-for': '192.0.2.211' });
    const phone = await registerAndLogin(page, { firstName: 'Onglets', lastName: 'L3' });
    userId = (await prisma.user.findUniqueOrThrow({ where: { phone } })).id;
    await page.goto('/patient/vaccinations');
    await context.route('**/api/v1/vaccinations/subjects', async (route) => {
      posts++; mutationKey = route.request().headers()['idempotency-key'];
      const response = await route.fetch(); expect(response.status()).toBe(201); await route.abort('failed');
      committed();
    });
    // La file est persistée AVANT le POST. Intercepter dès maintenant évite
    // qu'une reprise initiale la consomme hors du scénario à deux onglets.
    await context.route('**/api/v1/sync/receipts/*', async (route) => {
      keys.push(route.request().url().split('/').at(-1)!);
      await commit; // le reçu n'existe qu'après le vrai commit PostgreSQL
      const response = await route.fetch(); statuses.push(response.status());
      expect(await response.json()).toEqual({ confirmed: true, status: 201 });
      await gate;
      await route.fulfill({ response });
    });
    await fillSubject(page, 'Enfant onglets L3');
    await expect.poll(() => pending(page)).toBe(1);
    const second = await context.newPage(); await second.goto('/patient/vaccinations');
    await expect(second.getByLabel('Date de naissance')).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(() => keys.length).toBe(2);
    // Deux requêtes démarrées ne prouvent pas que les deux réponses sont reçues.
    // Une seule réponse libérée suffirait à vider la file partagée.
    await expect.poll(() => statuses).toEqual([200, 200]);
    release();
    await expect.poll(() => pending(page)).toBe(0);
    expect(statuses).toEqual([200, 200]); expect(keys).toEqual([mutationKey, mutationKey]); expect(posts).toBe(1);
    expect(await prisma.vaccinationSubject.count({ where: { patient: { userId } } })).toBe(1);
    expect(await prisma.mutationReceipt.count({ where: { userId, key: keys[0] } })).toBe(1);
  } finally { committed(); release(); if (userId) await prisma.user.delete({ where: { id: userId } }); await prisma.$disconnect(); }
});
