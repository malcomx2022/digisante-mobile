import { expect, test } from '@playwright/test';

import { registerAndLogin } from './helpers';

/**
 * Le triage est la fonction signature du produit : une orientation OMS/PCIME
 * qui doit fonctionner en zone blanche, réseau totalement coupé (§3 offline-first).
 *
 * C'est le seul niveau où cette promesse est vérifiable : un test unitaire de
 * `evaluateTriage` prouve que l'arbre décisionnel est juste, pas que l'écran
 * s'ouvre et répond sans réseau. Ici on coupe vraiment la connexion.
 */
test.describe('triage hors-ligne', () => {
  test('un signe ROUGE oriente vers l’URGENCE, réseau coupé', async ({ page, context }) => {
    await registerAndLogin(page, { firstName: 'Ama', lastName: 'Triage' });
    await expect(page).toHaveURL(/\/patient$/);

    // Charger la page AVANT la coupure : c'est le scénario réel (l'app est
    // installée/visitée, puis le réseau disparaît).
    await page.goto('/patient/triage');
    await expect(page.getByRole('heading', { name: /quel est le problème/i })).toBeVisible();

    // ── Zone blanche ──
    await context.setOffline(true);

    await page.getByRole('button', { name: /fièvre/i }).click();

    // La 1ʳᵉ question du flux FEVER est le signe ROUGE « convulsions »
    // (`TRIAGE_FLOWS`) : on l'affirme pour que ce test échoue si l'ordre change,
    // plutôt que de cliquer à l'aveugle sur le premier « Oui » venu.
    await expect(page.getByText(/convulsions/i)).toBeVisible();
    await page.getByRole('button', { name: /^oui$/i }).first().click();

    // Un seul signe ROUGE suffit : biais conservateur assumé.
    await page.getByRole('button', { name: /voir le conseil/i }).click();

    await expect(page.getByText(/urgence — cherchez de l’aide/i)).toBeVisible();
    // L'orientation doit proposer l'action de secours, hors-ligne comprise.
    await expect(page.getByRole('button', { name: /alerte sos/i })).toBeVisible();
  });

  test('sans aucun signe de danger, l’orientation reste à domicile', async ({ page, context }) => {
    await registerAndLogin(page, { firstName: 'Kofi', lastName: 'Triage' });
    await page.goto('/patient/triage');
    await expect(page.getByRole('heading', { name: /quel est le problème/i })).toBeVisible();

    await context.setOffline(true);
    await page.getByRole('button', { name: /diarrhée/i }).click();

    // Répondre « Non » à tout : aucun drapeau levé.
    const noButtons = page.getByRole('button', { name: /^non$/i });
    const count = await noButtons.count();
    for (let i = 0; i < count; i += 1) await noButtons.nth(i).click();

    await page.getByRole('button', { name: /voir le conseil/i }).click();
    await expect(page.getByText(/surveillez à la maison/i)).toBeVisible();
  });

  test('l’avertissement « orientation, pas un diagnostic » reste affiché', async ({ page }) => {
    await registerAndLogin(page, { firstName: 'Sena', lastName: 'Triage' });
    await page.goto('/patient/triage');

    // Exigence de sécurité clinique (docs/VALIDATION_Clinique.md) : la mention ne
    // doit jamais disparaître de l'écran, avant comme après l'orientation.
    await expect(page.getByText(/orientation, pas un diagnostic/i).first()).toBeVisible();
  });
});
