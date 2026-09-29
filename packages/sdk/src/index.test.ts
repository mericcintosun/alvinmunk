import {
  Account,
  Address,
  Keypair,
  nativeToScVal,
  scValToNative,
  xdr,
  type Transaction,
} from '@stellar/stellar-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  NETWORKS,
  createClient,
  decodeProfile,
  decodeVouch,
  isMissingFunction,
  simulateRead,
  type SimulationServer,
} from './index.js';

const ADDR = Keypair.random().publicKey();
const OTHER = Keypair.random().publicKey();
const REP = 'CAIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRDB3V';
const REG = 'CCT5EGFZ33IFLMUU6EBMC6NWRLX5TWJS5FICNJFBG7MU5PTAU6PFMVH4';
const GATE = 'CDX4QTFVT7VOGXCSASD75INCUHNZJUE3DRZDL65Z65PMIYJ5JELP576E';
const CONTRACTS = { reputation: REP, registry: REG, gate: GATE };

/** What the RPC reports when a deployed contract predates the view being called. */
const missing = (fn: string) =>
  `HostError: Error(WasmVm, MissingValue)\n\nEvent log (newest first):\n` +
  `   0: [Diagnostic Event] topics:[error, Error(WasmVm, MissingValue)], data:["trying to invoke non-existent contract function", ${fn}]`;

/** One decoded contract call, as the simulated transaction carries it. */
interface Call {
  contract: string;
  method: string;
  args: unknown[];
  source: string;
  passphrase: string;
}

type Reply = { retval?: xdr.ScVal } | { error: string };

/**
 * A stub RPC: decodes every simulated transaction's contract call and answers it from
 * `answer`. It only implements `simulateTransaction`, so any other RPC use would throw.
 */
function mockRpc(answer: (call: Call) => Reply) {
  const calls: Call[] = [];
  const simulateTransaction = vi.fn(async (tx: Transaction) => {
    expect(tx.signatures).toHaveLength(0);
    expect(tx.operations).toHaveLength(1);
    const op = tx.operations[0] as unknown as { type: string; func: xdr.HostFunction };
    expect(op.type).toBe('invokeHostFunction');
    const invoke = op.func.invokeContract();
    const call: Call = {
      contract: Address.fromScAddress(invoke.contractAddress()).toString(),
      method: invoke.functionName().toString(),
      args: invoke.args().map((a) => scValToNative(a)),
      source: tx.source,
      passphrase: tx.networkPassphrase,
    };
    calls.push(call);
    const reply = answer(call);
    return ('error' in reply ? reply : { result: { retval: reply.retval } }) as never;
  });
  return { server: { simulateTransaction } as SimulationServer, calls, simulateTransaction };
}

const client = (answer: (call: Call) => Reply) => {
  const rpc = mockRpc(answer);
  return { ...rpc, sdk: createClient({ network: 'testnet', contracts: CONTRACTS, server: rpc.server }) };
};

const u64 = (n: number) => nativeToScVal(n, { type: 'u64' });

describe('createClient', () => {
  it('defaults to the built-in testnet deployment and public RPC', () => {
    const sdk = createClient({ network: 'testnet' });
    expect(sdk.network).toBe('testnet');
    expect(sdk.rpcUrl).toBe('https://soroban-testnet.stellar.org');
    expect(sdk.networkPassphrase).toBe('Test SDF Network ; September 2015');
    expect(sdk.contracts).toEqual(NETWORKS.testnet.contracts);
    for (const id of Object.values(sdk.contracts)) expect(id).toMatch(/^C[A-Z2-7]{55}$/);
  });

  it('overrides only the contract ids it is given', () => {
    const sdk = createClient({ network: 'testnet', contracts: { gate: GATE, registry: undefined } });
    expect(sdk.contracts).toEqual({ ...NETWORKS.testnet.contracts, gate: GATE });
  });

  it('needs an RPC on mainnet, where none is built in', () => {
    expect(() => createClient({ network: 'mainnet' })).toThrow(/pass rpcUrl/);
    const sdk = createClient({ network: 'mainnet', rpcUrl: 'https://rpc.example' });
    expect(sdk.networkPassphrase).toBe('Public Global Stellar Network ; September 2015');
  });

  it('rejects an unknown network', () => {
    expect(() => createClient({ network: 'futurenet' as 'testnet' })).toThrow(/unknown network/);
  });

  it('signs nothing: every read is one simulation from a throwaway source on the right network', async () => {
    const { sdk, calls } = client(() => ({ retval: xdr.ScVal.scvBool(true) }));
    await sdk.checkGate(ADDR, 1);
    await sdk.checkGate(ADDR, 1);
    expect(calls).toHaveLength(2);
    expect(calls[0].passphrase).toBe('Test SDF Network ; September 2015');
    expect(calls[0].source).not.toBe(ADDR);
    expect(calls[0].source).not.toBe(calls[1].source);
  });

  it('exposes reads only — no method that signs, submits or holds a key', () => {
    const sdk = createClient({ network: 'testnet' });
    const methods = Object.keys(sdk).filter((k) => typeof (sdk as never)[k] === 'function');
    expect(methods.sort()).toEqual(
      ['checkGate', 'getProfile', 'getScore', 'getVouch', 'resolveHandle', 'reverseHandle'].sort(),
    );
    expect(Object.isFrozen(sdk)).toBe(true);
    expect(Object.isFrozen(sdk.contracts)).toBe(true);
  });

  it('touches nothing on the RPC client but simulateTransaction', async () => {
    const used = new Set<PropertyKey>();
    const { server } = mockRpc(() => ({ retval: xdr.ScVal.scvVoid() }));
    const spy = new Proxy(server, {
      get(target, key, receiver) {
        used.add(key);
        return Reflect.get(target, key, receiver);
      },
    });
    const sdk = createClient({ network: 'testnet', contracts: CONTRACTS, server: spy });
    await Promise.all([
      sdk.getProfile(ADDR),
      sdk.resolveHandle('alice'),
      sdk.reverseHandle(ADDR),
      sdk.getVouch(1),
      sdk.checkGate(ADDR, 1),
    ]);
    expect([...used]).toEqual(['simulateTransaction']);
  });

  it('refuses a contract that is not deployed, without calling the RPC', async () => {
    const rpc = mockRpc(() => ({ retval: xdr.ScVal.scvBool(true) }));
    const sdk = createClient({
      network: 'testnet',
      contracts: { gate: '' },
      server: rpc.server,
    });
    await expect(sdk.checkGate(ADDR, 1)).rejects.toThrow('no gate contract on testnet');
    expect(rpc.simulateTransaction).not.toHaveBeenCalled();
  });
});

