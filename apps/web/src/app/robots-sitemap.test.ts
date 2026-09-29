import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import robots from './robots';
import sitemap from './sitemap';

const PREVIEW = 'https://alvinmunk-git-feature.vercel.app';

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('VERCEL_URL', 'alvinmunk-git-feature.vercel.app');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function disallowed(): string[] {
  const { rules } = robots();
  const all = Array.isArray(rules) ? rules : [rules];
  const star = all.find((r) => r.userAgent === '*');
  const d = star?.disallow ?? [];
  return Array.isArray(d) ? d : [d];
}

/** robots.txt prefix matching: is `path` blocked for every crawler? */
const isBlocked = (path: string) => disallowed().some((prefix) => path.startsWith(prefix));

describe('robots.txt', () => {
  it('keeps crawlers out of the dashboard, the API and the wallet demo', () => {
    for (const path of ['/app', '/app/vouch', '/api/health', '/wallet']) {
      expect(isBlocked(path), path).toBe(true);
    }
  });

  it('lets crawlers and link-preview bots fetch /claim so they see its noindex', () => {
    expect(isBlocked('/claim/7')).toBe(false);
  });

  it('links the sitemap on this deployment’s own host', () => {
    expect(robots().sitemap).toBe(`${PREVIEW}/sitemap.xml`);
  });
});

describe('sitemap.xml', () => {
  it('lists the public static routes on this deployment’s own host', () => {
    expect(sitemap().map((e) => e.url)).toEqual([
      `${PREVIEW}/`,
      `${PREVIEW}/how-it-works`,
      `${PREVIEW}/leaderboard`,
      `${PREVIEW}/stats`,
    ]);
  });

  it('lists nothing that is noindex or blocked by robots.txt', () => {
    for (const { url } of sitemap()) {
      const path = new URL(url).pathname;
      expect(isBlocked(path), path).toBe(false);
      expect(path.startsWith('/claim'), path).toBe(false);
    }
  });
});
