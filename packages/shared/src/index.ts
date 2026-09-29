/**
 * @alvinmunk/shared — single source of truth for contract interfaces, event
 * schemas, and schema ids shared by the web app and (future) indexer.
 *
 * Keep the EVENT shapes in lockstep with the Soroban contracts. The canonical
 * `att_set` event is frozen (belts/00-strategy §4) — changing it breaks indexing.
 */

// ── Schema ids (namespacing for attestations). Issuers agree off-chain. ──
// `schema_id` is whatever the attester passes to `award_xp`; every deployed quest uses
// QUEST (scripts/redeploy-all.sh). Vouches never touch Earned, so no `att_set` carries 1.
export const SCHEMA = {
  /** Reserved, never emitted (formerly VOUCH). Do not reuse for a new namespace. */
  RESERVED: 1,
  QUEST: 2,
} as const;
export type SchemaId = (typeof SCHEMA)[keyof typeof SCHEMA];

// ── Canonical on-chain event topics (Symbol values in the contracts) ──
// FROZEN at Yellow belt (belts/02 + 00-strategy §4). Changing a shape breaks indexing.
export const EVENTS = {
  /** topics ('att_set', addr) · data v1 (schema_version, issuer, schema_id, amount, ts) — versioned fundable primitive (Earned) */
  ATTESTATION_SET: 'att_set',
  /** topics ('xp', addr) · data (amount, newTotal) — Earned track total */
  XP: 'xp',
  /** topics ('social', addr) · data (amount, newTotal) — Social track total (leaderboard source). `amount` is unsigned: compare newTotal with the previous total for the direction */
  SOCIAL: 'social',
  /** topics ('vouch', 'minted'|'claimed'|'slashed') · data minted (id, from) · claimed (id, from, claimer) · slashed (id, from, stake) */
  VOUCH: 'vouch',
  /** topics ('quest', 'created'|'awarded') · data created id · awarded (quest_id, recipient) */
  QUEST: 'quest',
  /** topics ('tipped', from, to) · data amount */
  TIPPED: 'tipped',
  /** topics ('reward', to) · data (reward_id, amount, claims) */
  REWARD: 'reward',
} as const;

// ── Mirrors of the on-chain read-view structs ──
// `Vouch` and `Profile` carry every `u64` as a `bigint`, because that is what
// `scValToNative` returns for one and a u64 does not fit a JS `number` in general. Narrow at
// the edge that needs it. `Attestation` is left narrowing its own `timestamp`: it is a unix
// second count, `getQuestAttestation` already normalises to a number, and callers do
// arithmetic on it.

// ── Mirror of the on-chain Attestation struct (read-view shape) ──
export interface Attestation {
  issuer: string; // G... address
  value: bigint;
  timestamp: number;
  revoked: boolean;
}

// ── Mirror of the on-chain Vouch struct (read-view shape of `get_vouch`) ──
export interface Vouch {
  id: bigint;
  from: string; // voucher address
  /** sha256(secret) — BytesN<32>; all zeros on a card minted with a claim key
   *  (`mint_vouch_signed`), whose key is read with `get_claim_key` */
  claim_hash: Uint8Array;
  note: string;
  claimed: boolean;
  /** Option<Address> — null until claimed */
  claimer: string | null;
  created: bigint; // ledger timestamp at mint
  /** Social XP escrowed at mint */
  stake: bigint;
  slashed: boolean;
}

/** Mirror of the on-chain `Profile` struct — all of `get_profile`, nothing else. Frozen
 *  (docs/ON_CHAIN_EVENTS.md): Soroban decodes a struct only when the returned map has
 *  exactly its fields, so new per-address data ships as its own view, like `get_counts`. */
export interface Profile {
  /** Social XP — leaderboard/fun, never cashable */
  social: bigint;
  /** Earned XP — the only track Rewards may gate USDC on */
  earned: bigint;
  /** true once the address has done at least one Earned (verified) action */
  verified: boolean;
}

/**
 * Every field of each mirror, in the contract's declaration order. A `#[contracttype]`
 * struct with named fields travels as an `ScVal::Map` keyed by field name (sorted by the
 * host), which `scValToNative` turns into a plain object with those keys: the decoders
 * below accept exactly these keys, so a field added, dropped or renamed on either side
 * throws instead of reading as `undefined`. `read-views.test.ts` checks the lists against
 * `contracts/reputation/src/lib.rs` and decodes the contract's own fixtures through them.
 */
