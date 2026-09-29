import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSiteUrl } from './site-url';

const KEYS = ['NEXT_PUBLIC_SITE_URL', 'VERCEL_ENV', 'VERCEL_URL', 'VERCEL_PROJECT_PRODUCTION_URL'] as const;

/** Set exactly these site-URL env vars; every other one in KEYS is cleared. */
function env(vars: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const key of KEYS) vi.stubEnv(key, vars[key] ?? '');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('getSiteUrl', () => {
  it('prefers NEXT_PUBLIC_SITE_URL over every Vercel value', () => {
    env({
      NEXT_PUBLIC_SITE_URL: 'https://fork.example.com',
      VERCEL_ENV: 'production',
      VERCEL_URL: 'fork-abc123.vercel.app',
      VERCEL_PROJECT_PRODUCTION_URL: 'alvinmunk.vercel.app',
    });
    expect(getSiteUrl().href).toBe('https://fork.example.com/');
  });

  it('keeps only the origin, and assumes https for a bare host', () => {
    env({ NEXT_PUBLIC_SITE_URL: ' https://fork.example.com/some/path?x=1 ' });
    expect(getSiteUrl().href).toBe('https://fork.example.com/');
    env({ NEXT_PUBLIC_SITE_URL: 'fork.example.com' });
    expect(getSiteUrl().href).toBe('https://fork.example.com/');
    env({ NEXT_PUBLIC_SITE_URL: 'http://localhost:4000' });
    expect(getSiteUrl().href).toBe('http://localhost:4000/');
  });

  it('a Vercel production build uses the production domain, not the deployment host', () => {
    env({
      VERCEL_ENV: 'production',
      VERCEL_URL: 'alvinmunk-abc123-team.vercel.app',
      VERCEL_PROJECT_PRODUCTION_URL: 'alvinmunk.vercel.app',
    });
    expect(getSiteUrl().href).toBe('https://alvinmunk.vercel.app/');
  });

  it('a Vercel preview uses its own host', () => {
    env({
      VERCEL_ENV: 'preview',
      VERCEL_URL: 'alvinmunk-git-feature-team.vercel.app',
      VERCEL_PROJECT_PRODUCTION_URL: 'alvinmunk.vercel.app',
    });
    expect(getSiteUrl().href).toBe('https://alvinmunk-git-feature-team.vercel.app/');
  });

  it('uses localhost when no env is set', () => {
    env({});
    expect(getSiteUrl().href).toBe('http://localhost:3000/');
  });

  it('skips an unusable NEXT_PUBLIC_SITE_URL with a warning instead of throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const bad of ['https://', 'ftp://fork.example.com', 'not a url']) {
      env({ NEXT_PUBLIC_SITE_URL: bad, VERCEL_URL: 'preview.vercel.app' });
      expect(getSiteUrl().href).toBe('https://preview.vercel.app/');
    }
    expect(warn).toHaveBeenCalledTimes(3);
  });
});
