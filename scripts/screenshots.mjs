// Drives the /app onboarding flow and captures the 3 Level-1 screenshots into the repo root.
// Uses the built-in dev wallet (Friendbot-funded testnet keypair) — no extension. The steps and
// selectors follow apps/web/e2e/smoke.spec.ts, the maintained end-to-end check of this flow.
//
// Usage: node scripts/screenshots.mjs   (with the web app running: pnpm --dir apps/web dev)
// PLAYWRIGHT_BASE_URL picks the app to drive; unset, it is the local dev server, the same
// default as apps/web/playwright.config.ts.
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000';

/** A fresh, valid handle per run (as in smoke.spec.ts): a fixed one is taken after its first run. */
function uniqueHandle() {
  return `e2e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 20);
}

const handle = uniqueHandle();
console.log(`driving ${BASE} as @${handle}`);

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
const page = await ctx.newPage();
page.on('console', (m) => m.type() === 'error' && console.log('PAGE ERROR:', m.text()));

try {
  // A fresh context has no stored profile, so /app shows the onboarding form.
  await page.goto(new URL('/app', BASE).href, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  await page.getByRole('heading', { name: /Create your profile/i }).waitFor({ timeout: 120_000 });

  // The heading is server-rendered, so it can show before hydration, and text typed before then
  // never reaches React state. Clear and refill until the availability line (rendered by React)
  // confirms the handle is free, as smoke.spec.ts does.
  const input = page.getByLabel('Handle');
  const deadline = Date.now() + 120_000;
  for (;;) {
    await input.fill('');
    await input.fill(handle);
    try {
      await page.getByText(`@${handle} is free`).waitFor({ timeout: 15_000 });
      break;
    } catch (e) {
      if (Date.now() > deadline) throw e;
    }
  }

  // Creating the profile connects the dev wallet (Friendbot funds it) and sends the genesis and
  // handle-claim transactions to testnet.
  await page.getByRole('button', { name: /Create my profile/i }).click();

  // 3) Successful testnet transaction: the "stamped on-chain" toast over the new profile.
  await page.getByText(/Your profile is live/i).waitFor({ timeout: 240_000 });
  await page.getByRole('link', { name: /View profile/i }).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${ROOT}level1-3-testnet-tx.png` });

  // 1) Wallet connected: the account chip for the new handle, in the mobile nav panel.
  await page.getByRole('button', { name: /Open menu/i }).click();
  const nav = page.locator('#mobile-nav');
  const account = nav.getByRole('button', { name: new RegExp(`@${handle}`) });
  await account.waitFor({ timeout: 30_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${ROOT}level1-1-wallet-connected.png` });

  // 2) Balance displayed: the account menu shows the address and its XLM balance.
  await account.click();
  await nav.getByText(/\d XLM$/).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${ROOT}level1-2-balance.png` });

  console.log('OK: 3 screenshots written to repo root');
} catch (e) {
  console.error('DRIVER FAILED:', e.message);
  await page.screenshot({ path: `${ROOT}level1-debug.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
