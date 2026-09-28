import { describe, it, expect, afterEach, vi } from 'vitest';
import { isPasskeyConfigured } from './wallet';

vi.mock('@stellar/freighter-api', () => ({
  isConnected: vi.fn(async () => ({ isConnected: true })),
  requestAccess: vi.fn(async () => ({ address: 'G'.padEnd(56, 'F') })),
  signTransaction: vi.fn(async () => ({ signedTxXdr: 'signed-xdr' })),
  signMessage: vi.fn(async () => ({
    signedMessage: 'c2lnbmVk', // base64
    signerAddress: 'G'.padEnd(56, 'F'),
  })),
}));

vi.mock('@albedo-link/intent', () => ({
  default: {
    publicKey: vi.fn(async () => ({ pubkey: 'G'.padEnd(56, 'A') })),
    tx: vi.fn(async () => ({ signed_envelope_xdr: 'signed-xdr' })),
    signMessage: vi.fn(async () => ({ signed_message: 'c2lnbmVk' })),
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

describe('connectFreighter().signMessage', () => {
  it('returns the base64 signature Freighter provides', async () => {
    const { connectFreighter } = await import('./wallet');
    const wallet = await connectFreighter();
    const sig = await wallet.signMessage('hello quest');
    expect(sig).toBe('c2lnbmVk');
  });

  it('surfaces a Freighter error instead of throwing the old "not supported" message', async () => {
    const { signMessage } = await import('@stellar/freighter-api');
    vi.mocked(signMessage).mockResolvedValueOnce({
      error: { message: 'user declined' },
    } as never);

    const { connectFreighter } = await import('./wallet');
    const wallet = await connectFreighter();
    await expect(wallet.signMessage('hello quest')).rejects.toThrow(/declined/i);
  });
});

describe('connectAlbedo().signMessage', () => {
  it('returns the base64 signature Albedo provides', async () => {
    const { connectAlbedo } = await import('./wallet');
    const wallet = await connectAlbedo();
    const sig = await wallet.signMessage('hello quest');
    expect(sig).toBe('c2lnbmVk');
  });
});