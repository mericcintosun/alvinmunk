import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transaction } from '@stellar/stellar-sdk';

const { server } = vi.hoisted(() => ({ server: { sendTransaction: vi.fn() } }));
vi.mock('./stellar', () => ({ server }));

import { SEND_ATTEMPTS, TxNotQueuedError, submitSigned } from './submit';

const tx = { envelope: 'signed' } as unknown as Transaction;

describe('submitSigned', () => {
  beforeEach(() => {
    server.sendTransaction.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('PENDING: resolves the hash after one send', async () => {
    server.sendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'H1' });
    await expect(submitSigned(tx, 'payment')).resolves.toBe('H1');
    expect(server.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it('DUPLICATE: the envelope is already queued, so it counts as accepted', async () => {
    server.sendTransaction.mockResolvedValue({ status: 'DUPLICATE', hash: 'H2' });
    await expect(submitSigned(tx, 'payment')).resolves.toBe('H2');
    expect(server.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it('TRY_AGAIN_LATER: backs off, resubmits the same envelope, then resolves on PENDING', async () => {
    server.sendTransaction
      .mockResolvedValueOnce({ status: 'TRY_AGAIN_LATER', hash: 'H3' })
      .mockResolvedValueOnce({ status: 'TRY_AGAIN_LATER', hash: 'H3' })
      .mockResolvedValueOnce({ status: 'PENDING', hash: 'H3' });

    const p = submitSigned(tx, 'payment');
    await vi.advanceTimersByTimeAsync(0);
    expect(server.sendTransaction).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000); // first backoff
    expect(server.sendTransaction).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1999); // second backoff doubles
    expect(server.sendTransaction).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toBe('H3');
    expect(server.sendTransaction).toHaveBeenCalledTimes(3);
    for (const [sent] of server.sendTransaction.mock.calls) expect(sent).toBe(tx);
  });

  it('TRY_AGAIN_LATER on every send: gives up with a clear, retryable error', async () => {
    server.sendTransaction.mockResolvedValue({ status: 'TRY_AGAIN_LATER', hash: 'H4' });

    const p = submitSigned(tx, 'payment');
    const settled = expect(p).rejects.toThrow(/network is busy.*try again/);
    await vi.runAllTimersAsync();
    await settled;
    const err = await p.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TxNotQueuedError);
    expect(err).toMatchObject({ retryable: true, hash: 'H4', attempts: SEND_ATTEMPTS });
    expect(server.sendTransaction).toHaveBeenCalledTimes(SEND_ATTEMPTS);
  });

  it('ERROR: throws at once and never resubmits', async () => {
    server.sendTransaction.mockResolvedValue({ status: 'ERROR', hash: 'H5', errorResult: { code: 'x' } });
    await expect(submitSigned(tx, 'payment')).rejects.toThrow(/^payment rejected/);
    expect(server.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it('sends through the RPC server it is given', async () => {
    const own = { sendTransaction: vi.fn(async () => ({ status: 'PENDING', hash: 'H6' })) };
    await expect(
      submitSigned(tx, 'faucet mint', own as unknown as Parameters<typeof submitSigned>[2]),
    ).resolves.toBe('H6');
    expect(own.sendTransaction).toHaveBeenCalledWith(tx);
    expect(server.sendTransaction).not.toHaveBeenCalled();
  });
});
