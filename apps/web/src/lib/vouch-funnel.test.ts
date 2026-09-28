import { describe, expect, it, vi } from 'vitest';
import { Address, nativeToScVal, xdr, type rpc } from '@stellar/stellar-sdk';
import {
  aggregateVouchFunnel,
  readVouchRecords,
  MAX_VOUCH_READS,
  type LedgerEntryReader,
  type VouchRecord,
} from './vouch-funnel';

const DAY = 86_400;
const WINDOW = 7 * DAY; // the contract's VOUCH_TTL_SECS
const MON = Date.UTC(2026, 0, 5) / 1000; // Monday 2026-01-05 00:00 UTC

const record = (id: number, overrides: Partial<VouchRecord> = {}): VouchRecord => ({
  id,
  from: 'A',
  claimed: false,
  claimer: null,
  created: MON,
  slashed: false,
  ...overrides,
});

describe('aggregateVouchFunnel', () => {
  it('derives minted, claimed, completion, expiry, vouchers, repeat pairs and weekly cohorts', () => {
    const result = aggregateVouchFunnel(
      [
        record(1, { claimed: true, claimer: 'B' }),
        record(2, { claimed: true, claimer: 'B' }), // repeats A→B
        record(3, { from: 'C', slashed: true }), // slashed by the keeper
        record(4, { from: 'C' }), // window closed, never slashed — still expired
        record(5, { created: MON + 7 * DAY, claimed: true, claimer: 'D' }),
        record(6, { created: MON + 8 * DAY }), // still inside its window
      ],
      { now: MON + 10 * DAY },
    );
    expect(result).toEqual({
      minted: 6,
      claimed: 3,
      completionRate: 0.5,
      open: 1,
      expiredUnclaimed: 2,
      expiredRate: 2 / 6,
      distinctVouchers: 2,
      repeatPairShare: 1 / 3,
      unread: 0,
      weeklyCohorts: [
        { week: '2026-01-05', minted: 4, claimed: 2, completionRate: 0.5, open: 0, expiredUnclaimed: 2 },
        { week: '2026-01-12', minted: 2, claimed: 1, completionRate: 0.5, open: 1, expiredUnclaimed: 0 },
      ],
    });
  });

  it('closes the claim window only once now > created + VOUCH_TTL_SECS, as the contract does', () => {
    const at = (now: number) => aggregateVouchFunnel([record(1)], { now });
    expect(at(MON + WINDOW)).toMatchObject({ open: 1, expiredUnclaimed: 0 });
    expect(at(MON + WINDOW + 1)).toMatchObject({ open: 0, expiredUnclaimed: 1 });
  });

  it('counts a late claim — even one after a slash — as claimed, not expired', () => {
    const result = aggregateVouchFunnel([record(1, { slashed: true, claimed: true, claimer: 'B' })], {
      now: MON + 30 * DAY,
    });
    expect(result).toMatchObject({ claimed: 1, completionRate: 1, expiredUnclaimed: 0, open: 0 });
  });

  it('treats pairs as directed: B→A after A→B is a new pair, a third A→B is another repeat', () => {
    const result = aggregateVouchFunnel(
      [
        record(1, { claimed: true, claimer: 'B' }),
        record(2, { from: 'B', claimed: true, claimer: 'A' }),
        record(3, { claimed: true, claimer: 'B' }),
        record(4, { claimed: true, claimer: 'B' }),
      ],
      { now: MON },
    );
    expect(result.repeatPairShare).toBe(2 / 4);
  });

  it('buckets by Monday-start UTC weeks, oldest first', () => {
    const sundayNight = MON + 7 * DAY - 1;
    const result = aggregateVouchFunnel(
      [record(1, { created: MON + 7 * DAY }), record(2, { created: sundayNight }), record(3, { created: MON - 1 })],
      { now: MON },
    );
    expect(result.weeklyCohorts.map((c) => [c.week, c.minted])).toEqual([
      ['2025-12-29', 1],
      ['2026-01-05', 1],
      ['2026-01-12', 1],
    ]);
  });

  it('returns zero rates for an empty record set and passes unread through', () => {
    expect(aggregateVouchFunnel([], { now: MON, unread: 3 })).toEqual({
      minted: 0,
      claimed: 0,
      completionRate: 0,
      open: 0,
      expiredUnclaimed: 0,
      expiredRate: 0,
      distinctVouchers: 0,
      repeatPairShare: 0,
      unread: 3,
      weeklyCohorts: [],
    });
  });
});

