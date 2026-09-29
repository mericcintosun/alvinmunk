import { describe, it, expect } from 'vitest';
import {
  artSeed,
  stampArt,
  readNetworkConfig,
  validateNetworkConfig,
  PASSPHRASE,
  SCHEMA,
  rankLeaderboard,
  mergeSocialRecords,
  detectReciprocalRings,
  detectRingCandidates,
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

/** A fully-wired mainnet env — one builder so each test flips a single field. */
function mainnetEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    NEXT_PUBLIC_STELLAR_NETWORK: 'mainnet',
    NEXT_PUBLIC_RPC_URL: 'https://mainnet.sorobanrpc.com',
    NEXT_PUBLIC_HORIZON_URL: 'https://horizon.stellar.org',
    NEXT_PUBLIC_NETWORK_PASSPHRASE: PASSPHRASE.mainnet,
    NEXT_PUBLIC_REPUTATION_CONTRACT_ID: 'CREP',
    NEXT_PUBLIC_QUEST_REGISTRY_CONTRACT_ID: 'CQUEST',
    NEXT_PUBLIC_REWARDS_CONTRACT_ID: 'CREWARDS',
    NEXT_PUBLIC_USDC_SAC_ID: 'CUSDC',
    NEXT_PUBLIC_REGISTRY_CONTRACT_ID: 'CREGISTRY',
    NEXT_PUBLIC_GATE_CONTRACT_ID: 'CGATE',
    ...overrides,
  };
}

describe('validateNetworkConfig', () => {
  it('accepts a fully-wired mainnet config', () => {
    expect(validateNetworkConfig(readNetworkConfig(mainnetEnv()))).toEqual([]);
  });

  it('accepts an empty-contract testnet config (fresh local checkout)', () => {
    expect(validateNetworkConfig(readNetworkConfig({}))).toEqual([]);
  });

  it('rejects a testnet passphrase override on mainnet', () => {
    const errors = validateNetworkConfig(
      readNetworkConfig(mainnetEnv({ NEXT_PUBLIC_NETWORK_PASSPHRASE: PASSPHRASE.testnet })),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('passphrase');
    expect(errors[0]).toContain(PASSPHRASE.mainnet);
  });

  it('rejects a mainnet passphrase override on testnet', () => {
    const errors = validateNetworkConfig(
      readNetworkConfig({
        NEXT_PUBLIC_STELLAR_NETWORK: 'testnet',
        NEXT_PUBLIC_NETWORK_PASSPHRASE: PASSPHRASE.mainnet,
      }),
    );
    expect(errors.some((e) => e.includes('passphrase'))).toBe(true);
  });

  it('rejects a testnet RPC url on mainnet', () => {
    const errors = validateNetworkConfig(
      readNetworkConfig(mainnetEnv({ NEXT_PUBLIC_RPC_URL: 'https://soroban-testnet.stellar.org' })),
    );
    expect(errors).toContain('rpcUrl still points at testnet on mainnet: https://soroban-testnet.stellar.org');
  });

  it('rejects a testnet Horizon url on mainnet', () => {
    const errors = validateNetworkConfig(
      readNetworkConfig(mainnetEnv({ NEXT_PUBLIC_HORIZON_URL: 'https://horizon-testnet.stellar.org' })),
    );
    expect(errors.some((e) => e.startsWith('horizonUrl still points at testnet'))).toBe(true);
  });

  it('rejects every unset contract id on mainnet, naming the env var', () => {
    const errors = validateNetworkConfig(
      readNetworkConfig(
        mainnetEnv({
          NEXT_PUBLIC_REPUTATION_CONTRACT_ID: '',
          NEXT_PUBLIC_REWARDS_CONTRACT_ID: '',
          NEXT_PUBLIC_GATE_CONTRACT_ID: '',
        }),
      ),
    );
    const missing = errors.filter((e) => e.startsWith('missing mainnet contract id'));
    expect(missing).toHaveLength(3);
    expect(missing).toContain('missing mainnet contract id: NEXT_PUBLIC_REPUTATION_CONTRACT_ID');
    expect(missing).toContain('missing mainnet contract id: NEXT_PUBLIC_REWARDS_CONTRACT_ID');
    expect(missing).toContain('missing mainnet contract id: NEXT_PUBLIC_GATE_CONTRACT_ID');
  });

  it('reports mixed configs with one specific reason per problem', () => {
    const errors = validateNetworkConfig(
      readNetworkConfig(
        mainnetEnv({
          NEXT_PUBLIC_NETWORK_PASSPHRASE: PASSPHRASE.testnet,
          NEXT_PUBLIC_RPC_URL: 'https://soroban-testnet.stellar.org',
          NEXT_PUBLIC_USDC_SAC_ID: '',
        }),
      ),
    );
    expect(errors).toHaveLength(3);
    expect(errors.filter((e) => e.includes('passphrase'))).toHaveLength(1);
    expect(errors.filter((e) => e.includes('rpcUrl'))).toHaveLength(1);
    expect(errors.filter((e) => e.includes('NEXT_PUBLIC_USDC_SAC_ID'))).toHaveLength(1);
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

describe('detectRingCandidates', () => {
  const addrs = (pairs: { from: string; claimer: string }[]) =>
    detectRingCandidates(pairs).map((c) => c.address);

  it('flags a reciprocal pair and nothing else', () => {
    expect(
      detectRingCandidates([
        { from: 'A', claimer: 'B' },
        { from: 'B', claimer: 'A' },
        { from: 'C', claimer: 'D' },
      ]),
    ).toEqual([
      { address: 'A', reasons: ['reciprocal'] },
      { address: 'B', reasons: ['reciprocal'] },
    ]);
  });

  it('flags every member of a three-member cycle', () => {
    expect(
      detectRingCandidates([
        { from: 'A', claimer: 'B' },
        { from: 'B', claimer: 'C' },
        { from: 'C', claimer: 'A' },
      ]),
    ).toEqual([
      { address: 'A', reasons: ['cycle3'] },
      { address: 'B', reasons: ['cycle3'] },
      { address: 'C', reasons: ['cycle3'] },
    ]);
  });

  it('does not flag unrelated one-way vouches', () => {
    expect(
      addrs([
        { from: 'A', claimer: 'B' },
        { from: 'C', claimer: 'D' },
        { from: 'E', claimer: 'F' },
      ]),
    ).toEqual([]);
  });

  it('does not flag a busy honest hub', () => {
    const pairs = ['B', 'C', 'D', 'E', 'F', 'G'].flatMap((x) => [
      { from: 'HUB', claimer: x },
      { from: `${x}2`, claimer: 'HUB' },
    ]);
    expect(addrs(pairs)).toEqual([]);
  });

  it('does not flag an open chain', () => {
    expect(
      addrs([
        { from: 'A', claimer: 'B' },
        { from: 'B', claimer: 'C' },
        { from: 'C', claimer: 'D' },
      ]),
    ).toEqual([]);
  });

  it('ignores self-loops and duplicate edges', () => {
    expect(
      addrs([
        { from: 'A', claimer: 'A' },
        { from: 'A', claimer: 'B' },
        { from: 'A', claimer: 'B' },
      ]),
    ).toEqual([]);
  });

  it('reports a back-and-forth pair as reciprocal only, not as a cycle', () => {
    const out = detectRingCandidates([
      { from: 'A', claimer: 'B' },
      { from: 'B', claimer: 'A' },
    ]);
    expect(out.every((c) => c.reasons.join() === 'reciprocal')).toBe(true);
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
