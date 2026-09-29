import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { xdr, Address, StrKey } from '@stellar/stellar-sdk';
import type { ReadNetwork } from './read-network';

const { getLatestLedgerMock, getEventsMock } = vi.hoisted(() => ({
  getLatestLedgerMock: vi.fn(),
  getEventsMock: vi.fn(),
}));

vi.mock('./stellar', () => ({
  server: { getLatestLedger: getLatestLedgerMock, getEvents: getEventsMock },
  config: { contracts: { reputation: 'CREP', rewards: 'CRWD', questRegistry: 'CQST' } },
}));

import {
  clearEventCache,
  decodeScVal,
  fetchReputationEvents,
  fetchTipEvents,
  fetchTipsSent,
  fetchContractEvents,
  fetchQuestEvents,
  EVENT_LEDGER_WINDOW,
  EVENT_WINDOW_TTL_MS,
  MAX_PAGES,
  PAGE_SIZE,
} from './events';

/**
 * Helper: assert two Uint8Arrays have the same bytes.
 */
function expectBytesEqual(actual: Uint8Array, expected: Uint8Array) {
  expect(ArrayBuffer.isView(actual)).toBe(true);
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
      const keyBuf = Buffer.alloc(32);
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
      const data = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe, 0xba, 0xbe]);
      const scv = xdr.ScVal.scvBytes(data);
      const result = decodeScVal(scv);
      expect(ArrayBuffer.isView(result)).toBe(true);
      expectBytesEqual(result as Uint8Array, data);
    });

    it('decodes a non-trivial byte sequence correctly', () => {
      const data = Buffer.alloc(64);
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
      const keyBuf = Buffer.alloc(32, 0xab);
      const pubKey = xdr.PublicKey.publicKeyTypeEd25519(keyBuf);
      const scAddr = xdr.ScAddress.scAddressTypeAccount(pubKey);
      const addrScv = xdr.ScVal.scvAddress(scAddr);

      const scv = xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol('user'),
        addrScv,
        xdr.ScVal.scvU32(7),
        xdr.ScVal.scvBytes(Buffer.from([0x01, 0x02])),
      ]);
      const result = decodeScVal(scv) as unknown[];
      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toBe('user');
      expect(typeof result[1]).toBe('string');
      expect((result[1] as string)).toMatch(/^G[A-Z2-7]{55}$/);
      expect(result[2]).toBe(7);
      expect(ArrayBuffer.isView(result[3])).toBe(true);
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
    clearEventCache();
    getLatestLedgerMock.mockReset().mockResolvedValue({ sequence: 20_000 });
    getEventsMock.mockReset().mockResolvedValue({ events: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('scans the reputation window with the 2-segment wildcard', async () => {
    await fetchReputationEvents();
    expect(getEventsMock).toHaveBeenCalledWith({
      startLedger: 11_000,
      filters: [{ type: 'contract', contractIds: ['CREP'], topics: [['*', '*']] }],
      limit: 1000,
    });
    expect(getEventsMock).toHaveBeenCalledTimes(1); // a quiet window is still one request
  });

  it("scans the override network's reputation contract on its own RPC, never the deployment's (#290)", async () => {
    const testnetServer = {
      getLatestLedger: vi.fn().mockResolvedValue({ sequence: 50_000 }),
      getEvents: vi.fn().mockResolvedValue({ events: [] }),
    };
    const net = {
      network: 'testnet',
      contracts: { reputation: 'CTESTREP', registry: 'CTESTREG' },
      server: testnetServer,
    } as unknown as ReadNetwork;
    await Promise.all([fetchReputationEvents({ net }), fetchReputationEvents()]);
    expect(testnetServer.getEvents).toHaveBeenCalledWith({
      startLedger: 41_000,
      filters: [{ type: 'contract', contractIds: ['CTESTREP'], topics: [['*', '*']] }],
      limit: 1000,
    });
    // The deployment's scan ran on its own, not shared with the override's.
    expect(getEventsMock).toHaveBeenCalledTimes(1);
    expect(getEventsMock.mock.calls[0][0].filters[0].contractIds).toEqual(['CREP']);
    // Each window is reused within the TTL from its own network's cache.
    await Promise.all([fetchReputationEvents({ net }), fetchReputationEvents()]);
    expect(testnetServer.getEvents).toHaveBeenCalledTimes(1);
    expect(getEventsMock).toHaveBeenCalledTimes(1);
  });

  it('keys the shared window by network, even for one contract id on both', async () => {
    const otherServer = {
      getLatestLedger: vi.fn().mockResolvedValue({ sequence: 50_000 }),
      getEvents: vi.fn().mockResolvedValue({ events: [] }),
    };
    const net = { network: 'testnet', contracts: { reputation: 'CREP' }, server: otherServer } as unknown as ReadNetwork;
    await fetchReputationEvents();
    await fetchReputationEvents({ net }); // within the TTL of the deployment's window
    expect(otherServer.getEvents).toHaveBeenCalledTimes(1);
  });

  it('shares one scan between concurrent callers', async () => {
    const [a, b, c] = await Promise.all([fetchReputationEvents(), fetchReputationEvents(), fetchReputationEvents()]);
    expect(getEventsMock).toHaveBeenCalledTimes(1);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('reuses a settled window for callers that mount later, until the TTL passes', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const first = await fetchReputationEvents(); // the feed mounts
    now.mockReturnValue(1_000_000 + EVENT_WINDOW_TTL_MS - 1);
    expect(await fetchReputationEvents()).toBe(first); // the 3D hero, seconds later
    expect(getLatestLedgerMock).toHaveBeenCalledTimes(1);
    expect(getEventsMock).toHaveBeenCalledTimes(1);

    now.mockReturnValue(1_000_000 + EVENT_WINDOW_TTL_MS);
    await fetchReputationEvents();
    expect(getEventsMock).toHaveBeenCalledTimes(2);
  });

  it('shares one scan between plain and throwOnError callers', async () => {
    await Promise.all([fetchReputationEvents(), fetchReputationEvents({ throwOnError: true })]);
    expect(getEventsMock).toHaveBeenCalledTimes(1);
    await fetchReputationEvents({ throwOnError: true });
    expect(getEventsMock).toHaveBeenCalledTimes(1);
  });

  it('scans again for maxAgeMs 0, and that scan refreshes the window for everyone', async () => {
    await fetchReputationEvents();
    const fresh = await fetchReputationEvents({ maxAgeMs: 0 });
    expect(getEventsMock).toHaveBeenCalledTimes(2);
    expect(await fetchReputationEvents()).toBe(fresh);
    expect(getEventsMock).toHaveBeenCalledTimes(2);
  });

  it('never keeps a failed scan: the next caller reads again', async () => {
    getEventsMock.mockRejectedValueOnce(new Error('429'));
    await expect(fetchReputationEvents()).resolves.toEqual([]);
    await expect(fetchReputationEvents({ throwOnError: true })).resolves.toEqual([]);
    expect(getEventsMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the reputation and tip windows apart, each read once', async () => {
    await Promise.all([fetchReputationEvents(), fetchTipEvents()]);
    await Promise.all([fetchReputationEvents(), fetchTipEvents()]);
    expect(getEventsMock.mock.calls.map((c) => c[0].filters[0].contractIds)).toEqual([['CREP'], ['CRWD']]);
  });

  it("does not cache one sender's tips (badges read them once, on demand)", async () => {
    const from = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1));
    await fetchTipsSent(from);
    await fetchTipsSent(from);
    expect(getEventsMock).toHaveBeenCalledTimes(2);
  });

  it("scans the quest registry's 2-topic events — quest awards and streaks — in one shared window (#279)", async () => {
    const player = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 3));
    getEventsMock.mockResolvedValue({
      events: [
        {
          id: '0000085899350016-0000000001',
          topic: [sym('streak'), new Address(player).toScVal().toXDR('base64')],
          value: xdr.ScVal.scvVec([xdr.ScVal.scvU32(3), xdr.ScVal.scvU32(4)]).toXDR('base64'),
          ledger: 19_990,
          ledgerClosedAt: '2026-09-29T10:00:00Z',
        },
      ],
    });
    const [events] = await Promise.all([fetchQuestEvents(), fetchQuestEvents()]);
    expect(getEventsMock).toHaveBeenCalledTimes(1);
    expect(getEventsMock).toHaveBeenCalledWith({
      startLedger: 11_000,
      filters: [{ type: 'contract', contractIds: ['CQST'], topics: [['*', '*']] }],
      limit: PAGE_SIZE, // one page: the window's first request
    });
    // The RPC's event id and close time ride along, for stable ids and real timestamps.
    expect(events).toEqual([
      {
        topics: ['streak', player],
        data: [3, 4],
        ledger: 19_990,
        id: '0000085899350016-0000000001',
        closedAt: Date.parse('2026-09-29T10:00:00Z') / 1000,
      },
    ]);
    await fetchQuestEvents(); // within the TTL
    expect(getEventsMock).toHaveBeenCalledTimes(1);
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
      cursor: 'after-the-first-tip',
    });

    const events = await fetchTipsSent(from);

    // Only the first tip is wanted: one request for one event, and no follow-up page.
    expect(getEventsMock).toHaveBeenCalledTimes(1);
    expect(getEventsMock.mock.calls[0][0].limit).toBe(1);

    const filter = getEventsMock.mock.calls[0][0].filters[0];
    expect(filter.contractIds).toEqual(['CRWD']);
    // ('tipped', from, to) has THREE topics; a 2-segment filter would never match it.
    expect(filter.topics).toEqual([[sym('tipped'), new Address(from).toScVal().toXDR('base64'), '*']]);
    expect(events).toEqual([{ topics: ['tipped', from, to], data: 5n, ledger: 19_999 }]);
  });

  it('reads every tip in the window with a three-segment tipped filter', async () => {
    getLatestLedgerMock.mockResolvedValue({ sequence: 20_000 });
    getEventsMock.mockResolvedValue({ events: [] });

    await fetchTipEvents();

    const filter = getEventsMock.mock.calls[0][0].filters[0];
    expect(filter.contractIds).toEqual(['CRWD']);
    // ('tipped', from, to) has THREE topics; a 2-segment wildcard would never match it.
    expect(filter.topics).toEqual([[sym('tipped'), '*', '*']]);
  });

  it('returns no tips for a malformed sender without calling RPC', async () => {
    await expect(fetchTipsSent('not-an-address')).resolves.toEqual([]);
    expect(getEventsMock).not.toHaveBeenCalled();
  });

  it('degrades to [] when RPC fails', async () => {
    getEventsMock.mockRejectedValue(new Error('rpc down'));
    await expect(fetchReputationEvents()).resolves.toEqual([]);
  });

  it('still degrades to [] for a plain caller when getLatestLedger fails, not just getEvents', async () => {
    getLatestLedgerMock.mockRejectedValue(new Error('rpc down'));
    await expect(fetchReputationEvents()).resolves.toEqual([]);
  });

  it('throws instead of degrading when a caller opts into throwOnError', async () => {
    getEventsMock.mockRejectedValue(new Error('rpc down'));
    await expect(fetchReputationEvents({ throwOnError: true })).rejects.toThrow('rpc down');
  });

  it('throws on throwOnError even when getLatestLedger (not just getEvents) fails', async () => {
    getLatestLedgerMock.mockRejectedValue(new Error('rpc down'));
    await expect(fetchReputationEvents({ throwOnError: true })).rejects.toThrow('rpc down');
  });

  it('does not throw with throwOnError when the RPC succeeds with a genuinely quiet window', async () => {
    getEventsMock.mockResolvedValue({ events: [] });
    await expect(fetchReputationEvents({ throwOnError: true })).resolves.toEqual([]);
  });

  describe('cursor pagination', () => {
    const SOCIAL = xdr.ScVal.scvSymbol('social');
    const WHO = xdr.ScVal.scvSymbol('who');
    const LATEST = 20_000;
    const eventId = (ledger: number, i: number) =>
      `${String(ledger).padStart(19, '0')}-${String(i).padStart(10, '0')}`;

    /**
     * Serve `count` events (data = their index, ascending, three per ledger from the window
     * start) the way stellar-rpc's getEvents does: `startLedger` XOR `cursor`, at most `limit`
     * events per page, and a cursor that is the last event on a full page or the end of the
     * scanned range on a short one.
     */
    function serveWindow(count: number) {
      const all = Array.from({ length: count }, (_, i) => {
        const ledger = LATEST - EVENT_LEDGER_WINDOW + Math.floor(i / 3);
        return { id: eventId(ledger, i), ledger, topic: [SOCIAL, WHO], value: xdr.ScVal.scvU32(i) };
      });
      getEventsMock.mockImplementation(async (req: { startLedger?: number; cursor?: string; limit: number }) => {
        const { startLedger, cursor, limit } = req;
        if (cursor !== undefined && startLedger !== undefined) {
          throw new Error('ledger ranges and cursor cannot both be set');
        }
        if (cursor === undefined && !(Number(startLedger) > 0)) throw new Error('startLedger must be positive');
        const rest =
          cursor === undefined
            ? all.filter((e) => e.ledger >= Number(startLedger))
            : all.filter((e) => e.id > cursor);
        const events = rest.slice(0, limit);
        const next = events.length === limit ? events[events.length - 1].id : eventId(LATEST, 4_294_967_295);
        return { events, cursor: next, latestLedger: LATEST, oldestLedger: 1 };
      });
      return all;
    }
    const indexes = (events: { data: unknown }[]) => events.map((e) => e.data);
    const range = (n: number) => Array.from({ length: n }, (_, i) => i);

    it('keeps the window inside one RPC ledger scan, so a short page means caught up', () => {
      // stellar-rpc scans at most 10,000 ledgers per getEvents request (LedgerScanLimit).
      expect(EVENT_LEDGER_WINDOW).toBeLessThan(10_000);
    });

    it('concatenates two pages in order, so the newest event is returned', async () => {
      const all = serveWindow(PAGE_SIZE + 1); // the newest event is alone on page 2

      const events = await fetchReputationEvents();

      expect(indexes(events)).toEqual(range(PAGE_SIZE + 1));
      expect(events[events.length - 1].ledger).toBe(all[PAGE_SIZE].ledger);
      expect(getEventsMock).toHaveBeenCalledTimes(2);
      // Page 2 continues from page 1's last event and must not also send startLedger.
      const second = getEventsMock.mock.calls[1][0];
      expect(second.cursor).toBe(all[PAGE_SIZE - 1].id);
      expect(second).not.toHaveProperty('startLedger');
    });

    it('confirms an exactly-full last page with one more request', async () => {
      serveWindow(2 * PAGE_SIZE);

      const events = await fetchReputationEvents();

      expect(indexes(events)).toEqual(range(2 * PAGE_SIZE));
      expect(getEventsMock).toHaveBeenCalledTimes(3); // the third page comes back empty
    });

    it('stops after MAX_PAGES requests on a window busier than the cap', async () => {
      serveWindow(PAGE_SIZE * MAX_PAGES + 7);

      const events = await fetchReputationEvents();

      expect(getEventsMock).toHaveBeenCalledTimes(MAX_PAGES);
      expect(indexes(events)).toEqual(range(PAGE_SIZE * MAX_PAGES)); // documented ceiling: the oldest events win
    });

    it('ends the scan on a full page without a cursor instead of re-reading from startLedger', async () => {
      const page = serveWindow(PAGE_SIZE);
      getEventsMock.mockResolvedValue({ events: page, cursor: '' });

      const events = await fetchReputationEvents();

      expect(getEventsMock).toHaveBeenCalledTimes(1);
      expect(indexes(events)).toEqual(range(PAGE_SIZE)); // no duplicated first page
    });

    it('drops the whole scan when a later page fails, and retries on the next call', async () => {
      serveWindow(PAGE_SIZE + 1);
      const rpcWindow = getEventsMock.getMockImplementation()!;
      getEventsMock.mockImplementationOnce(rpcWindow).mockRejectedValueOnce(new Error('rpc timeout'));

      // An oldest-only prefix would pass for "nothing newer happened", so it is not returned.
      await expect(fetchReputationEvents()).resolves.toEqual([]);
      expect(getEventsMock).toHaveBeenCalledTimes(2);

      expect(indexes(await fetchReputationEvents())).toEqual(range(PAGE_SIZE + 1));
    });

    it('shares one multi-page scan between concurrent callers', async () => {
      serveWindow(2 * PAGE_SIZE + 1);

      const [a, b, c] = await Promise.all([fetchReputationEvents(), fetchReputationEvents(), fetchReputationEvents()]);

      expect(getLatestLedgerMock).toHaveBeenCalledTimes(1);
      expect(getEventsMock).toHaveBeenCalledTimes(3); // one 3-page scan, not three
      expect(b).toBe(a);
      expect(c).toBe(a);
      expect(indexes(a)).toEqual(range(2 * PAGE_SIZE + 1));

      await fetchReputationEvents({ maxAgeMs: 0 }); // a fresh read scans all three pages again
      expect(getEventsMock).toHaveBeenCalledTimes(6);
    });
  });
});