describe('getProfile / getScore', () => {
  const profile = (social: number, earned: number, verified: boolean) =>
    nativeToScVal({ earned: u64(earned), social: u64(social), verified });

  it('reads get_profile(addr) in one call', async () => {
    const { sdk, calls } = client(() => ({ retval: profile(30, 50, true) }));
    await expect(sdk.getProfile(ADDR)).resolves.toEqual({ social: 30, earned: 50, verified: true });
    expect(calls).toEqual([expect.objectContaining({ contract: REP, method: 'get_profile', args: [ADDR] })]);
  });

  it('falls back to get_score + get_earned + is_verified on a contract without get_profile', async () => {
    const { sdk, calls } = client(({ method }) => {
      if (method === 'get_profile') return { error: missing('get_profile') };
      if (method === 'get_score') return { retval: u64(15) };
      if (method === 'get_earned') return { retval: u64(4) };
      if (method === 'is_verified') return { retval: xdr.ScVal.scvBool(true) };
      throw new Error(`unexpected ${method}`);
    });
    await expect(sdk.getProfile(ADDR)).resolves.toEqual({ social: 15, earned: 4, verified: true });
    expect(calls.map((c) => c.method).sort()).toEqual(
      ['get_earned', 'get_profile', 'get_score', 'is_verified'].sort(),
    );
    for (const c of calls) expect(c).toMatchObject({ contract: REP, args: [ADDR] });
  });

  it('reads unverified on a contract that predates is_verified too', async () => {
    const { sdk } = client(({ method }) => {
      if (method === 'get_score') return { retval: u64(9) };
      if (method === 'get_earned') return { retval: u64(0) };
      return { error: missing(method) };
    });
    await expect(sdk.getProfile(ADDR)).resolves.toEqual({ social: 9, earned: 0, verified: false });
  });

  it('rejects when a fallback read fails for another reason', async () => {
    const { sdk } = client(({ method }) => {
      if (method === 'get_profile') return { error: missing('get_profile') };
      if (method === 'is_verified') return { error: 'fetch failed' };
      return { retval: u64(1) };
    });
    await expect(sdk.getProfile(ADDR)).rejects.toThrow('simulate is_verified failed: fetch failed');
  });

  it('does not mistake an outage or a revert for a missing view', async () => {
    const { sdk, calls } = client(() => ({ error: 'HostError: Error(Contract, #3)' }));
    await expect(sdk.getProfile(ADDR)).rejects.toThrow('simulate get_profile failed: HostError: Error(Contract, #3)');
    expect(calls).toHaveLength(1);
  });

  it('getScore is the two XP tracks of the profile', async () => {
    const { sdk } = client(() => ({ retval: profile(7, 2, false) }));
    await expect(sdk.getScore(ADDR)).resolves.toEqual({ social: 7, earned: 2 });
  });

  it('rejects an address that is not a Stellar address before calling the RPC', async () => {
    const { sdk, simulateTransaction } = client(() => ({ retval: profile(1, 1, true) }));
    await expect(sdk.getProfile('0:123abc')).rejects.toThrow();
    expect(simulateTransaction).not.toHaveBeenCalled();
  });
});

