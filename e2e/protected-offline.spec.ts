import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '../apps/api/node_modules/@prisma/client';

import { registerAndLogin, uniquePhone } from './helpers';
import { enableVault, unlockVault, VAULT_PHRASE } from './vault-helpers';

const PRIVATE = 'DMP-SYNTHETIQUE-L4-PRIVE';
async function localRows(page: Page) {
  return page.evaluate(() => new Promise<Record<string, any[]>>((resolve, reject) => {
    const request = indexedDB.open('digisante-offline', 4);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result; const names = [...db.objectStoreNames]; const rows: Record<string, any[]> = {};
      const tx = db.transaction(names, 'readonly');
      for (const name of names) { const read = tx.objectStore(name).getAll(); read.onsuccess = () => { rows[name] = read.result; }; }
      tx.oncomplete = () => { db.close(); resolve(rows); }; tx.onabort = () => reject(tx.error);
    };
  }));
}
async function fixture(prisma: PrismaClient, phone: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { phone }, include: { patient: true } });
  await prisma.medicalRecord.create({ data: { patientId: user.patient!.id, type: 'VITAL_SIGNS', title: PRIVATE, authorId: user.id, authorRole: 'PATIENT', data: { marker: 'FULL-DMP-EXCLUDED' } } });
  await prisma.patient.update({ where: { id: user.patient!.id }, data: { bloodGroup: 'O+', allergies: ['ALLERGIE-SYNTHETIQUE-L4'], insuranceNumber: 'INSURANCE-EXCLUDED' } });
  const doctor = await prisma.user.create({ data: { phone: uniquePhone(), role: 'MEDECIN', status: 'ACTIVE', doctor: { create: { speciality: 'Synthétique', licenseNumber: `L4-${user.id}`, consultFee: 0 } } }, include: { doctor: true } });
  await prisma.prescription.create({ data: { patientId: user.patient!.id, doctorId: doctor.doctor!.id, status: 'CANCELLED', validUntil: new Date(Date.now() + 7 * 86_400_000), qrCode: `QR-EXCLUDED-${user.id}`, items: { create: { medicationName: 'MEDICAMENT-SYNTHETIQUE-L4', dosage: '5 mg', frequency: '1/j', duration: '3 j' } } } });
  return { userId: user.id, doctorId: doctor.id };
}
async function syncReadings(page: Page) {
  const medicalResponses = Promise.all(['/dmp/records', '/prescriptions', '/users/me/medical'].map((path) => page.waitForResponse((response) => response.url().endsWith(`/api/v1${path}`) && response.request().method() === 'GET')));
  await page.getByRole('button', { name: 'Synchroniser mes lectures', exact: true }).click();
  for (const response of await medicalResponses) expect(response.headers()['cache-control']).toBe('no-store');
  await expect(page.getByTestId('offline-medical')).toContainText(PRIVATE);
}

test('lecture préparée puis reload hors réseau : phrase obligatoire, aucun médical en cache public', async ({ page, context }) => {
  const prisma = new PrismaClient(); let ids: Awaited<ReturnType<typeof fixture>> | undefined;
  try {
    await page.setExtraHTTPHeaders({ 'x-forwarded-for': '192.0.2.212' });
    const phone = await registerAndLogin(page, { firstName: 'Coffre', lastName: 'L4' }); ids = await fixture(prisma, phone);
    await enableVault(page); await syncReadings(page);
    await expect(page.getByTestId('offline-medical')).toContainText('Annulée');
    const raw = JSON.stringify(await localRows(page));
    for (const marker of [PRIVATE, VAULT_PHRASE, 'MEDICAMENT-SYNTHETIQUE-L4', 'ALLERGIE-SYNTHETIQUE-L4', 'QR-EXCLUDED', 'FULL-DMP-EXCLUDED', 'INSURANCE-EXCLUDED']) expect(raw).not.toContain(marker);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    const cache = await page.evaluate(async () => {
      const urls: string[] = []; let bodies = '';
      for (const name of await caches.keys()) { const store = await caches.open(name); for (const request of await store.keys()) { urls.push(request.url); bodies += await (await store.match(request))!.text(); } }
      return { urls, bodies };
    });
    expect(cache.urls.some((url) => url.includes('/api/') || url.includes('_rsc'))).toBe(false); expect(cache.bodies).not.toContain(PRIVATE);
    await context.setOffline(true); await page.reload();
    await expect(page.getByText('Coffre verrouillé', { exact: true })).toBeVisible(); await expect(page.getByTestId('offline-medical')).toHaveCount(0);
    await page.getByLabel('Phrase secrète locale', { exact: true }).fill('mauvaise phrase synthétique');
    await page.getByRole('button', { name: 'Déverrouiller le coffre', exact: true }).click();
    await expect(page.getByText(/Action impossible : vérifiez la phrase/)).toBeVisible(); await expect(page.getByTestId('offline-medical')).toHaveCount(0);
    await unlockVault(page); await expect(page.getByTestId('offline-medical')).toContainText(PRIVATE);
    await expect(page.getByTestId('offline-medical')).toContainText('MEDICAMENT-SYNTHETIQUE-L4');
    await page.getByRole('button', { name: 'Verrouiller le coffre', exact: true }).click(); await expect(page.getByTestId('offline-medical')).toHaveCount(0);
  } finally { await context.setOffline(false); if (ids) { await prisma.user.delete({ where: { id: ids.userId } }); await prisma.user.delete({ where: { id: ids.doctorId } }); } await prisma.$disconnect(); }
});

