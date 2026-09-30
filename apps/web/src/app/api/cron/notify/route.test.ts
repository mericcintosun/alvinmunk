// @vitest-environment node
//
// Route module imports next/server, which needs Node's fetch primitives
// (Response/Headers) — run in the node environment, not jsdom.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Every collaborator is mocked except the claim store, which is a real in-memory set here,
// so "never twice" is exercised end to end across runs.
const m = vi.hoisted(() => {
  const claimed = new Set<string>();
  return {
    claimed,
    fetchTipEventsSince: vi.fn(),
    getSubscriptionsForWallet: vi.fn(),
    removeSubscription: vi.fn(async (_endpoint: string) => undefined),
    getCursor: vi.fn(async (): Promise<string | null> => null),
    setCursor: vi.fn(async (_cursor: string) => undefined),
    claimEvent: vi.fn(async (id: string) => {
      if (claimed.has(id)) return false;
      claimed.add(id);
      return true;
    }),
    reverseHandles: vi.fn(async (_addresses: string[]): Promise<Record<string, string | null>> => ({})),
    sendNotification: vi.fn(async (_sub: unknown, _payload: string) => undefined),
    setVapidDetails: vi.fn(),
  };
});

vi.mock('@/lib/events', () => ({ fetchTipEventsSince: m.fetchTipEventsSince }));
vi.mock('@/lib/push-store', () => ({
  getSubscriptionsForWallet: m.getSubscriptionsForWallet,
  removeSubscription: m.removeSubscription,
  getCursor: m.getCursor,
  setCursor: m.setCursor,
  claimEvent: m.claimEvent,
}));
vi.mock('@/lib/registry', () => ({ reverseHandles: m.reverseHandles }));
vi.mock('web-push', () => ({
  default: { setVapidDetails: m.setVapidDetails, sendNotification: m.sendNotification },
  setVapidDetails: m.setVapidDetails,
  sendNotification: m.sendNotification,
}));

import { GET } from './route';

const FROM = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const TO = 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA';
const OTHER = 'G'.padEnd(56, 'Q');
const SECRET = 'test-secret';
const AUTH = `Bearer ${SECRET}`;

/** Minimal NextRequest stand-in — the handler only reads headers. */
function makeReq(auth?: string): Parameters<typeof GET>[0] {
  return {
    headers: { get: (name: string) => (name === 'authorization' ? (auth ?? null) : null) },
  } as unknown as Parameters<typeof GET>[0];
}

/** One decoded `tipped` event, as fetchTipEventsSince returns it (amount in stroops). */
function tip(id: string | undefined, from = FROM, to = TO, amount: unknown = 20_000_000n) {
  return { ...(id ? { id } : {}), topics: ['tipped', from, to], data: amount, ledger: 100 };
}

function sub(endpoint: string, wallet = TO) {
  return {
    endpoint,
    subscription: { endpoint } as PushSubscriptionJSON,
    walletAddress: wallet.toLowerCase(),
    vouchIds: [],
    updatedAt: 0,
  };
}

function read(events: unknown[], cursor: string | null = 'c-next', ok = true) {
  m.fetchTipEventsSince.mockResolvedValue({ events, cursor, ok });
}

const payloads = () => m.sendNotification.mock.calls.map(([, p]) => JSON.parse(p) as Record<string, string>);

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('CRON_SECRET', SECRET);
  vi.stubEnv('VAPID_SUBJECT', 'mailto:test@test');
  vi.stubEnv('VAPID_PUBLIC_KEY', 'pub');
  vi.stubEnv('VAPID_PRIVATE_KEY', 'priv');
  m.claimed.clear();
  for (const fn of [m.fetchTipEventsSince, m.getSubscriptionsForWallet, m.setVapidDetails]) fn.mockReset();
  m.removeSubscription.mockClear();
  m.getCursor.mockReset().mockResolvedValue(null);
  m.setCursor.mockClear();
  m.claimEvent.mockClear();
  m.reverseHandles.mockReset().mockResolvedValue({});
  m.sendNotification.mockReset().mockResolvedValue(undefined);
  m.getSubscriptionsForWallet.mockImplementation(async (w: string) => (w === TO ? [sub('https://push.example/a')] : []));
  read([]);
});

