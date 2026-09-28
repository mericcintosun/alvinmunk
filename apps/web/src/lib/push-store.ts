/**
 * Push-subscription storage — shared by /api/push/subscribe and /api/push/notify.
 *
 * Storage strategy (order of preference):
 *   1. Upstash Redis (if KV_REST_API_URL + KV_REST_API_TOKEN are set)
 *   2. In-memory Map (single warm serverless instance — fine for testnet demos)
 *
 * Lives in lib/ (not inside a route file) because Next.js route modules may only export
 * route handlers; both push routes import this shared store so they see the same state.
 */

import { Redis } from '@upstash/redis';

export interface StoredSubscription {
  endpoint: string;
  subscription: PushSubscriptionJSON;
  walletAddress: string;
  /** All vouch IDs this device should receive notifications for. */
  vouchIds: number[];
  updatedAt: number;
}

/** Cached client — created once per warm instance. */
let _redis: Redis | null | 'uninitialized' = 'uninitialized';

/**
 * Return a thin KV interface backed by Upstash Redis, or null when KV is not configured.
 * If KV_REST_API_URL is set but the client fails to initialize, logs an error once and
 * returns null so callers can fall back to in-memory storage.
 */
export function getKv(): {
  get: (key: string) => Promise<StoredSubscription | null>;
  set: (key: string, value: StoredSubscription) => Promise<void>;
  del: (key: string) => Promise<void>;
  smembers: (key: string) => Promise<string[]>;
  sadd: (key: string, member: string) => Promise<void>;
  srem: (key: string, member: string) => Promise<void>;
} | null {
  if (_redis === 'uninitialized') {
    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;

    if (!url) {
      _redis = null;
    } else {
      try {
        _redis = new Redis({ url, token: token ?? '' });
      } catch (err) {
        console.error('[push-store] KV is configured but failed to initialise:', err);
        _redis = null;
      }
    }
  }

  if (!_redis) return null;

  const redis = _redis;
  return {
    get: (key: string) => redis.get<StoredSubscription>(key),
    set: (key: string, value: StoredSubscription) =>
      redis.set(key, value).then(() => undefined),
    del: (key: string) => redis.del(key).then(() => undefined),
    smembers: (key: string) => redis.smembers(key),
    sadd: (key: string, member: string) => redis.sadd(key, member).then(() => undefined),
    srem: (key: string, member: string) => redis.srem(key, member).then(() => undefined),
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
  walletIndex.get(wallet)!.add(key);
}
export function memDel(key: string): void {
  const existing = memStore.get(key);
  if (existing) {
    const wallet = existing.walletAddress.toLowerCase();
    walletIndex.get(wallet)?.delete(key);
  }
  memStore.delete(key);
}

/** Remove a subscription by endpoint (used to prune revoked endpoints on 410/404). */
export async function removeSubscription(endpoint: string): Promise<void> {
  const key = `sub:${endpoint.slice(0, 512)}`;
  const kv = getKv();
  if (kv) {
    // Fetch wallet address before deleting so we can srem from the index.
    const existing = await kv.get(key);
    await kv.del(key);
    if (existing) {
      const wallet = existing.walletAddress.toLowerCase();
      await kv.srem(`wallet:${wallet}`, endpoint.slice(0, 512));
    }
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
