import { describe, it, expect, afterEach } from 'vitest';
import { isPasskeyConfigured } from './wallet';

describe('isPasskeyConfigured', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_WALLET_WASM_HASH;
    delete process.env.NEXT_PUBLIC_LAUNCHTUBE_URL;
  });

  it('is false when infra env is unset (falls back to dev wallet)', () => {
    expect(isPasskeyConfigured()).toBe(false);
  });

  it('is true only when BOTH wasm hash and launchtube are set', () => {
    process.env.NEXT_PUBLIC_WALLET_WASM_HASH = 'deadbeef';
    expect(isPasskeyConfigured()).toBe(false); // still missing launchtube
    process.env.NEXT_PUBLIC_LAUNCHTUBE_URL = 'https://launchtube.example';
    expect(isPasskeyConfigured()).toBe(true);
  });
});