// ── readVouchRecords against a fake RPC holding real contract-data XDR ──

const CONTRACT = 'CDRYXUS55TKGYEM3YUB3YTJWQKSWWQABK6YPQK7SLEPVALWYK4IR7WCL';
const VOUCHER = 'GC7K66B2IL3KWQC25EVY3BQI3SVCRWIJLWZ3R5LBBWAL2ZXW4CELFFGU';
const CLAIMER = 'GDIS5BDXSI2DDJNTKRZPI6MNB5XCLMN4Z6PPRPM4RQLZ3PSQ2YTERLFA';

const keyXdr = (key: xdr.ScVal) =>
  xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(CONTRACT).toScAddress(),
      key,
      durability: xdr.ContractDataDurability.persistent(),
    }),
  ).toXDR('base64');

// DataKey::Vouch(id) as the contract stores it.
const vouchStorageKey = (id: number) =>
  keyXdr(xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Vouch'), nativeToScVal(id, { type: 'u64' })]));

function dataEntry(key: xdr.ScVal, val: xdr.ScVal): rpc.Api.LedgerEntryResult {
  const entry = new xdr.ContractDataEntry({
    ext: new xdr.ExtensionPoint(0),
    contract: new Address(CONTRACT).toScAddress(),
    key,
    durability: xdr.ContractDataDurability.persistent(),
    val,
  });
  return {
    key: xdr.LedgerKey.fromXDR(keyXdr(key), 'base64'),
    val: xdr.LedgerEntryData.contractData(entry),
    lastModifiedLedgerSeq: 1,
  };
}

function instanceEntry(vouchSeq: number | null): rpc.Api.LedgerEntryResult {
  const storage = [
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Admin')]),
      val: new Address(VOUCHER).toScVal(),
    }),
  ];
  if (vouchSeq !== null) {
    storage.push(
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('VouchSeq')]),
        val: nativeToScVal(vouchSeq, { type: 'u64' }),
      }),
    );
  }
  return dataEntry(
    xdr.ScVal.scvLedgerKeyContractInstance(),
    xdr.ScVal.scvContractInstance(
      new xdr.ScContractInstance({
        executable: xdr.ContractExecutable.contractExecutableStellarAsset(),
        storage,
      }),
    ),
  );
}

// The Vouch struct, a map keyed by field name as #[contracttype] encodes it.
function vouchEntry(id: number, claimed: boolean): rpc.Api.LedgerEntryResult {
  const field = (name: string, val: xdr.ScVal) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(name), val });
  return dataEntry(
    xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Vouch'), nativeToScVal(id, { type: 'u64' })]),
    xdr.ScVal.scvMap([
      field('claim_hash', xdr.ScVal.scvBytes(Buffer.alloc(32))),
      field('claimed', xdr.ScVal.scvBool(claimed)),
      field('claimer', claimed ? new Address(CLAIMER).toScVal() : xdr.ScVal.scvVoid()),
      field('created', nativeToScVal(MON + id, { type: 'u64' })),
      field('from', new Address(VOUCHER).toScVal()),
      field('id', nativeToScVal(id, { type: 'u64' })),
      field('note', xdr.ScVal.scvString('gm')),
      field('slashed', xdr.ScVal.scvBool(false)),
      field('stake', nativeToScVal(5, { type: 'u64' })),
    ]),
  );
}

