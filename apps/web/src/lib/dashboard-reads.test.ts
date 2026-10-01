/**
 * The cold `/app` load end to end (#202): every dashboard reader, mounting at different
 * moments the way the page does, against one mocked RPC. Only the RPC edge is mocked —
 * the memo, the in-flight sharing and the concurrency cap under test are the real ones.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Address, StrKey, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import type { VouchView } from '@alvinmunk/sdk';

const { getLatestLedgerMock, getEventsMock, sdkGetVouchMock, readPublicMock } = vi.hoisted(() => ({
  getLatestLedgerMock: vi.fn(),
  getEventsMock: vi.fn(),
  sdkGetVouchMock: vi.fn(),
  readPublicMock: vi.fn(),
}));

vi.mock('./stellar', () => ({
  server: { getLatestLedger: getLatestLedgerMock, getEvents: getEventsMock },
  config: { contracts: { reputation: 'CREP', rewards: 'CRWD' } },
  networkPassphrase: 'Test SDF Network ; September 2015',
}));
vi.mock('./sdk', () => ({ readClient: () => ({ getVouch: sdkGetVouchMock }) }));
vi.mock('./contracts', () => ({
  repId: () => 'CREP',
  questId: () => 'CQUEST',
  readPublic: readPublicMock,
  readContract: vi.fn(),
  invokeAndWait: vi.fn(),
  args: { addr: (g: string) => g },
}));
vi.mock('./registry', () => ({ reverseHandle: async () => null }));
vi.mock('./push', () => ({ subscribeToPush: vi.fn() }));
vi.mock('./quests', () => ({ getStreak: vi.fn() }));

import { getOwedBonuses, getPendingVouchIds, getPendingVouches, pollNewlyClaimed, type MyVouch } from './myvouches';
import { fetchActivity } from './feed';
import { fetchVouchersOf } from './constellation';
import { VOUCH_READ_CONCURRENCY } from './reputation';

const account = (n: number) => StrKey.encodeEd25519PublicKey(Buffer.alloc(32, n));
const ME = account(1);
const BOB = account(2);
const FRIENDS = Array.from({ length: 5 }, (_, i) => account(10 + i));
const MINE = Array.from({ length: 30 }, (_, i) => i + 1); // stored half-cards I minted
const TO_ME = FRIENDS.map((_, i) => 101 + i); // cards friends minted that I claimed

function card(id: number): VouchView {
  const claimed = id > 100 || id % 3 === 0;
  return {
    id,
    from: id > 100 ? FRIENDS[id - 101] : ME,
    note: `note ${id}`,
    claimed,
    claimer: claimed ? (id > 100 ? ME : BOB) : null,
    created: Math.floor(Date.now() / 1000) - 3600,
    stake: 5,
    slashed: false,
  };
}

const claimedEvent = (id: number, from: string) => ({
  topic: [xdr.ScVal.scvSymbol('vouch'), xdr.ScVal.scvSymbol('claimed')],
  value: xdr.ScVal.scvVec([
    nativeToScVal(id, { type: 'u64' }),
    new Address(from).toScVal(),
    new Address(ME).toScVal(),
  ]),
  ledger: 19_000 + id,
});

describe('a cold /app load', () => {
  let active = 0;
  let peak = 0;

  beforeEach(() => {
    const stored: MyVouch[] = MINE.map((id) => ({ id, seed: 'ab'.repeat(32), note: `note ${id}`, created: 0, walletAddress: ME }));
    localStorage.setItem('alvinmunk.myVouches', JSON.stringify(stored));
    getLatestLedgerMock.mockResolvedValue({ sequence: 20_000 });
    getEventsMock.mockImplementation(async (req: { filters: { contractIds: string[] }[] }) => ({
      events: req.filters[0].contractIds[0] === 'CREP' ? TO_ME.map((id, i) => claimedEvent(id, FRIENDS[i])) : [],
    }));
    readPublicMock.mockResolvedValue([]);
    sdkGetVouchMock.mockImplementation(async (id: number) => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 1));
      active--;
      return card(id);
    });
  });

  it('reads one events window per contract and each vouch id once, a few at a time', async () => {
    // The /app layout's claim notice and PendingHalfCards mount together …
    await Promise.all([pollNewlyClaimed(), getPendingVouches('https://alvinmunk.test')]);
    // … the owed-bonus card and the activity feed right after …
    await Promise.all([getOwedBonuses(ME), fetchActivity()]);
    // … the 3D hero once its bundle has loaded, then the push re-sync.
    const stars = await fetchVouchersOf(ME);
    await getPendingVouchIds();

    expect(stars.map((s) => s.vouchId).sort()).toEqual(TO_ME);

    const windows = getEventsMock.mock.calls.map((c) => c[0].filters[0].contractIds[0]);
    expect(windows.sort()).toEqual(['CREP', 'CRWD']);
    expect(getLatestLedgerMock).toHaveBeenCalledTimes(2);

    const ids = sdkGetVouchMock.mock.calls.map((c) => c[0] as number);
    expect(ids.sort((a, b) => a - b)).toEqual([...MINE, ...TO_ME]);
    expect(peak).toBeLessThanOrEqual(VOUCH_READ_CONCURRENCY);
  });
});
