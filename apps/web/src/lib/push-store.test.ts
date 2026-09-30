// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

// A tiny stand-in for the Upstash REST client: values are JSON-serialized like the real
// client's automatic (de)serialization, sets hold string members.
const { RedisMock, fake } = vi.hoisted(() => {
  const fake = {
    strings: new Map<string, string>(),
    /** TTL (seconds) each key was set with, when it had one. */
    ttls: new Map<string, number>(),
    sets: new Map<string, Set<string>>(),
    srem: null as unknown as Mock<(key: string, member: string) => Promise<number>>,
  };
  const client = () => {
    fake.srem = vi.fn(async (key: string, member: string) =>
      fake.sets.get(key)?.delete(member) ? 1 : 0,
    );
    return {
      get: async (key: string) => {
        const raw = fake.strings.get(key);
        return raw === undefined ? null : JSON.parse(raw);
      },
      set: async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
        if (opts?.nx && fake.strings.has(key)) return null;
        fake.strings.set(key, JSON.stringify(value));
        if (opts?.ex !== undefined) fake.ttls.set(key, opts.ex);
        return 'OK';
      },
      del: async (key: string) => (fake.strings.delete(key) ? 1 : 0),
      smembers: async (key: string) => [...(fake.sets.get(key) ?? [])],
      sadd: async (key: string, member: string) => {
        if (!fake.sets.has(key)) fake.sets.set(key, new Set());
        const set = fake.sets.get(key)!;
        const added = set.has(member) ? 0 : 1;
        set.add(member);
        return added;
      },
      srem: (key: string, member: string) => fake.srem(key, member),
    };
  };
  // `function` (not an arrow) so the store can call it with `new`.
  const RedisMock = vi.fn(function () {
    return client();
  });
  return { RedisMock, fake };
});

vi.mock('@upstash/redis', () => ({ Redis: RedisMock }));

type Store = typeof import('./push-store');

const KV_URL = 'https://kv.example.upstash.io';
const TOKEN = 'kv-token';
const A = 'https://push.example/a';
const B = 'https://push.example/b';
const C = 'https://push.example/c';

function sub(endpoint: string): PushSubscriptionJSON {
  return { endpoint, keys: { p256dh: 'p256dh', auth: 'auth' } };
}

let store: Store;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  fake.strings.clear();
  fake.ttls.clear();
  fake.sets.clear();
  RedisMock.mockClear();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  // Fresh module state (client cache + in-memory maps) for every test.
  vi.resetModules();
  store = await import('./push-store');
});

afterEach(() => {
  vi.unstubAllEnvs();
  errorSpy.mockRestore();
});

