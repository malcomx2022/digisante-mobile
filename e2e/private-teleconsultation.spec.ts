import { expect, test } from '@playwright/test';
import { PrismaClient } from '../apps/api/node_modules/@prisma/client';
import { registerAndLogin, uniquePhone } from './helpers';

// Pile réelle sans identifiants Daily : preuve du repli explicite et des droits.
// Les médias fournisseur sont couverts par contrats unitaires, puis recette L10.
test('médecin ouvre, patient rejoint puis passe AUDIO → CHAT, médecin clôture sans média fictif', async ({ page, browser }) => {
  const prisma = new PrismaClient();
  const patientContext = await browser.newContext();
  const ids: string[] = [];
  try {
    const doctorPhone = await registerAndLogin(page, { role: 'Médecin', firstName: 'Daily', lastName: 'Médecin' });
    const doctor = await prisma.user.findUniqueOrThrow({ where: { phone: doctorPhone }, include: { doctor: true } }); ids.push(doctor.id);
    await prisma.doctor.update({ where: { id: doctor.doctor!.id }, data: { verifiedAt: new Date() } });
    // Fonds synthétiques, achat L6 par API réelle pour la fixture téléconsultation.
    await prisma.wallet.create({ data: { userId: doctor.id, balance: 5000 } });
    const session = await page.request.post('/api/v1/auth/refresh');
    expect(session.ok()).toBe(true);
    const { accessToken } = await session.json();
    const paid = await page.request.post('/api/v1/subscriptions', { headers: { authorization: `Bearer ${accessToken}` }, data: { plan: 'PRO', method: 'WALLET', requestId: 'a6000000-0000-4000-8000-000000000003' } });
    expect(paid.ok()).toBe(true);
    const patientPage = await patientContext.newPage();
    const patientPhone = await registerAndLogin(patientPage, { firstName: 'Daily', lastName: 'Patient' });
    const patient = await prisma.user.findUniqueOrThrow({ where: { phone: patientPhone }, include: { patient: true } }); ids.push(patient.id);
    const appt = await prisma.appointment.create({ data: { patientId: patient.patient!.id, doctorId: doctor.doctor!.id, type: 'TELECONSULTATION', status: 'CONFIRMED', scheduledAt: new Date(Date.now() + 3_600_000) } });
    await page.goto('/pro/agenda');
    await page.getByRole('button', { name: 'Démarrer la téléconsultation' }).click();
    await page.waitForURL(/\/pro\/teleconsult\?id=/);
    await expect(page.getByText('La vidéo est indisponible. Vous pouvez poursuivre par messagerie.')).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
    const consult = await prisma.consultation.findUniqueOrThrow({ where: { appointmentId: appt.id } });
    expect(consult.dailyRoomUrl).toBeNull(); expect(consult.dailyRoomName).toBeNull();
    await patientPage.goto('/patient/appointments');
    await patientPage.getByRole('link', { name: 'Rejoindre' }).click();
    await expect(patientPage.getByText('La vidéo est indisponible. Vous pouvez poursuivre par messagerie.')).toBeVisible();
    await expect(patientPage.locator('iframe')).toHaveCount(0);
    await patientPage.getByRole('button', { name: /passer en audio/i }).click();
    await expect.poll(async () => (await prisma.consultation.findUniqueOrThrow({ where: { id: consult.id } })).mode).toBe('AUDIO');
    await patientPage.reload();
    await expect(patientPage.getByText(/\(AUDIO\)/)).toBeVisible();
    await patientPage.getByRole('button', { name: /passer en audio/i }).click();
    await patientPage.waitForURL(/\/patient\/chat/);
    await expect.poll(async () => (await prisma.consultation.findUniqueOrThrow({ where: { id: consult.id } })).mode).toBe('CHAT');
    // Revenir dans une salle déjà en CHAT ne doit pas renvoyer le médecin vers la
    // messagerie : « Terminer » est le seul point de clôture.
    await page.reload();
    await expect(page.getByText('Mode chat (réseau faible)')).toBeVisible();
    await expect(page).toHaveURL(/\/pro\/teleconsult\?id=/);
    await page.getByRole('button', { name: 'Terminer la consultation' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Terminer la consultation' }).click();
    await page.waitForURL(/\/pro\/agenda/);
    expect((await prisma.consultation.findUniqueOrThrow({ where: { id: consult.id } })).status).toBe('COMPLETED');
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } })).status).toBe('COMPLETED');
    await patientPage.goto(`/patient/teleconsult?id=${consult.id}`);
    await expect(patientPage.getByText('La consultation n’est pas active')).toBeVisible();
    await expect(patientPage.locator('iframe')).toHaveCount(0);
  } finally { await patientContext.close(); await prisma.user.deleteMany({ where: { id: { in: ids } } }); await prisma.$disconnect(); }
});

