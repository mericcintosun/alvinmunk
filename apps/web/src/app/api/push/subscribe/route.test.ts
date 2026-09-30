// @vitest-environment node
//
// The route module imports next/server, which needs Node's fetch primitives
// (Response/Headers) — run in the node environment, not jsdom.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/push-store', () => ({
  saveSubscription: vi.fn(async () => undefined),
  saveSubscriptionWithVouchIds: vi.fn(async () => undefined),
  saveGeneralSubscription: vi.fn(async () => undefined),
  removeSubscription: vi.fn(async () => undefined),
  getSubscriptionByEndpoint: vi.fn(async () => null),
  moveSubscription: vi.fn(),
}));

import { PATCH, POST } from './route';
import {
  moveSubscription,
  saveGeneralSubscription,
  saveSubscription,
  saveSubscriptionWithVouchIds,
} from '@/lib/push-store';

const moveMock = vi.mocked(moveSubscription);
const saveMock = vi.mocked(saveSubscription);
const saveIdsMock = vi.mocked(saveSubscriptionWithVouchIds);
const saveGeneralMock = vi.mocked(saveGeneralSubscription);

/** Minimal NextRequest stand-in — the handler only reads headers + json(). */
function makeReq(body: unknown): Parameters<typeof PATCH>[0] {
  return {
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Parameters<typeof PATCH>[0];
}

const NEW_SUB = { endpoint: 'https://push.example.com/new-ep' } as PushSubscriptionJSON;

describe('PATCH /api/push/subscribe (subscription move, #169)', () => {
  beforeEach(() => {
    moveMock.mockReset();
    saveMock.mockReset();
    saveIdsMock.mockReset();
  });

  it('moves the stored record and returns ok', async () => {
    moveMock.mockResolvedValueOnce('moved');
    const res = await PATCH(
      makeReq({
        oldEndpoint: 'https://push.example.com/old-ep',
        subscription: NEW_SUB,
        walletAddress: 'GABC',
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(moveMock).toHaveBeenCalledWith(
      'https://push.example.com/old-ep',
      'https://push.example.com/new-ep',
      NEW_SUB,
      'GABC',
    );
  });

  it('rejects malformed json with 400', async () => {
    const req = {
      headers: { get: () => null },
      json: async () => {
        throw new Error('nope');
      },
    } as unknown as Parameters<typeof PATCH>[0];
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });

  it.each([
    ['missing oldEndpoint', {}],
    ['missing walletAddress', { oldEndpoint: 'https://p.com/old', subscription: NEW_SUB }],
    ['missing subscription', { oldEndpoint: 'https://p.com/old', walletAddress: 'GABC' }],
    ['oldEndpoint not https', { oldEndpoint: 'http://p.com/old', subscription: NEW_SUB, walletAddress: 'GABC' }],
    ['new endpoint not https', { oldEndpoint: 'https://p.com/old', subscription: { endpoint: 'http://p.com/new' }, walletAddress: 'GABC' }],
    [
      'endpoints identical',
      { oldEndpoint: 'https://p.com/same', subscription: { endpoint: 'https://p.com/same' }, walletAddress: 'GABC' },
    ],
  ])('validates fields → 422 (%s)', async (_label, body) => {
    const res = await PATCH(makeReq(body));
    expect(res.status).toBe(422);
    expect(moveMock).not.toHaveBeenCalled();
  });

  it('maps not_found → 404 so clients can fall back to a fresh POST', async () => {
    moveMock.mockResolvedValueOnce('not_found');
    const res = await PATCH(makeReq({ oldEndpoint: 'https://p.com/gone', subscription: NEW_SUB, walletAddress: 'GABC' }));
    expect(res.status).toBe(404);
  });

  it('maps forbidden → 403 when the wallet does not own the record', async () => {
    moveMock.mockResolvedValueOnce('forbidden');
    const res = await PATCH(makeReq({ oldEndpoint: 'https://p.com/old', subscription: NEW_SUB, walletAddress: 'GNOTMINE' }));
    expect(res.status).toBe(403);
  });

  it('maps conflict → 409 when the new endpoint is already registered', async () => {
    moveMock.mockResolvedValueOnce('conflict');
    const res = await PATCH(makeReq({ oldEndpoint: 'https://p.com/old', subscription: NEW_SUB, walletAddress: 'GABC' }));
    expect(res.status).toBe(409);
  });
});

describe('POST /api/push/subscribe (vouchIds re-register, #169)', () => {
  // A real (checksummed) account: POST only stores a valid G… or C… address.
  const WALLET = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';

  beforeEach(() => {
    saveMock.mockReset();
    saveIdsMock.mockReset();
    saveGeneralMock.mockReset();
  });

  const stored = () => saveMock.mock.calls.length + saveIdsMock.mock.calls.length + saveGeneralMock.mock.calls.length;

  it('routes a vouchIds array to saveSubscriptionWithVouchIds', async () => {
    const res = await POST(makeReq({ subscription: NEW_SUB, walletAddress: WALLET, vouchIds: [7, 11] }));
    expect(res.status).toBe(200);
    expect(saveIdsMock).toHaveBeenCalledWith(NEW_SUB, WALLET, [7, 11]);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('routes the legacy single vouchId to saveSubscription', async () => {
    const res = await POST(makeReq({ subscription: NEW_SUB, walletAddress: WALLET, vouchId: 7 }));
    expect(res.status).toBe(200);
    expect(saveMock).toHaveBeenCalledWith(NEW_SUB, WALLET, 7);
    expect(saveIdsMock).not.toHaveBeenCalled();
  });

  describe('general opt-in without a vouch (#297)', () => {
    it('stores a subscription that names no vouch', async () => {
      const res = await POST(makeReq({ subscription: NEW_SUB, walletAddress: WALLET }));
      expect(res.status).toBe(200);
      expect(saveGeneralMock).toHaveBeenCalledWith(NEW_SUB, WALLET);
      expect(saveMock).not.toHaveBeenCalled();
      expect(saveIdsMock).not.toHaveBeenCalled();
    });

    it('treats an empty vouchIds array (a re-sync with nothing pending) as the same opt-in', async () => {
      const res = await POST(makeReq({ subscription: NEW_SUB, walletAddress: WALLET, vouchIds: [] }));
      expect(res.status).toBe(200);
      expect(saveGeneralMock).toHaveBeenCalledWith(NEW_SUB, WALLET);
      expect(saveIdsMock).not.toHaveBeenCalled();
    });

    it('accepts a C… smart-wallet address, trimmed', async () => {
      const C = 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA';
      const res = await POST(makeReq({ subscription: NEW_SUB, walletAddress: ` ${C} ` }));
      expect(res.status).toBe(200);
      expect(saveGeneralMock).toHaveBeenCalledWith(NEW_SUB, C);
    });
  });

  it.each([
    ['a malformed vouchId', { vouchId: 'nope' }],
    ['a negative vouchId', { vouchId: -1 }],
    ['a fractional vouchId', { vouchId: 1.5 }],
    ['a vouchIds array with a non-number', { vouchIds: [7, 'x'] }],
    ['a vouchIds that is not an array', { vouchIds: 7 }],
  ])('rejects %s → 422, never falling back to a general opt-in', async (_, fields) => {
    const res = await POST(makeReq({ subscription: NEW_SUB, walletAddress: WALLET, ...fields }));
    expect(res.status).toBe(422);
    expect(stored()).toBe(0);
  });

  it.each([
    ['no walletAddress', { subscription: NEW_SUB }],
    ['a walletAddress that is not a Stellar address', { subscription: NEW_SUB, walletAddress: 'GABC' }],
    ['a walletAddress with a bad checksum', { subscription: NEW_SUB, walletAddress: `${WALLET.slice(0, -1)}A` }],
    ['a non-string walletAddress', { subscription: NEW_SUB, walletAddress: 42 }],
    ['no subscription', { walletAddress: WALLET }],
    ['a non-https endpoint', { subscription: { endpoint: 'http://push.example.com/x' }, walletAddress: WALLET }],
  ])('rejects %s → 422', async (_, body) => {
    const res = await POST(makeReq(body));
    expect(res.status).toBe(422);
    expect(stored()).toBe(0);
  });

  it('answers a store failure with a JSON 500 naming the request id (#183)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    saveIdsMock.mockRejectedValueOnce(new Error('KV https://token@kv.example.com unreachable'));

    const res = await POST(makeReq({ subscription: NEW_SUB, walletAddress: WALLET, vouchIds: [7] }));

    expect(res.status).toBe(500);
    const requestId = res.headers.get('x-request-id');
    expect(requestId).toBeTruthy();
    expect(await res.json()).toEqual({ error: 'internal error', requestId });
    errorSpy.mockRestore();
  });

  it('keeps its response and adds x-request-id (#183)', async () => {
    const res = await POST(makeReq({ subscription: NEW_SUB, walletAddress: WALLET, vouchId: 7 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });
});
