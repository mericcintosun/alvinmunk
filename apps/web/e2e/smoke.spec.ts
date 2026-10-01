import { expect, test } from '@playwright/test';

function uniqueHandle() {
  return `e2e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 20);
}

test('dev wallet onboarding creates a profile and mints a shareable vouch', async ({ page }) => {
  const handle = uniqueHandle();
  const note = `e2e ${Date.now().toString(36)}`;

  test.setTimeout(300_000);

  await page.goto('/app', { waitUntil: 'domcontentloaded', timeout: 180_000 });

  await expect(page.getByRole('heading', { name: /Create your profile/i })).toBeVisible({
    timeout: 120_000,
  });

  // The heading is server-rendered, so it can show before hydration. Text typed before then never
  // reaches React state, and re-typing the same value fires no onChange (React's value tracker
  // already holds it). Clear and refill until the availability line — rendered by React — shows.
  const handleInput = page.getByLabel('Handle');
  await expect(async () => {
    await handleInput.fill('');
    await handleInput.fill(handle);
    await expect(page.getByText(`@${handle} is free`)).toBeVisible({ timeout: 15_000 });
  }).toPass({ timeout: 120_000 });
  await page.getByRole('button', { name: /Create my profile/i }).click();

  await expect(page.getByRole('link', { name: /View profile/i })).toBeVisible({
    timeout: 240_000,
  });
  await expect(page).toHaveURL(/\/app(?:\/)?$/, { timeout: 180_000 });

  await page.goto('/app/vouch', { waitUntil: 'domcontentloaded', timeout: 180_000 });

  await expect(page.getByRole('heading', { name: /Light someone's star/i })).toBeVisible({
    timeout: 120_000,
  });

  await page.getByPlaceholder('unblocked me at 2am').fill(note);
  await page.getByRole('button', { name: /Light their star/i }).click();

  await expect(page.getByText(/Their star is lit — now send it\./i)).toBeVisible({
    timeout: 180_000,
  });

  const link = page
    .locator('code')
    .filter({ hasText: /\/claim\/\d+#k=/ })
    .first();

  await expect(link).toBeVisible({ timeout: 60_000 });
  await expect(link).toContainText(/\/claim\/\d+#k=[0-9a-f]+/i);
  await expect(page.getByRole('button', { name: /Copy link/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /View profile/i })).toBeVisible({
    timeout: 60_000,
  });
});
