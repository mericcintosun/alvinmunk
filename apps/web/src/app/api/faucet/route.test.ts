// @vitest-environment node
/**
 * Branch-coverage tests for POST /api/faucet (closes #170).
 *
 * Two bug families fixed:
 *   1. SAC mint (C… recipients): poll loop fell through to ok:true on timeout;
 *      TRY_AGAIN_LATER was not handled.
 *   2. Classic payment (G… recipients): every loadAccount failure was 404;
 *      submitTransaction errors dropped Horizon result_codes.
 *
 * Pattern (mirrors route.test.ts in /api/attest):
 *   - vi.mock at top level so factories are hoisted.
 *   - vi.resetModules() in beforeEach so the module-level `funded`/`hits`
 *     Maps start fresh, then dynamic import gives us the POST handler.
 *   - Shared hoisted mock objects so beforeEach can configure them before the
 *     factory is called.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEND_ATTEMPTS } from '../../../lib/submit';

// ─── hardcoded valid test addresses ───────────────────────────────────────
// Pre-generated so we never call Keypair.random() at module evaluation time
// (which would race with the vi.mock factory below).

/** A valid C… smart-wallet (contract) address. */
const C_ADDR = 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526';
/** A valid G… classic address. */
const G_ADDR = 'GC4TEBCIRYGH7Z4JWPE4YGKNQ5MXXQFNK4KZTDXWVDKAFQOK7Z4JZPO6';
/** Pre-generated issuer keypair so Keypair.fromSecret doesn't need real crypto. */
const ISSUER_SECRET = 'SCPN4CXC2SYVU2C7MOR3X34IPREMYGLWMA7PQSVGIGWTNLOGIHADBT6H';
const ISSUER_PUBLIC = 'GBBXXXOQA3CDJHCSGR4HGCKMRUH5Q5ESRLLYQOT43IGPKBA5TZ2NTO5H';

// ─── hoisted shared state ─────────────────────────────────────────────────
// vi.hoisted runs before any import, so these objects are available in the
// vi.mock factories below without circular-ref issues.
const { state, rpcMocks, horizonMocks, NotFoundError } = vi.hoisted(() => {
  /** Fake Horizon NotFoundError — satisfies `instanceof NotFoundError`. */
  class FakeNotFoundError extends Error {
    name = 'NotFoundError';
    constructor() { super('not found'); }
  }

  return {
    /** Mutable network config that tests can mutate. */
    state: {
      network: 'testnet' as string,
      rpcUrl: 'https://rpc.test',
      horizonUrl: 'https://horizon.test',
      networkPassphrase: 'Test SDF Network ; September 2015',
      contracts: {
        usdcSac: 'CSAC000000000000000000000000000000000000000000000000000000' as string,
      },
      configErrors: [] as string[],
    },
    /** rpc.Server instance surface the route calls. */
    rpcMocks: {
      getAccount: vi.fn(),
      prepareTransaction: vi.fn(),
      sendTransaction: vi.fn(),
      getTransaction: vi.fn(),
    },
    /** Horizon.Server instance surface the route calls. */
    horizonMocks: {
      loadAccount: vi.fn(),
      submitTransaction: vi.fn(),
    },
    NotFoundError: FakeNotFoundError,
  };
});

