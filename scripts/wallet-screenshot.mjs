// Captures the Level-2 "wallet options available" screenshot: opens the /wallet demo and
// clicks Connect, which launches the real Stellar Wallets Kit picker (Freighter, xBull,
// Albedo, Rabet, LOBSTR, Hana). Writes level2-wallet-options.png to the repo root.
import { chromium } from 'playwright';

const ROOT = new URL('..', import.meta.url).pathname;
const BASE = 'http://localhost:3000';

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('console', (m) => m.type() === 'error' && console.log('PAGE ERROR:', m.text()));

try {
  await page.goto(`${BASE}/wallet`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Connect a Wallet/i }).click();

  // SWK renders its modal as a web component; wait for a known wallet label to appear.
  await page.getByText(/Freighter/i).first().waitFor({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${ROOT}level2-wallet-options.png` });
  console.log('OK: level2-wallet-options.png written to repo root');
} catch (e) {
  console.error('DRIVER FAILED:', e.message);
  await page.screenshot({ path: `${ROOT}level2-debug.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