describe('handles', () => {
  it('resolveHandle reads resolve(Symbol) and answers the holder or null', async () => {
    const { sdk, calls } = client(({ args: [h] }) =>
      h === 'alice' ? { retval: new Address(OTHER).toScVal() } : { retval: xdr.ScVal.scvVoid() },
    );
    await expect(sdk.resolveHandle('alice')).resolves.toBe(OTHER);
    await expect(sdk.resolveHandle('nobody')).resolves.toBeNull();
    expect(calls[0]).toMatchObject({ contract: REG, method: 'resolve', args: ['alice'] });
  });

  it('reverseHandle reads reverse(addr) and answers the handle or null', async () => {
    const { sdk, calls } = client(({ args: [a] }) =>
      a === ADDR ? { retval: nativeToScVal('alice', { type: 'symbol' }) } : { retval: xdr.ScVal.scvVoid() },
    );
    await expect(sdk.reverseHandle(ADDR)).resolves.toBe('alice');
    await expect(sdk.reverseHandle(OTHER)).resolves.toBeNull();
    expect(calls[0]).toMatchObject({ contract: REG, method: 'reverse', args: [ADDR] });
  });

  it('surfaces a failed read instead of answering null', async () => {
    const { sdk } = client(() => ({ error: 'fetch failed' }));
    await expect(sdk.reverseHandle(ADDR)).rejects.toThrow('simulate reverse failed: fetch failed');
  });
});

describe('getVouch', () => {
  it('reads get_vouch(u64) and decodes the half-card', async () => {
    const vouch = nativeToScVal({
      claim_hash: nativeToScVal(new Uint8Array(32), { type: 'bytes' }),
      claimed: true,
      claimer: new Address(OTHER).toScVal(),
      created: u64(1_782_920_887),
      from: new Address(ADDR).toScVal(),
      id: u64(9),
      note: nativeToScVal('thanks', { type: 'string' }),
      slashed: false,
      stake: u64(5),
    });
    const { sdk, calls } = client(() => ({ retval: vouch }));
    await expect(sdk.getVouch(9)).resolves.toEqual({
      id: 9,
      from: ADDR,
      note: 'thanks',
      claimed: true,
      claimer: OTHER,
      created: 1_782_920_887,
      stake: 5,
      slashed: false,
    });
    expect(calls[0]).toMatchObject({ contract: REP, method: 'get_vouch', args: [9n] });
  });

  it('is null for an unknown id', async () => {
    const { sdk } = client(() => ({ retval: xdr.ScVal.scvVoid() }));
    await expect(sdk.getVouch(404)).resolves.toBeNull();
  });
});

describe('checkGate', () => {
  it('reads check(addr, u32) on the gate contract', async () => {
    const { sdk, calls } = client(({ args: [, id] }) => ({ retval: xdr.ScVal.scvBool(id === 1) }));
    await expect(sdk.checkGate(ADDR, 1)).resolves.toBe(true);
    await expect(sdk.checkGate(ADDR, 2)).resolves.toBe(false);
    expect(calls[0]).toMatchObject({ contract: GATE, method: 'check', args: [ADDR, 1] });
  });
});

describe('simulateRead', () => {
  it('uses the given source account and decodes the result', async () => {
    const { server, calls } = mockRpc(() => ({ retval: u64(3) }));
    const source = Keypair.random().publicKey();
    await expect(
      simulateRead(server, 'Custom ; Net', REP, 'get_score', [], new Account(source, '7')),
    ).resolves.toBe(3n);
    expect(calls[0]).toMatchObject({ source, passphrase: 'Custom ; Net', method: 'get_score' });
  });

  it('answers undefined when the view returns nothing', async () => {
    const { server } = mockRpc(() => ({}));
    await expect(simulateRead(server, 'N', REP, 'bump', [])).resolves.toBeUndefined();
  });
});

describe('decoders', () => {
  it('decodeProfile reads missing fields as 0 / false', () => {
    expect(decodeProfile(undefined)).toEqual({ social: 0, earned: 0, verified: false });
    expect(decodeProfile({ social: 2n })).toEqual({ social: 2, earned: 0, verified: false });
  });

  it('decodeVouch maps an absent claimer to null', () => {
    expect(decodeVouch(null)).toBeNull();
    expect(
      decodeVouch({ id: 1n, from: ADDR, note: '', claimed: false, created: 2n, stake: 3n, slashed: true }),
    ).toEqual({ id: 1, from: ADDR, note: '', claimed: false, claimer: null, created: 2, stake: 3, slashed: true });
  });

  it('isMissingFunction spots a contract that predates a view, and nothing else', () => {
    expect(isMissingFunction(new Error(`simulate get_profile failed: ${missing('get_profile')}`))).toBe(true);
    expect(isMissingFunction(new Error('simulate check failed: HostError: Error(Contract, #1)'))).toBe(false);
    expect(isMissingFunction(new Error('fetch failed'))).toBe(false);
    expect(isMissingFunction(undefined)).toBe(false);
  });
});