// ─── mock @stellar/stellar-sdk ────────────────────────────────────────────
vi.mock('@stellar/stellar-sdk', () => {
  /** Minimal Transaction stub — the route only calls .sign(). */
  class FakeTx { sign() {} }

  /**
   * Minimal Keypair stub.
   * The route calls:
   *   - Keypair.fromSecret(secret) → .publicKey() / .sign(tx)
   */
  class FakeKeypair {
    static fromSecret(_s: string) { return new FakeKeypair(); }
    static random()               { return new FakeKeypair(); }
    publicKey() { return ISSUER_PUBLIC; }
    sign(_tx: unknown) {}
  }

  return {
    Keypair:            FakeKeypair,
    StrKey:             { encodeContract: () => C_ADDR },
    Address:            class { toScVal() { return {}; } },
    Asset:              class { constructor(_code: string, _issuer: string) {} },
    Contract:           class { call() { return {}; } },
    Operation:          { payment: vi.fn().mockReturnValue({}) },
    nativeToScVal:      vi.fn().mockReturnValue({}),
    TransactionBuilder: class {
      addOperation() { return this; }
      setTimeout()   { return this; }
      build()        { return new FakeTx(); }
    },
    rpc: {
      Server: vi.fn().mockImplementation(() => rpcMocks),
    },
    Horizon: {
      Server:        vi.fn().mockImplementation(() => horizonMocks),
    },
    // The SDK exports Horizon's NotFoundError at the top level (there is no Horizon.NotFoundError).
    NotFoundError: NotFoundError,
  };
});

// ─── mock lib/stellar ─────────────────────────────────────────────────────
vi.mock('../../../lib/stellar', () => ({
  get config() {
    return {
      network:           state.network,
      rpcUrl:            state.rpcUrl,
      horizonUrl:        state.horizonUrl,
      networkPassphrase: state.networkPassphrase,
      contracts: {
        usdcSac: state.contracts.usdcSac,
      },
    };
  },
  get configErrors() { return state.configErrors; },
  misconfiguredResponse() {
    if (state.configErrors.length === 0) return null;
    return new Response(JSON.stringify({ error: 'misconfigured' }), { status: 503 });
  },
}));

// ─── types ────────────────────────────────────────────────────────────────

type PostFn = (req: Request) => Promise<Response>;
let POST: PostFn;

// ─── setup / teardown ─────────────────────────────────────────────────────

beforeEach(async () => {
  // Reset module registry so the route's module-level `funded` / `hits` Maps
  // are fresh, then re-import a clean POST handler.
  vi.resetModules();

  // Restore config defaults.
  state.network = 'testnet';
  state.configErrors = [];
  state.contracts.usdcSac = 'CSAC000000000000000000000000000000000000000000000000000000';

  // Default RPC happy-path: PENDING → SUCCESS.
  // These are set BEFORE the import so the mock factory (which runs during
  // import) captures the same rpcMocks object that's already configured.
  rpcMocks.getAccount.mockResolvedValue({
    accountId: () => ISSUER_PUBLIC,
    sequence: '100',
    incrementSequenceNumber() {},
  });
  rpcMocks.prepareTransaction.mockImplementation((tx: unknown) => tx);
  rpcMocks.sendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'abc123' });
  rpcMocks.getTransaction.mockResolvedValue({ status: 'SUCCESS' });

  // Default Horizon happy-path: recipient account exists with USDC trustline.
  horizonMocks.loadAccount.mockResolvedValue({
    balances: [
      {
        asset_code:   'USDC',
        asset_issuer: ISSUER_PUBLIC, // must equal issuer.publicKey()
        asset_type:   'credit_alphanum4',
        balance:      '0',
      },
    ],
  });
  horizonMocks.submitTransaction.mockResolvedValue({ hash: 'classic-hash' });

  // Set the issuer secret so the route doesn't bail with a 500.
  process.env.USDC_ISSUER_SECRET_KEY = ISSUER_SECRET;

  // Fresh import after resetModules — gets a new module instance.
  ({ POST } = (await import('./route')) as { POST: PostFn });
});

afterEach(() => {
  delete process.env.USDC_ISSUER_SECRET_KEY;
  // clearAllMocks resets call counts and implementations.
  // Do NOT use vi.restoreAllMocks() here — it would restore the vi.fn()
  // instances created inside the vi.mock() factory (Horizon.Server,
  // rpc.Server constructors), removing their mockImplementation and
  // causing the next test's constructed server to be undefined.
  vi.clearAllMocks();
});

// ─── helpers ──────────────────────────────────────────────────────────────

