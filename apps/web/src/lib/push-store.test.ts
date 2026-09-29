// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A tiny stand-in for the Upstash REST client: values are JSON-serialized like the real
// client's automatic (de)serialization, sets hold string members.
const { RedisMock, fake } = vi.hoisted(() => {
  const fake = {
    strings: new Map<string, string>(),
    sets: new Map<string, Set<string>>(),
    srem: null as unknown as ReturnType<typeof vi.fn>,
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
      set: async (key: string, value: unknown) => {
        fake.strings.set(key, JSON.stringify(value));
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
});
