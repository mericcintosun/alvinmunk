/**
 * Security-headers smoke test — closes #178.
 *
 * Checks that every response from "/" carries the required HTTP security headers
 * and that the X-Powered-By header has been suppressed.
 *
 * Uses a plain `fetch` via `request` (Playwright's API request context) so the
 * check is purely at the HTTP layer — no UI interaction required.
 */
import { expect, test } from '@playwright/test';

test('security headers are present on /', async ({ request, baseURL }) => {
  const response = await request.get('/');

  // The server must respond successfully.
  expect(response.status()).toBeLessThan(500);

  const h = (name: string) => response.headers()[name.toLowerCase()] ?? '';

  // --- Anti-clickjacking ---
  expect(h('X-Frame-Options')).toBe('DENY');

  // --- MIME-type sniffing protection ---
  expect(h('X-Content-Type-Options')).toBe('nosniff');

  // --- Referrer policy (baseline — /claim/* has its own stricter rule) ---
  expect(h('Referrer-Policy')).toBe('strict-origin-when-cross-origin');

  // --- HSTS ---
  expect(h('Strict-Transport-Security')).toContain('max-age=63072000');
  expect(h('Strict-Transport-Security')).toContain('includeSubDomains');

  // --- Permissions policy (passkey origins allowed; everything else denied) ---
  const pp = h('Permissions-Policy');
  expect(pp).toContain('camera=()');
  expect(pp).toContain('microphone=()');
  expect(pp).toContain('geolocation=()');
  expect(pp).toContain('publickey-credentials-get=(self)');
  expect(pp).toContain('publickey-credentials-create=(self)');

  // --- X-Powered-By must be absent (poweredByHeader: false) ---
  expect(h('X-Powered-By')).toBe('');
});

test('security headers are present on /api/ready', async ({ request }) => {
  const response = await request.get('/api/ready');

  // API routes must also carry the headers.
  expect(response.status()).toBeLessThan(500);

  const h = (name: string) => response.headers()[name.toLowerCase()] ?? '';

  expect(h('X-Frame-Options')).toBe('DENY');
  expect(h('X-Content-Type-Options')).toBe('nosniff');
  expect(h('X-Powered-By')).toBe('');
});

test('/claim/* uses no-referrer policy', async ({ request }) => {
  // The /claim/:path* route overrides the baseline Referrer-Policy with no-referrer.
  // We check with a path that Next will handle (even a 404 still sends headers).
  const response = await request.get('/claim/test-secret-path');

  const referrerPolicy = response.headers()['referrer-policy'] ?? '';
  // The more-restrictive rule must win.
  expect(referrerPolicy).toBe('no-referrer');
});
