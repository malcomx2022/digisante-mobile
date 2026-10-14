import { expect, test, type Page } from '@playwright/test';

// Contrats UI simulés, sans message envoyé à un patient réel ni effet en base.
async function installDoctorSession(page: Page) {
  const user = { id: 'conversation-privacy-fixture', role: 'MEDECIN', status: 'ACTIVE', lang: 'FR', phone: '', email: null };
  await page.addInitScript((cached) => {
    localStorage.setItem('digisante.session', JSON.stringify(cached));
    localStorage.setItem('digisante.lang', 'FR');
  }, user);
  await page.route('**/api/v1/auth/refresh', (route) => route.fulfill({ json: { user, accessToken: 'conversation-privacy-test-only' } }));
  await page.routeWebSocket('**/api/v1/chat/ws?*', () => {});
}

const THREAD_A = 'cchataprivacytest00000001';
const THREAD_B = 'cchatbprivacytest00000001';
const threads = [
  { id: THREAD_A, counterpart: { role: 'PATIENT', name: 'Patient A synthétique' }, unreadCount: 0, lastMessageAt: null },
  { id: THREAD_B, counterpart: { role: 'PATIENT', name: 'Patient B synthétique' }, unreadCount: 0, lastMessageAt: null },
];
const message = (id: string, body: string) => ({ id, body, mine: false, readAt: null, createdAt: '2026-10-01T10:00:00.000Z' });