function makeReq(body: Record<string, unknown>, ip = '1.2.3.4'): Request {
  return new Request('http://localhost/api/faucet', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

// ─── common guard tests ────────────────────────────────────────────────────

describe('POST /api/faucet — common guards', () => {
  it('returns 403 when network is mainnet', async () => {
    state.network = 'mainnet';
    // Re-import so IS_MAINNET (computed at module load) sees the updated config.
    vi.resetModules();
    ({ POST } = (await import('./route')) as { POST: PostFn });

    const res = await POST(makeReq({ recipient: G_ADDR }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/mainnet/i);
  });

  it('returns 500 when USDC_ISSUER_SECRET_KEY is not set', async () => {
    delete process.env.USDC_ISSUER_SECRET_KEY;
    const res = await POST(makeReq({ recipient: G_ADDR }));
    expect(res.status).toBe(500);
  });

  it('returns 400 for an invalid recipient address', async () => {
    const res = await POST(makeReq({ recipient: 'not-an-address' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when recipient field is missing', async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });

  it('returns 503 when the network config is misconfigured', async () => {
    state.configErrors = ['NEXT_PUBLIC_NETWORK_PASSPHRASE is wrong'];
    const res = await POST(makeReq({ recipient: G_ADDR }));
    expect(res.status).toBe(503);
  });
});

// ─── SAC mint path (C… recipients) ────────────────────────────────────────

describe('POST /api/faucet — SAC mint path (C… recipients)', () => {
  it('happy path: returns ok:true, hash, amount on SUCCESS', async () => {
    const res = await POST(makeReq({ recipient: C_ADDR }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.hash).toBeDefined();
    expect(body.amount).toBe('5');
  });

  it('returns 429 on a second request after the recipient is funded', async () => {
    await POST(makeReq({ recipient: C_ADDR }));
    const res2 = await POST(makeReq({ recipient: C_ADDR }, '5.6.7.8'));
    expect(res2.status).toBe(429);
    expect((await res2.json()).error).toMatch(/already funded/i);
  });

  it('returns 503 for TRY_AGAIN_LATER and does not mark funded', async () => {
    rpcMocks.sendTransaction.mockResolvedValue({ status: 'TRY_AGAIN_LATER', hash: 'tal-hash' });
    vi.useFakeTimers();

    const promise = POST(makeReq({ recipient: C_ADDR }));
    // submitSigned resubmits the same envelope with backoff before giving up.
    await vi.runAllTimersAsync();
    const res = await promise;
    vi.useRealTimers();

    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/try again/i);
    expect(rpcMocks.sendTransaction).toHaveBeenCalledTimes(SEND_ATTEMPTS);
    expect(rpcMocks.getTransaction).not.toHaveBeenCalled(); // a never-queued hash is never polled

    // Must NOT be in funded — a retry succeeds rather than hitting 429.
    rpcMocks.sendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'abc123' });
    rpcMocks.getTransaction.mockResolvedValue({ status: 'SUCCESS' });
    const retry = await POST(makeReq({ recipient: C_ADDR }, '5.6.7.8'));
    expect(retry.status).toBe(200);
  });

  it('returns 504 when poll loop times out and does not mark funded', async () => {
    rpcMocks.sendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'slow-hash' });
    // Every poll returns NOT_FOUND — SUCCESS never appears.
    rpcMocks.getTransaction.mockResolvedValue({ status: 'NOT_FOUND' });
    vi.useFakeTimers();

    const promise = POST(makeReq({ recipient: C_ADDR }));
    // Flush all 30 × 1 000 ms sleeps in the poll loop.
    await vi.runAllTimersAsync();
    const res = await promise;

    vi.useRealTimers();
    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.error).toMatch(/not confirmed/i);
    expect(body.hash).toBe('slow-hash');

    // Recipient must NOT be in funded — a retry should be able to succeed.
    rpcMocks.getTransaction.mockResolvedValue({ status: 'SUCCESS' });
    const retry = await POST(makeReq({ recipient: C_ADDR }, '5.6.7.8'));
    expect(retry.status).toBe(200);
  });

  it('returns 502 when on-chain mint status is FAILED, and does not mark funded', async () => {
    rpcMocks.getTransaction.mockResolvedValue({ status: 'FAILED' });

    const res = await POST(makeReq({ recipient: C_ADDR }));
    expect(res.status).toBe(502);

    // Recipient NOT in funded — retry is not blocked.
    rpcMocks.getTransaction.mockResolvedValue({ status: 'SUCCESS' });
    const retry = await POST(makeReq({ recipient: C_ADDR }, '5.6.7.8'));
    expect(retry.status).not.toBe(429);
  });

  it('returns 502 when sendTransaction reports ERROR status', async () => {
    rpcMocks.sendTransaction.mockResolvedValue({ status: 'ERROR', errorResult: { code: -1 } });
    const res = await POST(makeReq({ recipient: C_ADDR }));
    expect(res.status).toBe(502);
  });

  it('returns 500 when the USDC SAC contract id is not configured', async () => {
    state.contracts.usdcSac = '';
    // Re-import so the module picks up the empty SAC id at load time.
    vi.resetModules();
    ({ POST } = (await import('./route')) as { POST: PostFn });
    const res = await POST(makeReq({ recipient: C_ADDR }));
    expect(res.status).toBe(500);
  });
});

// ─── Classic payment path (G… recipients) ─────────────────────────────────

describe('POST /api/faucet — classic payment path (G… recipients)', () => {
  it('happy path: returns ok:true on a successful classic payment', async () => {
    const res = await POST(makeReq({ recipient: G_ADDR }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.hash).toBeDefined();
  });

  it('returns 404 only for a Horizon NotFoundError on loadAccount', async () => {
    horizonMocks.loadAccount.mockRejectedValue(new NotFoundError());

    const res = await POST(makeReq({ recipient: G_ADDR }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/not found/i);
  });

  it('returns 502 (not 404) when loadAccount throws any other error', async () => {
    horizonMocks.loadAccount.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const res = await POST(makeReq({ recipient: G_ADDR }));
    expect(res.status).toBe(502);
    const body = await res.json();
    // Must NOT say the account doesn't exist — that would be a false 404.
    expect(body.error).not.toMatch(/account not found/i);
  });

  it('returns 409 when the recipient has no USDC trustline', async () => {
    horizonMocks.loadAccount.mockResolvedValue({ balances: [] });

    const res = await POST(makeReq({ recipient: G_ADDR }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/trustline/i);
  });

  it('returns 502 with result_codes when submitTransaction fails with Horizon extras', async () => {
    const resultCodes = { transaction: 'tx_bad_seq', operations: ['op_no_trust'] };
    horizonMocks.submitTransaction.mockRejectedValue(
      Object.assign(new Error('Transaction submission failed'), {
        response: { data: { extras: { result_codes: resultCodes } } },
      }),
    );

    const res = await POST(makeReq({ recipient: G_ADDR }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.result_codes).toEqual(resultCodes);
    expect(body.error).toBeTruthy();
  });

  it('returns 502 without result_codes when there are none in the error', async () => {
    horizonMocks.submitTransaction.mockRejectedValue(new Error('network timeout'));

    const res = await POST(makeReq({ recipient: G_ADDR }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.result_codes).toBeUndefined();
    expect(body.error).toMatch(/timeout/i);
  });

  it('does not mark recipient funded when submitTransaction fails', async () => {
    horizonMocks.submitTransaction.mockRejectedValue(new Error('failed'));
    await POST(makeReq({ recipient: G_ADDR }));

    // Fix the mock and retry — must succeed, not hit the 429 "already funded" guard.
    horizonMocks.submitTransaction.mockResolvedValue({ hash: 'retry-hash' });
    const retry = await POST(makeReq({ recipient: G_ADDR }, '5.6.7.8'));
    expect(retry.status).toBe(200);
  });
});
