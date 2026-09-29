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
