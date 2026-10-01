import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPushAvailabilityHint } from './push';

const IOS_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1';

// Chrome on iOS still runs on WebKit and its UA string contains "Safari", but it's
// third-party — it cannot register for Web Push there and gets no say over the
// Home Screen prompt, so it must not be mistaken for the first-party browser.
const IOS_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1';

const DESKTOP_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function setBrowser(userAgent: string, standalone: boolean) {
  vi.stubGlobal('navigator', {
    userAgent,
    platform: 'iPhone',
    maxTouchPoints: 0,
  });
  vi.stubGlobal('window', {
    matchMedia: vi.fn(() => ({ matches: standalone })),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getPushAvailabilityHint', () => {
  it('prompts iOS Safari users to install the app before enabling push', () => {
    setBrowser(IOS_SAFARI, false);

    expect(getPushAvailabilityHint()).toBe('Add to Home Screen to get notified.');
  });

  it('does not prompt an installed iOS web app', () => {
    setBrowser(IOS_SAFARI, true);

    expect(getPushAvailabilityHint()).toBeNull();
  });

  it('does not prompt Chrome on iOS, which cannot install or subscribe to push there', () => {
    setBrowser(IOS_CHROME, false);

    expect(getPushAvailabilityHint()).toBeNull();
  });

  it('does not prompt a non-iOS browser', () => {
    setBrowser(DESKTOP_CHROME, false);

    expect(getPushAvailabilityHint()).toBeNull();
  });
});

describe('subscribeToPush (#297)', () => {
  const WALLET = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
  const endpoint = 'https://push.example/device';

  async function load() {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response('{"ok":true}'));
    const subscription = { endpoint, toJSON: () => ({ endpoint, keys: { p256dh: 'k', auth: 'a' } }) };
    const reg = { pushManager: { getSubscription: vi.fn(async () => subscription), subscribe: vi.fn() } };
    vi.stubGlobal('navigator', { serviceWorker: { register: vi.fn(async () => reg) } });
    vi.stubGlobal('window', { PushManager: function PushManager() {}, Notification: {} });
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn(async () => 'granted') });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'BPub');
    vi.resetModules(); // the VAPID key is read at module load
    const push = await import('./push');
    const posted = () => JSON.parse(String(fetchMock.mock.calls.at(-1)![1].body));
    return { push, fetchMock, posted };
  }

  afterEach(() => vi.unstubAllEnvs());

  it('opts in without a vouch: the server gets the wallet and no vouch IDs', async () => {
    const { push, fetchMock, posted } = await load();
    expect(await push.subscribeToPush(WALLET)).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('/api/push/subscribe', expect.objectContaining({ method: 'POST' }));
    expect(posted()).toEqual({
      subscription: { endpoint, keys: { p256dh: 'k', auth: 'a' } },
      walletAddress: WALLET,
      vouchIds: [],
    });
  });

  it('still registers a vouch when one is given', async () => {
    const { push, posted } = await load();
    await push.subscribeToPush(WALLET, 7);
    expect(posted().vouchIds).toEqual([7]);
  });
});