// ── fetchContractEvents — mocked-RPC unit tests ──────────────────────────────
describe('fetchContractEvents', () => {
  const TOPIC_SYM = (v: string) => xdr.ScVal.scvSymbol(v).toXDR('base64');
  const WILDCARD = '*';

  beforeEach(() => {
    clearEventCache();
    getLatestLedgerMock.mockReset().mockResolvedValue({ sequence: 20_000 });
    getEventsMock.mockReset().mockResolvedValue({ events: [], cursor: undefined });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns [] immediately when contractId is empty, without calling RPC', async () => {
    const events = await fetchContractEvents('', [WILDCARD, WILDCARD], 100);
    expect(events).toEqual([]);
    expect(getLatestLedgerMock).not.toHaveBeenCalled();
    expect(getEventsMock).not.toHaveBeenCalled();
  });

  it('rejects when contractId is empty and throwOnError is true', async () => {
    await expect(
      fetchContractEvents('', [WILDCARD, WILDCARD], 100, { throwOnError: true }),
    ).rejects.toThrow('No contract ID');
  });

  it('sends the correct contractId and topic filter to RPC', async () => {
    const CONTRACT = 'CQUEST';
    const quest = TOPIC_SYM('quest');
    const awarded = TOPIC_SYM('awarded');

    await fetchContractEvents(CONTRACT, [quest, awarded], 50);

    expect(getEventsMock).toHaveBeenCalledTimes(1);
    const call = getEventsMock.mock.calls[0][0];
    expect(call.filters[0].contractIds).toEqual([CONTRACT]);
    expect(call.filters[0].topics).toEqual([[quest, awarded]]);
    expect(call.limit).toBe(50);
  });

  it('decodes topics and data and returns them with the ledger', async () => {
    const from = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1));
    const to = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
    const amount = xdr.ScVal.scvI128(
      new xdr.Int128Parts({
        lo: xdr.Uint64.fromString('5000000'),
        hi: xdr.Int64.fromString('0'),
      }),
    ).toXDR('base64');

    getEventsMock.mockResolvedValue({
      events: [
        {
          topic: [
            TOPIC_SYM('tipped'),
            new Address(from).toScVal().toXDR('base64'),
            new Address(to).toScVal().toXDR('base64'),
          ],
          value: amount,
          ledger: 19_800,
        },
      ],
      cursor: undefined,
    });

    const events = await fetchContractEvents('CRWD', [TOPIC_SYM('tipped'), WILDCARD, WILDCARD], 100);

    expect(events).toHaveLength(1);
    expect(events[0].ledger).toBe(19_800);
    expect(events[0].topics[0]).toBe('tipped');
    expect(events[0].topics[1]).toBe(from);
    expect(events[0].topics[2]).toBe(to);
    expect(events[0].data).toBe(5_000_000n);
  });

  it('degrades to [] when the RPC call throws, instead of propagating', async () => {
    getEventsMock.mockRejectedValue(new Error('network timeout'));
    const events = await fetchContractEvents('CREP', [WILDCARD, WILDCARD], 100);
    expect(events).toEqual([]);
  });

  it('propagates the RPC error when throwOnError is true', async () => {
    getEventsMock.mockRejectedValue(new Error('rpc unavailable'));
    await expect(
      fetchContractEvents('CREP', [WILDCARD, WILDCARD], 100, { throwOnError: true }),
    ).rejects.toThrow('rpc unavailable');
  });

  it('shares one in-flight scan among concurrent callers with the same key', async () => {
    const [a, b, c] = await Promise.all([
      fetchContractEvents('CREP', [WILDCARD, WILDCARD], 500),
      fetchContractEvents('CREP', [WILDCARD, WILDCARD], 500),
      fetchContractEvents('CREP', [WILDCARD, WILDCARD], 500),
    ]);
    expect(getEventsMock).toHaveBeenCalledTimes(1);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('treats different contract IDs as separate scan keys (no cross-contamination)', async () => {
    await Promise.all([
      fetchContractEvents('CREP', [WILDCARD, WILDCARD], 500),
      fetchContractEvents('CRWD', [TOPIC_SYM('tipped'), WILDCARD, WILDCARD], 500),
    ]);
    expect(getEventsMock).toHaveBeenCalledTimes(2);
    const ids = getEventsMock.mock.calls.map((c) => c[0].filters[0].contractIds[0]);
    expect(ids).toContain('CREP');
    expect(ids).toContain('CRWD');
  });

  it('reuses a settled scan within the maxAgeMs window', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const first = await fetchContractEvents('CREP', [WILDCARD, WILDCARD], 500, {
      maxAgeMs: EVENT_WINDOW_TTL_MS,
    });
    now.mockReturnValue(1_000_000 + EVENT_WINDOW_TTL_MS - 1);
    const second = await fetchContractEvents('CREP', [WILDCARD, WILDCARD], 500, {
      maxAgeMs: EVENT_WINDOW_TTL_MS,
    });
    expect(getEventsMock).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('re-scans when the settled cache is older than maxAgeMs', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await fetchContractEvents('CREP', [WILDCARD, WILDCARD], 500, {
      maxAgeMs: EVENT_WINDOW_TTL_MS,
    });
    now.mockReturnValue(1_000_000 + EVENT_WINDOW_TTL_MS);
    await fetchContractEvents('CREP', [WILDCARD, WILDCARD], 500, {
      maxAgeMs: EVENT_WINDOW_TTL_MS,
    });
    expect(getEventsMock).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed scan — the next call rescans', async () => {
    getEventsMock.mockRejectedValueOnce(new Error('first fail'));
    await expect(fetchContractEvents('CREP', [WILDCARD, WILDCARD], 100)).resolves.toEqual([]);
    await expect(fetchContractEvents('CREP', [WILDCARD, WILDCARD], 100)).resolves.toEqual([]);
    expect(getEventsMock).toHaveBeenCalledTimes(2);
  });

  it('returns events from quest_registry decoded with correct topics for quest-awarded pattern', async () => {
    const recipient = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 5));
    const questId = xdr.ScVal.scvU32(42).toXDR('base64');

    getEventsMock.mockResolvedValue({
      events: [
        {
          topic: [TOPIC_SYM('quest'), TOPIC_SYM('awarded')],
          value: xdr.ScVal.scvVec([
            xdr.ScVal.scvU32(42),
            new Address(recipient).toScVal(),
          ]).toXDR('base64'),
          ledger: 19_500,
        },
      ],
      cursor: undefined,
    });

    const events = await fetchContractEvents(
      'CQUEST_REG',
      [TOPIC_SYM('quest'), TOPIC_SYM('awarded')],
      100,
    );

    expect(events).toHaveLength(1);
    expect(events[0].topics).toEqual(['quest', 'awarded']);
    expect(events[0].ledger).toBe(19_500);
    // data is a vec: [questId=42, recipient address]
    expect(Array.isArray(events[0].data)).toBe(true);
    expect((events[0].data as unknown[])[0]).toBe(42);
    expect((events[0].data as unknown[])[1]).toBe(recipient);
  });
});
