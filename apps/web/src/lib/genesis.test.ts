import { Account, Networks } from '@stellar/stellar-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { server, waitForTransaction } = vi.hoisted(() => ({
  server: { getAccount: vi.fn(), sendTransaction: vi.fn() },
  waitForTransaction: vi.fn(async () => {}),
}));
vi.mock('./stellar', () => ({ server, networkPassphrase: Networks.TESTNET, waitForTransaction }));

import { recordGenesis } from './genesis';
import type { Wallet } from './wallet';

const SOURCE = 'GDIS5BDXSI2DDJNTKRZPI6MNB5XCLMN4Z6PPRPM4RQLZ3PSQ2YTERLFA';
const wallet = (): Wallet => ({
  kind: 'dev',
  address: SOURCE,
  sign: vi.fn(async (x: string) => x),
  signMessage: vi.fn(),
});

describe('recordGenesis submit', () => {
  beforeEach(() => {
    server.getAccount.mockReset().mockImplementation(async () => new Account(SOURCE, '1'));
    server.sendTransaction.mockReset();
    waitForTransaction.mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('resubmits on TRY_AGAIN_LATER and waits for the hash once it is PENDING', async () => {
    server.sendTransaction
      .mockResolvedValueOnce({ status: 'TRY_AGAIN_LATER', hash: 'G1' })
      .mockResolvedValueOnce({ status: 'PENDING', hash: 'G1' });

    const p = recordGenesis(wallet(), 'ada');
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe('G1');
    expect(server.sendTransaction).toHaveBeenCalledTimes(2);
    expect(waitForTransaction).toHaveBeenCalledWith('G1');
  });

  it('never waits on a hash Core did not queue', async () => {
    server.sendTransaction.mockResolvedValue({ status: 'TRY_AGAIN_LATER', hash: 'G2' });

    const p = recordGenesis(wallet(), 'ada');
    const settled = expect(p).rejects.toThrow(/network is busy/);
    await vi.runAllTimersAsync();
    await settled;
    expect(waitForTransaction).not.toHaveBeenCalled();
  });
});
