import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Address, xdr } from '@stellar/stellar-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readInstanceValueMock, ids } = vi.hoisted(() => ({
  readInstanceValueMock: vi.fn(),
  ids: { rewards: 'CREWARDS', gate: 'CGATE', quest: 'CQUEST' },
}));

vi.mock('./contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./contracts')>()),
  readInstanceValue: readInstanceValueMock,
  rewardsId: () => ids.rewards,
  gateId: () => ids.gate,
  questId: () => ids.quest,
}));

import {
  ADMIN_ERRORS,
  ADMIN_KEY,
  GATE_LABEL_MAX,
  adminErrorMessage,
  gateConsequence,
  gateToggleConsequence,
  manageableSections,
  parseU32,
  parseUsdc,
  questConsequence,
  questToggleConsequence,
  readContentAdmins,
  readContractAdmin,
  rewardConsequence,
  rewardToggleConsequence,
  supplyConsequence,
  validateGate,
  validateQuest,
  validateReward,
  validateSupply,
  type ContentAdmins,
} from './admin';
import type { RewardEntry } from './rewards';
import type { Gate } from './gate';

const ADMIN = 'GDIS5BDXSI2DDJNTKRZPI6MNB5XCLMN4Z6PPRPM4RQLZ3PSQ2YTERLFA';
const OTHER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const USDC = 10_000_000n;

const reward = (over: Partial<RewardEntry> = {}): RewardEntry => ({
  id: 3,
  threshold: 100n,
  amount: 2n * USDC,
  active: true,
  max_claims: 0,
  claims: 0,
  ...over,
});
const gate = (over: Partial<Gate> = {}): Gate => ({
  id: 2,
  track: 1,
  min: 30,
  label: 'Bounty board',
  active: true,
  ...over,
});

describe('on-chain admin gate', () => {
  beforeEach(() => {
    readInstanceValueMock.mockReset();
    ids.rewards = 'CREWARDS';
  });

  it('reads DataKey::Admin, encoded as the contracts store it (vec[Symbol("Admin")])', async () => {
    expect(ADMIN_KEY.toXDR('base64')).toBe(
      xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Admin')]).toXDR('base64'),
    );
    readInstanceValueMock.mockResolvedValueOnce(new Address(ADMIN).toScVal());
    await expect(readContractAdmin('CREWARDS')).resolves.toBe(ADMIN);
    expect(readInstanceValueMock).toHaveBeenCalledWith('CREWARDS', ADMIN_KEY);
  });

  it('has no admin when the key is unset or the contract is not deployed', async () => {
    readInstanceValueMock.mockResolvedValueOnce(null);
    await expect(readContractAdmin('CREWARDS')).resolves.toBeNull();
    await expect(readContractAdmin('')).resolves.toBeNull();
    expect(readInstanceValueMock).toHaveBeenCalledTimes(1);
  });

  it('reads each content contract; a failed read is null instead of rejecting', async () => {
    readInstanceValueMock.mockImplementation(async (id: string) => {
      if (id === 'CGATE') throw new Error('rpc down');
      return new Address(ADMIN).toScVal();
    });
    await expect(readContentAdmins()).resolves.toEqual({
      rewards: ADMIN,
      gates: null,
      quests: ADMIN,
    });
  });

  it('shows a section only to the admin its contract stores, and fails closed', () => {
    const all: ContentAdmins = { rewards: ADMIN, gates: ADMIN, quests: ADMIN };
    expect(manageableSections(ADMIN, all)).toEqual(['rewards', 'gates', 'quests']);
    expect(manageableSections(OTHER, all)).toEqual([]);
    expect(manageableSections(ADMIN, { rewards: OTHER, gates: ADMIN, quests: null })).toEqual([
      'gates',
    ]);
    expect(manageableSections(ADMIN, null)).toEqual([]);
    expect(manageableSections(null, all)).toEqual([]);
    expect(manageableSections('', { rewards: '', gates: '', quests: '' })).toEqual([]);
  });
});

