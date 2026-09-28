import { describe, expect, it, vi } from 'vitest';
import { isConfiguredAdmin } from './admin';

describe('isConfiguredAdmin', () => {
  it('only accepts the configured wallet address', () => {
    vi.stubEnv('NEXT_PUBLIC_ADMIN_ADDRESS', 'GADMIN');
    expect(isConfiguredAdmin('GADMIN')).toBe(true);
    expect(isConfiguredAdmin('GOTHER')).toBe(false);
    vi.unstubAllEnvs();
  });

  it('fails closed when the public admin configuration is absent or empty', () => {
    vi.stubEnv('NEXT_PUBLIC_ADMIN_ADDRESS', '');
    expect(isConfiguredAdmin('GADMIN')).toBe(false);
    vi.unstubAllEnvs();
  });
});
