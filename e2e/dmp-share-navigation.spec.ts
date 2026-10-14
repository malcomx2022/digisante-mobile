import { expect, test, type Page } from '@playwright/test';

// Contrat navigateur de navigation seulement : session et réponses DMP
// synthétiques. Les droits serveur et la réclamation du consentement restent
// couverts par les suites API ; aucune donnée clinique réelle n'est utilisée.
async function installShareFixture(page: Page) {
  const requests: { patientId: string | null; token: string | undefined }[] = [];
  const user = { id: 'doctor-share-navigation-fixture', role: 'MEDECIN', status: 'ACTIVE', lang: 'FR', phone: '', email: null };
  await page.addInitScript((cached) => {
    localStorage.setItem('digisante.session', JSON.stringify(cached));
    localStorage.setItem('digisante.lang', 'FR');
  }, user);
  await page.route('**/api/v1/auth/refresh', (route) => route.fulfill({ json: { user, accessToken: 'share-navigation-test-only' } }));
  await page.route('**/api/v1/dmp/records?*', async (route) => {
    const patientId = new URL(route.request().url()).searchParams.get('patientId');
    const token = route.request().headers()['x-share-token'];
    requests.push({ patientId, token });
    if (!patientId || token !== `share-${patientId}` && token !== `renewed-${patientId}`) {
      await route.fulfill({ status: 403, json: { code: 'NO_CONSENT', message: 'Partage refusé' } });
      return;
    }
    await route.fulfill({ json: [{
      id: `record-${patientId}`, type: 'DIAGNOSIS', title: `Dossier synthétique ${patientId} ${token}`,
      authorId: user.id, authorRole: user.role, createdAt: '2026-10-01T10:00:00.000Z',
    }] });
  });
  return requests;
}

test('coller un partage ouvre son dossier sans ressaisir le jeton, y compris après retour arrière', async ({ page }) => {
  const requests = await installShareFixture(page);
  await page.goto('/pro/patient');
  const paste = page.getByRole('textbox', { name: 'Coller le lien de partage du patient' });
  await paste.fill('http://127.0.0.1:3000/pro/patient?patientId=patient-a&token=share-patient-a');
  await page.getByRole('button', { name: 'Ouvrir le dossier partagé' }).click();
  await expect(page.getByText('Dossier synthétique patient-a share-patient-a', { exact: true })).toBeVisible();
  expect(requests).toEqual([{ patientId: 'patient-a', token: 'share-patient-a' }]);
  await expect(page.getByRole('textbox', { name: 'Jeton de partage', exact: true })).toHaveCount(0);

  await page.goBack();
  await expect(paste).toHaveValue('');
  await paste.fill('http://127.0.0.1:3000/pro/patient?patientId=patient-b&token=share-patient-b');
  await page.getByRole('button', { name: 'Ouvrir le dossier partagé' }).click();
  await expect(page.getByText('Dossier synthétique patient-b share-patient-b', { exact: true })).toBeVisible();
  await expect(page.getByText('Dossier synthétique patient-a share-patient-a', { exact: true })).toHaveCount(0);
  expect(requests.at(-1)).toEqual({ patientId: 'patient-b', token: 'share-patient-b' });
});

test('les changements de patient ou de jeton dans la même page effacent les saisies et le partage précédent', async ({ page }) => {
  const requests = await installShareFixture(page);
  await page.goto('/pro/patient?patientId=patient-a');
  const tokenInput = page.getByRole('textbox', { name: 'Jeton de partage', exact: true });
  await tokenInput.fill('saisie-patient-a');

  // Navigation native prise en charge par Next, sans recharger le document.
  await page.evaluate(() => window.history.pushState(null, '', '/pro/patient?patientId=patient-b'));
  await expect(tokenInput).toHaveValue('');
  expect(requests).toHaveLength(0);
  await tokenInput.fill('share-patient-b');
  await page.getByRole('button', { name: 'Accéder au dossier' }).click();
  await expect(page.getByText('Dossier synthétique patient-b share-patient-b', { exact: true })).toBeVisible();

  await page.evaluate(() => window.history.pushState(null, '', '/pro/patient?patientId=patient-b&token=renewed-patient-b'));
  await expect(page.getByText('Dossier synthétique patient-b renewed-patient-b', { exact: true })).toBeVisible();
  expect(requests.at(-1)).toEqual({ patientId: 'patient-b', token: 'renewed-patient-b' });

  await page.evaluate(() => window.history.pushState(null, '', '/pro/patient?patientId=patient-c'));
  await expect(tokenInput).toHaveValue('');
  await expect(page.getByText(/Dossier synthétique/)).toHaveCount(0);
  expect(requests).toHaveLength(2);
  await page.getByRole('link', { name: 'Patients', exact: true }).last().click();
  await expect(page.getByRole('textbox', { name: 'Coller le lien de partage du patient' })).toHaveValue('');
});
