import { describe, it, expect, afterEach } from 'vitest';
import { isPasskeyConfigured } from './wallet';

describe('isPasskeyConfigured', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_PASSKEY_WALLET_WASM_HASH;
  });

  it('is false when the wallet WASM hash is unset (falls back to dev wallet)', () => {
    expect(isPasskeyConfigured()).toBe(false);
  });

  it('is true once the passkey wallet WASM hash is set', () => {
    // The relayer URL + key are SERVER-only secrets (checked in /api/passkey-send), so the
    // client gate is the wallet WASM hash alone.
    process.env.NEXT_PUBLIC_PASSKEY_WALLET_WASM_HASH = 'ecd990f0';
    expect(isPasskeyConfigured()).toBe(true);
  });
});
