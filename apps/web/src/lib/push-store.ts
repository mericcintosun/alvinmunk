/**
 * Push-subscription storage — shared by /api/push/subscribe and /api/push/notify.
 *
 * Storage strategy (order of preference):
 *   1. Vercel KV (if KV_REST_API_URL + KV_REST_API_TOKEN are set)
 *   2. In-memory Map (single warm serverless instance — fine for testnet demos)
 *
 * Lives in lib/ (not inside a route file) because Next.js route modules may only export
 * route handlers; both push routes import this shared store so they see the same state.
 */

import { kv } from '@vercel/kv';

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

/** Return a KV store adapter when KV env vars are present, otherwise null. */
export function getKv(): KvStore | null {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;

  try {
    // Verify the module loaded correctly — the import is static so bundling is reliable.
    if (!kv) throw new Error('@vercel/kv exported nothing');
    return {
      get: (key: string) => kv.get<StoredSubscription>(key),
      set: (key: string, value: StoredSubscription) =>
        kv.set(key, value).then(() => undefined),
      del: (key: string) => kv.del(key).then(() => undefined),
      smembers: (key: string) => kv.smembers(key),
      sadd: (key: string, member: string) =>
        kv.sadd(key, member).then(() => undefined),
      srem: (key: string, member: string) =>
        kv.srem(key, member).then(() => undefined),
    };
  } catch (err) {
    console.error('[push-store] KV_REST_API_URL is set but @vercel/kv failed to load:', err);
    return null;
  }
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
  const ep = endpoint.slice(0, 512);
  const key = `sub:${ep}`;
  const kv = getKv();
  if (kv) {
    // Read wallet address before deleting so we can srem from the wallet index.
    const existing = await kv.get(key);
    await kv.del(key);
    if (existing) {
      await kv.srem(`wallet:${existing.walletAddress.toLowerCase()}`, ep);
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
