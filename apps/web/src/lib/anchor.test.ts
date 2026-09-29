// @vitest-environment node
// Keypair/WebAuth need Node's own Uint8Array; jsdom's cross-realm one fails the SDK's checks.
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  Account,
  Asset,
  Keypair,
  Operation,
  TransactionBuilder,
  WebAuth,
  type Transaction,
} from '@stellar/stellar-sdk';
import {
  anchorEntryUrl,
  authenticate,
  buildWithdrawalPayment,
  getAnchorConfig,
  getWithdrawalStatus,
  isAnchorConfigured,
  isTerminalStatus,
  sendWithdrawalPayment,
  startWithdrawal,
  type AnchorToml,
  type Withdrawal,
} from './anchor';
import { networkPassphrase, server } from './stellar';
import type { Wallet } from './wallet';

describe('anchor config hook', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_ANCHOR_HOME_DOMAIN;
    delete process.env.NEXT_PUBLIC_ANCHOR_TRANSFER_SERVER;
  });

  it('is unconfigured until BOTH the home domain and transfer server are set', () => {
    expect(getAnchorConfig()).toBeNull();
    expect(isAnchorConfigured()).toBe(false);
    process.env.NEXT_PUBLIC_ANCHOR_HOME_DOMAIN = 'anchor.example.com';
    expect(isAnchorConfigured()).toBe(false); // still missing the transfer server
    process.env.NEXT_PUBLIC_ANCHOR_TRANSFER_SERVER = 'https://anchor.example.com/sep24';
    expect(isAnchorConfigured()).toBe(true);
  });

  it('builds an https entry url from a bare home domain', () => {
    process.env.NEXT_PUBLIC_ANCHOR_HOME_DOMAIN = 'anchor.example.com';
    process.env.NEXT_PUBLIC_ANCHOR_TRANSFER_SERVER = 'https://anchor.example.com/sep24';
    expect(anchorEntryUrl()).toBe('https://anchor.example.com');
  });
});

const DOMAIN = 'anchor.example.com';
const serverKp = Keypair.random();
const clientKp = Keypair.random();
const toml: AnchorToml = {
  transferServer: `https://${DOMAIN}/sep24`,
  webAuthEndpoint: `https://${DOMAIN}/auth`,
  signingKey: serverKp.publicKey(),
};

function fakeWallet(kp = clientKp) {
  const sign = vi.fn(async (xdr: string) => {
    const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase) as Transaction;
    tx.sign(kp);
    return tx.toXDR();
  });
  return { wallet: { kind: 'dev', address: kp.publicKey(), sign } as unknown as Wallet, sign };
}