test('un patient tiers reçoit le refus réel et peut ouvrir la messagerie sans iframe Daily', async ({ page }) => {
  const prisma = new PrismaClient(); const ids: string[] = [];
  try {
    const phone = await registerAndLogin(page); ids.push((await prisma.user.findUniqueOrThrow({ where: { phone } })).id);
    const doctor = await prisma.user.create({ data: { phone: uniquePhone(), role: 'MEDECIN', status: 'ACTIVE', doctor: { create: { speciality: 'Généraliste', licenseNumber: `L5-${Date.now()}`, consultFee: 3000, verifiedAt: new Date() } } }, include: { doctor: true } }); ids.push(doctor.id);
    const patient = await prisma.user.create({ data: { phone: '+229017700' + String(Date.now()).slice(-4), role: 'PATIENT', status: 'ACTIVE', patient: { create: {} } }, include: { patient: true } }); ids.push(patient.id);
    const appt = await prisma.appointment.create({ data: { patientId: patient.patient!.id, doctorId: doctor.doctor!.id, type: 'TELECONSULTATION', status: 'CONFIRMED', scheduledAt: new Date() } });
    const consult = await prisma.consultation.create({ data: { appointmentId: appt.id, mode: 'VIDEO', status: 'ACTIVE', startedAt: new Date() } });
    await page.goto(`/patient/teleconsult?id=${consult.id}`);
    await expect(page.getByText('La consultation n’est pas active')).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
    await page.getByRole('button', { name: /ouvrir.*messagerie|ouvrir.*chat/i }).click();
    await page.waitForURL(/\/patient\/chat/);
  } finally { await prisma.user.deleteMany({ where: { id: { in: ids } } }); await prisma.$disconnect(); }
});

// Contrat navigateur du SDK officiel. Seules l'admission et l'iframe fournisseur
// sont simulées ; ce test n'atteste aucun accès API ni média fournisseur réel.
test('contrat SDK simulé : token hors URL/DOM/stockage, no-referrer et destruction à la sortie', async ({ page }) => {
  const prisma = new PrismaClient(); let userId: string | undefined;
  const token = 'eyJhbGciOiJIUzI1NiJ9.eyJ0ZXN0Ijp0cnVlfQ.test_only_signature';
  const consultationId = 'cl5dailycontract0000000001';
  const urls: string[] = [];
  try {
    const phone = await registerAndLogin(page); userId = (await prisma.user.findUniqueOrThrow({ where: { phone } })).id;
    await page.route(`**/api/v1/consultations/${consultationId}/join`, (route) => route.fulfill({ json: {
      roomUrl: 'https://digisante.daily.co/consult-client-contract', token, mode: 'VIDEO', expiresAt: Math.floor(Date.now() / 1000) + 900,
    } }));
    await page.route(/https:\/\/[^/]+\.daily\.co\//, async (route) => {
      urls.push(route.request().url());
      await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body>Daily supplier fixture only<script>
        const parentOrigin = 'http://127.0.0.1:3000';
        function reply(action, callClientId) { parent.postMessage({ what: 'iframe-call-message', from: 'embedded', action, callClientId, participants: {} }, parentOrigin); }
        window.addEventListener('message', (event) => {
          if (event.origin !== parentOrigin || event.data.what !== 'iframe-call-message') return;
          if (event.data.action === 'join-meeting') {
            window.receivedJoinToken = event.data.properties.token;
            reply('joined-meeting', event.data.callClientId);
          }
          if (event.data.action === 'leave-meeting') reply('left-meeting', event.data.callClientId);
        });
        setTimeout(() => reply('loaded'), 0);
        </script></body></html>` });
    });
    await page.goto(`/patient/teleconsult?id=${consultationId}`);
    const frame = page.locator('iframe');
    await expect(frame).toHaveCount(1);
    await expect.poll(() => urls.length).toBeGreaterThan(0);
    await expect.poll(async () => page.frames().find((f) => f.url().startsWith('https://digisante.daily.co/'))?.evaluate(() => (window as unknown as { receivedJoinToken?: string }).receivedJoinToken)).toBe(token);
    expect(urls.join('\n')).not.toContain(token);
    expect(await frame.getAttribute('src')).not.toContain(token);
    await expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
    await expect(frame).toHaveAttribute('allow', 'camera; microphone; fullscreen');
    expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain(token);
    expect(await page.content()).not.toContain(token);
    await page.getByRole('button', { name: 'Raccrocher' }).click();
    await page.waitForURL(/\/patient$/); await expect(page.locator('iframe')).toHaveCount(0);
  } finally { if (userId) await prisma.user.delete({ where: { id: userId } }); await prisma.$disconnect(); }
});
