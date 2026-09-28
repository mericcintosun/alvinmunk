import { describe, it, expect, vi, beforeEach } from 'vitest';
import { xdr, Address, StrKey } from '@stellar/stellar-sdk';

const { getLatestLedgerMock, getEventsMock } = vi.hoisted(() => ({
  getLatestLedgerMock: vi.fn(),
  getEventsMock: vi.fn(),
}));

vi.mock('./stellar', () => ({
  server: { getLatestLedger: getLatestLedgerMock, getEvents: getEventsMock },
  config: { contracts: { reputation: 'CREP', rewards: 'CRWD' } },
}));

import { decodeScVal, fetchReputationEvents, fetchTipsSent } from './events';

/**
 * Helper: assert two Uint8Arrays have the same bytes.
 */
function expectBytesEqual(actual: Uint8Array, expected: Uint8Array) {
  expect(actual).toBeInstanceOf(Uint8Array);
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < actual.length; i++) {
    expect(actual[i]).toBe(expected[i]);
  }
}

describe('decodeScVal', () => {
  describe('primitive values', () => {
    it('decodes a Symbol ScVal to a string', () => {
      const scv = xdr.ScVal.scvSymbol('test_symbol');
      expect(decodeScVal(scv)).toBe('test_symbol');
    });

    it('decodes an empty symbol to an empty string', () => {
      const scv = xdr.ScVal.scvSymbol('');
      expect(decodeScVal(scv)).toBe('');
    });
  });

  describe('numeric values', () => {
    it('decodes a u32 ScVal to a safe number', () => {
      const scv = xdr.ScVal.scvU32(12345);
      const result = decodeScVal(scv);
      expect(result).toBe(12345);
      expect(typeof result).toBe('number');
    });

    it('decodes u32 at the upper boundary', () => {
      const scv = xdr.ScVal.scvU32(4_294_967_295); // u32 max
      expect(decodeScVal(scv)).toBe(4_294_967_295);
    });

    it('decodes a u64 ScVal to a bigint (precision-safe)', () => {
      const scv = xdr.ScVal.scvU64(
        xdr.Uint64.fromString('9999999999'),
      );
      const result = decodeScVal(scv);
      expect(result).toBe(9999999999n);
      expect(typeof result).toBe('bigint');
    });

    it('decodes a large u64 exceeding Number.MAX_SAFE_INTEGER as bigint', () => {
      // 9,007,199,254,740,991 = Number.MAX_SAFE_INTEGER, use a value above it
      const large = '9999999999999999999';
      const scv = xdr.ScVal.scvU64(xdr.Uint64.fromString(large));
      const result = decodeScVal(scv) as bigint;
      expect(typeof result).toBe('bigint');
      expect(result.toString()).toBe(large);
    });

    it('decodes a positive i128 ScVal to a bigint', () => {
      const scv = xdr.ScVal.scvI128(
        new xdr.Int128Parts({
          lo: xdr.Uint64.fromString('12345678901234567890'),
          hi: xdr.Int64.fromString('0'),
        }),
      );
      const result = decodeScVal(scv);
      expect(typeof result).toBe('bigint');
      expect(result).toBe(12345678901234567890n);
    });

    it('decodes a negative i128 ScVal to a bigint', () => {
      // -1 as i128: lo = 2^64 - 1 (all 64 low bits set), hi = -1
      const scv = xdr.ScVal.scvI128(
        new xdr.Int128Parts({
          lo: xdr.Uint64.fromString('18446744073709551615'), // 2^64 - 1
          hi: xdr.Int64.fromString('-1'),
        }),
      );
      const result = decodeScVal(scv);
      expect(typeof result).toBe('bigint');
      expect(result).toBe(-1n);
    });
  });

  describe('address values', () => {
    it('decodes an account address (G…) ScVal to a string', () => {
      // Construct an account address ScVal using a raw 32-byte key buffer
      const keyBuf = new Uint8Array(32);
      for (let i = 0; i < 32; i++) keyBuf[i] = i + 1;
      const pubKey = xdr.PublicKey.publicKeyTypeEd25519(keyBuf);
      const scAddr = xdr.ScAddress.scAddressTypeAccount(pubKey);
      const scv = xdr.ScVal.scvAddress(scAddr);
      const result = decodeScVal(scv) as string;
      expect(typeof result).toBe('string');
      // The decoded address should be a valid G… strkey
      expect(result).toMatch(/^G[A-Z2-7]{55}$/);
    });

    it('decodes a contract address (C…) ScVal to a string', () => {
      // Use Address to construct a valid contract address
      const contractBuf = Buffer.alloc(32, 0xca);
      const addr = Address.contract(contractBuf);
      const scv = addr.toScVal();
      const result = decodeScVal(scv) as string;
      expect(typeof result).toBe('string');
      expect(result).toBe(addr.toString());
    });
  });

  describe('bytes', () => {
    it('decodes a Bytes ScVal to a Uint8Array with order preserved', () => {
      const data = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe, 0xba, 0xbe]);
      const scv = xdr.ScVal.scvBytes(data);
      const result = decodeScVal(scv);
      expect(result).toBeInstanceOf(Uint8Array);
      expectBytesEqual(result as Uint8Array, data);
    });

    it('decodes a non-trivial byte sequence correctly', () => {
      const data = new Uint8Array(64);
      for (let i = 0; i < data.length; i++) data[i] = i;
      const scv = xdr.ScVal.scvBytes(data);
      const result = decodeScVal(scv) as Uint8Array;
      expectBytesEqual(result, data);
    });
  });

  describe('compound values', () => {
    it('decodes a Vec ScVal recursively with order preserved', () => {
      const scv = xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol('alice'),
        xdr.ScVal.scvU32(42),
        xdr.ScVal.scvSymbol('bob'),
      ]);
      const result = decodeScVal(scv);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(['alice', 42, 'bob']);
    });

    it('decodes a Vec containing different ScVal types recursively', () => {
      // Build a consistent address ScVal without Keypair (jsdom incompatible)
      const keyBuf = new Uint8Array(32).fill(0xab);
      const pubKey = xdr.PublicKey.publicKeyTypeEd25519(keyBuf);
      const scAddr = xdr.ScAddress.scAddressTypeAccount(pubKey);
      const addrScv = xdr.ScVal.scvAddress(scAddr);

      const scv = xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol('user'),
        addrScv,
        xdr.ScVal.scvU32(7),
        xdr.ScVal.scvBytes(new Uint8Array([0x01, 0x02])),
      ]);
      const result = decodeScVal(scv) as unknown[];
      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toBe('user');
      expect(typeof result[1]).toBe('string');
      expect((result[1] as string)).toMatch(/^G[A-Z2-7]{55}$/);
      expect(result[2]).toBe(7);
      expect(result[3]).toBeInstanceOf(Uint8Array);
    });
  });

  describe('base64 string input', () => {
    it('decodes a base64-encoded ScVal string to the same value as the ScVal object', () => {
      const scv = xdr.ScVal.scvSymbol('base64_test');
      const b64 = scv.toXDR().toString('base64');
      const fromObj = decodeScVal(scv);
      const fromStr = decodeScVal(b64);
      expect(fromStr).toBe(fromObj);
      expect(fromStr).toBe('base64_test');
    });

    it('decodes a base64-encoded u64 ScVal correctly', () => {
      const scv = xdr.ScVal.scvU64(xdr.Uint64.fromString('9876543210'));
      const b64 = scv.toXDR().toString('base64');
      const result = decodeScVal(b64);
      expect(result).toBe(9876543210n);
    });

    it('decodes a base64-encoded Vec ScVal correctly', () => {
      const scv = xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol('x'),
        xdr.ScVal.scvU32(99),
      ]);
      const b64 = scv.toXDR().toString('base64');
      const result = decodeScVal(b64);
      expect(result).toEqual(['x', 99]);
    });
  });

  describe('malformed input', () => {
    it('returns null for an invalid base64 string instead of throwing', () => {
      expect(() => decodeScVal('not-valid-base64!!!')).not.toThrow();
      expect(decodeScVal('not-valid-base64!!!')).toBeNull();
    });

    it('returns null for a malformed XDR buffer (empty string) instead of throwing', () => {
      expect(() => decodeScVal('')).not.toThrow();
      expect(decodeScVal('')).toBeNull();
    });

    it('returns null for base64 that decodes to non-ScVal data instead of throwing', () => {
      // "AAAAAA==" is the base64 encoding of the XDR for a boolean true (a valid XDR, but not an ScVal)
      expect(() => decodeScVal('AAAAAA==')).not.toThrow();
      expect(decodeScVal('AAAAAA==')).toBeNull();
    });
  });
});

