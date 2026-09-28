/**
 * Push-subscription storage — shared by /api/push/subscribe and /api/push/notify.
 *
 * Storage strategy (order of preference):
 *   1. Vercel KV (if @vercel/kv is installed and KV_REST_API_URL is set)
 *   2. In-memory Map (single warm serverless instance — fine for testnet demos)
 *
 * Lives in lib/ (not inside a route file) because Next.js route modules may only export
 * route handlers; both push routes import this shared store so they see the same state.
 */

export interface StoredSubscription {
  endpoint: string;
  subscription: PushSubscriptionJSON;
  walletAddress: string;
  /** All vouch IDs this device should receive notifications for. */
  vouchIds: number[];
  updatedAt: number;
}

/** Attempt to load Vercel KV at runtime — falls back to in-memory if unavailable. */
export async function getKv(): Promise<{
  get: (key: string) => Promise<StoredSubscription | null>;
  set: (key: string, value: StoredSubscription) => Promise<void>;
  del: (key: string) => Promise<void>;
  smembers: (key: string) => Promise<string[]>;
  sadd: (key: string, member: string) => Promise<void>;
} | null> {
  try {
    if (!process.env.KV_REST_API_URL) return null;
    // Use a variable to prevent tsc from resolving @vercel/kv statically.
    const specifier = '@vercel/kv';
    /* eslint-disable-next-line -- dynamic optional import of an uninstalled package needs any */
    const kvModule: any = await import(/* webpackIgnore: true */ specifier).catch(() => null);
    if (!kvModule) return null;
    const kv = kvModule.kv;
    return {
      get: (key: string) => kv.get(key) as Promise<StoredSubscription | null>,
      set: (key: string, value: StoredSubscription) => kv.set(key, value) as Promise<void>,
      del: (key: string) => kv.del(key) as Promise<void>,
      smembers: (key: string) => kv.smembers(key) as Promise<string[]>,
      sadd: (key: string, member: string) => kv.sadd(key, member) as Promise<void>,
    };
  } catch {
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
  const key = `sub:${endpoint.slice(0, 512)}`;
  const kv = await getKv();
  if (kv) await kv.del(key);
  else memDel(key);
}

/** Retrieve all subscriptions for a wallet address (used by /api/push/notify). */
export async function getSubscriptionsForWallet(walletAddress: string): Promise<StoredSubscription[]> {
  const kv = await getKv();
  const wallet = walletAddress.toLowerCase();

  if (kv) {
    const endpoints = await kv.smembers(`wallet:${wallet}`).catch(() => [] as string[]);
    const subs = await Promise.all(endpoints.map((ep) => kv.get(`sub:${ep}`).catch(() => null)));
    return subs.filter(Boolean) as StoredSubscription[];
  }
  const endpoints = walletIndex.get(wallet) ?? new Set<string>();
  return [...endpoints].map((ep) => memGet(`sub:${ep}`)).filter(Boolean) as StoredSubscription[];
}
