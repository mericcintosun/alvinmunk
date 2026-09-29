// @vitest-environment node
// (the snippet makes a Keypair, which needs Node's Uint8Array rather than jsdom's)
import { readFileSync } from 'node:fs';
import * as sdk from '@stellar/stellar-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CONTRACT_ID_PLACEHOLDER,
  REPUTATION_READ_VIEWS,
  SAMPLE_ADDRESS,
  reputationReadSnippet,
} from './reputation-read-snippet';

const { Address, Networks, nativeToScVal, rpc, scValToNative } = sdk;

const CONTRACT = 'CDRYXUS55TKGYEM3YUB3YTJWQKSWWQABK6YPQK7SLEPVALWYK4IR7WCL';
const WALLET = 'GC7K66B2IL3KWQC25EVY3BQI3SVCRWIJLWZ3R5LBBWAL2ZXW4CELFFGU';
const testnet = { network: 'testnet', rpcUrl: 'https://soroban-testnet.stellar.org', contracts: { reputation: CONTRACT } } as const;

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const reputationSource = read('../../../../contracts/reputation/src/lib.rs');

interface Call {
  url: string;
  passphrase: string;
  contract: string;
  method: string;
  args: unknown[];
}

/**
 * Run the snippet as a developer would (`node read-reputation.mjs`), with its one import
 * bound to the real SDK and `simulateTransaction` answered locally: the RPC sees exactly the
 * transactions the snippet builds, and each view returns `values[method]` as a u64.
 */
async function runSnippet(code: string, values: Record<string, number>) {
  const imp = /^import \{([^}]+)\} from '@stellar\/stellar-sdk';\n/.exec(code);
  if (!imp) throw new Error('the snippet must open with its @stellar/stellar-sdk import');
  const names = imp[1].split(',').map((n) => n.trim()).filter(Boolean);
  const missing = names.filter((n) => !(n in sdk));
  if (missing.length) throw new Error(`not exported by @stellar/stellar-sdk: ${missing.join(', ')}`);

  const calls: Call[] = [];
  vi.spyOn(rpc.Server.prototype, 'simulateTransaction').mockImplementation(async function (
    this: sdk.rpc.Server,
    tx,
  ) {
    const op = (tx as sdk.Transaction).operations[0] as sdk.Operation.InvokeHostFunction;
    const invoke = op.func.invokeContract();
    const method = invoke.functionName().toString();
    calls.push({
      url: this.serverURL.toString(),
      passphrase: (tx as sdk.Transaction).networkPassphrase,
      contract: Address.fromScAddress(invoke.contractAddress()).toString(),
      method,
      args: invoke.args().map((a) => scValToNative(a)),
    });
    return {
      id: '1',
      latestLedger: 1,
      events: [],
      _parsed: true,
      transactionData: new sdk.SorobanDataBuilder(),
      minResourceFee: '0',
      result: { auth: [], retval: nativeToScVal(values[method] ?? 0, { type: 'u64' }) },
    } as sdk.rpc.Api.SimulateTransactionSuccessResponse;
  });

  const log = vi.fn();
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
    ...params: string[]
  ) => (...a: unknown[]) => Promise<void>;
  const body = `const { ${names.join(', ')} } = sdk;\n${code.slice(imp[0].length)}`;
  await new AsyncFunction('sdk', 'console', body)(sdk, { log });
  return { calls, log };
}

afterEach(() => vi.restoreAllMocks());

describe('reputationReadSnippet', () => {
  it('runs as written: reads get_score and get_earned for the address from the configured contract', async () => {
    const { calls, log } = await runSnippet(reputationReadSnippet(WALLET, testnet), { get_score: 15, get_earned: 3 });
    const expected = { url: 'https://soroban-testnet.stellar.org/', passphrase: Networks.TESTNET, contract: CONTRACT, args: [WALLET] };
    expect(calls).toEqual([
      { ...expected, method: 'get_score' },
      { ...expected, method: 'get_earned' },
    ]);
    expect(log).toHaveBeenCalledWith({ social: 15n, earned: 3n });
  });

  it('only calls views the reputation contract defines as fn(env, addr: Address) -> u64', () => {
    const called = [...reputationReadSnippet(WALLET, testnet).matchAll(/read\('(\w+)'\)/g)].map((m) => m[1]);
    expect(called).toEqual([...REPUTATION_READ_VIEWS]);
    for (const view of REPUTATION_READ_VIEWS) {
      expect(reputationSource).toMatch(new RegExp(`pub fn ${view}\\(env: Env, addr: Address\\) -> u64 \\{`));
    }
  });

  it('imports nothing but @stellar/stellar-sdk — nothing from this app', () => {
    const code = reputationReadSnippet(WALLET, testnet);
    expect(code.match(/^import /gm)).toHaveLength(1);
    expect(code.match(/from '[^']+'/g)).toEqual(["from '@stellar/stellar-sdk'"]);
    expect(code).not.toMatch(/require\(|import\(|@\//);
  });

  it('follows the configured network', async () => {
    const mainnet = { network: 'mainnet', rpcUrl: 'https://mainnet.sorobanrpc.com', contracts: { reputation: CONTRACT } } as const;
    const { calls } = await runSnippet(reputationReadSnippet(WALLET, mainnet), {});
    expect(calls.map((c) => [c.url, c.passphrase])).toEqual([
      ['https://mainnet.sorobanrpc.com/', Networks.PUBLIC],
      ['https://mainnet.sorobanrpc.com/', Networks.PUBLIC],
    ]);
  });

  it('shows a placeholder instead of an empty id when no contract is configured', () => {
    const code = reputationReadSnippet(WALLET, { ...testnet, contracts: { reputation: '' } });
    expect(code).toContain(`const contractId = '${CONTRACT_ID_PLACEHOLDER}';`);
  });

  it('defaults to a valid account address', () => {
    expect(sdk.StrKey.isValidEd25519PublicKey(SAMPLE_ADDRESS)).toBe(true);
    expect(reputationReadSnippet(undefined, testnet)).toContain(`const address = '${SAMPLE_ADDRESS}';`);
  });

  it('is the only developer snippet: the landing, how-it-works and score pages all render it', () => {
    for (const page of ['../app/page.tsx', '../app/how-it-works/page.tsx', '../app/score/[address]/page.tsx']) {
      const src = read(page);
      expect(src, page).toContain('<ReputationSnippet');
      expect(src, page).not.toContain('<pre');
    }
  });
});
