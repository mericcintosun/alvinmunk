import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPushAvailabilityHint } from './push';

const IOS_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1';

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
});