/** Serve `challenge` on GET and a JWT on POST; return the fetch mock. */
function mockAuthServer(challenge: string) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'POST'
      ? new Response(JSON.stringify({ token: 'jwt-123' }), { status: 200 })
      : new Response(JSON.stringify({ transaction: challenge, network_passphrase: networkPassphrase }), {
          status: 200,
        }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('SEP-10 authenticate', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('verifies a genuine challenge, signs it and returns the JWT', async () => {
    const challenge = WebAuth.buildChallengeTx(
      serverKp,
      clientKp.publicKey(),
      DOMAIN,
      300,
      networkPassphrase,
      DOMAIN,
    );
    const fetchMock = mockAuthServer(challenge);
    const { wallet, sign } = fakeWallet();

    await expect(authenticate(wallet, toml, DOMAIN)).resolves.toBe('jwt-123');
    expect(sign).toHaveBeenCalledTimes(1);
    const posted = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as { transaction: string };
    const signedTx = TransactionBuilder.fromXDR(posted.transaction, networkPassphrase) as Transaction;
    expect(signedTx.signatures).toHaveLength(2); // server + client
  });

  it('refuses to sign an arbitrary transaction served as a challenge', async () => {
    // A payment out of the user's account, signed by the "anchor" — not a SEP-10 challenge.
    const evil = new TransactionBuilder(new Account(clientKp.publicKey(), '41'), {
      fee: '100',
      networkPassphrase,
    })
      .addOperation(
        Operation.payment({ destination: serverKp.publicKey(), asset: Asset.native(), amount: '1000' }),
      )
      .setTimeout(300)
      .build();
    evil.sign(serverKp);
    mockAuthServer(evil.toXDR());
    const { wallet, sign } = fakeWallet();

    await expect(authenticate(wallet, toml, DOMAIN)).rejects.toThrow();
    expect(sign).not.toHaveBeenCalled();
  });

  it('refuses a challenge signed by a key other than the SIGNING_KEY', async () => {
    const impostor = Keypair.random();
    const challenge = WebAuth.buildChallengeTx(
      impostor,
      clientKp.publicKey(),
      DOMAIN,
      300,
      networkPassphrase,
      DOMAIN,
    );
    mockAuthServer(challenge);
    const { wallet, sign } = fakeWallet();

    await expect(authenticate(wallet, toml, DOMAIN)).rejects.toThrow();
    expect(sign).not.toHaveBeenCalled();
  });

  it('refuses a challenge issued for a different account', async () => {
    const other = Keypair.random();
    const challenge = WebAuth.buildChallengeTx(serverKp, other.publicKey(), DOMAIN, 300, networkPassphrase, DOMAIN);
    mockAuthServer(challenge);
    const { wallet, sign } = fakeWallet();

    await expect(authenticate(wallet, toml, DOMAIN)).rejects.toThrow(/different account/);
    expect(sign).not.toHaveBeenCalled();
  });

  it('rejects passkey wallets before contacting the anchor', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const wallet = { kind: 'passkey', address: `C${'A'.repeat(55)}`, sign: vi.fn() } as unknown as Wallet;
    await expect(authenticate(wallet, toml, DOMAIN)).rejects.toThrow(/classic wallet/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('SEP-24 withdrawal', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads the status from the nested `transaction` object', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              transaction: {
                id: 'tx-1',
                status: 'pending_user_transfer_start',
                amount_in: '5.0',
                withdraw_anchor_account: serverKp.publicKey(),
                withdraw_memo: '12345',
                withdraw_memo_type: 'id',
              },
            }),
            { status: 200 },
          ),
      ),
    );
    await expect(getWithdrawalStatus('tx-1', 'jwt', toml.transferServer)).resolves.toMatchObject({
      id: 'tx-1',
      status: 'pending_user_transfer_start',
      amountIn: '5.0',
      withdrawAnchorAccount: serverKp.publicKey(),
      withdrawMemo: '12345',
      withdrawMemoType: 'id',
    });
  });

  it('rejects malformed amounts before any network call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { wallet } = fakeWallet();
    for (const bad of ['', '0', '-1', '1.12345678', 'abc', '1,5']) {
      await expect(startWithdrawal(wallet, bad)).rejects.toThrow(/valid USDC amount/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('marks only final SEP-24 statuses as terminal', () => {
    expect(isTerminalStatus('completed')).toBe(true);
    expect(isTerminalStatus('refunded')).toBe(true);
    expect(isTerminalStatus('incomplete')).toBe(false);
    expect(isTerminalStatus('pending_user_transfer_start')).toBe(false);
  });
});

describe('buildWithdrawalPayment', () => {
  const issuer = Keypair.random().publicKey();
  const base: Withdrawal = {
    id: 'tx-1',
    status: 'pending_user_transfer_start',
    amountIn: '5.0000000',
    withdrawAnchorAccount: serverKp.publicKey(),
  };
  const build = (w: Withdrawal) =>
    TransactionBuilder.fromXDR(
      buildWithdrawalPayment(new Account(clientKp.publicKey(), '1'), w, issuer),
      networkPassphrase,
    ) as Transaction;

  it('pays amount_in of USDC to the anchor account', () => {
    const tx = build(base);
    expect(tx.operations).toHaveLength(1);
    const op = tx.operations[0] as Operation.Payment;
    expect(op.type).toBe('payment');
    expect(op.destination).toBe(serverKp.publicKey());
    expect(op.amount).toBe('5.0000000');
    expect(op.asset.getCode()).toBe('USDC');
    expect(op.asset.getIssuer()).toBe(issuer);
  });

  it('carries the anchor memo in the format it asked for', () => {
    expect(build({ ...base, withdrawMemo: 'hello', withdrawMemoType: 'text' }).memo.value?.toString()).toBe(
      'hello',
    );
    expect(build({ ...base, withdrawMemo: '42', withdrawMemoType: 'id' }).memo.value).toBe('42');
    const hash = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i)));
    const memo = build({ ...base, withdrawMemo: hash, withdrawMemoType: 'hash' }).memo;
    expect(memo.type).toBe('hash');
    expect(Array.from(memo.value as Uint8Array)).toEqual(Array.from({ length: 32 }, (_, i) => i));
  });

  it('refuses to pay before the anchor is waiting for the transfer', () => {
    expect(() => build({ ...base, status: 'incomplete' })).toThrow(/not waiting/);
    expect(() => build({ ...base, withdrawAnchorAccount: undefined })).toThrow(/where to send/);
  });
});

describe('sendWithdrawalPayment', () => {
  const issuer = Keypair.random().publicKey();
  const w: Withdrawal = {
    id: 'tx-1',
    status: 'pending_user_transfer_start',
    amountIn: '5.0000000',
    withdrawAnchorAccount: serverKp.publicKey(),
  };
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('never polls a payment Core kept answering TRY_AGAIN_LATER to', async () => {
    vi.useFakeTimers();
    vi.spyOn(server, 'getAccount').mockResolvedValue(new Account(clientKp.publicKey(), '1'));
    const send = vi
      .spyOn(server, 'sendTransaction')
      .mockResolvedValue({ status: 'TRY_AGAIN_LATER', hash: 'P1', latestLedger: 1, latestLedgerCloseTime: 0 });
    const poll = vi.spyOn(server, 'getTransaction');

    const p = sendWithdrawalPayment(fakeWallet().wallet, w, issuer);
    const settled = expect(p).rejects.toThrow(/network is busy/);
    await vi.runAllTimersAsync();
    await settled;
    expect(send.mock.calls.length).toBeGreaterThan(1);
    expect(poll).not.toHaveBeenCalled();
  });
});