test('changement de compte réel : lectures A purgées, aucune lecture ou file A exposée à B', async ({ page }) => {
  const prisma = new PrismaClient(); let ids: Awaited<ReturnType<typeof fixture>> | undefined; let b: string | undefined;
  try {
    await page.setExtraHTTPHeaders({ 'x-forwarded-for': '192.0.2.213' });
    const phone = await registerAndLogin(page, { firstName: 'CompteA', lastName: 'L4' }); ids = await fixture(prisma, phone);
    await enableVault(page); await syncReadings(page);
    await page.locator('a[href="/patient"]').last().click(); await page.locator('a[href="/patient/vaccinations"]').click();
    await page.route('**/api/v1/vaccinations/subjects', async (route) => { const response = await route.fetch(); expect(response.status()).toBe(201); await route.abort('failed'); });
    await page.getByLabel('Nom', { exact: true }).fill('FILE-A-SYNTHETIQUE-L4'); await page.getByLabel('Date de naissance').fill('2025-01-01');
    await page.getByRole('button', { name: 'Générer le calendrier' }).click();
    await expect.poll(async () => (await localRows(page)).pendingSealed.length).toBe(1);
    const next = await registerAndLogin(page, { firstName: 'CompteB', lastName: 'L4' }); b = (await prisma.user.findUniqueOrThrow({ where: { phone: next } })).id;
    await page.goto('/patient/offline'); await expect(page.getByText('Stockage médical hors ligne désactivé', { exact: true })).toBeVisible();
    await expect(page.getByTestId('offline-medical')).toHaveCount(0);
    await expect.poll(async () => (await localRows(page)).snapshots.length).toBe(0);
    await enableVault(page); await expect(page.getByText('Aucune lecture synchronisée pour ce compte.', { exact: true })).toBeVisible();
    await expect(page.getByText(/0 action\(s\) en attente/).first()).toBeVisible();
    const rows = await localRows(page); expect(rows.pendingSealed).toHaveLength(1); expect(rows.pendingSealed[0].owner).toBe(ids.userId);
    expect(JSON.stringify(rows)).not.toContain('FILE-A-SYNTHETIQUE-L4');
    expect(await page.locator('body').textContent()).not.toContain(PRIVATE);
  } finally { if (b) await prisma.user.delete({ where: { id: b } }); if (ids) { await prisma.user.delete({ where: { id: ids.userId } }); await prisma.user.delete({ where: { id: ids.doctorId } }); } await prisma.$disconnect(); }
});

test('ancien corps v3 migré par activation : même clé, un seul effet, héritage en clair retiré', async ({ page }) => {
  const prisma = new PrismaClient(); let userId: string | undefined;
  try {
    await page.setExtraHTTPHeaders({ 'x-forwarded-for': '192.0.2.214' });
    const phone = await registerAndLogin(page, { firstName: 'Migration', lastName: 'L4' }); userId = (await prisma.user.findUniqueOrThrow({ where: { phone } })).id;
    await page.goto('/patient/offline');
    const key = await page.evaluate(async (owner) => {
      const id = crypto.randomUUID(); const ts = Date.now(); const key = `v1.${ts}.${id}`;
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('digisante-offline', 4); request.onerror = () => reject(request.error);
        request.onsuccess = () => { const db = request.result; const tx = db.transaction('mutations', 'readwrite');
          tx.objectStore('mutations').put({ id, ts, owner, idempotencyKey: key, method: 'POST', path: '/vaccinations/subjects', body: { name: 'HERITAGE-SYNTHETIQUE-L4', birthDate: '2025-01-01', isSelf: false } });
          tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
        };
      }); return key;
    }, userId);
    await enableVault(page);
    await expect.poll(() => prisma.mutationReceipt.count({ where: { userId, key } })).toBe(1);
    await expect.poll(() => prisma.vaccinationSubject.count({ where: { patient: { userId }, name: 'HERITAGE-SYNTHETIQUE-L4' } })).toBe(1);
    await expect.poll(async () => (await localRows(page)).pendingSealed.length).toBe(0);
    const rows = await localRows(page); expect(rows.mutations).toEqual([]); expect(JSON.stringify(rows)).not.toContain('HERITAGE-SYNTHETIQUE-L4');
  } finally { if (userId) await prisma.user.delete({ where: { id: userId } }); await prisma.$disconnect(); }
});

test('purge et stockage navigateur refusés au logout : session fermée et avertissement mémoire visible', async ({ page }) => {
  const prisma = new PrismaClient(); let userId: string | undefined; const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.setExtraHTTPHeaders({ 'x-forwarded-for': '192.0.2.215' });
    const phone = await registerAndLogin(page, { firstName: 'Purge', lastName: 'L4' }); userId = (await prisma.user.findUniqueOrThrow({ where: { phone } })).id;
    await enableVault(page);
    await page.evaluate(() => {
      IDBObjectStore.prototype.clear = () => { throw new DOMException('synthetic quota', 'QuotaExceededError'); };
      const set = Storage.prototype.setItem; Storage.prototype.setItem = function (key, value) { if (key === 'digisante.cleanupFailed') throw new DOMException('blocked', 'SecurityError'); return set.call(this, key, value); };
      const remove = Storage.prototype.removeItem; Storage.prototype.removeItem = function (key) { if (key === 'digisante.session') throw new DOMException('blocked', 'SecurityError'); return remove.call(this, key); };
    });
    await page.getByRole('button', { name: 'Se déconnecter', exact: true }).click();
    await expect(page.getByText(/Effacement local non confirmé/)).toBeVisible();
    await expect(page.getByText('Coffre déverrouillé', { exact: true })).toHaveCount(0);
    await expect(page).toHaveURL(/\/(login|onboarding)$/); expect(errors).toEqual([]);
    expect((await localRows(page)).vaults).toHaveLength(1); // échec déclaré, jamais effacement fictif
  } finally { if (userId) await prisma.user.delete({ where: { id: userId } }); await prisma.$disconnect(); }
});