test('changer de conversation efface immédiatement les messages et le brouillon A, avant la réponse B', async ({ page }) => {
  await installDoctorSession(page);
  let releaseB!: () => void;
  const responseB = new Promise<void>((resolve) => { releaseB = resolve; });
  const sent: { threadId: string; body: string }[] = [];
  await page.route('**/api/v1/chat/threads', (route) => route.fulfill({ json: threads }));
  await page.route('**/api/v1/chat/threads/*/read', (route) => route.fulfill({ json: { updated: 0 } }));
  await page.route('**/api/v1/chat/threads/*/messages', async (route) => {
    const threadId = new URL(route.request().url()).pathname.split('/').at(-2)!;
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON().body as string;
      sent.push({ threadId, body });
      await route.fulfill({ json: message('sent-browser-fixture', body) });
      return;
    }
    if (threadId === THREAD_B) await responseB;
    await route.fulfill({ json: [message(`message-${threadId}`, threadId === THREAD_A ? 'Contenu privé A synthétique' : 'Contenu privé B synthétique')] });
  });
  try {
    await page.goto('/pro/messages');
    await page.getByRole('button', { name: 'Patient A synthétique', exact: true }).click();
    await expect(page.getByText('Contenu privé A synthétique', { exact: true })).toBeVisible();
    await page.getByPlaceholder('Votre message…').fill('Brouillon réservé à A');
    await page.getByRole('button', { name: 'Retour', exact: true }).click();
    await page.getByRole('button', { name: 'Patient B synthétique', exact: true }).click();
    await expect(page.getByPlaceholder('Votre message…')).toHaveValue('');
    await expect(page.getByText('Contenu privé A synthétique', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Envoyer', exact: true }).click();
    expect(sent).toHaveLength(0);
    releaseB();
    await expect(page.getByText('Contenu privé B synthétique', { exact: true })).toBeVisible();
    await page.getByPlaceholder('Votre message…').fill('Message choisi pour B');
    await page.getByRole('button', { name: 'Envoyer', exact: true }).click();
    await expect.poll(() => sent).toEqual([{ threadId: THREAD_B, body: 'Message choisi pour B' }]);
  } finally { releaseB(); }
});

test('un changement du destinataire dans l’URL ouvre le nouveau fil sans conserver le brouillon', async ({ page }) => {
  await installDoctorSession(page);
  const opened: string[] = [];
  await page.route('**/api/v1/chat/threads', async (route) => {
    if (route.request().method() === 'POST') {
      const counterpartId = route.request().postDataJSON().counterpartId as string;
      opened.push(counterpartId);
      await route.fulfill({ json: counterpartId === 'patient-a' ? threads[0] : threads[1] });
    } else await route.fulfill({ json: threads });
  });
  await page.route('**/api/v1/chat/threads/*/read', (route) => route.fulfill({ json: { updated: 0 } }));
  await page.route('**/api/v1/chat/threads/*/messages', (route) => route.fulfill({ json: [message('query-message', route.request().url().includes(THREAD_A) ? 'Dossier A synthétique' : 'Dossier B synthétique')] }));
  await page.goto('/pro/messages?patient=patient-a');
  await expect(page.getByText('Dossier A synthétique', { exact: true })).toBeVisible();
  await page.getByPlaceholder('Votre message…').fill('Brouillon du patient A');
  await page.evaluate(() => window.history.pushState(null, '', '/pro/messages?patient=patient-b'));
  await expect(page.getByText('Dossier B synthétique', { exact: true })).toBeVisible();
  await expect(page.getByText('Dossier A synthétique', { exact: true })).toHaveCount(0);
  await expect(page.getByPlaceholder('Votre message…')).toHaveValue('');
  expect(opened).toEqual(['patient-a', 'patient-b']);
});

test('un envoi en ligne reste annoncé en attente lors du retour queued du client', async ({ page }) => {
  await installDoctorSession(page);
  let releaseSend!: () => void;
  let markSending!: () => void;
  const sending = new Promise<void>((resolve) => { markSending = resolve; });
  const sendGate = new Promise<void>((resolve) => { releaseSend = resolve; });
  await page.route('**/api/v1/chat/threads', (route) => route.fulfill({ json: threads }));
  await page.route('**/api/v1/chat/threads/*/read', (route) => route.fulfill({ json: { updated: 0 } }));
  await page.route('**/api/v1/chat/threads/*/messages', async (route) => {
    if (route.request().method() === 'POST') {
      markSending();
      await sendGate;
      await route.fulfill({ json: { queued: true } });
    } else await route.fulfill({ json: [] });
  });
  try {
    await page.goto(`/pro/messages?thread=${THREAD_A}`);
    await page.getByPlaceholder('Votre message…').fill('Message synthétique en attente');
    await page.getByRole('button', { name: 'Envoyer', exact: true }).click();
    await sending;
    await expect(page.getByText('En attente d’envoi…', { exact: true })).toBeVisible();
    const response = page.waitForResponse((reply) => reply.url().endsWith(`/chat/threads/${THREAD_A}/messages`) && reply.request().method() === 'POST');
    releaseSend();
    await response;
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Message synthétique en attente', { exact: true })).toBeVisible();
    await expect(page.getByText('En attente d’envoi…', { exact: true })).toBeVisible();
  } finally { releaseSend(); }
});

test('une orientation pour B ne réutilise ni le motif ni le confrère saisis pour A', async ({ page }) => {
  await installDoctorSession(page);
  const sent: Record<string, unknown>[] = [];
  await page.route('**/api/v1/referrals', async (route) => {
    if (route.request().method() === 'POST') {
      sent.push(route.request().postDataJSON());
      await route.fulfill({ json: { id: 'referral-browser-fixture', status: 'PENDING' } });
    } else await route.fulfill({ json: [] });
  });
  await page.route('**/api/v1/professionals?*', (route) => route.fulfill({ json: { data: [{ id: 'doctor-recipient-fixture', speciality: 'Généraliste', consultFee: 3000, isVerified: true, profile: { firstName: 'Confrère', lastName: 'Synthétique', spokenLangs: ['FR'], avatarUrl: null }, rating: { average: null, count: 0 } }], total: 1 } }));
  await page.goto('/pro/referrals?patientId=patient-a');
  await page.getByRole('textbox', { name: 'Confrère destinataire', exact: true }).fill('Confrère');
  await page.getByRole('button', { name: 'Confrère Synthétique · Généraliste', exact: true }).click();
  await page.getByRole('textbox', { name: 'Motif de l’orientation', exact: true }).fill('Motif confidentiel du patient A');
  await expect(page.getByRole('button', { name: 'Envoyer l’orientation', exact: true })).toBeEnabled();
  await page.evaluate(() => window.history.pushState(null, '', '/pro/referrals?patientId=patient-b'));
  await expect(page.getByRole('textbox', { name: 'Confrère destinataire', exact: true })).toHaveValue('');
  await expect(page.getByRole('textbox', { name: 'Motif de l’orientation', exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Envoyer l’orientation', exact: true })).toBeDisabled();
  expect(sent).toHaveLength(0);
});
