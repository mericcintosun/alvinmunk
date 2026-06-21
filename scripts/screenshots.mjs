// Drives the White-belt onboarding flow and captures the 3 Level-1 screenshots.
// Uses the built-in dev wallet (Friendbot-funded testnet keypair) — no extension.
import { chromium } from 'playwright';

const ROOT = new URL('..', import.meta.url).pathname;
const BASE = 'http://localhost:3000';

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
const page = await ctx.newPage();
page.on('console', (m) => m.type() === 'error' && console.log('PAGE ERROR:', m.text()));

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });

  // 1) Connect via the dev wallet (passkey infra unset -> Friendbot-funded keypair)
  await page.getByRole('button', { name: /Continue with Face ID/i }).click();

  // Wait for the handle step — proves the wallet connected and balance loaded.
  await page.getByPlaceholder('pick a handle').waitFor({ timeout: 45000 });
  await page.getByText(/funded:/i).waitFor({ timeout: 45000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${ROOT}level1-1-wallet-connected.png` });

  // 2) Balance element close-up
  const bal = page.getByText(/funded:/i).first();
  await bal.screenshot({ path: `${ROOT}level1-2-balance.png` });

  // 3) Enter a handle and mint the Genesis stamp (a real testnet transaction)
  await page.getByPlaceholder('pick a handle').fill('alvinmunk');
  await page.getByRole('button', { name: /Mint my Genesis Stamp/i }).click();

  // Wait for the success state with the explorer link.
  await page.getByText(/on-chain/i).waitFor({ timeout: 60000 });
  await page.getByRole('link', { name: /view your first transaction/i }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${ROOT}level1-3-testnet-tx.png` });

  console.log('OK: 3 screenshots written to repo root');
} catch (e) {
  console.error('DRIVER FAILED:', e.message);
  await page.screenshot({ path: `${ROOT}level1-debug.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