describe('GET /api/cron/notify — auth (#297)', () => {
  it('is disabled (503), not open, when CRON_SECRET is unset', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const res = await GET(makeReq(AUTH));
    expect(res.status).toBe(503);
    expect(m.fetchTipEventsSince).not.toHaveBeenCalled();
  });

  it.each([
    ['no Authorization header', undefined],
    ['a wrong secret', 'Bearer wrong'],
    ['the secret without the Bearer scheme', SECRET],
    ['a secret with a prefix of the right one', `Bearer ${SECRET.slice(0, -1)}`],
    ['the right secret with trailing junk', `${AUTH}x`],
  ])('rejects %s with 401 and reads nothing', async (_, auth) => {
    const res = await GET(makeReq(auth));
    expect(res.status).toBe(401);
    expect(m.fetchTipEventsSince).not.toHaveBeenCalled();
    expect(m.sendNotification).not.toHaveBeenCalled();
  });

  it('never echoes the secret', async () => {
    const res = await GET(makeReq('Bearer wrong'));
    expect(JSON.stringify(await res.json())).not.toContain(SECRET);
  });
});

describe('GET /api/cron/notify — push not configured', () => {
  it('skips without reading events or moving the cursor', async () => {
    vi.stubEnv('VAPID_PRIVATE_KEY', '');
    const res = await GET(makeReq(AUTH));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, sent: 0 });
    expect(m.fetchTipEventsSince).not.toHaveBeenCalled();
    expect(m.setCursor).not.toHaveBeenCalled();
  });
});