describe('input checks', () => {
  it('parses a contract u32 and rejects anything else', () => {
    expect(parseU32(' 7 ', 'ID')).toEqual({ ok: true, value: 7 });
    expect(parseU32('4294967295', 'ID')).toEqual({ ok: true, value: 4_294_967_295 });
    for (const bad of ['4294967296', '-1', '1.5', '1e3', '', 'abc']) {
      expect(parseU32(bad, 'ID').ok).toBe(false);
    }
  });

  it('parses USDC into stroops with at most 7 decimals, and only above 0', () => {
    expect(parseUsdc('2.5')).toEqual({ ok: true, value: 25_000_000n });
    expect(parseUsdc('0.0000001')).toEqual({ ok: true, value: 1n });
    for (const bad of ['0', '0.0', '-1', '1.12345678', '1,5', '.5', 'abc', '']) {
      expect(parseUsdc(bad).ok).toBe(false);
    }
  });

  it('validates a reward like add_reward does: threshold ≥ 1, amount > 0, within the daily cap', () => {
    expect(validateReward({ id: '3', threshold: '100', amount: '2' }, 0n)).toEqual({
      ok: true,
      value: { id: 3, threshold: 100n, amount: 2n * USDC },
    });
    // #318: a 0 threshold would bypass the Earned-XP gate.
    const zero = validateReward({ id: '3', threshold: '0', amount: '2' }, 0n);
    expect(zero).toEqual({ ok: false, error: expect.stringContaining('at least 1') });
    expect(validateReward({ id: '3', threshold: '100', amount: '0' }, 0n).ok).toBe(false);
    expect(validateReward({ id: 'x', threshold: '100', amount: '2' }, 0n).ok).toBe(false);
    // A payout above a set daily cap could never be claimed (AmountExceedsCap).
    expect(validateReward({ id: '3', threshold: '100', amount: '6' }, 5n * USDC)).toEqual({
      ok: false,
      error: expect.stringContaining('above the daily cap of 5 USDC'),
    });
    expect(validateReward({ id: '3', threshold: '100', amount: '5' }, 5n * USDC).ok).toBe(true);
  });

  it('validates a supply cap against the claims already paid (0 = unlimited)', () => {
    const rows = [reward({ claims: 4 })];
    expect(validateSupply({ id: '3', maxClaims: '10' }, rows)).toEqual({
      ok: true,
      value: { reward: rows[0], maxClaims: 10 },
    });
    expect(validateSupply({ id: '3', maxClaims: '4' }, rows).ok).toBe(true);
    expect(validateSupply({ id: '3', maxClaims: '0' }, rows).ok).toBe(true);
    expect(validateSupply({ id: '3', maxClaims: '3' }, rows)).toEqual({
      ok: false,
      error: expect.stringContaining('already paid 4 claims'),
    });
    expect(validateSupply({ id: '9', maxClaims: '10' }, rows)).toEqual({
      ok: false,
      error: expect.stringContaining("doesn't exist"),
    });
  });

  it('validates a gate: Social/Earned track, min ≥ 1, a short label', () => {
    expect(validateGate({ id: '2', track: '1', min: '30', label: '  Bounty board ' })).toEqual({
      ok: true,
      value: { id: 2, track: 1, min: 30n, label: 'Bounty board' },
    });
    expect(validateGate({ id: '2', track: '2', min: '30', label: 'x' }).ok).toBe(false);
    expect(validateGate({ id: '2', track: '', min: '30', label: 'x' }).ok).toBe(false);
    expect(validateGate({ id: '2', track: '0', min: '0', label: 'x' }).ok).toBe(false);
    expect(validateGate({ id: '2', track: '0', min: '5', label: '   ' }).ok).toBe(false);
    const long = 'x'.repeat(GATE_LABEL_MAX + 1);
    expect(validateGate({ id: '2', track: '0', min: '5', label: long }).ok).toBe(false);
  });

  it('validates a quest: u32 ids and at least 1 XP', () => {
    expect(validateQuest({ id: '5', schemaId: '2', xp: '50' })).toEqual({
      ok: true,
      value: { id: 5, schemaId: 2, xp: 50n },
    });
    expect(validateQuest({ id: '5', schemaId: '2', xp: '0' }).ok).toBe(false);
    expect(validateQuest({ id: '5', schemaId: '4294967296', xp: '50' }).ok).toBe(false);
  });
});

