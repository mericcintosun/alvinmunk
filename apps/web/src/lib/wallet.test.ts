import { describe, it, expect, afterEach, vi } from 'vitest';
import { isPasskeyConfigured } from './wallet';

vi.mock('@stellar/freighter-api', () => ({
  isConnected: vi.fn(async () => ({ isConnected: true })),
  requestAccess: vi.fn(async () => ({ address: 'G'.padEnd(56, 'F') })),
  signTransaction: vi.fn(async () => ({ signedTxXdr: 'signed-xdr' })),
}));

vi.mock('@albedo-link/intent', () => ({
  default: {
    publicKey: vi.fn(async () => ({ pubkey: 'G'.padEnd(56, 'A') })),
    tx: vi.fn(async () => ({ signed_envelope_xdr: 'signed-xdr' })),
  },
}));

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

