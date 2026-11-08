import { expect, test } from '@playwright/test';
import { PrismaClient } from '../apps/api/node_modules/@prisma/client';
import { registerAndLogin } from './helpers';
import { grantProDb } from './pro-fixture';

// Pile API/DB réelle, aucun fournisseur externe. A8 (revue GO du 22/10/2026) : l'abonnement
// ne se règle plus par wallet ; la période payée vient d'une fixture « confirmée fournisseur ».
test('FREE bloque le démarrage, wallet non proposé, période payée affichée et arrêt à échéance', async ({ page }) => {
  const prisma = new PrismaClient(); let userId: string | undefined;
  try {
    const phone = await registerAndLogin(page, { role: 'Médecin', firstName: 'Abonnement', lastName: 'L6' });
    const doctor = await prisma.user.findUniqueOrThrow({ where: { phone }, include: { doctor: true } }); userId = doctor.id;
    await prisma.doctor.update({ where: { id: doctor.doctor!.id }, data: { verifiedAt: new Date() } });
    await page.goto('/pro/agenda'); await expect(page.getByRole('link', { name: /abonnement PRO payé/ })).toBeVisible();
    await page.goto('/pro/stats'); await expect(page.getByText('Aucun prélèvement automatique.', { exact: false })).toBeVisible();
    const methods = page.getByLabel('Moyen de paiement');
    await expect(methods.locator('option[value="MTN_MOMO"]')).toHaveCount(1);
    await expect(methods.locator('option[value="WALLET"]')).toHaveCount(0);
    const order = await grantProDb(prisma, userId);
    await page.reload(); await expect(page.getByRole('button', { name: 'Renouveler un mois PRO', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Passer à FREE à l’échéance' }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Confirmer', exact: true }).click();
    await expect(page.getByText('Arrêt demandé à l’échéance de la période payée.').first()).toBeVisible();
    expect((await prisma.subscriptionOrder.findUniqueOrThrow({ where: { id: order.id } })).revokedAt).toBeNull();
    await page.reload(); await expect(page.getByRole('button', { name: 'Renouveler un mois PRO' })).toBeVisible();
  } finally { if (userId) await prisma.user.delete({ where: { id: userId } }); await prisma.$disconnect(); }
});

test('fournisseur indisponible et réseau hors ligne : pas d’activation, aucun paiement en file', async ({ page, context }) => {
  const prisma = new PrismaClient(); let userId: string | undefined;
  try {
    const phone = await registerAndLogin(page, { role: 'Médecin', firstName: 'Refus', lastName: 'L6' });
    const doctor = await prisma.user.findUniqueOrThrow({ where: { phone }, include: { doctor: true } }); userId = doctor.id;
    await prisma.doctor.update({ where: { id: doctor.doctor!.id }, data: { verifiedAt: new Date() } });
    // Aucune configuration FedaPay dans l'e2e : refus serveur (502) sans commande.
    await page.goto('/pro/stats');
    await page.getByRole('button', { name: 'Payer un mois PRO', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Payer un mois PRO', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Abonnement indisponible' })).toBeVisible();
    expect(await prisma.subscriptionOrder.count({ where: { doctorId: doctor.doctor!.id } })).toBe(0);
    await page.getByRole('button', { name: 'Payer un mois PRO', exact: true }).click(); await context.setOffline(true);
    await page.getByRole('dialog').getByRole('button', { name: 'Payer un mois PRO', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Abonnement indisponible' })).toBeVisible();
    await context.setOffline(false);
    expect(await prisma.payment.count({ where: { userId } })).toBe(0);
    const queued = await page.evaluate(async () => {
      if (!(await indexedDB.databases()).some((db) => db.name === 'digisante-offline')) return 0;
      return new Promise<number>((resolve, reject) => { const req = indexedDB.open('digisante-offline', 4); req.onerror = () => reject(req.error); req.onsuccess = () => { const db = req.result; if (!db.objectStoreNames.contains('mutations')) { db.close(); resolve(0); return; } const read = db.transaction('mutations').objectStore('mutations').count(); read.onsuccess = () => { db.close(); resolve(read.result); }; read.onerror = () => reject(read.error); }; });
    });
    expect(queued).toBe(0);
  } finally { await context.setOffline(false); if (userId) await prisma.user.delete({ where: { id: userId } }); await prisma.$disconnect(); }
});

// Contrat UI simulé seulement : prouve la redirection, aucune preuve de règlement.
test('checkout FedaPay : redirection exigée sans annoncer un paiement confirmé', async ({ page }) => {
  const prisma = new PrismaClient(); let userId: string | undefined;
  try {
    const phone = await registerAndLogin(page, { role: 'Médecin', firstName: 'Checkout', lastName: 'L6' }); userId = (await prisma.user.findUniqueOrThrow({ where: { phone } })).id;
    let seenBody: Record<string, unknown> | undefined;
    await page.route('**/api/v1/subscriptions', async (route) => {
      seenBody = route.request().postDataJSON();
      await route.fulfill({ json: { orderId: 'cl6testcheckout00000000001', revoked: false, payment: { id: 'test-only-payment', status: 'PENDING' }, paymentUrl: 'https://checkout.fedapay.com/l6-browser-test-only' } });
    });
    await page.route('https://checkout.fedapay.com/l6-browser-test-only', (route) => route.fulfill({ contentType: 'text/html', body: '<html><body>FedaPay fixture — aucun paiement réel</body></html>' }));
    await page.goto('/pro/stats'); await page.getByRole('button', { name: 'Payer un mois PRO', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Payer un mois PRO', exact: true }).click();
    await page.waitForURL('https://checkout.fedapay.com/l6-browser-test-only');
    expect(seenBody).toMatchObject({ plan: 'PRO', method: 'MTN_MOMO' }); expect(seenBody).not.toHaveProperty('amount'); expect(String(seenBody?.requestId)).toMatch(/^[0-9a-f-]{36}$/);
    expect(await prisma.payment.count({ where: { userId } })).toBe(0);
  } finally { if (userId) await prisma.user.delete({ where: { id: userId } }); await prisma.$disconnect(); }
});
