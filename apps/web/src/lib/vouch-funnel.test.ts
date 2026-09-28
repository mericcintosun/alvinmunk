import { describe, expect, it } from 'vitest';
import { aggregateVouchFunnel, type VouchRecord } from './vouch-funnel';

const record = (id: number, overrides: Partial<VouchRecord> = {}): VouchRecord => ({
  id,
  from: 'A',
  claimed: false,
  claimer: null,
  created: Date.UTC(2026, 0, 5) / 1000,
  slashed: false,
  ...overrides,
});

describe('aggregateVouchFunnel', () => {
  it('aggregates minted, claimed, expired, distinct vouchers, repeat pairs and weekly cohorts', () => {
    const result = aggregateVouchFunnel([
      record(1, { claimed: true, claimer: 'B' }),
      record(2, { claimed: true, claimer: 'B' }),
      record(3, { from: 'C', slashed: true }),
      record(4, { created: Date.UTC(2026, 0, 12) / 1000, claimed: true, claimer: 'D' }),
    ]);
    expect(result).toEqual({
      minted: 4,
      claimed: 3,
      completionRate: 0.75,
      expiredUnclaimed: 1,
      distinctVouchers: 2,
      repeatPairShare: 2 / 3,
      weeklyCohorts: [
        { week: '2026-01-05', minted: 3, claimed: 2, completionRate: 2 / 3, expiredUnclaimed: 1 },
        { week: '2026-01-12', minted: 1, claimed: 1, completionRate: 1, expiredUnclaimed: 0 },
      ],
    });
  });

  it('returns zero rates for an empty record set', () => {
    expect(aggregateVouchFunnel([])).toMatchObject({ minted: 0, claimed: 0, completionRate: 0, repeatPairShare: 0, weeklyCohorts: [] });
  });
});
