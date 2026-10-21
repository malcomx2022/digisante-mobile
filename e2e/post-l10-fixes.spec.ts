import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '../apps/api/node_modules/@prisma/client';
import { registerAndLogin, uniquePhone } from './helpers';

// Correctifs post-recette L10 (constats des 20–21/10/2026) sur la pile réelle.

// Après promotion, le profil local (encore PATIENT) redirige : recharger fait
// revalider le rôle courant en base par le refresh, qui ramène vers l'espace admin.
async function gotoAdmin(page: Page, path: string) {
  await page.reload();
  await page.waitForURL(/\/admin(\/|$)/);
  await page.goto(path);
  await expect(page).toHaveURL(new RegExp(`${path}$`));
}

async function promoteAdmin(prisma: PrismaClient, phone: string, scopes: string[]) {
  const admin = await prisma.user.findUniqueOrThrow({ where: { phone } });
  await prisma.user.update({ where: { id: admin.id }, data: { role: 'ADMIN', adminProfile: { create: { scopes } } } });
  return admin;
}

test('C2 — ConfirmDialog rendu hors de la carte : diffusion de campagne par l’UI (POST émis)', async ({ page }) => {
  const prisma = new PrismaClient(); const ids: string[] = []; let campaignId: string | null = null;
  try {
    const phone = await registerAndLogin(page, { firstName: 'Campagne', lastName: 'C2' });
    const admin = await promoteAdmin(prisma, phone, ['campaigns:write']); ids.push(admin.id);
    // Audience vide (langue + rôle sans compte actif) : aucune notification réelle.
    const campaign = await prisma.healthCampaign.create({ data: {
      category: 'PREVENTION', channel: 'IN_APP', audienceRole: 'ASC', audienceLang: 'YOR', createdById: admin.id,
      translations: { FR: { title: `Recette C2 ${randomUUID().slice(0, 8)}`, body: 'Message de recette.' } },
    } });
    campaignId = campaign.id;
    // Mobile : la carte y est la plus étroite, le panneau piégé n'apparaissait jamais.
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoAdmin(page, '/admin/campaigns');
    const card = page.locator('div.card-pagne').filter({ hasText: (campaign.translations as { FR: { title: string } }).FR.title });
    await card.getByRole('button', { name: 'Diffuser', exact: true }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeInViewport();
    // Portail : le dialogue est un enfant direct de <body>, hors de toute carte.
    expect(await dialog.evaluate((el) => el.parentElement === document.body)).toBe(true);
    const sent = page.waitForResponse((r) => r.url().endsWith(`/admin/campaigns/${campaign.id}/send`) && r.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Diffuser', exact: true }).click();
    expect((await sent).status()).toBe(200);
    await expect(card.getByText('Diffusé', { exact: true })).toBeVisible();
    expect((await prisma.healthCampaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe('SENT');
  } finally {
    if (campaignId) await prisma.healthCampaign.deleteMany({ where: { id: campaignId } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } }); await prisma.$disconnect();
  }
});

test('I1 — console support : la page se charge, cherche un compte et l’affiche', async ({ page }) => {
  const prisma = new PrismaClient(); const ids: string[] = [];
  try {
    const phone = await registerAndLogin(page, { firstName: 'Support', lastName: 'I1' });
    const admin = await promoteAdmin(prisma, phone, ['support:write', 'users:read', 'otp:write']); ids.push(admin.id);
    const target = await prisma.user.create({ data: { phone: uniquePhone().replace(/\d$/, '7'), role: 'PATIENT', status: 'ACTIVE', patient: { create: {} }, profile: { create: { firstName: 'Cible', lastName: 'Support' } } } });
    ids.push(target.id);
    await gotoAdmin(page, '/admin/support');
    await expect(page.getByText('Sélectionnez un utilisateur pour voir le détail.')).toBeVisible();
    const search = page.waitForResponse((r) => r.url().includes('/api/v1/admin/users?q=') && r.status() === 200);
    await page.getByLabel('Rechercher (nom, téléphone, e-mail)…').fill(target.phone);
    await search;
    await page.getByRole('button', { name: new RegExp(target.phone.replace('+', '\\+')) }).click();
    await expect(page.getByText('Verrou OTP')).toBeVisible();
    await expect(page.getByText('Aucun verrou actif')).toBeVisible();
  } finally { await prisma.user.deleteMany({ where: { id: { in: ids } } }); await prisma.$disconnect(); }
});

test('C1 — paiement Portefeuille confirmé : « Paiement confirmé », avant et après rechargement', async ({ page }) => {
  const prisma = new PrismaClient(); const ids: string[] = [];
  try {
    const phone = await registerAndLogin(page, { firstName: 'Patient', lastName: 'C1' });
    const patient = await prisma.user.findUniqueOrThrow({ where: { phone }, include: { patient: true } }); ids.push(patient.id);
    await prisma.wallet.upsert({ where: { userId: patient.id }, create: { userId: patient.id, balance: 10000 }, update: { balance: 10000 } });
    const doctor = await prisma.user.create({ data: { phone: uniquePhone().replace(/\d$/, '3'), role: 'MEDECIN', status: 'ACTIVE', profile: { create: { firstName: 'Doc', lastName: 'C1' } },
      doctor: { create: { speciality: 'Généraliste', licenseNumber: randomUUID(), verifiedAt: new Date(), consultFee: 3000 } } }, include: { doctor: true } });
    ids.push(doctor.id);
    await prisma.appointment.create({ data: { patientId: patient.patient!.id, doctorId: doctor.doctor!.id, type: 'PHYSICAL', status: 'CONFIRMED', scheduledAt: new Date(Date.now() + 2 * 86_400_000) } });

    await page.goto('/patient/appointments');
    await page.getByRole('button', { name: /^Payer · 3\s*000 XOF$/ }).click();
    await page.getByRole('button', { name: 'Wallet 🇫🇷' }).click();
    await expect(page.locator('[data-payment-status]')).toHaveText(/Paiement confirmé/);
    await expect(page.getByText('Paiement initié')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('[data-payment-status="COMPLETED"]')).toHaveText(/Paiement confirmé/);
  } finally { await prisma.user.deleteMany({ where: { id: { in: ids } } }); await prisma.$disconnect(); }
});

test('C4 — espace diaspora : le bouton d’action dit « Recharger » et mène au montant à recharger', async ({ page }) => {
  const prisma = new PrismaClient(); let phone = '';
  try {
    phone = await registerAndLogin(page, { role: 'Diaspora', firstName: 'Diaspora', lastName: 'C4' });
    await page.goto('/diaspora');
    // Le FAB visible (barre basse mobile ; la barre desktop porte le même lien).
    const fab = page.locator('a[href="/diaspora/wallet#topup"]:visible');
    await expect(fab).toHaveAccessibleName('Recharger');
    // La navigation garde son entrée « Mon portefeuille ».
    await expect(page.getByRole('link', { name: 'Mon portefeuille' }).first()).toBeVisible();
    await page.goto('/diaspora/wallet#topup');
    await expect(page.locator('#topup')).toBeFocused();
  } finally { if (phone) await prisma.user.deleteMany({ where: { phone } }); await prisma.$disconnect(); }
});
