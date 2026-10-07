import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { PrismaClient } from '../apps/api/node_modules/@prisma/client';
import { registerAndLogin, uniquePhone } from './helpers';

const WEB = 'http://127.0.0.1:3000';
// Session obtenue via l'OTP réel en mode test. Aucun token navigateur stocké.
async function login(request: APIRequestContext, phone: string) {
  const otp = await request.post(`${WEB}/api/v1/auth/otp/request`, { data: { phone } }); expect(otp.ok()).toBe(true);
  const res = await request.post(`${WEB}/api/v1/auth/otp/verify`, { data: { phone, code: (await otp.json()).devCode } }); expect(res.ok()).toBe(true);
  return { authorization: `Bearer ${(await res.json()).accessToken}` };
}

test('revenus PRO et CSV réels isolés, reçu explicitement non fiscal', async ({ page, request }) => {
  const prisma = new PrismaClient(); const ids: string[] = [];
  try {
    const phone = await registerAndLogin(page, { role: 'Médecin', firstName: 'Revenus', lastName: 'L7' });
    const doctor = await prisma.user.findUniqueOrThrow({ where: { phone }, include: { doctor: true } }); ids.push(doctor.id);
    await prisma.doctor.update({ where: { id: doctor.doctor!.id }, data: { verifiedAt: new Date(), consultFee: 3000 } });
    await prisma.wallet.upsert({ where: { userId: doctor.id }, create: { userId: doctor.id, balance: 5000 }, update: { balance: 5000 } });
    await page.goto('/pro/stats'); await expect(page.getByText('Les statistiques de revenus nécessitent un abonnement PRO payé et en cours.')).toBeVisible();
    await page.getByLabel('Moyen de paiement').selectOption('WALLET'); await page.getByRole('button', { name: 'Payer un mois PRO', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Payer un mois PRO', exact: true }).click(); await expect(page.getByText('Paiement confirmé. La période PRO est enregistrée.')).toBeVisible();
    const other = await prisma.user.create({ data: { phone: uniquePhone(), role: 'MEDECIN', status: 'ACTIVE', doctor: { create: { speciality: 'G', licenseNumber: randomUUID(), verifiedAt: new Date(), consultFee: 7000 } } }, include: { doctor: true } }); ids.push(other.id);
    const patient = await prisma.user.create({ data: { phone: uniquePhone(), role: 'PATIENT', status: 'ACTIVE', patient: { create: {} }, wallet: { create: { balance: 30000 } } }, include: { patient: true } }); ids.push(patient.id);
    const headers = await login(request, patient.phone); const payments: string[] = [];
    for (const doctorId of [doctor.doctor!.id, other.doctor!.id]) {
      const appointment = await prisma.appointment.create({ data: { patientId: patient.patient!.id, doctorId, type: 'PHYSICAL', status: 'COMPLETED', scheduledAt: new Date() } });
      const paid = await request.post(`${WEB}/api/v1/payments`, { headers, data: { type: 'CONSULTATION', method: 'WALLET', appointmentId: appointment.id, amount: 1 } }); expect(paid.status()).toBe(201); payments.push((await paid.json()).payment.id);
    }
    await page.reload();
    await expect(page.locator('dl > div').filter({ has: page.getByText('Montants confirmés', { exact: true }) })).toContainText(/3\s*000 FCFA/);
    await expect(page.locator('dl > div').filter({ has: page.getByText('Net acquis sur la période', { exact: true }) })).toContainText(/2\s*910 FCFA/);
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Télécharger le relevé CSV' }).click();
    const file = await download; const csv = await readFile((await file.path())!, 'utf8'); expect(csv).toContain(payments[0]); expect(csv).not.toContain(payments[1]); expect(csv).not.toMatch(/patientId|phone|notes|triage/);
    await page.getByRole('button', { name: 'Afficher le reçu non fiscal' }).first().click(); await expect(page.getByText('Reçu de paiement non fiscal — ne vaut pas facture fiscale')).toBeVisible();
    const receipt = await request.get(`${WEB}/api/v1/payments/${payments[0]}/receipt`, { headers }); expect(receipt.status()).toBe(200); expect((await receipt.json()).fiscal).toBe(false);
  } finally { await prisma.user.deleteMany({ where: { id: { in: ids } } }); await prisma.$disconnect(); }
});

test('finance admin : réservation, prise en charge et preuve sans transfert externe', async ({ page, request, context }) => {
  const prisma = new PrismaClient(); const ids: string[] = [];
  try {
    const phone = await registerAndLogin(page, { firstName: 'Finance', lastName: 'L7' });
    const admin = await prisma.user.findUniqueOrThrow({ where: { phone } }); ids.push(admin.id);
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'ADMIN', adminProfile: { create: { scopes: ['finance:read', 'finance:write', 'webhooks:read'] } } } });
    // Refresh cookie revalide le rôle courant en base lors du rechargement.
    const doctor = await prisma.user.create({ data: { phone: uniquePhone(), role: 'MEDECIN', status: 'ACTIVE', doctor: { create: { speciality: 'G', licenseNumber: randomUUID(), consultFee: 3000, verifiedAt: new Date() } } }, include: { doctor: true } }); ids.push(doctor.id);
    const patient = await prisma.user.create({ data: { phone: uniquePhone(), role: 'PATIENT', status: 'ACTIVE', patient: { create: {} }, wallet: { create: { balance: 10000 } } }, include: { patient: true } }); ids.push(patient.id);
    const headers = await login(request, patient.phone);
    const appointment = await prisma.appointment.create({ data: { patientId: patient.patient!.id, doctorId: doctor.doctor!.id, type: 'PHYSICAL', status: 'COMPLETED', scheduledAt: new Date() } });
    const res = await request.post(`${WEB}/api/v1/payments`, { headers, data: { type: 'CONSULTATION', method: 'WALLET', appointmentId: appointment.id } }); expect(res.status()).toBe(201); const paymentId = (await res.json()).payment.id;
    await page.goto('/admin/finance');
    // Le profil optimiste peut rediriger une fois après la promotion de rôle.
    // Attendre la navigation ADMIN issue du refresh, puis utiliser son lien réel.
    await page.getByRole('link', { name: 'Finances', exact: true }).click();
    await page.getByLabel('Identifiant du médecin').fill(doctor.doctor!.id); await page.getByRole('button', { name: 'Lister les paiements éligibles' }).click();
    await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Demander le reversement du net sélectionné' }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Confirmer', exact: true }).click();
    await expect.poll(() => prisma.financeOperationItem.count({ where: { paymentId, operation: { kind: 'PAYOUT' } } })).toBe(1);
    const operation = await prisma.financeOperation.findFirstOrThrow({ where: { items: { some: { paymentId } }, kind: 'PAYOUT' } }); expect(Number(operation.amount)).toBe(2910);
    const card = page.locator('div.border-b').filter({ hasText: `Opération : ${operation.id}` });
    await card.getByRole('button', { name: 'Prendre en charge l’exécution' }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Confirmer', exact: true }).click();
    await expect(card.getByText('En exécution / à rapprocher', { exact: false })).toBeVisible();
    await card.getByRole('button', { name: 'Consigner l’exécution prouvée' }).click(); await page.getByLabel('Référence de preuve (sans URL ni données patient)').fill(`test:${operation.id}`); await page.getByRole('dialog').getByRole('button', { name: 'Confirmer', exact: true }).click();
    await expect(card.getByText('Exécuté avec preuve', { exact: false })).toBeVisible(); expect((await prisma.financeOperation.findUniqueOrThrow({ where: { id: operation.id } })).proofRef).toBe(`test:${operation.id}`);
    // La fermeture est purement comptable ; aucune mutation ne part en file offline.
    await context.setOffline(true); await page.getByLabel('Référence d’un paiement historique REFUNDED').fill(paymentId); await page.getByRole('button', { name: 'Créer la demande de remboursement externe' }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Confirmer', exact: true }).click(); await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible(); await context.setOffline(false);
    expect(await prisma.financeOperation.count({ where: { requestId: `refund:${paymentId}` } })).toBe(0);
  } finally { await context.setOffline(false); await prisma.user.deleteMany({ where: { id: { in: ids } } }); await prisma.$disconnect(); }
});
