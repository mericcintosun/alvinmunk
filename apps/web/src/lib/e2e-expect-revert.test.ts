import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Mirrors scripts/e2e-testnet.mjs expectRevert contract error matcher (#245)
 * and verifies that scripts/e2e-testnet.mjs stays aligned with the current
 * 4-argument QuestRegistry.award_quest ABI and Reputation STARTER_SOCIAL baseline.
 */
async function expectRevert(code: number, fn: () => Promise<unknown>): Promise<void> {
  if (!Number.isInteger(code) || code <= 0) {
    throw new Error(`expectRevert requires a positive integer contract error code, got: ${code}`);
  }
  let succeeded = false;
  try {
    await fn();
    succeeded = true;
  } catch (e: unknown) {
    const m = String((e as Error)?.message ?? e);
    const hit = /Error\(Contract,\s*#(\d+)\)/.exec(m);
    if (hit === null || Number(hit[1]) !== code) {
      throw new Error(`expected contract error #${code}, got: ${m.slice(0, 160)}`);
    }
  }
  if (succeeded) {
    throw new Error(`expected contract error #${code}, but call succeeded`);
  }
}

describe('e2e-testnet expectRevert & ABI alignment (#245)', () => {
  it('fails when expectRevert(10, ...) receives Error(Contract, #9)', async () => {
    await expect(
      expectRevert(10, async () => {
        throw new Error('sim: HostError: Error(Contract, #9)');
      }),
    ).rejects.toThrow('expected contract error #10');
  });

  it('does not match substring prefixes (#1 must not match #10 or #12)', async () => {
    await expect(
      expectRevert(1, async () => {
        throw new Error('sim: HostError: Error(Contract, #10)');
      }),
    ).rejects.toThrow('expected contract error #1');

    await expect(
      expectRevert(1, async () => {
        throw new Error('sim: HostError: Error(Contract, #12)');
      }),
    ).rejects.toThrow('expected contract error #1');
  });

  it('fails on non-contract errors (host, WasmVm, or network errors)', async () => {
    await expect(
      expectRevert(5, async () => {
        throw new Error('sim: HostError: Error(Value, UnexpectedType)');
      }),
    ).rejects.toThrow('expected contract error #5');

    await expect(
      expectRevert(5, async () => {
        throw new Error('fetch failed: network timeout');
      }),
    ).rejects.toThrow('expected contract error #5');
  });

  it('passes when the exact contract error code is thrown', async () => {
    await expect(
      expectRevert(10, async () => {
        throw new Error('sim: HostError: Error(Contract, #10)');
      }),
    ).resolves.toBeUndefined();
  });

  it('pins scripts/e2e-testnet.mjs to the 4-arg award_quest ABI and STARTER_SOCIAL baseline', () => {
    const e2ePath = join(process.cwd(), '..', '..', 'scripts', 'e2e-testnet.mjs');
    const source = readFileSync(e2ePath, 'utf8');
    expect(source).toContain("read(QUEST, 'quest_payload'");
    expect(source).toContain("invoke(recipientKp, QUEST, 'award_quest'");
    expect(source).toContain('await score(Aw.publicKey())) === 20');
    expect(source).toContain('await score(Bw.publicKey())) === 30');
    expect(source).not.toContain("invoke(ATTESTER, QUEST, 'award_quest'");
  });
});
