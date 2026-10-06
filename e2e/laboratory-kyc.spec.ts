import { expect, test } from '@playwright/test';
import { PrismaClient } from '../apps/api/node_modules/@prisma/client';

import { registerAndLogin, uniquePhone } from './helpers';

// Pile réelle : formulaire labo → upload chiffré → checklist admin → accès au pool.
test('un laboratoire prépare son dossier et accède aux demandes après revue administrative', async ({ page, browser }) => {
  const prisma = new PrismaClient();
  let adminId: string | undefined;
  let labUserId: string | undefined;
  const adminContext = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '192.0.2.201' } });
  try {
    await page.setExtraHTTPHeaders({ 'x-forwarded-for': '192.0.2.200' });
    const labPhone = await registerAndLogin(page, { role: 'Laboratoire', firstName: 'Labo', lastName: 'Pilote' });
    labUserId = (await prisma.user.findUniqueOrThrow({ where: { phone: labPhone } })).id;
    await expect(page.getByText('Validation administrative requise')).toBeVisible();
    await expect(page.getByRole('button', { name: /publier/i })).toHaveCount(0);
    await page.getByRole('link', { name: 'Habilitation du laboratoire' }).click();
    await page.getByRole('button', { name: 'Ouvrir un dossier de validation' }).click();
    await page.getByLabel('Nom de la structure', { exact: true }).fill('Labo Pilote E2E');
    await page.getByLabel('Numéro d’autorisation d’exercice').fill('BJ-LAB-E2E');
    await page.getByRole('button', { name: 'Enregistrer la structure' }).click();
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    for (const type of ['NATIONAL_ID', 'PRACTICE_LICENSE']) {
      await page.getByLabel('Type de pièce').selectOption(type);
      await page.locator('input[type=file]').setInputFiles({ name: `${type}.png`, mimeType: 'image/png', buffer: png });
      await expect.poll(async () => prisma.kycDocument.count({ where: { submission: { userId: labUserId }, type: type as 'NATIONAL_ID' | 'PRACTICE_LICENSE' } })).toBe(1);
    }
    await page.getByRole('button', { name: /soumettre/i }).click();
    await expect(page.getByText('En cours de revue', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Nom de la structure', { exact: true })).toBeDisabled();

    const adminPhone = uniquePhone();
    const admin = await prisma.user.create({ data: { phone: adminPhone, role: 'ADMIN', status: 'ACTIVE', lang: 'FR',
      profile: { create: { firstName: 'Revue', lastName: 'E2E' } }, adminProfile: { create: { scopes: ['kyc:review'] } } } });
    adminId = admin.id;
    const adminPage = await adminContext.newPage();
    await adminPage.goto('/login');
    await adminPage.getByLabel(/téléphone|phone/i).fill(adminPhone);
    await adminPage.getByRole('button', { name: /recevoir le code|send code/i }).click();
    const hint = adminPage.getByText(/dev:\s*\d{6}/); await expect(hint).toBeVisible();
    await adminPage.getByLabel(/code/i).fill((await hint.textContent())!.match(/dev:\s*(\d{6})/)![1]);
    await adminPage.getByRole('button', { name: /vérifier|verify/i }).click();
    await adminPage.waitForURL(/\/admin/);
    await adminPage.goto('/admin/kyc');
    const card = adminPage.locator('div.card-pagne').filter({ hasText: 'Labo Pilote E2E' }).filter({ has: adminPage.getByRole('button', { name: /examiner|review/i }) }).first();
    await card.getByRole('button', { name: /examiner|review/i }).click();
    await expect(adminPage.getByText('BJ-LAB-E2E', { exact: true })).toBeVisible();
    const approve = adminPage.getByRole('button', { name: /^approuver$/i });
    await expect(approve).toBeDisabled();
    for (let i = 0; i < 2; i++) {
      await adminPage.getByRole('button', { name: /à vérifier/i }).first().click();
      await expect(adminPage.getByRole('button', { name: /à vérifier/i })).toHaveCount(1 - i);
    }
    await expect(approve).toBeEnabled(); await approve.click();
    await expect.poll(async () => (await prisma.lab.findUniqueOrThrow({ where: { userId: labUserId } })).verifiedAt).not.toBeNull();
    await page.goto('/labo/orders');
    await expect(page.getByRole('heading', { name: /demandes disponibles/i })).toBeVisible();
    await expect(page.getByText('Validation administrative requise')).toHaveCount(0);
  } finally {
    await adminContext.close();
    if (labUserId) { await prisma.kycSubmission.deleteMany({ where: { userId: labUserId } }); await prisma.user.deleteMany({ where: { id: labUserId } }); }
    if (adminId) await prisma.user.deleteMany({ where: { id: adminId } });
    await prisma.$disconnect();
  }
});
