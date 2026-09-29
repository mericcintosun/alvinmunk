import { describe, it, expect, vi } from 'vitest';
import { humanizeError, withTimeout, contractErrorCode, shareInFlight } from './utils';

describe('contractErrorCode', () => {
  it('extracts a Soroban contract error code', () => {
    expect(contractErrorCode(new Error('HostError: Error(Contract, #6)'))).toBe(6);
    expect(contractErrorCode(new Error('no code here'))).toBeNull();
  });
});

describe('humanizeError', () => {
  it('prefers a mapped message when the code is known', () => {
    expect(humanizeError(new Error('Error(Contract, #4)'), { 4: 'Already gone.' })).toBe('Already gone.');
  });

  it('always gives a next step for an unknown code (never a dead end)', () => {
    const msg = humanizeError(new Error('Error(Contract, #99)'));
    expect(msg).toContain('chain error 99');
    expect(msg).toMatch(/try again/i);
  });

  it('drops the scary diagnostic tail', () => {
    const msg = humanizeError(new Error('boom\nEvent log (newest first): scary stuff'));
    expect(msg).toBe('boom');
  });

  describe('XLM fee errors', () => {
    it('maps txInsufficientBalance to XLM fee copy', () => {
      const msg = humanizeError(new Error('txInsufficientBalance'));
      expect(msg).toContain('XLM');
      expect(msg).toContain('network fee');
      expect(msg).not.toContain('USDC');
    });

    it('maps txInsufficientFee to XLM fee copy', () => {
      const msg = humanizeError(new Error('txInsufficientFee'));
      expect(msg).toContain('XLM');
      expect(msg).toContain('network fee');
      expect(msg).not.toContain('USDC');
    });

    it('matches txInsufficientBalance case-insensitively', () => {
      const msg = humanizeError(new Error('TxInsufficientBalance'));
      expect(msg).toContain('XLM');
      expect(msg).not.toContain('USDC');
    });
  });

  describe('USDC/trustline errors in tip flow', () => {
    it('maps SAC BalanceError to USDC copy in tip flow', () => {
      const msg = humanizeError(new Error('BalanceError'), {}, 'tip');
      expect(msg).toContain('USDC');
      expect(msg).toContain('claim a reward');
    });

    it('maps "insufficient balance" to USDC copy in tip flow', () => {
      const msg = humanizeError(new Error('insufficient balance'), {}, 'tip');
      expect(msg).toContain('USDC');
    });

    it('maps trustline error to recipient copy in tip flow', () => {
      const msg = humanizeError(new Error('trustline'), {}, 'tip');
      expect(msg).toContain('recipient');
      expect(msg).toContain("can't receive the tip");
    });

    it('does NOT map bare "insufficient" to USDC when no flow specified', () => {
      const msg = humanizeError(new Error('insufficient funds'));
      expect(msg).not.toContain('USDC');
      expect(msg).toBe('insufficient funds');
    });
  });

  describe('USDC/trustline errors in reward flow', () => {
    it('maps BalanceError to USDC copy in reward flow', () => {
      const msg = humanizeError(new Error('BalanceError'), {}, 'reward');
      expect(msg).toContain('USDC');
      expect(msg).toContain('claim a reward');
    });

    it('maps trustline error to self (not recipient) in reward flow', () => {
      const msg = humanizeError(new Error('trustline'), {}, 'reward');
      expect(msg).toContain('You');
      expect(msg).toContain("can't receive the reward");
      expect(msg).not.toContain('recipient');
      expect(msg).not.toContain('tip');
    });
  });

  describe('SAC edge cases', () => {
    it('maps the SAC "zero balance" message to USDC copy in tip flow', () => {
      const msg = humanizeError(new Error('zero balance is not sufficient to spend'), {}, 'tip');
      expect(msg).toContain('USDC');
    });

    it('does not read an auth failure as a missing trustline', () => {
      const msg = humanizeError(new Error('Error(Auth, InvalidAction): not authorized'), {}, 'tip');
      expect(msg).not.toContain('enabled this USDC');
    });

    it('keeps trustline copy out of flows that move no USDC', () => {
      const msg = humanizeError(new Error('trustline entry is missing'));
      expect(msg).toBe('trustline entry is missing');
    });

    it('still prefers the XLM fee copy inside a USDC flow', () => {
      const msg = humanizeError(new Error('send tip failed: txInsufficientBalance'), {}, 'tip');
      expect(msg).toContain('network fee');
      expect(msg).not.toContain('USDC');
    });
  });

  describe('non-USDC flows', () => {
    it('does not apply USDC heuristics to vouch mint errors', () => {
      const msg = humanizeError(new Error('balance is not sufficient'));
      expect(msg).not.toContain('USDC');
      expect(msg).toBe('balance is not sufficient');
    });

    it('does not apply USDC heuristics to handle claim errors', () => {
      const msg = humanizeError(new Error('insufficient balance'));
      expect(msg).not.toContain('USDC');
      expect(msg).toBe('insufficient balance');
    });
  });
});

describe('withTimeout', () => {
  it('resolves a fast promise unchanged', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000)).resolves.toBe(42);
  });

  it('rejects with a recoverable message when the promise hangs', async () => {
    await expect(withTimeout(new Promise(() => {}), 10, 'vouch')).rejects.toThrow(/timed out/i);
  });

  it('propagates the original rejection before the timeout fires', async () => {
    await expect(withTimeout(Promise.reject(new Error('upstream')), 1000)).rejects.toThrow('upstream');
  });
});

describe('shareInFlight', () => {
  it('gives concurrent callers of the same key one shared read', async () => {
    const pending = new Map<string, Promise<number>>();
    const run = vi.fn(async () => 7);
    const [a, b] = await Promise.all([
      shareInFlight(pending, 'k', run),
      shareInFlight(pending, 'k', run),
    ]);
    expect([a, b]).toEqual([7, 7]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('keeps different keys apart', async () => {
    const pending = new Map<string, Promise<string>>();
    const run = vi.fn(async () => 'x');
    await Promise.all([shareInFlight(pending, 'a', run), shareInFlight(pending, 'b', run)]);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('drops a settled read so the next call is fresh — even after a rejection', async () => {
    const pending = new Map<string, Promise<number>>();
    await expect(shareInFlight(pending, 'k', async () => Promise.reject(new Error('rpc')))).rejects.toThrow('rpc');
    expect(pending.size).toBe(0);
    await expect(shareInFlight(pending, 'k', async () => 2)).resolves.toBe(2);
    expect(pending.size).toBe(0);
  });
});
