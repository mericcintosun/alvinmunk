import { describe, it, expect } from 'vitest';
import { humanizeError, withTimeout, contractErrorCode, shortAddress } from './utils';

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
});

describe('shortAddress', () => {
  it('middle-truncates long addresses', () => {
    expect(shortAddress('GABCDEFGHIJKLMNOP')).toBe('GABC…MNOP');
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
