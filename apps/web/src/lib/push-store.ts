/**
 * Push-subscription storage — shared by /api/push/subscribe and /api/push/notify.
 *
 * Storage strategy (order of preference):
 *   1. Upstash Redis / Vercel KV (if KV_REST_API_URL + KV_REST_API_TOKEN are set)
 *   2. In-memory Map (single warm serverless instance — fine for testnet demos)
 *
 * KV key schema: `sub:<endpoint>` → StoredSubscription, and `wallet:<lowercased address>` →
 * set of endpoints registered for that wallet.
 *
 * Lives in lib/ (not inside a route file) because Next.js route modules may only export
 * route handlers; both push routes import this shared store so they see the same state.
 */

// Static import so Next's output file tracing copies the client into the function bundle.
import { Redis } from '@upstash/redis';

export interface StoredSubscription {
  endpoint: string;
  subscription: PushSubscriptionJSON;
  walletAddress: string;
  /** All vouch IDs this device should receive notifications for. */
  vouchIds: number[];
  updatedAt: number;
}

type KvStore = {
  get: (key: string) => Promise<StoredSubscription | null>;
  set: (key: string, value: StoredSubscription) => Promise<void>;
  del: (key: string) => Promise<void>;
  smembers: (key: string) => Promise<string[]>;
  sadd: (key: string, member: string) => Promise<void>;
  srem: (key: string, member: string) => Promise<void>;
  /** A plain string value (the tip-notification cron's cursor). */
  getString: (key: string) => Promise<string | null>;
  setString: (key: string, value: string) => Promise<void>;
  /** SET NX EX: true only for the caller that created the key (an atomic claim). */
  setIfAbsent: (key: string, value: string, ttlSeconds: number) => Promise<boolean>;
};

/** Cap endpoint length to avoid KV key blowup. */
const MAX_ENDPOINT = 512;

/** The store built for the last-seen env config, reused while that config is unchanged. */
let cached: { url: string; token: string; store: KvStore | null } | null = null;

/**
 * Return a KV store backed by Upstash Redis, or null when KV is not configured. The env is
 * read on every call; a config that is set but unusable logs an error once and returns null,
 * so callers fall back to the in-memory store.
 */
export function getKv(): KvStore | null {
  const url = process.env.KV_REST_API_URL ?? '';
  const token = process.env.KV_REST_API_TOKEN ?? '';
  if (!url && !token) return null;
  if (cached?.url !== url || cached.token !== token) {
    cached = { url, token, store: createKvStore(url, token) };
  }
  return cached.store;
}

function createKvStore(url: string, token: string): KvStore | null {
  if (!url || !token) {
    console.error(
      '[push-store] KV needs both KV_REST_API_URL and KV_REST_API_TOKEN — using the in-memory store',
    );
    return null;
  }
  let redis: Redis;
  try {
    redis = new Redis({ url, token });
  } catch (err) {
    console.error('[push-store] KV is configured but unusable — using the in-memory store:', err);
    return null;
  }
  return {
    get: (key) => redis.get<StoredSubscription>(key),
    set: (key, value) => redis.set(key, value).then(() => undefined),
    del: (key) => redis.del(key).then(() => undefined),
    smembers: (key) => redis.smembers(key),
    sadd: (key, member) => redis.sadd(key, member).then(() => undefined),
    srem: (key, member) => redis.srem(key, member).then(() => undefined),
    // The client JSON-decodes what it reads back, so coerce: a cursor must stay a string.
    getString: (key) => redis.get<unknown>(key).then((v) => (v == null ? null : String(v))),
    setString: (key, value) => redis.set(key, value).then(() => undefined),
    setIfAbsent: (key, value, ttlSeconds) =>
      redis.set(key, value, { nx: true, ex: ttlSeconds }).then((res) => res === 'OK'),
  };
}

// In-memory fallback — module-level Maps that survive within a single warm instance.
const memStore = new Map<string, StoredSubscription>();
/** wallet → Set of endpoints */
const walletIndex = new Map<string, Set<string>>();
/** Fallback cursor storage when KV is not configured. */
const memCursors = new Map<string, string>();
/** Fallback claimed-event storage: key → expiry timestamp (ms). */
const memClaims = new Map<string, number>();

export function memGet(key: string): StoredSubscription | null {
  return memStore.get(key) ?? null;
}
export function memSet(key: string, value: StoredSubscription): void {
  memStore.set(key, value);
  const wallet = value.walletAddress.toLowerCase();
  if (!walletIndex.has(wallet)) walletIndex.set(wallet, new Set());
  walletIndex.get(wallet)!.add(value.endpoint);
}
export function memDel(key: string): void {
  const existing = memStore.get(key);
  if (existing) {
    const wallet = existing.walletAddress.toLowerCase();
    walletIndex.get(wallet)?.delete(existing.endpoint);
  }
  memStore.delete(key);
}

