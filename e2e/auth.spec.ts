import { expect, test } from '@playwright/test';

import { registerAndLogin, uniquePhone } from './helpers';

// Parcours d'entrée : c'est le seul test qui traverse TOUTE la pile
// (Next → Fastify → Prisma/Postgres → Redis → JWT → cookie → routage par rôle).
// S'il casse, plus rien d'autre n'a de sens.
test.describe('inscription et session', () => {
  test('un patient s’inscrit, valide son OTP et arrive dans son espace', async ({ page }) => {
    await registerAndLogin(page, { firstName: 'Sika', lastName: 'Patient' });

    await expect(page).toHaveURL(/\/patient$/);
    // Le rendu réel doit avoir eu lieu, pas seulement la redirection.
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('chaque rôle atterrit dans SON espace (thème cloisonné, §5)', async ({ page }) => {
    await registerAndLogin(page, { role: 'Médecin', firstName: 'Awa', lastName: 'Docteur' });
    await expect(page).toHaveURL(/\/pro$/);
  });

  // La garde de rôle côté navigateur : un patient ne doit pas pouvoir ouvrir
  // l'espace médecin en tapant l'URL. L'API refuse déjà (403), mais l'utilisateur
  // ne doit pas voir la coquille PRO se dessiner.
  test('un patient qui force /pro est renvoyé vers son espace', async ({ page }) => {
    await registerAndLogin(page, { firstName: 'Kossi', lastName: 'Patient' });
    await expect(page).toHaveURL(/\/patient$/);

    await page.goto('/pro');
    await expect(page).toHaveURL(/\/patient$/);
  });

  test('un visiteur non authentifié est renvoyé vers l’accueil', async ({ page }) => {
    await page.goto('/patient/dmp');
    await expect(page).toHaveURL(/\/onboarding$/);
  });

  test('réinscription : réponse générique et OTP, sans révéler l’existence du compte', async ({ page }) => {
    const phone = uniquePhone();
    await registerAndLogin(page, { phone, firstName: 'Yao', lastName: 'Doublon' });
    await expect(page).toHaveURL(/\/patient$/);

    await page.goto('/login');
    await page.getByRole('button', { name: /nouveau compte|new account/i }).click();
    await page.getByLabel(/prénom|first name/i).fill('Yao');
    await page.getByLabel(/^nom$|last name/i).fill('Doublon');
    await page.getByLabel(/téléphone|phone/i).fill(phone);
    await page.getByRole('button', { name: /recevoir le code|send code/i }).click();

    await expect(page.getByText(/si ce numéro|if this number/i)).toBeVisible();
    await expect(page.getByText(/déjà utilisé|already used/i)).toHaveCount(0);
  });
});
