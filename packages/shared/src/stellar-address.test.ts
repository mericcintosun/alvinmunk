import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { isStellarAddress } from './stellar-address';

describe('isStellarAddress', () => {
  it('accepts a valid classic account', () => {
    const g = Keypair.random().publicKey();
    expect(isStellarAddress(g)).toBe(true);
    expect(isStellarAddress(`  ${g}  `)).toBe(true);
  });

  it('rejects a checksum-invalid G address that matches the old regex', () => {
    const g = Keypair.random().publicKey();
    // Swap the last character for a different one: a key that already ends in the
    // replacement would otherwise stay valid (a 1-in-32 flake).
    const bad = `${g.slice(0, -1)}${g.endsWith('A') ? 'B' : 'A'}`;
    expect(/^[GC][A-Z2-7]{55}$/.test(bad)).toBe(true);
    expect(isStellarAddress(bad)).toBe(false);
  });

  it('rejects empty input', () => {
    expect(isStellarAddress('')).toBe(false);
    expect(isStellarAddress('   ')).toBe(false);
  });

  it('can require classic G accounts only', () => {
    const g = Keypair.random().publicKey();
    expect(isStellarAddress(g, { allowContract: false })).toBe(true);
    expect(isStellarAddress(g, { allowContract: true })).toBe(true);
  });

  it('accepts a valid contract address by default, rejects it when allowContract is false', () => {
    const c = StrKey.encodeContract(Buffer.alloc(32, 7));
    expect(isStellarAddress(c)).toBe(true);
    expect(isStellarAddress(c, { allowContract: true })).toBe(true);
    expect(isStellarAddress(c, { allowContract: false })).toBe(false);
  });
});