/**
 * Upsert the subscription for `subscription.endpoint` and add `vouchId` to the vouch IDs it
 * is notified about (used by POST /api/push/subscribe).
 */
export async function saveSubscription(
  subscription: PushSubscriptionJSON,
  walletAddress: string,
  vouchId: number,
): Promise<void> {
  if (!subscription.endpoint) throw new Error('[push-store] subscription has no endpoint');
  const endpoint = subscription.endpoint.slice(0, MAX_ENDPOINT);
  const key = `sub:${endpoint}`;
  const wallet = walletAddress.toLowerCase();
  const kv = getKv();

  const existing = kv ? await kv.get(key) : memGet(key);
  const record: StoredSubscription = {
    endpoint,
    subscription,
    walletAddress: wallet,
    vouchIds: Array.from(new Set([...(existing?.vouchIds ?? []), vouchId])),
    updatedAt: Date.now(),
  };

  if (kv) {
    await kv.set(key, record);
    // Maintain wallet → endpoint index.
    await kv.sadd(`wallet:${wallet}`, endpoint);
  } else {
    memSet(key, record);
  }
}

/**
 * Upsert the subscription for `subscription.endpoint`, replacing its vouch ID set with
 * `vouchIds` (used by POST /api/push/subscribe when a rotated subscription re-registers
 * with every still-pending vouch — #169).
 */
export async function saveSubscriptionWithVouchIds(
  subscription: PushSubscriptionJSON,
  walletAddress: string,
  vouchIds: number[],
): Promise<void> {
  if (!subscription.endpoint) throw new Error('[push-store] subscription has no endpoint');
  const endpoint = subscription.endpoint.slice(0, MAX_ENDPOINT);
  const key = `sub:${endpoint}`;
  const wallet = walletAddress.toLowerCase();
  const kv = getKv();

  const existing = kv ? await kv.get(key) : memGet(key);
  const record: StoredSubscription = {
    endpoint,
    subscription,
    walletAddress: wallet,
    vouchIds: Array.from(new Set([...(existing?.vouchIds ?? []), ...vouchIds])),
    updatedAt: Date.now(),
  };

  if (kv) {
    await kv.set(key, record);
    // Maintain wallet → endpoint index.
    await kv.sadd(`wallet:${wallet}`, endpoint);
  } else {
    memSet(key, record);
  }
}

/**
 * Remove a subscription by endpoint, including its wallet-index entry (used by
 * DELETE /api/push/subscribe and to prune revoked endpoints on 410/404).
 */
export async function removeSubscription(endpoint: string): Promise<void> {
  const ep = endpoint.slice(0, MAX_ENDPOINT);
  const key = `sub:${ep}`;
  const kv = getKv();
  if (kv) {
    // Read the owning wallet before deleting so the endpoint can leave its index too.
    const existing = await kv.get(key);
    await kv.del(key);
    if (existing) await kv.srem(`wallet:${existing.walletAddress.toLowerCase()}`, ep);
  } else {
    memDel(key);
  }
}

/** Read one subscription record by endpoint (used by the PATCH ownership check). */
export async function getSubscriptionByEndpoint(endpoint: string): Promise<StoredSubscription | null> {
  const key = `sub:${endpoint.slice(0, MAX_ENDPOINT)}`;
  const kv = getKv();
  return kv ? kv.get(key) : memGet(key);
}

/**
 * Move a subscription record from `oldEndpoint` to `newEndpoint` — the server-side half of
 * handling pushsubscriptionchange (push services rotate/expire endpoints; see issue #169).
 * Keeps the stored `walletAddress` and `vouchIds` untouched, only swapping the endpoint,
 * the subscription JSON, and the updatedAt timestamp.
 *
 * `ownerWallet` must match the stored walletAddress (case-insensitive) so a client cannot
 * hijack a subscription record it does not own (the same proof shape DELETE uses).
 * Returns 'moved' on success, 'not_found' / 'forbidden' / 'conflict' on failure.
 */
