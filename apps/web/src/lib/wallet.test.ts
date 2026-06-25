import { describe, it, expect, afterEach } from 'vitest';
import { isPasskeyConfigured } from './wallet';

describe('isPasskeyConfigured', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SMART_ACCOUNT_WASM_HASH;
    delete process.env.NEXT_PUBLIC_WEBAUTHN_VERIFIER_ID;
  });

  it('is false when infra env is unset (falls back to dev wallet)', () => {
    expect(isPasskeyConfigured()).toBe(false);
  });

  it('needs BOTH wasm hash + verifier — half-set stays on the dev wallet', () => {
    process.env.NEXT_PUBLIC_SMART_ACCOUNT_WASM_HASH = 'deadbeef';
    expect(isPasskeyConfigured()).toBe(false); // missing verifier
    process.env.NEXT_PUBLIC_WEBAUTHN_VERIFIER_ID = 'CVERIFIER';
    expect(isPasskeyConfigured()).toBe(true); // relayer is optional on testnet
  });
});
