import { describe, it, expect, afterEach } from 'vitest';
import { isPasskeyConfigured } from './wallet';

describe('isPasskeyConfigured', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_WALLET_WASM_HASH;
    delete process.env.NEXT_PUBLIC_LAUNCHTUBE_URL;
    delete process.env.NEXT_PUBLIC_PASSKEY_FACTORY_ID;
  });

  it('is false when infra env is unset (falls back to dev wallet)', () => {
    expect(isPasskeyConfigured()).toBe(false);
  });

  it('requires ALL THREE infra vars — half-set stays on the dev wallet', () => {
    process.env.NEXT_PUBLIC_WALLET_WASM_HASH = 'deadbeef';
    expect(isPasskeyConfigured()).toBe(false); // missing launchtube + factory
    process.env.NEXT_PUBLIC_LAUNCHTUBE_URL = 'https://launchtube.example';
    expect(isPasskeyConfigured()).toBe(false); // still missing factory id
    process.env.NEXT_PUBLIC_PASSKEY_FACTORY_ID = 'CFACTORY';
    expect(isPasskeyConfigured()).toBe(true);
  });
});
