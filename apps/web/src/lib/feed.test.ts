import { describe, it, expect, vi } from 'vitest';
import { fetchActivity } from './feed';
import * as eventsModule from './events';
import { EVENTS } from '@alvinmunk/shared';

// Mock the events module
vi.mock('./events', () => ({
  fetchReputationEvents: vi.fn(),
}));

describe('fetchActivity', () => {
  it('filters only vouch:claimed events', async () => {
    vi.mocked(eventsModule.fetchReputationEvents).mockResolvedValue([
      {
        topics: [EVENTS.VOUCH, 'minted'],
        data: [1, 'G_ALICE', 'G_BOB'],
        ledger: 100,
      } as any,
      {
        topics: [EVENTS.VOUCH, 'claimed'],
        data: [1, 'G_ALICE', 'G_BOB'],
        ledger: 101,
      } as any,
      {
        topics: [EVENTS.XP, 'G_ALICE'],
        data: [100, 200],
        ledger: 102,
      } as any,
    ]);

    const activity = await fetchActivity();
    expect(activity).toHaveLength(1);
    expect(activity[0]).toEqual({
      from: 'G_ALICE',
      to: 'G_BOB',
      ledger: 101,
    });
  });

  it('orders newest-first and respects max cap', async () => {
    // Array with indices 0 to 4. Latest are at the end (highest index)
    const mockEvents = Array.from({ length: 5 }).map((_, i) => ({
      topics: [EVENTS.VOUCH, 'claimed'],
      data: [i, `G_FROM_${i}`, `G_TO_${i}`],
      ledger: 100 + i,
    })) as any[];

    vi.mocked(eventsModule.fetchReputationEvents).mockResolvedValue(mockEvents);

    const activity = await fetchActivity(3);
    expect(activity).toHaveLength(3);
    
    // Should be newest-first (events[4], events[3], events[2])
    expect(activity[0]).toEqual({ from: 'G_FROM_4', to: 'G_TO_4', ledger: 104 });
    expect(activity[1]).toEqual({ from: 'G_FROM_3', to: 'G_TO_3', ledger: 103 });
    expect(activity[2]).toEqual({ from: 'G_FROM_2', to: 'G_TO_2', ledger: 102 });
  });

  it('skips events where data is not an array', async () => {
    vi.mocked(eventsModule.fetchReputationEvents).mockResolvedValue([
      {
        topics: [EVENTS.VOUCH, 'claimed'],
        data: 'not-an-array',
        ledger: 100,
      } as any,
    ]);

    const activity = await fetchActivity();
    expect(activity).toHaveLength(0);
  });
});