describe('push-store with KV configured', () => {
  beforeEach(() => {
    vi.stubEnv('KV_REST_API_URL', KV_URL);
    vi.stubEnv('KV_REST_API_TOKEN', TOKEN);
  });

  it('builds one Upstash client from the KV_REST_API_* env and reuses it', () => {
    expect(store.getKv()).not.toBeNull();
    expect(store.getKv()).not.toBeNull();
    expect(RedisMock).toHaveBeenCalledTimes(1);
    expect(RedisMock).toHaveBeenCalledWith({ url: KV_URL, token: TOKEN });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('saveSubscription writes the record and the wallet index through KV', async () => {
    await store.saveSubscription(sub(A), 'GABC', 7);

    const record = JSON.parse(fake.strings.get(`sub:${A}`)!);
    expect(record).toMatchObject({
      endpoint: A,
      subscription: sub(A),
      walletAddress: 'gabc',
      vouchIds: [7],
    });
    expect([...fake.sets.get('wallet:gabc')!]).toEqual([A]);
    // Nothing leaked into the per-instance fallback.
    expect(store.memGet(`sub:${A}`)).toBeNull();
  });

  it('saveSubscriptionWithVouchIds writes the full vouch set through KV (#169 re-register)', async () => {
    await store.saveSubscriptionWithVouchIds(sub(A), 'GABC', [7, 11]);

    const record = JSON.parse(fake.strings.get(`sub:${A}`)!);
    expect(record).toMatchObject({
      endpoint: A,
      walletAddress: 'gabc',
      vouchIds: [7, 11],
    });
    expect([...fake.sets.get('wallet:gabc')!]).toEqual([A]);
    expect(store.memGet(`sub:${A}`)).toBeNull();
  });

  it('merges vouch IDs without duplicates when a device re-subscribes', async () => {
    await store.saveSubscription(sub(A), 'GABC', 1);
    await store.saveSubscription(sub(A), 'GABC', 2);
    await store.saveSubscription(sub(A), 'GABC', 1);

    expect(JSON.parse(fake.strings.get(`sub:${A}`)!).vouchIds).toEqual([1, 2]);
    expect([...fake.sets.get('wallet:gabc')!]).toEqual([A]);
  });

  it('getSubscriptionsForWallet reads a wallet’s subscriptions back through KV', async () => {
    await store.saveSubscription(sub(A), 'GABC', 1);
    await store.saveSubscription(sub(B), 'GABC', 2);
    await store.saveSubscription(sub(C), 'GXYZ', 3);

    const subs = await store.getSubscriptionsForWallet('GABC');
    expect(subs.map((s) => s.endpoint).sort()).toEqual([A, B]);
    expect(subs.find((s) => s.endpoint === B)?.vouchIds).toEqual([2]);
    // The address match is case-insensitive.
    expect(await store.getSubscriptionsForWallet('gxyz')).toHaveLength(1);
  });

  it('removeSubscription deletes the record and drops the endpoint from the wallet index', async () => {
    await store.saveSubscription(sub(A), 'GABC', 1);
    await store.saveSubscription(sub(B), 'GABC', 2);

    await store.removeSubscription(A);

    expect(fake.strings.has(`sub:${A}`)).toBe(false);
    expect([...fake.sets.get('wallet:gabc')!]).toEqual([B]);
    expect(fake.srem).toHaveBeenCalledWith('wallet:gabc', A);
    const left = await store.getSubscriptionsForWallet('GABC');
    expect(left.map((s) => s.endpoint)).toEqual([B]);
  });

  it('removeSubscription of an unknown endpoint touches no wallet index', async () => {
    store.getKv(); // create the client so the srem spy exists
    await store.removeSubscription('https://push.example/unknown');
    expect(fake.srem).not.toHaveBeenCalled();
  });

  it('caps endpoints at 512 chars the same way on save and remove', async () => {
    const long = `https://push.example/${'x'.repeat(600)}`;
    const capped = long.slice(0, 512);

    await store.saveSubscription(sub(long), 'GABC', 1);
    expect(fake.strings.has(`sub:${capped}`)).toBe(true);
    expect([...fake.sets.get('wallet:gabc')!]).toEqual([capped]);

    await store.removeSubscription(long);
    expect(fake.strings.size).toBe(0);
    expect(fake.sets.get('wallet:gabc')!.size).toBe(0);
  });

  it('moveSubscription rewrites the record and both index entries through KV (#169)', async () => {
    await store.saveSubscription(sub(A), 'GABC', 7);
    await store.saveSubscription(sub(A), 'GABC', 11);

    const result = await store.moveSubscription(A, B, sub(B), 'GABC');

    expect(result).toBe('moved');
    expect(fake.strings.has(`sub:${A}`)).toBe(false);
    expect(JSON.parse(fake.strings.get(`sub:${B}`)!)).toMatchObject({
      endpoint: B,
      walletAddress: 'gabc',
      vouchIds: [7, 11],
    });
    expect([...fake.sets.get('wallet:gabc')!]).toEqual([B]);
    expect(fake.srem).toHaveBeenCalledWith('wallet:gabc', A);
    const subs = await store.getSubscriptionsForWallet('GABC');
    expect(subs.map((s) => s.endpoint)).toEqual([B]);
  });

  it('moveSubscription refuses an unknown old endpoint and a foreign wallet through KV', async () => {
    await store.saveSubscription(sub(A), 'GABC', 7);

    expect(await store.moveSubscription('https://push.example/none', B, sub(B), 'GABC')).toBe('not_found');
    expect(await store.moveSubscription(A, B, sub(B), 'GOTHER')).toBe('forbidden');
    // Nothing was written or reindexed.
    expect(fake.strings.has(`sub:${B}`)).toBe(false);
    expect([...fake.sets.get('wallet:gabc')!]).toEqual([A]);
  });

  it('moveSubscription refuses to overwrite an existing record at the new endpoint', async () => {
    await store.saveSubscription(sub(A), 'GABC', 7);
    await store.saveSubscription(sub(B), 'GABC', 42);

    expect(await store.moveSubscription(A, B, sub(B), 'GABC')).toBe('conflict');
    expect(JSON.parse(fake.strings.get(`sub:${B}`)!).vouchIds).toEqual([42]);
  });

  describe('tip-notification cron state (#297)', () => {
    it('round-trips the cursor through KV, always as a string', async () => {
      expect(await store.getCursor()).toBeNull();
      await store.setCursor('0000123-0000000001');
      expect(await store.getCursor()).toBe('0000123-0000000001');
      // The client JSON-decodes reads: a numeric-looking value still comes back a string.
      fake.strings.set('cursor:notify:tip', '123');
      expect(await store.getCursor()).toBe('123');
    });

    it('claims an event exactly once, with a TTL, through SET NX', async () => {
      expect(await store.claimEvent('e1')).toBe(true);
      expect(await store.claimEvent('e1')).toBe(false);
      expect(await store.claimEvent('e2')).toBe(true);
      expect(fake.ttls.get('seen:notify:tip:e1')).toBe(store.EVENT_CLAIM_TTL_SECONDS);
      expect(store.EVENT_CLAIM_TTL_SECONDS).toBeGreaterThan(24 * 60 * 60);
    });

    it('stores a general opt-in with no vouch, indexed for its wallet', async () => {
      await store.saveGeneralSubscription(sub(A), 'GABC');
      expect(JSON.parse(fake.strings.get(`sub:${A}`)!)).toMatchObject({
        endpoint: A,
        walletAddress: 'gabc',
        vouchIds: [],
      });
      expect(await store.getSubscriptionsForWallet('GABC')).toHaveLength(1);
    });

    it('keeps the vouch IDs a device already registered when it opts in generally', async () => {
      await store.saveSubscription(sub(A), 'GABC', 7);
      await store.saveGeneralSubscription(sub(A), 'GABC');
      expect(JSON.parse(fake.strings.get(`sub:${A}`)!).vouchIds).toEqual([7]);
    });

    it('does not hand a wallet the device that re-subscribed for another wallet', async () => {
      await store.saveGeneralSubscription(sub(A), 'GOLD');
      await store.saveGeneralSubscription(sub(A), 'GNEW'); // same browser, new wallet
      expect(await store.getSubscriptionsForWallet('GNEW')).toHaveLength(1);
      expect(await store.getSubscriptionsForWallet('GOLD')).toEqual([]);
    });
  });
});

describe('push-store with KV configured but unusable', () => {
  it.each([
    ['only the URL', { KV_REST_API_URL: KV_URL }],
    ['only the token', { KV_REST_API_TOKEN: TOKEN }],
  ])('logs once and falls back to memory when %s is set', async (_label, env) => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);

    expect(store.getKv()).toBeNull();
    expect(store.getKv()).toBeNull();
    await store.saveSubscription(sub(A), 'GABC', 1);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain('KV_REST_API_TOKEN');
    expect(RedisMock).not.toHaveBeenCalled();
    expect(store.memGet(`sub:${A}`)?.vouchIds).toEqual([1]);
  });

  it('logs once and falls back to memory when the Upstash client cannot be created', async () => {
    vi.stubEnv('KV_REST_API_URL', 'not a url');
    vi.stubEnv('KV_REST_API_TOKEN', TOKEN);
    const boom = new Error('invalid url');
    RedisMock.mockImplementationOnce(function () {
      throw boom;
    });

    expect(store.getKv()).toBeNull();
    expect(store.getKv()).toBeNull();
    await store.saveSubscription(sub(A), 'GABC', 1);

    expect(RedisMock).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]).toContain(boom);
    expect(store.memGet(`sub:${A}`)).not.toBeNull();
  });
});

