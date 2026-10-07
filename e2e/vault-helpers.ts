import { expect, type Page } from '@playwright/test';

export const VAULT_PHRASE = 'phrase synthétique navigateur L4';
export async function enableVault(page: Page) {
  await page.goto('/patient/offline');
  await page.getByLabel('J’active le coffre sur cet appareil et je garde ma phrase secrète.').check();
  await page.getByLabel('Phrase secrète locale', { exact: true }).fill(VAULT_PHRASE);
  await page.getByLabel('Confirmer la phrase secrète', { exact: true }).fill(VAULT_PHRASE);
  await page.getByRole('button', { name: 'Activer le coffre', exact: true }).click();
  await expect(page.getByText('Coffre déverrouillé', { exact: true })).toBeVisible();
}
export async function unlockVault(page: Page) {
  await expect(page.getByText('Coffre verrouillé', { exact: true })).toBeVisible();
  await page.getByLabel('Phrase secrète locale', { exact: true }).fill(VAULT_PHRASE);
  await page.getByRole('button', { name: 'Déverrouiller le coffre', exact: true }).click();
  await expect(page.getByText('Coffre déverrouillé', { exact: true })).toBeVisible();
}