describe('contract event reads', () => {
  const sym = (v: string) => xdr.ScVal.scvSymbol(v).toXDR('base64');

  beforeEach(() => {
    getLatestLedgerMock.mockReset().mockResolvedValue({ sequence: 20_000 });
    getEventsMock.mockReset().mockResolvedValue({ events: [] });
  });

  it('scans the reputation window with the 2-segment wildcard', async () => {
    await fetchReputationEvents();
    expect(getEventsMock).toHaveBeenCalledWith({
      startLedger: 11_000,
      filters: [{ type: 'contract', contractIds: ['CREP'], topics: [['*', '*']] }],
      limit: 1000,
    });
  });

  it('shares one scan between concurrent callers, and re-reads once it settles', async () => {
    await Promise.all([fetchReputationEvents(), fetchReputationEvents(), fetchReputationEvents()]);
    expect(getEventsMock).toHaveBeenCalledTimes(1);
    await fetchReputationEvents();
    expect(getEventsMock).toHaveBeenCalledTimes(2);
  });

  it('reads tips with a 3-segment filter pinned to the sender', async () => {
    const from = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1));
    const to = Address.contract(Buffer.alloc(32, 0xca)).toString(); // passkey wallets are C…
    getEventsMock.mockResolvedValue({
      events: [
        {
          topic: [sym('tipped'), new Address(from).toScVal().toXDR('base64'), new Address(to).toScVal().toXDR('base64')],
          value: xdr.ScVal.scvI128(new xdr.Int128Parts({ lo: xdr.Uint64.fromString('5'), hi: xdr.Int64.fromString('0') })).toXDR('base64'),
          ledger: 19_999,
        },
      ],
    });

    const events = await fetchTipsSent(from);

    const filter = getEventsMock.mock.calls[0][0].filters[0];
    expect(filter.contractIds).toEqual(['CRWD']);
    // ('tipped', from, to) has THREE topics; a 2-segment filter would never match it.
    expect(filter.topics).toEqual([[sym('tipped'), new Address(from).toScVal().toXDR('base64'), '*']]);
    expect(events).toEqual([{ topics: ['tipped', from, to], data: 5n, ledger: 19_999 }]);
  });

  it('returns no tips for a malformed sender without calling RPC', async () => {
    await expect(fetchTipsSent('not-an-address')).resolves.toEqual([]);
    expect(getEventsMock).not.toHaveBeenCalled();
  });

  it('degrades to [] when RPC fails', async () => {
    getEventsMock.mockRejectedValue(new Error('rpc down'));
    await expect(fetchReputationEvents()).resolves.toEqual([]);
  });
});
