/**
 * Vouch claim-completion funnel — the PMF gate metric ("vouch-claim completion ≥ 40%",
 * docs/product/PRODUCT_MARKET_FIT.md).
 *
 * Read from contract STATE, not events: RPC keeps events only for a short retention window
 * (lib/events.ts), so an event-sourced funnel would silently shrink to the last few days
 * and its weekly cohorts would decay. Every half-card instead
 * lives in the reputation contract's persistent storage under a sequential id
 * (`DataKey::Vouch(1..=VouchSeq)`, `VouchSeq` in instance storage). `getLedgerEntries`
 * reads those entries directly — up to 200 per request, no simulation — so the funnel works
 * against the deployed contract as-is. Entries do not live forever either: a half-card's
 * entry is extended to ~150 days at mint and never again, so once one is archived the RPC
 * stops returning it. Those, and anything past `MAX_VOUCH_READS`, are counted as `unread`
 * rather than silently dropped.
 */
import { Address, scValToNative, xdr, type rpc } from '@stellar/stellar-sdk';
import { VOUCH_TTL_SECS } from './reputation';

/** The funnel-relevant fields of the contract's `Vouch` struct. */
export interface VouchRecord {
  id: number;
  from: string;
  claimed: boolean;
  claimer: string | null;
  /** ledger unix-seconds at mint */
  created: number;
  slashed: boolean;
}

export interface VouchCohort {
  /** Monday (UTC) of the mint week, `YYYY-MM-DD` */
  week: string;
  minted: number;
  claimed: number;
  completionRate: number;
  /** unclaimed and still inside the 7-day claim window */
  open: number;
  expiredUnclaimed: number;
}

export interface VouchFunnel {
  /** half-cards read (see `unread` for the ones that could not be) */
  minted: number;
  claimed: number;
  /** claimed / minted, 0..1 */
  completionRate: number;
  /** unclaimed and still inside the 7-day claim window — may still convert */
  open: number;
  /** unclaimed past the window, whether or not a keeper has slashed it yet */
  expiredUnclaimed: number;
  /** expiredUnclaimed / minted, 0..1 */
  expiredRate: number;
  distinctVouchers: number;
  /** share of claims that repeat an already-claimed (voucher, claimer) pair — the claims the
   *  contract's first-pair guard pays no Social XP for. 0..1 */
  repeatPairShare: number;
  /** minted ids (≤ VouchSeq) whose entry could not be read: archived, or past the read cap */
  unread: number;
  /** oldest mint week first */
  weeklyCohorts: VouchCohort[];
}

/** Monday 00:00 UTC of the week holding `unixSecs`, as `YYYY-MM-DD`. */
function mintWeek(unixSecs: number): string {
  const date = new Date(unixSecs * 1000);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

const rate = (part: number, whole: number) => (whole ? part / whole : 0);

/**
 * Pure funnel aggregation over half-card records. `now` (unix seconds) splits the
 * unclaimed ones into still-open and expired using the contract's rule: a half-card's
 * window closes once `now > created + VOUCH_TTL_SECS`. A late claim (after the window, or
 * even after a slash) still counts as claimed — the contract accepts it.
 */
export function aggregateVouchFunnel(
  records: readonly VouchRecord[],
  { now, unread = 0 }: { now: number; unread?: number },
): VouchFunnel {
  const cohorts = new Map<string, Omit<VouchCohort, 'week' | 'completionRate'>>();
  const vouchers = new Set<string>();
  const pairClaims = new Map<string, number>();
  let claimed = 0;
  let open = 0;
  let expiredUnclaimed = 0;

  for (const vouch of records) {
    const week = mintWeek(vouch.created);
    const cohort = cohorts.get(week) ?? { minted: 0, claimed: 0, open: 0, expiredUnclaimed: 0 };
    cohort.minted++;
    vouchers.add(vouch.from);
    if (vouch.claimed) {
      cohort.claimed++;
      claimed++;
      if (vouch.claimer) {
        const pair = `${vouch.from}\u0000${vouch.claimer}`;
        pairClaims.set(pair, (pairClaims.get(pair) ?? 0) + 1);
      }
    } else if (vouch.slashed || now > vouch.created + VOUCH_TTL_SECS) {
      cohort.expiredUnclaimed++;
      expiredUnclaimed++;
    } else {
      cohort.open++;
      open++;
    }
    cohorts.set(week, cohort);
  }

  // Every claim after a pair's first is a repeat.
  let repeatClaims = 0;
  for (const count of pairClaims.values()) repeatClaims += count - 1;

  return {
    minted: records.length,
    claimed,
    completionRate: rate(claimed, records.length),
    open,
    expiredUnclaimed,
    expiredRate: rate(expiredUnclaimed, records.length),
    distinctVouchers: vouchers.size,
    repeatPairShare: rate(repeatClaims, claimed),
    unread,
    weeklyCohorts: [...cohorts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, c]) => ({ week, ...c, completionRate: rate(c.claimed, c.minted) })),
  };
}