describe('push-store without KV', () => {
  it('indexes subscriptions for wallet lookup and removes them from the index', async () => {
    await store.saveSubscription(sub(A), 'GABC', 1);

    expect(await store.getSubscriptionsForWallet('gabc')).toMatchObject([
      { endpoint: A, walletAddress: 'gabc', vouchIds: [1] },
    ]);

    await store.removeSubscription(A);

    expect(await store.getSubscriptionsForWallet('GABC')).toEqual([]);
    expect(store.memGet(`sub:${A}`)).toBeNull();
  });

  it('memSet indexes the record by its endpoint, not by the `sub:` store key', async () => {
    const record = {
      endpoint: A,
      subscription: sub(A),
      walletAddress: 'gabc',
      vouchIds: [1],
      updatedAt: Date.now(),
    };

    // Same shape memGet(`sub:${key}`) is called with elsewhere: the key passed to memSet
    // already carries the `sub:` prefix, so indexing it verbatim (instead of the bare
    // endpoint) would make getSubscriptionsForWallet's lookups miss.
    store.memSet(`sub:${A}`, record);

    expect(store.memGet(`sub:${A}`)).toEqual(record);
    expect(await store.getSubscriptionsForWallet('GABC')).toEqual([record]);
  });

  it('memDel drops only the removed endpoint from the wallet index, leaving siblings indexed', async () => {
    const recordA = {
      endpoint: A,
      subscription: sub(A),
      walletAddress: 'gabc',
      vouchIds: [1],
      updatedAt: Date.now(),
    };
    const recordB = {
      endpoint: B,
      subscription: sub(B),
      walletAddress: 'gabc',
      vouchIds: [2],
      updatedAt: Date.now(),
    };
    store.memSet(`sub:${A}`, recordA);
    store.memSet(`sub:${B}`, recordB);

    store.memDel(`sub:${A}`);

    expect(store.memGet(`sub:${A}`)).toBeNull();
    expect(await store.getSubscriptionsForWallet('gabc')).toEqual([recordB]);
  });

  it('memDel on an endpoint that was never stored is a no-op', async () => {
    expect(() => store.memDel(`sub:${A}`)).not.toThrow();
    expect(store.memGet(`sub:${A}`)).toBeNull();
    expect(await store.getSubscriptionsForWallet('gabc')).toEqual([]);
  });

  it('uses the in-memory store and never builds an Upstash client', async () => {
    expect(store.getKv()).toBeNull();

    await store.saveSubscription(sub(A), 'GABC', 1);
    await store.saveSubscription(sub(A), 'GABC', 2);
    expect(store.memGet(`sub:${A}`)).toMatchObject({
      endpoint: A,
      walletAddress: 'gabc',
      vouchIds: [1, 2],
    });

    await store.removeSubscription(A);
    expect(store.memGet(`sub:${A}`)).toBeNull();

    expect(RedisMock).not.toHaveBeenCalled();
    expect(fake.strings.size).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('moveSubscription keeps wallet and vouchIds on the rotated endpoint (#169)', async () => {
    await store.saveSubscription(sub(A), 'GABC', 7);
    await store.saveSubscription(sub(A), 'GABC', 11);

    const result = await store.moveSubscription(A, B, sub(B), 'gabc');

    expect(result).toBe('moved');
    expect(store.memGet(`sub:${A}`)).toBeNull(); // old key gone
    const moved = store.memGet(`sub:${B}`);
    expect(moved).not.toBeNull();
    expect(moved!.endpoint).toBe(B);
    expect(moved!.walletAddress).toBe('gabc'); // ownership kept
    expect(moved!.vouchIds).toEqual([7, 11]); // accumulated vouchIds kept
    expect(moved!.updatedAt).toBeGreaterThan(0);

    // Still reachable through the wallet → endpoint index.
    const subs = await store.getSubscriptionsForWallet('GABC');
    expect(subs.map((s) => s.endpoint)).toEqual([B]);
    expect(subs[0].vouchIds).toEqual([7, 11]);
  });

  it('moveSubscription reports not_found / forbidden without touching storage', async () => {
    await store.saveSubscription(sub(A), 'GABC', 7);

    expect(await store.moveSubscription('https://push.example/none', B, sub(B), 'GABC')).toBe('not_found');
    expect(await store.moveSubscription(A, B, sub(B), 'GOTHER')).toBe('forbidden');
    expect(store.memGet(`sub:${A}`)).not.toBeNull(); // record untouched at the old key
    expect(store.memGet(`sub:${B}`)).toBeNull();
    expect(await store.getSubscriptionsForWallet('GABC')).toHaveLength(1);
  });

  it('moveSubscription refuses to overwrite an existing record at the new endpoint', async () => {
    await store.saveSubscription(sub(A), 'GABC', 7);
    await store.saveSubscription(sub(B), 'GABC', 42);

    expect(await store.moveSubscription(A, B, sub(B), 'GABC')).toBe('conflict');
    expect(store.memGet(`sub:${B}`)!.vouchIds).toEqual([42]); // the unrelated record survives
  });

  it('moveSubscription supports same-key moves (endpoint unchanged, fresh payload)', async () => {
    await store.saveSubscription(sub(A), 'GABC', 7);

    const result = await store.moveSubscription(A, A, sub(A), 'GABC');

    expect(result).toBe('moved');
    const moved = store.memGet(`sub:${A}`);
    expect(moved).not.toBeNull();
    expect(moved!.subscription).toEqual(sub(A));
    expect(moved!.vouchIds).toEqual([7]);
    expect(await store.getSubscriptionsForWallet('gabc')).toHaveLength(1);
  });

  it('keeps the cron cursor and event claims in memory (#297)', async () => {
    expect(await store.getCursor()).toBeNull();
    await store.setCursor('c-1');
    expect(await store.getCursor()).toBe('c-1');
    expect(await store.claimEvent('e1')).toBe(true);
    expect(await store.claimEvent('e1')).toBe(false);
    expect(RedisMock).not.toHaveBeenCalled();
  });

  it('lets an in-memory claim lapse after its TTL', async () => {
    vi.useFakeTimers();
    try {
      expect(await store.claimEvent('e1')).toBe(true);
      vi.advanceTimersByTime(store.EVENT_CLAIM_TTL_SECONDS * 1000 + 1);
      expect(await store.claimEvent('e1')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not hand a wallet the in-memory device that re-subscribed for another wallet', async () => {
    await store.saveGeneralSubscription(sub(A), 'GOLD');
    await store.saveGeneralSubscription(sub(A), 'GNEW');
    expect(await store.getSubscriptionsForWallet('GNEW')).toHaveLength(1);
    expect(await store.getSubscriptionsForWallet('GOLD')).toEqual([]);
  });
});