export async function moveSubscription(
  oldEndpoint: string,
  newEndpoint: string,
  subscription: StoredSubscription['subscription'],
  ownerWallet: string,
): Promise<'moved' | 'not_found' | 'forbidden' | 'conflict'> {
  const oldEp = oldEndpoint.slice(0, MAX_ENDPOINT);
  const newEp = newEndpoint.slice(0, MAX_ENDPOINT);
  const oldKey = `sub:${oldEp}`;
  const newKey = `sub:${newEp}`;
  const kv = getKv();

  const existing = kv ? await kv.get(oldKey) : memGet(oldKey);
  if (!existing || existing.endpoint !== oldEndpoint) return 'not_found';
  if (existing.walletAddress.toLowerCase() !== ownerWallet.toLowerCase()) return 'forbidden';
  if (newKey !== oldKey && (kv ? await kv.get(newKey) : memGet(newKey))) return 'conflict';

  const moved: StoredSubscription = {
    ...existing,
    endpoint: newEp,
    subscription,
    updatedAt: Date.now(),
  };

  if (kv) {
    await kv.set(newKey, moved);
    await kv.del(oldKey);
    const wallet = moved.walletAddress.toLowerCase();
    await kv.srem(`wallet:${wallet}`, oldEp);
    await kv.sadd(`wallet:${wallet}`, newEp);
  } else {
    // Write the new record first, then remove the old key. On a same-key move (endpoint
    // unchanged) this must be a plain overwrite — the pair memSet+memDel(oldKey) would
    // delete the record outright.
    memStore.set(newKey, moved);
    const wallet = moved.walletAddress.toLowerCase();
    if (!walletIndex.has(wallet)) walletIndex.set(wallet, new Set());
    // The index stores bare endpoints (see memSet/memDel), not `sub:`-prefixed keys.
    walletIndex.get(wallet)!.add(newEp);
    if (oldKey !== newKey) memDel(oldKey);
  }

  return 'moved';
}

/**
 * Retrieve all subscriptions for a wallet address (used by /api/push/notify and the tip
 * cron). Only records still registered to that wallet: a device that re-subscribed for
 * another wallet leaves a stale index entry behind, and must not get this wallet's pushes.
 */
export async function getSubscriptionsForWallet(walletAddress: string): Promise<StoredSubscription[]> {
  const kv = getKv();
  const wallet = walletAddress.toLowerCase();
  const owned = (s: StoredSubscription | null): s is StoredSubscription =>
    !!s && s.walletAddress.toLowerCase() === wallet;

  if (kv) {
    const endpoints = await kv.smembers(`wallet:${wallet}`).catch(() => [] as string[]);
    const subs = await Promise.all(endpoints.map((ep) => kv.get(`sub:${ep}`).catch(() => null)));
    return subs.filter(owned);
  }
  const endpoints = walletIndex.get(wallet) ?? new Set<string>();
  // The index stores bare endpoints (see memSet/memDel), so reconstruct the `sub:` key.
  return [...endpoints].map((ep) => memGet(`sub:${ep}`)).filter(owned);
}

// ─── Tip-notification cron: cursor + per-event claims (issue #297) ──────────

/** KV key for the tip-notification cron's RPC event cursor. */
const CURSOR_KEY = 'cursor:notify:tip';

/** KV key prefix of the per-event claims that keep a tip from being pushed twice. */
const CLAIM_PREFIX = 'seen:notify:tip:';

/**
 * How long a claim lives: longer than any event the cron can read again — it re-reads at
 * most the RPC's recent window (~12h, lib/events) after losing its cursor — so a re-read
 * never sends twice.
 */
export const EVENT_CLAIM_TTL_SECONDS = 3 * 24 * 60 * 60;

/** The cron's RPC cursor; null before its first run. */
export async function getCursor(): Promise<string | null> {
  const kv = getKv();
  if (kv) return kv.getString(CURSOR_KEY);
  return memCursors.get(CURSOR_KEY) ?? null;
}

/** Persist the cron's RPC cursor, once every event before it has been handled. */
export async function setCursor(cursor: string): Promise<void> {
  const kv = getKv();
  if (kv) {
    await kv.setString(CURSOR_KEY, cursor);
    return;
  }
  memCursors.set(CURSOR_KEY, cursor);
}

/**
 * Claim `eventId` for sending: true for exactly one caller, false once it has been claimed
 * — by an earlier run, or by an overlapping one (SET NX). A claimed event is never sent
 * again, whatever happened to its push: at most one notification per tip.
 */
export async function claimEvent(eventId: string): Promise<boolean> {
  const key = CLAIM_PREFIX + eventId;
  const kv = getKv();
  if (kv) return kv.setIfAbsent(key, '1', EVENT_CLAIM_TTL_SECONDS);
  const now = Date.now();
  const expiresAt = memClaims.get(key);
  if (expiresAt !== undefined && expiresAt > now) return false;
  memClaims.set(key, now + EVENT_CLAIM_TTL_SECONDS * 1000);
  return true;
}

// ─── General opt-in (issue #297) ────────────────────────────────────────────

/**
 * Upsert a subscription with no vouch ID — the general opt-in from the dashboard, which
 * is what tip notifications need. Keeps any vouch IDs the device already registered.
 */
export async function saveGeneralSubscription(
  subscription: PushSubscriptionJSON,
  walletAddress: string,
): Promise<void> {
  await saveSubscriptionWithVouchIds(subscription, walletAddress, []);
}
