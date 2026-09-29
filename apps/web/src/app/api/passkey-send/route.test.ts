// @vitest-environment node
/**
 * Tests for the /api/passkey-send route handler (issue #172).
 *
 * Three suites:
 *   - "input validation": malformed XDR, invalid auth, wrong envelope types return 400
 *   - "relayer error mapping": PluginTransportError → 502/504, PluginExecutionError → 422
 *   - "happy paths": successful contract call + deploy with mocked ChannelsClient
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  Account,
  Address,
  Keypair,
  Operation,
  SorobanDataBuilder,
  TransactionBuilder,
  xdr,
  hash as sha256,
} from '@stellar/stellar-sdk';
import {
  ChannelsClient,
  PluginExecutionError,
  PluginTransportError,
  PluginUnexpectedError,
} from '@openzeppelin/relayer-plugin-channels';

const PASSPHRASE = 'Test SDF Network ; September 2015';

type Post = (req: Request) => Promise<Response>;
let POST: Post;
let submitSorobanTxMock: Mock;
let submitTxMock: Mock;

/** A signed Soroban deploy tx whose fee differs from its resource fee (what refeeDeploy fixes). */
function buildDeployEnvelope(fee: number): string {
  const source = Keypair.fromRawEd25519Seed(sha256(Buffer.from('kalepail')));
  const tx = new TransactionBuilder(new Account(source.publicKey(), '1'), {
    fee: String(fee),
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(
      Operation.createCustomContract({
        address: new Address(source.publicKey()),
        wasmHash: Buffer.alloc(32),
        salt: Buffer.alloc(32),
      }),
    )
    .setSorobanData(new SorobanDataBuilder().setResourceFee(fee - 100).build())
    .setTimeout(0)
    .build();
  tx.sign(source);
  return tx.toXDR();
}

/** Valid base64-encoded SorobanAuthorizedFunction (invoke contract) */
function validFunc(): string {
  const addr = Address.contract(Buffer.alloc(32, 1)).toScAddress();
  const func = xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
    new xdr.InvokeContractArgs({
      contractAddress: addr,
      functionName: 'test',
      args: [],
    }),
  );
  return func.toXDR('base64');
}

/** Valid base64-encoded SorobanAuthorizationEntry */
function validAuth(): string {
  const entry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: Address.contract(Buffer.alloc(32, 1)).toScAddress(),
          functionName: 'test',
          args: [],
        }),
      ),
      subInvocations: [],
    }),
  });
  return entry.toXDR('base64');
}

