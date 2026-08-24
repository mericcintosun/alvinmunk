import { describe, it, expect, afterEach, vi } from 'vitest';
import { isPasskeyConfigured } from './wallet';



describe('isPasskeyConfigured', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_PASSKEY_WALLET_WASM_HASH;
  });

  it('is false when the wallet WASM hash is unset (falls back to dev wallet)', () => {
    expect(isPasskeyConfigured()).toBe(false);
  });

  it('is true once the passkey wallet WASM hash is set', () => {
    process.env.NEXT_PUBLIC_PASSKEY_WALLET_WASM_HASH = 'ecd990f0';
    expect(isPasskeyConfigured()).toBe(true);
  });
});
