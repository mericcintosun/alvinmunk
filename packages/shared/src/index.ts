/**
 * @passport/shared — single source of truth for contract interfaces, event
 * schemas, and schema ids shared by the web app and (future) indexer.
 *
 * Keep the EVENT shapes in lockstep with the Soroban contracts. The canonical
 * `att_set` event is frozen (belts/00-strategy §4) — changing it breaks indexing.
 */

// ── Schema ids (namespacing for attestations). Issuers agree off-chain. ──
export const SCHEMA = {
  VOUCH: 1,
  QUEST: 2,
} as const;
export type SchemaId = (typeof SCHEMA)[keyof typeof SCHEMA];

// ── Canonical on-chain event topics (Symbol values in the contracts) ──
// FROZEN at Yellow belt (belts/02 + 00-strategy §4). Changing a shape breaks indexing.
export const EVENTS = {
  /** topics ('att_set', addr) · data (issuer, schema_id, amount, ts) — fundable primitive (Earned) */
  ATTESTATION_SET: 'att_set',
  /** topics ('xp', addr) · data (amount, newTotal) — Earned track total */
  XP: 'xp',
  /** topics ('social', addr) · data (amount, newTotal) — Social track total (leaderboard source) */
  SOCIAL: 'social',
  /** topics ('vouch', 'minted'|'claimed') · data (id, from, to) */
  VOUCH: 'vouch',
  /** topics ('quest', 'created'|'awarded') · data varies */
  QUEST: 'quest',
  /** topics ('tipped', from, to) · data amount */
  TIPPED: 'tipped',
  /** topics ('reward', to) · data (reward_id, amount) */
  REWARD: 'reward',
} as const;

// ── Mirror of the on-chain Attestation struct (read-view shape) ──
export interface Attestation {
  issuer: string; // G... address
  value: bigint;
  timestamp: number;
  revoked: boolean;
}

export interface Vouch {
  id: number;
  from: string;
  to: string;
  note: string;
  claimed: boolean;
  created: number;
}

export interface Profile {
  address: string;
  score: bigint;
  attestations: Partial<Record<SchemaId, Attestation>>;
}

// ── Network config ──
export type StellarNetwork = 'testnet' | 'mainnet';

export interface ContractIds {
  reputation: string;
  questRegistry: string;
  rewards: string;
  usdcSac: string;
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

/** Reads the public NEXT_PUBLIC_* env into a typed config (client + server safe). */
export function readNetworkConfig(env: Record<string, string | undefined>): NetworkConfig {
  const network = (env.NEXT_PUBLIC_STELLAR_NETWORK as StellarNetwork) ?? 'testnet';
  return {
    network,
    rpcUrl: env.NEXT_PUBLIC_RPC_URL ?? 'https://soroban-testnet.stellar.org',
    networkPassphrase: env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? PASSPHRASE[network],
    horizonUrl: env.NEXT_PUBLIC_HORIZON_URL ?? 'https://horizon-testnet.stellar.org',
    contracts: {
      reputation: env.NEXT_PUBLIC_REPUTATION_CONTRACT_ID ?? '',
      questRegistry: env.NEXT_PUBLIC_QUEST_REGISTRY_CONTRACT_ID ?? '',
      rewards: env.NEXT_PUBLIC_REWARDS_CONTRACT_ID ?? '',
      usdcSac: env.NEXT_PUBLIC_USDC_SAC_ID ?? '',
    },
  };
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
}

/**
 * Fold raw `social` event records into the latest score per address, then rank
 * descending. Each event carries the *running total*, so the most recent ledger
 * wins per address. Deterministic tie-break by address for stable UI.
 */
export function rankLeaderboard(records: SocialRecord[]): LeaderboardEntry[] {
  const latest = new Map<string, SocialRecord>();
  for (const r of records) {
    const prev = latest.get(r.address);
    if (!prev || r.ledger >= prev.ledger) latest.set(r.address, r);
  }
  return [...latest.values()]
    .sort((a, b) => b.total - a.total || a.address.localeCompare(b.address))
    .map((r, i) => ({ rank: i + 1, address: r.address, score: r.total }));
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
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}
