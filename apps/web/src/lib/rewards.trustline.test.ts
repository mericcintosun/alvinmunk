import { Account, Networks } from '@stellar/stellar-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { server } = vi.hoisted(() => ({
  server: { getAccount: vi.fn(), sendTransaction: vi.fn(), getTransaction: vi.fn() },
}));
vi.mock('./stellar', () => ({
  server,
  horizon: {},
  networkPassphrase: Networks.TESTNET,
  config: { contracts: { usdcSac: 'CUSDC' } },
}));
vi.mock('./contracts', () => ({
  readContract: vi.fn(async () => 'USDC:GB72PZXNOU6DJ2BXZDITS24A5JCN3CEUNTKIX5ESZDXAY2R5HO7YZ3H3'),
  invokeAndWait: vi.fn(),
  invokeAndWaitHash: vi.fn(),
  readPublic: vi.fn(),
  rewardsId: () => 'CREWARDS',
  args: {},
}));

import { enableUsdc } from './rewards';
import type { Wallet } from './wallet';

const SOURCE = 'GDIS5BDXSI2DDJNTKRZPI6MNB5XCLMN4Z6PPRPM4RQLZ3PSQ2YTERLFA';
const wallet = (): Wallet => ({
  kind: 'dev',
  address: SOURCE,
  sign: vi.fn(async (x: string) => x),
});

describe('enableUsdc submit', () => {
  beforeEach(() => {
    server.getAccount.mockReset().mockImplementation(async () => new Account(SOURCE, '1'));
    server.sendTransaction.mockReset();
    server.getTransaction.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('resubmits on TRY_AGAIN_LATER, then confirms the queued trustline', async () => {
    server.sendTransaction
      .mockResolvedValueOnce({ status: 'TRY_AGAIN_LATER', hash: 'T1' })
      .mockResolvedValueOnce({ status: 'PENDING', hash: 'T1' });
    server.getTransaction.mockResolvedValue({ status: 'SUCCESS' });

    const p = enableUsdc(wallet());
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe('T1');
    expect(server.sendTransaction).toHaveBeenCalledTimes(2);
    expect(server.getTransaction).toHaveBeenCalledWith('T1');
  });

  it('never reports success for a trustline Core did not queue', async () => {
    server.sendTransaction.mockResolvedValue({ status: 'TRY_AGAIN_LATER', hash: 'T2' });

    const p = enableUsdc(wallet());
    const settled = expect(p).rejects.toThrow(/network is busy/);
    await vi.runAllTimersAsync();
    await settled;
    expect(server.getTransaction).not.toHaveBeenCalled();
  });

  it('keeps confirming through a transient status-read error (#193)', async () => {
    server.sendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'T3' });
    server.getTransaction
      .mockRejectedValueOnce(new Error('RPC 429'))
      .mockResolvedValueOnce({ status: 'SUCCESS' });

    const p = enableUsdc(wallet());
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe('T3');
    expect(server.getTransaction).toHaveBeenCalledTimes(2);
  });

  it('still rejects a trustline that failed on-chain', async () => {
    server.sendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'T4' });
    server.getTransaction.mockResolvedValue({ status: 'FAILED' });

    const p = enableUsdc(wallet());
    const settled = expect(p).rejects.toThrow(/failed on-chain/);
    await vi.runAllTimersAsync();
    await settled;
  });
});
