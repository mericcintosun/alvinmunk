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

  // The onboarding form is a client component, so the deep link arrives as inert server
  // markup first. Typing into its controlled input before React hydrates leaves the text in
  // the DOM but not in React state — the create-profile call then reads an empty handle and
  // silently bails. Clear before filling: once the field already holds the value, a retried
  // `fill` is a no-op and React never sees an input event. The status line only fills in
  // after the hydrated availability check answers, which proves we are interactive.
  await expect(async () => {
    await page.getByLabel('Handle').fill('');
    await page.getByLabel('Handle').fill(handle);
    await expect(page.locator('#handle-status')).not.toBeEmpty({ timeout: 5_000 });
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

  // New cards carry the claim key's seed (`#k=`); cards minted before it existed carry the
  // legacy plain secret (`#s=`). Both are valid share links.
  const link = page
    .locator('code')
    .filter({ hasText: /\/claim\/\d+#[ks]=/ })
    .first();

  await expect(link).toBeVisible({ timeout: 60_000 });
  await expect(link).toContainText(/\/claim\/\d+#[ks]=[0-9a-f]{64}/i);
  await expect(page.getByRole('button', { name: /Copy link/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /View profile/i })).toBeVisible({
    timeout: 60_000,
  });
});