function passkeySend(body: Record<string, unknown>): Promise<Response> {
  return POST(
    new Request('http://localhost/api/passkey-send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('PASSKEY_RELAYER_URL', 'https://relayer.example.com');
  vi.stubEnv('PASSKEY_RELAYER_API_KEY', 'test-api-key');
  vi.stubEnv('NEXT_PUBLIC_NETWORK_PASSPHRASE', PASSPHRASE);

  // Mock ChannelsClient methods
  submitSorobanTxMock = vi.fn(async () => ({ hash: 'mockhash123' }));
  submitTxMock = vi.fn(async () => ({ hash: 'mockhash456' }));

  vi.spyOn(ChannelsClient.prototype, 'submitSorobanTransaction').mockImplementation(submitSorobanTxMock);
  vi.spyOn(ChannelsClient.prototype, 'submitTransaction').mockImplementation(submitTxMock);

  // Mock console methods to suppress logs during tests
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  ({ POST } = (await import('./route')) as { POST: Post });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════
// Suite — input validation (issue #172: client errors → 400)
// ══════════════════════════════════════════════════════════════════════════

describe('POST /api/passkey-send — input validation', () => {
  it('400 when body is not valid JSON', async () => {
    const res = await POST(
      new Request('http://localhost/api/passkey-send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not valid json',
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/json/i);
    expect(submitSorobanTxMock).not.toHaveBeenCalled();
    expect(submitTxMock).not.toHaveBeenCalled();
  });

  it('400 when body is neither { func, auth } nor { xdr }', async () => {
    const res = await passkeySend({ something: 'else' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/must be/i);
    expect(submitSorobanTxMock).not.toHaveBeenCalled();
    expect(submitTxMock).not.toHaveBeenCalled();
  });

  it('400 when func is provided but auth is not an array', async () => {
    const res = await passkeySend({ func: validFunc(), auth: 'notanarray' });
    expect(res.status).toBe(400);
    expect(submitSorobanTxMock).not.toHaveBeenCalled();
  });

  it('400 when auth array contains non-string elements', async () => {
    const res = await passkeySend({ func: validFunc(), auth: [validAuth(), 123, validAuth()] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/auth must be an array/i);
    expect(submitSorobanTxMock).not.toHaveBeenCalled();
  });

  it('400 when func is malformed base64', async () => {
    const res = await passkeySend({ func: 'not-valid-base64!!!', auth: [] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/func must be valid/i);
    expect(submitSorobanTxMock).not.toHaveBeenCalled();
  });

  it('400 when func is valid base64 but not valid SorobanAuthorizedFunction XDR', async () => {
    const res = await passkeySend({ func: Buffer.from('random bytes').toString('base64'), auth: [] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/func must be valid/i);
    expect(submitSorobanTxMock).not.toHaveBeenCalled();
  });

  it('400 when auth entry is malformed XDR', async () => {
    const res = await passkeySend({ func: validFunc(), auth: ['not-valid-xdr!!!'] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/auth\[0\] must be valid/i);
    expect(submitSorobanTxMock).not.toHaveBeenCalled();
  });

  it('400 when xdr is malformed base64', async () => {
    const res = await passkeySend({ xdr: 'not-valid-base64!!!' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/xdr must be valid/i);
    expect(submitTxMock).not.toHaveBeenCalled();
  });

  it('400 when xdr is valid base64 but not a TransactionEnvelope', async () => {
    const res = await passkeySend({ xdr: Buffer.from('random bytes').toString('base64') });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/xdr must be valid/i);
    expect(submitTxMock).not.toHaveBeenCalled();
  });

  it('400 when xdr is a classic (non-Soroban) transaction', async () => {
    const source = Keypair.random();
    const classic = new TransactionBuilder(new Account(source.publicKey(), '1'), {
      fee: '100',
      networkPassphrase: PASSPHRASE,
    })
      .addOperation(Operation.bumpSequence({ bumpTo: '2' }))
      .setTimeout(0)
      .build();
    const xdrStr = classic.toXDR();

    const res = await passkeySend({ xdr: xdrStr });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/must be a Soroban transaction/i);
    expect(submitTxMock).not.toHaveBeenCalled();
  });

  it('400 when xdr is a fee-bump envelope', async () => {
    const source = Keypair.random();
    const inner = new TransactionBuilder(new Account(source.publicKey(), '1'), {
      fee: '100',
      networkPassphrase: PASSPHRASE,
    })
      .addOperation(Operation.bumpSequence({ bumpTo: '2' }))
      .setTimeout(0)
      .build();
    inner.sign(source);
    const xdrStr = TransactionBuilder.buildFeeBumpTransaction(source, '200', inner, PASSPHRASE).toXDR();

    const res = await passkeySend({ xdr: xdrStr });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/must be a v1 transaction/i);
    expect(submitTxMock).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Suite — relayer error mapping (issue #172: typed errors → 422/502/504)
// ══════════════════════════════════════════════════════════════════════════

describe('POST /api/passkey-send — relayer error mapping', () => {
  it('422 when the relayer rejects the transaction (PluginExecutionError)', async () => {
    submitSorobanTxMock.mockRejectedValueOnce(
      new PluginExecutionError('simulation failed: contract panic', { code: 'SIMULATION_FAILED' }),
    );
    const res = await passkeySend({ func: validFunc(), auth: [validAuth()] });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.error).toBe('simulation failed: contract panic');
    expect(body.code).toBe('RELAYER_EXECUTION_ERROR');
  });

  it('502 when the relayer answers an HTTP error with no body (PluginTransportError + status)', async () => {
    submitTxMock.mockRejectedValueOnce(new PluginTransportError('Network error: 503', 503, {}));
    const res = await passkeySend({ xdr: buildDeployEnvelope(1000) });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.error).toMatch(/unreachable.*503/i);
    expect(body.code).toBe('RELAYER_TRANSPORT_ERROR');
  });

  it('502 when the connection drops without a status', async () => {
    submitSorobanTxMock.mockRejectedValueOnce(
      new PluginTransportError('Network error: connect ECONNREFUSED', undefined, { code: 'ECONNREFUSED' }),
    );
    const res = await passkeySend({ func: validFunc(), auth: [validAuth()] });
    expect(res.status).toBe(502);
  });

  it.each([
    ['an axios timeout', undefined, 'ECONNABORTED'],
    ['a socket timeout', undefined, 'ETIMEDOUT'],
    ['an upstream 504', 504, undefined],
    ['an upstream 408', 408, undefined],
  ])('504 on %s', async (_label, status, code) => {
    submitSorobanTxMock.mockRejectedValueOnce(new PluginTransportError('Network error: timeout', status, { code }));
    const res = await passkeySend({ func: validFunc(), auth: [validAuth()] });
    expect(res.status).toBe(504);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.error).toMatch(/timed out/i);
    expect(body.code).toBe('RELAYER_TRANSPORT_ERROR');
  });

  it('never echoes or logs the transport error details (they carry the API key)', async () => {
    const axiosLike = { code: 'ECONNABORTED', config: { headers: { Authorization: 'Bearer test-api-key' } } };
    submitSorobanTxMock.mockRejectedValueOnce(new PluginTransportError('Network error: timeout', undefined, axiosLike));
    const res = await passkeySend({ func: validFunc(), auth: [validAuth()] });
    expect(await res.text()).not.toContain('test-api-key');
    const logged = [...(console.log as Mock).mock.calls, ...(console.error as Mock).mock.calls]
      .flat()
      .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ');
    expect(logged).not.toContain('test-api-key');
  });

  it('502 when PluginUnexpectedError (malformed relayer response)', async () => {
    submitSorobanTxMock.mockRejectedValueOnce(new PluginUnexpectedError('Malformed response: missing success field'));
    const res = await passkeySend({ func: validFunc(), auth: [validAuth()] });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.error).toMatch(/malformed response/i);
    expect(body.code).toBe('RELAYER_UNEXPECTED_ERROR');
  });

  it('502 when unknown error is thrown (not a typed relayer error)', async () => {
    submitSorobanTxMock.mockRejectedValueOnce(new Error('something completely unexpected'));
    const res = await passkeySend({ func: validFunc(), auth: [validAuth()] });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.error).toBe('something completely unexpected');
    expect(body.code).toBe('UNKNOWN_ERROR');
  });

  it('502 when relayer returns no hash', async () => {
    submitSorobanTxMock.mockResolvedValueOnce({ hash: null });
    const res = await passkeySend({ func: validFunc(), auth: [validAuth()] });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/no tx hash/i);
  });

  it('502 when relayer returns empty object', async () => {
    submitSorobanTxMock.mockResolvedValueOnce({});
    const res = await passkeySend({ func: validFunc(), auth: [validAuth()] });
    expect(res.status).toBe(502);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Suite — happy paths (issue #172 acceptance criteria)
// ══════════════════════════════════════════════════════════════════════════

describe('POST /api/passkey-send — happy paths', () => {
  it('200 with { func, auth } — calls submitSorobanTransaction', async () => {
    submitSorobanTxMock.mockResolvedValueOnce({ hash: 'abcd1234' });
    const res = await passkeySend({ func: validFunc(), auth: [validAuth(), validAuth()] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hash: string };
    expect(body.hash).toBe('abcd1234');
    expect(submitSorobanTxMock).toHaveBeenCalledTimes(1);
    expect(submitSorobanTxMock).toHaveBeenCalledWith({
      func: validFunc(),
      auth: [validAuth(), validAuth()],
    });
    expect(submitTxMock).not.toHaveBeenCalled();
  });

  it('200 with { xdr } — calls submitTransaction after refee', async () => {
    submitTxMock.mockResolvedValueOnce({ hash: 'deploy5678' });
    const deployXdr = buildDeployEnvelope(1000);
    const res = await passkeySend({ xdr: deployXdr });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hash: string };
    expect(body.hash).toBe('deploy5678');
    expect(submitTxMock).toHaveBeenCalledTimes(1);
    expect(submitSorobanTxMock).not.toHaveBeenCalled();

    // Verify that refeeDeploy was called by checking the XDR was modified
    const submittedXdr = submitTxMock.mock.calls[0][0].xdr as string;
    expect(submittedXdr).not.toBe(deployXdr);

    // The refee'd tx should have fee === resourceFee
    const env = xdr.TransactionEnvelope.fromXDR(submittedXdr, 'base64');
    const tx = env.v1()?.tx();
    const resourceFee = Number(tx?.ext().sorobanData()?.resourceFee().toString());
    const actualFee = Number(tx?.fee().toString());
    expect(actualFee).toBe(resourceFee);
  });

  it('503 when PASSKEY_RELAYER_URL is not configured', async () => {
    vi.resetModules();
    vi.stubEnv('PASSKEY_RELAYER_URL', '');
    vi.stubEnv('PASSKEY_RELAYER_API_KEY', 'test-key');
    ({ POST } = (await import('./route')) as { POST: Post });
    const res = await passkeySend({ func: validFunc(), auth: [] });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not configured/i);
  });

  it('503 when PASSKEY_RELAYER_API_KEY is not configured', async () => {
    vi.resetModules();
    vi.stubEnv('PASSKEY_RELAYER_URL', 'https://relayer.example.com');
    vi.stubEnv('PASSKEY_RELAYER_API_KEY', '');
    ({ POST } = (await import('./route')) as { POST: Post });
    const res = await passkeySend({ func: validFunc(), auth: [] });
    expect(res.status).toBe(503);
  });
});