describe('write consequences', () => {
  const draft = { id: 3, threshold: 100n, amount: 2n * USDC };

  it('states what a new or replaced reward pays, to whom', () => {
    expect(rewardConsequence(draft)).toBe(
      'Reward 3 will pay 2 USDC to any wallet with ≥ 100 Earned XP.',
    );
    const replaced = rewardConsequence(draft, reward({ amount: USDC, threshold: 50n, active: false }));
    expect(replaced).toContain('replacing 1 USDC at ≥ 50 Earned XP');
    expect(replaced).toContain('It will be re-enabled.');
    expect(replaced).toContain("already claimed it can't claim it again");
  });

  it('states what toggling a reward does', () => {
    expect(rewardToggleConsequence(reward(), false)).toBe(
      'Reward 3 (2 USDC at ≥ 100 Earned XP) will be disabled: no wallet can claim it until it is re-enabled.',
    );
    expect(rewardToggleConsequence(reward({ max_claims: 10, claims: 4 }), true)).toContain(
      'can claim 2 USDC. 6 of 10 claims are left.',
    );
  });

  it('states the remaining spend under a supply cap', () => {
    expect(supplyConsequence(reward({ claims: 4 }), 10)).toBe(
      'Reward 3 will stop paying after 10 claims in total (4 paid so far): at most 6 more, 12 USDC.',
    );
    expect(supplyConsequence(reward({ claims: 4 }), 4)).toContain('will stop paying now');
    expect(supplyConsequence(reward(), 0)).toContain('no claim limit');
  });

  it('states who a gate opens to, and what disabling it does', () => {
    const d = { id: 2, track: 1, min: 30n, label: 'Bounty board' };
    expect(gateConsequence(d)).toBe(
      'Gate 2 “Bounty board” will open to any wallet with ≥ 30 Earned XP.',
    );
    expect(gateConsequence(d, gate({ track: 0, min: 20, label: 'Old' }))).toContain(
      'replacing “Old” at ≥ 20 Social XP',
    );
    expect(gateToggleConsequence(gate(), false)).toContain('every access check fails');
    expect(gateToggleConsequence(gate(), true)).toContain('≥ 30 Earned XP passes it');
  });

  it('states what a quest awards, and what disabling it does', () => {
    const q = { id: 5, schemaId: 2, xp: 50n, active: false };
    expect(questConsequence({ id: 5, schemaId: 2, xp: 50n }, null)).toBe(
      'Quest 5 will award 50 Earned XP (schema 2) once to each wallet the attester verifies for it.',
    );
    expect(questConsequence({ id: 5, schemaId: 3, xp: 80n }, q)).toContain(
      'replacing 50 XP (schema 2). It will be re-enabled.',
    );
    expect(questToggleConsequence(q, true)).toContain('award its 50 Earned XP again');
    expect(questToggleConsequence(q, false)).toContain("can't award it");
  });
});

describe('contract errors', () => {
  // Parse `Name = N,` out of a contract's `pub enum Error`, so a renumbered or renamed
  // variant breaks this test instead of showing the admin the wrong message.
  function errorEnum(crate: string): Record<number, string> {
    const file = path.resolve(__dirname, `../../../../contracts/${crate}/src/lib.rs`);
    const src = readFileSync(file, 'utf8');
    const body = src.slice(src.indexOf('pub enum Error'), src.indexOf('}', src.indexOf('pub enum Error')));
    return Object.fromEntries([...body.matchAll(/(\w+)\s*=\s*(\d+)/g)].map((m) => [Number(m[2]), m[1]]));
  }

  it('maps the codes each contract actually uses for these errors', () => {
    const expected = {
      rewards: {
        crate: 'rewards',
        names: {
          1: 'NotInitialized',
          6: 'RewardNotFound',
          8: 'InvalidAmount',
          14: 'InvalidSupply',
          15: 'InvalidThreshold',
          16: 'AmountExceedsCap',
        },
      },
      gates: { crate: 'gate', names: { 1: 'NotInitialized', 3: 'GateNotFound', 6: 'BadTrack' } },
      quests: { crate: 'quest_registry', names: { 1: 'NotInitialized', 4: 'QuestNotFound' } },
    } as const;
    for (const [section, { crate, names }] of Object.entries(expected)) {
      const onChain = errorEnum(crate);
      const mapped = ADMIN_ERRORS[section as keyof typeof ADMIN_ERRORS];
      expect(Object.keys(mapped).map(Number).sort()).toEqual(Object.keys(names).map(Number).sort());
      for (const [code, name] of Object.entries(names)) expect(onChain[Number(code)]).toBe(name);
    }
  });

  it('turns a contract error into the admin copy for that contract', () => {
    const e = new Error('HostError: Error(Contract, #15)\nEvent log (newest first): …');
    expect(adminErrorMessage('rewards', e)).toBe(ADMIN_ERRORS.rewards[15]);
    // Codes are per contract: gate #15 is not the rewards threshold error.
    expect(adminErrorMessage('gates', e)).toContain('chain error 15');
    expect(adminErrorMessage('quests', new Error('Error(Contract, #4)'))).toBe(
      ADMIN_ERRORS.quests[4],
    );
    expect(adminErrorMessage('rewards', new Error('HostError: Error(Auth, InvalidAction)'))).toContain(
      'not its admin',
    );
  });
});