describe('GET /api/cron/notify — delivery (#297)', () => {
  it('pushes one notification per tip to each of the recipient’s devices, then stores the cursor', async () => {
    m.getCursor.mockResolvedValue('c-prev');
    m.getSubscriptionsForWallet.mockResolvedValue([sub('https://push.example/a'), sub('https://push.example/b')]);
    m.reverseHandles.mockResolvedValue({ [FROM]: 'alice' });
    read([tip('e1')], 'c-next');

    const res = await GET(makeReq(AUTH));

    expect(await res.json()).toEqual({ ok: true, events: 1, sent: 1, failed: 0 });
    expect(m.fetchTipEventsSince).toHaveBeenCalledWith('c-prev');
    expect(m.sendNotification).toHaveBeenCalledTimes(2);
    expect(payloads()[0]).toEqual({
      title: '💸 You received a tip',
      body: '@alice tipped you 2 USDC',
      url: '/app/inbox',
      tag: 'tip-e1',
    });
    // The handle looked up is the sender's — the recipient is the one being told.
    expect(m.reverseHandles).toHaveBeenCalledWith([FROM]);
    expect(m.setCursor).toHaveBeenCalledWith('c-next');
  });

  it('keeps the exact amount and falls back to the short sender address', async () => {
    read([tip('e1', FROM, TO, 1_234_567n)]);
    await GET(makeReq(AUTH));
    expect(payloads()[0].body).toBe(`${FROM.slice(0, 4)}…${FROM.slice(-4)} tipped you 0.1234567 USDC`);
  });

  it('sends a tip once, even when a later run reads it again', async () => {
    read([tip('e1')]);
    await GET(makeReq(AUTH));
    await GET(makeReq(AUTH)); // e.g. the reader restarted from its window after losing the cursor
    expect(m.sendNotification).toHaveBeenCalledTimes(1);
  });

  it('sends a tip once when two runs overlap', async () => {
    read([tip('e1')]);
    await Promise.all([GET(makeReq(AUTH)), GET(makeReq(AUTH))]);
    expect(m.sendNotification).toHaveBeenCalledTimes(1);
  });

  it('claims a tip before pushing it, and not a tip nobody is subscribed to', async () => {
    read([tip('e1'), tip('e2', FROM, OTHER)]);
    let claimedWhenSent: boolean | undefined;
    m.sendNotification.mockImplementation(async () => {
      claimedWhenSent = m.claimed.has('e1');
      return undefined;
    });
    await GET(makeReq(AUTH));
    expect(claimedWhenSent).toBe(true);
    expect(m.claimEvent).toHaveBeenCalledTimes(1);
    expect(m.claimEvent).toHaveBeenCalledWith('e1');
    expect(m.sendNotification).toHaveBeenCalledTimes(1);
  });

  it('skips events it cannot deduplicate or trust: no id, bad topics, zero amount', async () => {
    read([tip(undefined), tip('e2', 42 as unknown as string), tip('e3', FROM, TO, 0n), tip('e4', FROM, TO, 'x')]);
    const res = await GET(makeReq(AUTH));
    expect(await res.json()).toMatchObject({ ok: true, events: 4, sent: 0 });
    expect(m.sendNotification).not.toHaveBeenCalled();
    expect(m.setCursor).toHaveBeenCalledWith('c-next');
  });

  it('prunes a revoked endpoint and still reaches the recipient’s other devices', async () => {
    m.getSubscriptionsForWallet.mockResolvedValue([sub('https://push.example/gone'), sub('https://push.example/ok')]);
    m.sendNotification.mockImplementation(async (s: unknown) => {
      if ((s as { endpoint: string }).endpoint.endsWith('gone')) throw Object.assign(new Error('gone'), { statusCode: 410 });
      return undefined;
    });
    read([tip('e1')]);
    const res = await GET(makeReq(AUTH));
    expect(await res.json()).toMatchObject({ sent: 1, failed: 0 });
    expect(m.removeSubscription).toHaveBeenCalledWith('https://push.example/gone');
  });

  it('does not let a failing push service hold back later tips or resend the failed one', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    m.sendNotification.mockRejectedValueOnce(Object.assign(new Error('boom'), { statusCode: 500 }));
    read([tip('e1'), tip('e2')], 'c-next');

    const res = await GET(makeReq(AUTH));
    expect(await res.json()).toEqual({ ok: true, events: 2, sent: 1, failed: 1 });
    expect(m.sendNotification).toHaveBeenCalledTimes(2);
    expect(m.removeSubscription).not.toHaveBeenCalled();
    expect(m.setCursor).toHaveBeenCalledWith('c-next');

    await GET(makeReq(AUTH)); // at most once: e1 is not retried
    expect(m.sendNotification).toHaveBeenCalledTimes(2);
  });

  it('still notifies when the handle lookup fails', async () => {
    m.reverseHandles.mockRejectedValue(new Error('rpc down'));
    read([tip('e1')]);
    await GET(makeReq(AUTH));
    expect(payloads()[0].body).toContain(`${FROM.slice(0, 4)}…`);
  });

  it('keeps the cursor when the RPC could not be read', async () => {
    m.getCursor.mockResolvedValue('c-prev');
    read([], 'c-prev', false);
    const res = await GET(makeReq(AUTH));
    expect(res.status).toBe(502);
    expect(m.setCursor).not.toHaveBeenCalled();
  });

  it('stores the new cursor after an empty read, and skips the write when it did not move', async () => {
    read([], 'c-new');
    await GET(makeReq(AUTH));
    expect(m.setCursor).toHaveBeenCalledWith('c-new');

    m.setCursor.mockClear();
    m.getCursor.mockResolvedValue('c-same');
    read([], 'c-same');
    await GET(makeReq(AUTH));
    expect(m.setCursor).not.toHaveBeenCalled();
  });

  it('does not store a cursor when a claim fails, so the tips are read again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    m.claimEvent.mockRejectedValueOnce(new Error('kv down'));
    read([tip('e1')], 'c-next');
    const res = await GET(makeReq(AUTH));
    expect(res.status).toBe(500);
    expect(m.setCursor).not.toHaveBeenCalled();
  });
});