export const VOUCH_FIELDS = [
  'id',
  'from',
  'claim_hash',
  'note',
  'claimed',
  'claimer',
  'created',
  'stake',
  'slashed',
] as const satisfies readonly (keyof Vouch)[];

export const PROFILE_FIELDS = [
  'social',
  'earned',
  'verified',
] as const satisfies readonly (keyof Profile)[];

/** `raw` as a struct object with exactly `fields`, or a thrown error naming the drift. */
function structOf(raw: unknown, name: string, fields: readonly string[]): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    const got = raw === null ? 'null' : Array.isArray(raw) ? 'an array' : typeof raw;
    throw new Error(`${name}: expected a contract struct, got ${got}`);
  }
  const keys = Object.keys(raw);
  const missing = fields.filter((f) => !keys.includes(f));
  const extra = keys.filter((k) => !fields.includes(k));
  if (missing.length || extra.length) {
    throw new Error(
      `${name}: contract fields drifted (missing: ${missing.join(', ') || '-'}; ` +
        `unknown: ${extra.join(', ') || '-'})`,
    );
  }
  return raw as Record<string, unknown>;
}

function u64Field(raw: unknown, what: string): bigint {
  if (typeof raw !== 'bigint') throw new Error(`${what}: expected a u64, got ${typeof raw}`);
  return raw;
}

function stringField(raw: unknown, what: string): string {
  if (typeof raw !== 'string') throw new Error(`${what}: expected a string, got ${typeof raw}`);
  return raw;
}

function boolField(raw: unknown, what: string): boolean {
  if (typeof raw !== 'boolean') throw new Error(`${what}: expected a bool, got ${typeof raw}`);
  return raw;
}

/**
 * Decode a `get_vouch` return value, as `scValToNative` hands it back, into {@link Vouch}:
 * `null` for `None` (an id that was never minted, which reads as `ScVal::Void`). An
 * `Option<Address>` field is its address or `null`; a `BytesN<32>` is a 32-byte buffer.
 */
export function decodeVouch(raw: unknown): Vouch | null {
  if (raw === null) return null;
  const v = structOf(raw, 'Vouch', VOUCH_FIELDS);
  const hash = v.claim_hash;
  if (!(hash instanceof Uint8Array) || hash.length !== 32) {
    throw new Error('Vouch.claim_hash: expected 32 bytes');
  }
  return {
    id: u64Field(v.id, 'Vouch.id'),
    from: stringField(v.from, 'Vouch.from'),
    claim_hash: Uint8Array.from(hash),
    note: stringField(v.note, 'Vouch.note'),
    claimed: boolField(v.claimed, 'Vouch.claimed'),
    claimer: v.claimer === null ? null : stringField(v.claimer, 'Vouch.claimer'),
    created: u64Field(v.created, 'Vouch.created'),
    stake: u64Field(v.stake, 'Vouch.stake'),
    slashed: boolField(v.slashed, 'Vouch.slashed'),
  };
}

/**
 * Decode a `get_profile` return value, as `scValToNative` hands it back, into
 * {@link Profile}. The address is the call's argument, never a field: `Profile` carries no
 * subject of its own.
 */
export function decodeProfile(raw: unknown): Profile {
  const p = structOf(raw, 'Profile', PROFILE_FIELDS);
  return {
    social: u64Field(p.social, 'Profile.social'),
    earned: u64Field(p.earned, 'Profile.earned'),
    verified: boolField(p.verified, 'Profile.verified'),
  };
}

// ── Network config ──
export type StellarNetwork = 'testnet' | 'mainnet';

export interface ContractIds {
  reputation: string;
  questRegistry: string;
  rewards: string;
  usdcSac: string;
  registry: string;
  gate: string;
}

export interface NetworkConfig {
  network: StellarNetwork;
  rpcUrl: string;
  networkPassphrase: string;
  horizonUrl: string;
  contracts: ContractIds;
}

export const PASSPHRASE = {
  testnet: 'Test SDF Network ; September 2015',
  mainnet: 'Public Global Stellar Network ; September 2015',
} as const;