/** A fake RPC that answers from a ledger of `entries`, like getLedgerEntries: absent keys are omitted. */
function fakeServer(entries: rpc.Api.LedgerEntryResult[]) {
  const ledger = new Map(entries.map((e) => [e.key.toXDR('base64'), e]));
  const getLedgerEntries = vi.fn(async (...keys: xdr.LedgerKey[]) => ({
    latestLedger: 100,
    entries: keys.flatMap((k) => ledger.get(k.toXDR('base64')) ?? []),
  }));
  return { server: { getLedgerEntries } as unknown as LedgerEntryReader, getLedgerEntries };
}

describe('readVouchRecords', () => {
  it('reads VouchSeq from instance storage, then every Vouch(id) in batches of 200', async () => {
    const vouches = Array.from({ length: 450 }, (_, i) => vouchEntry(i + 1, i % 3 === 0));
    const { server, getLedgerEntries } = fakeServer([instanceEntry(450), ...vouches]);

    const { total, records } = await readVouchRecords(server, CONTRACT);

    expect(total).toBe(450);
    expect(records).toHaveLength(450);
    expect(records[0]).toEqual({
      id: 1,
      from: VOUCHER,
      claimed: true,
      claimer: CLAIMER,
      created: MON + 1,
      slashed: false,
    });
    expect(records[1]).toMatchObject({ id: 2, claimed: false, claimer: null });
    // 1 instance read + 200 + 200 + 50 vouch keys
    expect(getLedgerEntries.mock.calls.map((c) => c.length)).toEqual([1, 200, 200, 50]);
    expect(getLedgerEntries.mock.calls[1][0].toXDR('base64')).toBe(vouchStorageKey(1));
    expect(getLedgerEntries.mock.calls[3][49].toXDR('base64')).toBe(vouchStorageKey(450));
  });

  it('leaves out ids the RPC no longer returns, so the caller can report them as unread', async () => {
    const { server } = fakeServer([instanceEntry(4), vouchEntry(2, true), vouchEntry(4, false)]);
    const { total, records } = await readVouchRecords(server, CONTRACT);
    expect(total).toBe(4);
    expect(records.map((r) => r.id)).toEqual([2, 4]);
  });

  it('reads nothing more for a contract that never minted (no VouchSeq yet)', async () => {
    const { server, getLedgerEntries } = fakeServer([instanceEntry(null)]);
    await expect(readVouchRecords(server, CONTRACT)).resolves.toEqual({ total: 0, records: [] });
    expect(getLedgerEntries).toHaveBeenCalledTimes(1);
  });

  it('reads only the newest MAX_VOUCH_READS ids', async () => {
    const total = MAX_VOUCH_READS + 5;
    const { server, getLedgerEntries } = fakeServer([instanceEntry(total)]);
    await readVouchRecords(server, CONTRACT);
    const requested = getLedgerEntries.mock.calls.slice(1).flat().map((k) => k.toXDR('base64'));
    expect(requested).toHaveLength(MAX_VOUCH_READS);
    expect(requested[0]).toBe(vouchStorageKey(6));
    expect(requested.at(-1)).toBe(vouchStorageKey(total));
  });

  it('rejects when the contract instance is missing', async () => {
    const { server } = fakeServer([]);
    await expect(readVouchRecords(server, CONTRACT)).rejects.toThrow(/instance not found/);
  });

  it('rejects instead of returning a partial funnel when a batch fails', async () => {
    const { server, getLedgerEntries } = fakeServer([instanceEntry(300), vouchEntry(1, true)]);
    const real = getLedgerEntries.getMockImplementation()!;
    getLedgerEntries.mockImplementation(async (...keys) => {
      if (keys.length === 100) throw new Error('rpc down');
      return real(...keys);
    });
    await expect(readVouchRecords(server, CONTRACT)).rejects.toThrow('rpc down');
  });
});
