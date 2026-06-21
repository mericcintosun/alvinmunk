import { describe, it, expect } from 'vitest';
import {
  artSeed,
  stampArt,
  readNetworkConfig,
  PASSPHRASE,
  SCHEMA,
  rankLeaderboard,
  mergeSocialRecords,
  detectReciprocalRings,
  buildClaimPath,
  buildClaimUrl,
  shortAddr,
  type SocialRecord,
} from './index';

describe('artSeed', () => {
  it('is deterministic for the same address', () => {
    expect(artSeed('GABCDEF')).toBe(artSeed('GABCDEF'));
  });
  it('differs across addresses', () => {
    expect(artSeed('GABCDEF')).not.toBe(artSeed('GZZZZZZ'));
  });
});

describe('stampArt', () => {
  it('is deterministic', () => {
    expect(stampArt('GTEST', 5)).toEqual(stampArt('GTEST', 5));
  });

  it('keeps hues in [0,360)', () => {
    const a = stampArt('GHUE');
    expect(a.hue).toBeGreaterThanOrEqual(0);
    expect(a.hue).toBeLessThan(360);
    expect(a.hue2).toBeGreaterThanOrEqual(0);
    expect(a.hue2).toBeLessThan(360);
  });

  it('encodes shape (vertex count) independent of color — a11y', () => {
    expect(stampArt('GTEST', 5).points.split(' ')).toHaveLength(5);
    expect(stampArt('GTEST', 7).points.split(' ')).toHaveLength(7);
    expect(stampArt('GTEST', 7).vertices).toBe(7);
  });
});

describe('readNetworkConfig', () => {
  it('defaults to testnet', () => {
    const c = readNetworkConfig({});
    expect(c.network).toBe('testnet');
    expect(c.networkPassphrase).toBe(PASSPHRASE.testnet);
  });

  it('reads contract ids from env', () => {
    const c = readNetworkConfig({ NEXT_PUBLIC_REPUTATION_CONTRACT_ID: 'CREP' });
    expect(c.contracts.reputation).toBe('CREP');
  });
});

describe('SCHEMA', () => {
  it('namespaces vouch vs quest distinctly', () => {
    expect(SCHEMA.VOUCH).not.toBe(SCHEMA.QUEST);
  });
});

describe('rankLeaderboard', () => {
  it('uses the latest running total per address and ranks desc', () => {
    const recs: SocialRecord[] = [
      { address: 'GALICE', total: 10, ledger: 1 },
      { address: 'GBOB', total: 10, ledger: 1 },
      { address: 'GALICE', total: 30, ledger: 5 }, // alice climbed
    ];
    const board = rankLeaderboard(recs);
    expect(board[0]).toEqual({ rank: 1, address: 'GALICE', score: 30, flagged: false });
    expect(board[1]).toEqual({ rank: 2, address: 'GBOB', score: 10, flagged: false });
  });

  it('marks flagged addresses', () => {
    const board = rankLeaderboard(
      [{ address: 'GX', total: 10, ledger: 1 }],
      new Set(['GX']),
    );
    expect(board[0].flagged).toBe(true);
  });

  it('breaks ties deterministically by address', () => {
    const board = rankLeaderboard([
      { address: 'GBBB', total: 10, ledger: 2 },
      { address: 'GAAA', total: 10, ledger: 2 },
    ]);
    expect(board.map((e) => e.address)).toEqual(['GAAA', 'GBBB']);
  });

  it('ignores stale lower-ledger records', () => {
    const board = rankLeaderboard([
      { address: 'GX', total: 50, ledger: 9 },
      { address: 'GX', total: 20, ledger: 3 },
    ]);
    expect(board[0].score).toBe(50);
  });
});

describe('mergeSocialRecords', () => {
  it('keeps the highest-ledger record per address (survives RPC window)', () => {
    const cached: SocialRecord[] = [{ address: 'GX', total: 20, ledger: 3 }];
    const fresh: SocialRecord[] = [{ address: 'GX', total: 50, ledger: 9 }];
    const merged = mergeSocialRecords(cached, fresh);
    expect(merged).toHaveLength(1);
    expect(merged[0].total).toBe(50);
  });
  it('retains a cached address absent from the fresh window', () => {
    const merged = mergeSocialRecords(
      [{ address: 'GOLD', total: 99, ledger: 1 }],
      [{ address: 'GNEW', total: 10, ledger: 5 }],
    );
    expect(merged.map((r) => r.address).sort()).toEqual(['GNEW', 'GOLD']);
  });
});

describe('detectReciprocalRings', () => {
  it('flags mutual pairs only', () => {
    const flagged = detectReciprocalRings([
      { from: 'A', claimer: 'B' },
      { from: 'B', claimer: 'A' }, // reciprocal with the first
      { from: 'C', claimer: 'D' }, // one-directional, not flagged
    ]);
    expect(flagged).toEqual(['A', 'B']);
  });
  it('returns empty when no reciprocity', () => {
    expect(detectReciprocalRings([{ from: 'A', claimer: 'B' }])).toEqual([]);
  });
});

describe('share links', () => {
  it('builds claim path and url', () => {
    expect(buildClaimPath(7)).toBe('/claim/7');
    expect(buildClaimUrl('https://passport.app/', 7)).toBe('https://passport.app/claim/7');
  });
  it('shortens addresses', () => {
    expect(shortAddr('GABCDEFGHIJKLMNOP')).toBe('GABC…MNOP');
  });
});