/**
 * Default URLs per network. Testnet has SDF's public endpoints; mainnet has SDF's public
 * Horizon but no keyless public RPC, so a mainnet deploy must set NEXT_PUBLIC_RPC_URL — an
 * unset one stays empty and `validateNetworkConfig` reports it, instead of the old silent
 * fallback to testnet's RPC.
 */
export const DEFAULT_URLS: Record<StellarNetwork, { rpcUrl: string; horizonUrl: string }> = {
  testnet: {
    rpcUrl: 'https://soroban-testnet.stellar.org',
    horizonUrl: 'https://horizon-testnet.stellar.org',
  },
  mainnet: { rpcUrl: '', horizonUrl: 'https://horizon.stellar.org' },
};

/** An env value, trimmed, with blank treated as unset (`FOO=` in a .env file is ''). */
function envValue(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

/**
 * Reads the public NEXT_PUBLIC_* env into a typed config (client + server safe). It never
 * throws: the network name is normalised ("Mainnet " → mainnet), and anything that is still
 * wrong — an unknown network, a passphrase for the other network, a missing mainnet RPC URL —
 * is reported by `validateNetworkConfig`, which blocks signing and shows the config banner.
 */
export function readNetworkConfig(env: Record<string, string | undefined>): NetworkConfig {
  const rawNetwork = env.NEXT_PUBLIC_STELLAR_NETWORK;
  // Only an absent variable means testnet; an empty or unknown value stays as typed so the
  // validator names it.
  const network = (rawNetwork === undefined ? 'testnet' : rawNetwork.trim().toLowerCase()) as StellarNetwork;
  const known = network === 'testnet' || network === 'mainnet';
  const defaults = known ? DEFAULT_URLS[network] : DEFAULT_URLS.testnet;
  return {
    network,
    rpcUrl: envValue(env.NEXT_PUBLIC_RPC_URL) ?? defaults.rpcUrl,
    networkPassphrase: envValue(env.NEXT_PUBLIC_NETWORK_PASSPHRASE) ?? (known ? PASSPHRASE[network] : ''),
    horizonUrl: envValue(env.NEXT_PUBLIC_HORIZON_URL) ?? defaults.horizonUrl,
    contracts: {
      reputation: env.NEXT_PUBLIC_REPUTATION_CONTRACT_ID ?? '',
      questRegistry: env.NEXT_PUBLIC_QUEST_REGISTRY_CONTRACT_ID ?? '',
      rewards: env.NEXT_PUBLIC_REWARDS_CONTRACT_ID ?? '',
      usdcSac: env.NEXT_PUBLIC_USDC_SAC_ID ?? '',
      registry: env.NEXT_PUBLIC_REGISTRY_CONTRACT_ID ?? '',
      gate: env.NEXT_PUBLIC_GATE_CONTRACT_ID ?? '',
    },
  };
}

/** The env var behind each contract id — validation errors name it, so the fix is obvious. */
const CONTRACT_ENV: Record<keyof ContractIds, string> = {
  reputation: 'NEXT_PUBLIC_REPUTATION_CONTRACT_ID',
  questRegistry: 'NEXT_PUBLIC_QUEST_REGISTRY_CONTRACT_ID',
  rewards: 'NEXT_PUBLIC_REWARDS_CONTRACT_ID',
  usdcSac: 'NEXT_PUBLIC_USDC_SAC_ID',
  registry: 'NEXT_PUBLIC_REGISTRY_CONTRACT_ID',
  gate: 'NEXT_PUBLIC_GATE_CONTRACT_ID',
};

/** Does `url` name `network`'s infrastructure? (SDF's public Horizon carries no network in its name.) */
function pointsAt(url: string, network: StellarNetwork): boolean {
  if (network === 'testnet') return /testnet/i.test(url);
  return /mainnet/i.test(url) || /^https?:\/\/horizon\.stellar\.org(?:[:/]|$)/i.test(url);
}

/**
 * Everything wrong with a resolved network config, one specific reason per problem (empty =
 * consistent). This is THE validation: /api/health reports it, the client shows it, and the
 * routes that sign or submit refuse to run on it — so a half-applied mainnet cutover (flipping
 * `NEXT_PUBLIC_STELLAR_NETWORK=mainnet` but leaving a testnet RPC, passphrase or contract id
 * behind, the likeliest mainnet launch failure) fails loudly instead of in confusing ways.
 *
 * Rules:
 *  - the network is `testnet` or `mainnet`;
 *  - the passphrase is that network's — an override that disagrees is rejected;
 *  - the RPC and Horizon URLs are set and don't point at the other network;
 *  - on mainnet, all six contract ids are set. Testnet allows empty ones, so a fresh
 *    checkout runs before the deploy script has printed them.
 */
export function validateNetworkConfig(cfg: NetworkConfig): string[] {
  const { network } = cfg;
  if (network !== 'testnet' && network !== 'mainnet') {
    return [`NEXT_PUBLIC_STELLAR_NETWORK must be "testnet" or "mainnet", not "${String(network)}"`];
  }
  const other: StellarNetwork = network === 'mainnet' ? 'testnet' : 'mainnet';
  const errors: string[] = [];

  if (cfg.networkPassphrase !== PASSPHRASE[network]) {
    const got =
      cfg.networkPassphrase === PASSPHRASE[other]
        ? `the ${other} passphrase`
        : `"${cfg.networkPassphrase}"`;
    errors.push(
      `NEXT_PUBLIC_NETWORK_PASSPHRASE is ${got}, but the network is ${network} ("${PASSPHRASE[network]}")`,
    );
  }

  const urls = [
    ['NEXT_PUBLIC_RPC_URL', cfg.rpcUrl],
    ['NEXT_PUBLIC_HORIZON_URL', cfg.horizonUrl],
  ] as const;
  for (const [envKey, url] of urls) {
    if (!url) errors.push(`${envKey} is empty`);
    else if (pointsAt(url, other)) {
      errors.push(`${envKey} points at ${other}, but the network is ${network}: ${url}`);
    }
  }

  if (network === 'mainnet') {
    for (const [key, envKey] of Object.entries(CONTRACT_ENV) as [keyof ContractIds, string][]) {
      if (!cfg.contracts[key]) errors.push(`${envKey} is not set — every contract id is required on mainnet`);
    }
  }

  return errors;
}

/** Deterministic generative-art seed from a wallet address (Genesis Stamp / vouch sigil). */
export function artSeed(address: string): number {
  let h = 2166136261;
  for (let i = 0; i < address.length; i++) {
    h ^= address.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * The generative-art DNA for a passport stamp/sigil, derived deterministically from
 * an address. Encodes BOTH hues AND a polygon shape so it never relies on color alone
 * (a11y — belts/01-white-belt). Locked at White belt; reused by every later card type.
 */
export interface StampArt {
  seed: number;
  hue: number; // 0-359
  hue2: number; // 0-359
  /** SVG polygon points string in a 100x100 viewBox. */
  points: string;
  /** number of vertices (shape signal, independent of color) */
  vertices: number;
}

export function stampArt(address: string, vertices = 5): StampArt {
  const seed = artSeed(address);
  const pts: string[] = [];
  for (let i = 0; i < vertices; i++) {
    const a = ((seed >> (i * 3)) % 100) + i * 17;
    const x = 50 + 28 * Math.cos((a / 100) * Math.PI * 2);
    const y = 50 + 28 * Math.sin((a / 100) * Math.PI * 2);
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return {
    seed,
    hue: seed % 360,
    hue2: (seed >> 9) % 360,
    points: pts.join(' '),
    vertices,
  };
}

// ── Leaderboard (pure, testable) — folds Social-track events into a ranking ──

/** One parsed `social` event: the running total for an address at some point. */
export interface SocialRecord {
  address: string;
  /** newTotal from the event's data[1] */
  total: number;
  /** ledger (for tie-break / recency); higher = more recent */
  ledger: number;
}

export interface LeaderboardEntry {
  rank: number;
  address: string;
  score: number;
  /** flagged by reciprocal-ring detection (belts/08-anti-sybil; full clustering at Blue) */
  flagged: boolean;
}

/** Merge prior + new social records, keeping the latest (highest-ledger) per address.
 * Used to persist a client-side snapshot so scores survive the RPC retention window. */
export function mergeSocialRecords(a: SocialRecord[], b: SocialRecord[]): SocialRecord[] {
  const latest = new Map<string, SocialRecord>();
  for (const r of [...a, ...b]) {
    const prev = latest.get(r.address);
    if (!prev || r.ledger >= prev.ledger) latest.set(r.address, r);
  }
  return [...latest.values()];
}

/** A claimed vouch edge (from vouched, claimer claimed). */
export interface VouchPair {
  from: string;
  claimer: string;
}

/** Flag addresses that form a reciprocal pair (A→B and B→A) — the cheapest ring
 * signal. Full cluster detection (A→B→C→A, funding clusters) lands at Blue belt. */
export function detectReciprocalRings(pairs: VouchPair[]): string[] {
  const edges = new Set(pairs.map((p) => `${p.from}>${p.claimer}`));
  const flagged = new Set<string>();
  for (const p of pairs) {
    if (edges.has(`${p.claimer}>${p.from}`)) {
      flagged.add(p.from);
      flagged.add(p.claimer);
    }
  }
  return [...flagged].sort();
}

/** Why an address was flagged by {@link detectRingCandidates}. */
export type RingReason = 'reciprocal' | 'cycle3';

export interface RingCandidate {
  address: string;
  reasons: RingReason[];
}

/**
 * Ring candidates for the frozen set (belts/08): reciprocal pairs (A→B, B→A) and
 * three-member cycles (A→B→C→A) in the claimed-vouch graph. Self-loops and duplicate
 * edges are ignored, and a pair that merely goes back and forth is reported only as
 * `reciprocal`, never as a cycle. Output is sorted by address for stable diffs.
 *
 * There is deliberately no raw-degree rule: the most active honest users vouch for and
 * are vouched by many people, and would be the first false positives. Candidates are
 * signals to review, not verdicts.
 */
export function detectRingCandidates(pairs: VouchPair[]): RingCandidate[] {
  const adj = new Map<string, Set<string>>();
  for (const { from, claimer } of pairs) {
    if (from === claimer) continue;
    if (!adj.has(from)) adj.set(from, new Set());
    adj.get(from)!.add(claimer);
  }
  const has = (a: string, b: string) => adj.get(a)?.has(b) ?? false;
  const reasons = new Map<string, Set<RingReason>>();
  const flag = (addr: string, why: RingReason) => {
    if (!reasons.has(addr)) reasons.set(addr, new Set());
    reasons.get(addr)!.add(why);
  };

  for (const [a, outs] of adj) {
    for (const b of outs) {
      if (has(b, a)) {
        flag(a, 'reciprocal');
        flag(b, 'reciprocal');
      }
      for (const c of adj.get(b) ?? []) {
        if (c !== a && c !== b && has(c, a)) {
          flag(a, 'cycle3');
          flag(b, 'cycle3');
          flag(c, 'cycle3');
        }
      }
    }
  }

  return [...reasons.keys()].sort().map((address) => ({
    address,
    reasons: [...reasons.get(address)!].sort() as RingReason[],
  }));
}

/**
 * Fold raw `social` event records into the latest score per address, then rank
 * descending. Each event carries the *running total*, so the most recent ledger
 * wins per address. Deterministic tie-break by address for stable UI. Pass a
 * `flagged` set to mark suspected ring members.
 */
export function rankLeaderboard(
  records: SocialRecord[],
  flagged: Set<string> = new Set(),
): LeaderboardEntry[] {
  const latest = new Map<string, SocialRecord>();
  for (const r of records) {
    const prev = latest.get(r.address);
    if (!prev || r.ledger >= prev.ledger) latest.set(r.address, r);
  }
  return [...latest.values()]
    .sort((a, b) => b.total - a.total || a.address.localeCompare(b.address))
    .map((r, i) => ({
      rank: i + 1,
      address: r.address,
      score: r.total,
      flagged: flagged.has(r.address),
    }));
}

// ── Share link (the install funnel) ──

/** Path for a vouch claim link. `buildClaimPath(7)` -> '/claim/7'. */
export function buildClaimPath(vouchId: number | string): string {
  return `/claim/${vouchId}`;
}

/** Absolute claim URL given an origin. No trailing-slash surprises. */
export function buildClaimUrl(origin: string, vouchId: number | string): string {
  return `${origin.replace(/\/$/, '')}${buildClaimPath(vouchId)}`;
}

/** Short display form for an address: GABC…WXYZ */
export function shortAddr(address: string, lead = 4, tail = 4): string {
  if (!address || address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

export { isStellarAddress, type IsStellarAddressOptions } from './stellar-address';