/** The one `rpc.Server` method the reader needs — injected so tests run without a network. */
export type LedgerEntryReader = Pick<rpc.Server, 'getLedgerEntries'>;

/** stellar-rpc's cap on keys per `getLedgerEntries` request. */
export const KEYS_PER_REQUEST = 200;

/**
 * Newest half-cards one read covers (50 requests); older ids count as `unread`. Past this
 * the durable indexer (#109) has to replace RPC-direct reads.
 */
export const MAX_VOUCH_READS = 10_000;

/** `getLedgerEntries` requests in flight at once. */
const PARALLEL_REQUESTS = 4;

function persistentKey(contractId: string, key: xdr.ScVal): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key,
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
}

// soroban-sdk encodes a #[contracttype] enum variant as a vec of its name and its fields.
const VOUCH_SEQ_KEY = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('VouchSeq')]).toXDR('base64');

function vouchKey(contractId: string, id: number): xdr.LedgerKey {
  return persistentKey(
    contractId,
    xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Vouch'), xdr.ScVal.scvU64(new xdr.Uint64(BigInt(id)))]),
  );
}

function toRecord(entry: rpc.Api.LedgerEntryResult): VouchRecord | null {
  try {
    const v = scValToNative(entry.val.contractData().val()) as Record<string, unknown>;
    if (typeof v?.from !== 'string') return null;
    return {
      id: Number(v.id),
      from: v.from,
      claimed: Boolean(v.claimed),
      claimer: typeof v.claimer === 'string' ? v.claimer : null,
      created: Number(v.created),
      slashed: Boolean(v.slashed),
    };
  } catch {
    return null;
  }
}

/**
 * Every readable half-card of the reputation contract `contractId`, oldest id first, plus
 * `total` — the contract's `VouchSeq`, i.e. how many were ever minted (ids are sequential
 * and never reused). `total - records.length` is what could not be read. Rejects when the
 * contract instance or any request fails: a partial read would skew every rate.
 */
export async function readVouchRecords(
  server: LedgerEntryReader,
  contractId: string,
): Promise<{ total: number; records: VouchRecord[] }> {
  const instance = await server.getLedgerEntries(
    persistentKey(contractId, xdr.ScVal.scvLedgerKeyContractInstance()),
  );
  const entry = instance.entries[0];
  if (!entry) throw new Error('reputation contract instance not found');
  const seq = (entry.val.contractData().val().instance().storage() ?? []).find(
    (e) => e.key().toXDR('base64') === VOUCH_SEQ_KEY,
  );
  const total = seq ? Number(scValToNative(seq.val())) : 0;
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('invalid VouchSeq');

  const batches: number[][] = [];
  for (let id = Math.max(1, total - MAX_VOUCH_READS + 1); id <= total; id += KEYS_PER_REQUEST) {
    const last = Math.min(total, id + KEYS_PER_REQUEST - 1);
    batches.push(Array.from({ length: last - id + 1 }, (_, i) => id + i));
  }
  const records: VouchRecord[] = [];
  for (let i = 0; i < batches.length; i += PARALLEL_REQUESTS) {
    const pages = await Promise.all(
      batches
        .slice(i, i + PARALLEL_REQUESTS)
        .map((ids) => server.getLedgerEntries(...ids.map((id) => vouchKey(contractId, id)))),
    );
    for (const page of pages) {
      for (const e of page.entries) {
        const record = toRecord(e);
        if (record) records.push(record);
      }
    }
  }
  records.sort((a, b) => a.id - b.id);
  return { total, records };
}
