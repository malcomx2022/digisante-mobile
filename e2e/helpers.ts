import { expect, type Page } from '@playwright/test';

/**
 * Numéro béninois unique par scénario. Les e2e écrivent dans une vraie base :
 * réutiliser un numéro ferait échouer l'inscription en 409 au second passage
 * (et les relances CI rejouent le même test).
 */
export function uniquePhone(): string {
  // Format ARCEP : +229 01 XX XX XX XX. On tire les 8 derniers chiffres.
  const n = String(Date.now()).slice(-8);
  return `+22901${n}`;
}

/**
 * Inscrit un utilisateur via l'interface réelle et valide son OTP.
 *
 * Le code arrive par l'indice « (dev: 123456) » affiché par l'écran de connexion,
 * alimenté par `devCode` que l'API n'expose QUE hors production
 * (`auth.service.ts`). Aucun SMS Twilio n'est nécessaire.
 */
export async function registerAndLogin(
  page: Page,
  opts: { role?: string; firstName?: string; lastName?: string; phone?: string } = {},
): Promise<string> {
  const phone = opts.phone ?? uniquePhone();

  await page.goto('/login');
  await page.getByRole('button', { name: /nouveau compte|new account/i }).click();

  if (opts.role) {
    await page.getByRole('button', { name: opts.role, exact: true }).click();
  }

  await page.getByLabel(/prénom|first name/i).fill(opts.firstName ?? 'Test');
  await page.getByLabel(/^nom$|last name/i).fill(opts.lastName ?? 'E2E');

  // Le formulaire est conditionnel au rôle : un médecin sans spécialité ni
  // numéro d'ordre est refusé côté client avant tout appel réseau.
  if (opts.role === 'Médecin') {
    await page.getByLabel(/spécialité/i).fill('Cardiologie');
    await page.getByLabel(/numéro d’ordre|numéro d'ordre/i).fill(`BJ-MED-${phone.slice(-5)}`);
  }

  if (opts.role === 'Laboratoire' || opts.role === 'Pharmacie') {
    await page.getByLabel(/nom de l’établissement|establishment name/i).fill('Structure E2E');
    await page.getByLabel(/adresse|address/i).fill('Cotonou');
  }

  await page.getByLabel(/téléphone|phone/i).fill(phone);
  await page.getByRole('button', { name: /recevoir le code|send code/i }).click();

  // L'indice porte le code ; sans lui le scénario ne peut pas avancer.
  const hint = page.getByText(/dev:\s*\d{6}/);
  await expect(hint).toBeVisible();
  const code = (await hint.textContent())?.match(/dev:\s*(\d{6})/)?.[1];
  expect(code, 'devCode absent — l’API tourne-t-elle avec NODE_ENV != production ?').toBeTruthy();

  await page.getByLabel(/code/i).fill(code!);
  await page.getByRole('button', { name: /vérifier|verify/i }).click();

  // Attendre l'arrivée effective dans un espace : sans ça, un `page.goto()`
  // enchaîné part avant la fin de l'authentification et retombe sur /onboarding.
  await page.waitForURL(/\/(patient|pro|pharmacie|labo|diaspora|asc|admin)(\/|$)/);

  return phone;
}
