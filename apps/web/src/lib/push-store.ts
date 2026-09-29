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
  };
}

// In-memory fallback — module-level Maps that survive within a single warm instance.
const memStore = new Map<string, StoredSubscription>();
/** wallet → Set of endpoints */
const walletIndex = new Map<string, Set<string>>();

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

/** Retrieve all subscriptions for a wallet address (used by /api/push/notify). */
export async function getSubscriptionsForWallet(walletAddress: string): Promise<StoredSubscription[]> {
  const kv = getKv();
  const wallet = walletAddress.toLowerCase();

  if (kv) {
    const endpoints = await kv.smembers(`wallet:${wallet}`).catch(() => [] as string[]);
    const subs = await Promise.all(endpoints.map((ep) => kv.get(`sub:${ep}`).catch(() => null)));
    return subs.filter(Boolean) as StoredSubscription[];
  }
  const endpoints = walletIndex.get(wallet) ?? new Set<string>();
  return [...endpoints].map((ep) => memGet(`sub:${ep}`)).filter(Boolean) as StoredSubscription[];
}
