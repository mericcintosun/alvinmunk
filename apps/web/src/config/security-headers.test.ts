// @vitest-environment node
import { describe, expect, it } from 'vitest';
// The real config Next loads — so these assertions run on every `vitest run`, not only in e2e.
import nextConfig from '../../next.config.mjs';

type HeaderRule = { source: string; headers: { key: string; value: string }[] };

async function rules(): Promise<HeaderRule[]> {
  return (await nextConfig.headers!()) as HeaderRule[];
}

/** The value Next sends for `key` on `path`: every matching rule applies, the later one wins. */
async function headerFor(path: string, key: string): Promise<string | undefined> {
  let value: string | undefined;
  for (const rule of await rules()) {
    const re = new RegExp(`^${rule.source.replace(':path*', '.*')}$`);
    if (!re.test(path)) continue;
    const h = rule.headers.find((x) => x.key.toLowerCase() === key.toLowerCase());
    if (h) value = h.value;
  }
  return value;
}

describe('security headers (next.config.mjs)', () => {
  it('drops X-Powered-By', () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it.each(['/', '/app', '/api/attest', '/u/alice'])('sends the baseline headers on %s', async (path) => {
    expect(await headerFor(path, 'X-Frame-Options')).toBe('DENY');
    expect(await headerFor(path, 'X-Content-Type-Options')).toBe('nosniff');
    expect(await headerFor(path, 'Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(await headerFor(path, 'Strict-Transport-Security')).toBe('max-age=63072000; includeSubDomains');
    const pp = await headerFor(path, 'Permissions-Policy');
    expect(pp).toContain('camera=()');
    expect(pp).toContain('publickey-credentials-get=(self)');
    expect(pp).toContain('publickey-credentials-create=(self)');
  });

  it('never sends a Referer from a claim link, which carries its secret in the URL', async () => {
    expect(await headerFor('/claim/42', 'Referrer-Policy')).toBe('no-referrer');
  });
});
