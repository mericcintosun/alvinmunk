export interface VouchRecord {
  id: number;
  from: string;
  claimed: boolean;
  claimer: string | null;
  created: number;
  slashed: boolean;
}

export interface VouchCohort {
  week: string;
  minted: number;
  claimed: number;
  completionRate: number;
  expiredUnclaimed: number;
}

export interface VouchFunnel {
  minted: number;
  claimed: number;
  completionRate: number;
  expiredUnclaimed: number;
  distinctVouchers: number;
  repeatPairShare: number;
  weeklyCohorts: VouchCohort[];
}

/** Pure funnel aggregation. Weeks begin Monday UTC; rates are fractions from 0 to 1. */
export function aggregateVouchFunnel(records: readonly VouchRecord[]): VouchFunnel {
  const cohorts = new Map<string, { minted: number; claimed: number; expiredUnclaimed: number }>();
  const vouchers = new Set<string>();
  const pairCounts = new Map<string, number>();
  let claimed = 0;
  let expiredUnclaimed = 0;

  for (const vouch of records) {
    const date = new Date(vouch.created * 1000);
    const day = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - day);
    date.setUTCHours(0, 0, 0, 0);
    const week = date.toISOString().slice(0, 10);
    const cohort = cohorts.get(week) ?? { minted: 0, claimed: 0, expiredUnclaimed: 0 };
    cohort.minted++;
    if (vouch.claimed) {
      cohort.claimed++;
      claimed++;
      if (vouch.claimer) {
        const pair = `${vouch.from}\u0000${vouch.claimer}`;
        pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
      }
    }
    if (!vouch.claimed && vouch.slashed) {
      cohort.expiredUnclaimed++;
      expiredUnclaimed++;
    }
    vouchers.add(vouch.from);
    cohorts.set(week, cohort);
  }

  const repeatedClaimedPairs = [...pairCounts.entries()]
    .filter(([, count]) => count > 1)
    .reduce((sum, [, count]) => sum + count, 0);
  return {
    minted: records.length,
    claimed,
    completionRate: records.length ? claimed / records.length : 0,
    expiredUnclaimed,
    distinctVouchers: vouchers.size,
    repeatPairShare: claimed ? repeatedClaimedPairs / claimed : 0,
    weeklyCohorts: [...cohorts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, c]) => ({
        week,
        ...c,
        completionRate: c.minted ? c.claimed / c.minted : 0,
      })),
  };
}
