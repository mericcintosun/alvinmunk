/**
 * Offline tests for scripts/status.mjs. Nothing here reaches a network: each case runs the
 * script against a local fake Soroban RPC that decodes every simulated call and answers
 * from canned data (or with a simulation error), and one case points it at a closed port.
 *
 * Contract ids reach the script as env vars, or through a deployment manifest in a fixture
 * config root (scripts/lib/env.mjs); every run gets its own root, so a developer's
 * apps/web/.env.local never leaks in.
 *
 * Usage: node --test scripts/status.test.mjs   (after `pnpm install`)
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = process.env.STATUS_SCRIPT ?? join(HERE, 'status.mjs');
const require = createRequire(join(HERE, '..', 'apps', 'web', 'package.json'));
const {
  Address,
  Networks,
  SorobanDataBuilder,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} = require('@stellar/stellar-sdk');

const contract = (n) => StrKey.encodeContract(Buffer.alloc(32, n));
const REP = contract(1);
const QUEST = contract(2);
const REWARDS = contract(3);
const USDC = contract(4);
const NOT_REWARDS = contract(5);
const MISSING_FN =
  'HostError: Error(WasmVm, MissingValue)\n\nEvent log (newest first):\n   0: [Diagnostic Event] ...';

/** A simulation failure answer (a plain object: an `xdr.ScVal` answer is a success). */
const simError = (error) => ({ error });
const i128 = (n) => nativeToScVal(BigInt(n), { type: 'i128' });
const u64 = (n) => nativeToScVal(BigInt(n), { type: 'u64' });
const REWARD_TYPES = {
  id: ['symbol', 'u32'],
  threshold: ['symbol', 'u64'],
  amount: ['symbol', 'i128'],
  active: ['symbol', null],
  max_claims: ['symbol', 'u32'],
  claims: ['symbol', 'u32'],
};
const reward = (r) => nativeToScVal(r, { type: REWARD_TYPES });

/** A healthy deployment: `balance` must be asked about the rewards contract itself. */
function healthy(id, fn, args) {
  if (id === USDC && fn === 'balance') {
    if (Address.fromScVal(args[0]).toString() !== REWARDS)
      return simError('balance of the wrong account');
    return i128(12_345_670_000n);
  }
  if (id === REWARDS) {
    switch (fn) {
      case 'get_daily_cap':
        return i128(1_000_000_000n);
      case 'get_daily_paid':
        return i128(250_000_000n);
      case 'get_require_funding':
        return xdr.ScVal.scvBool(false);
      case 'get_rewards':
        return xdr.ScVal.scvVec([
          reward({
            id: 1,
            threshold: 100n,
            amount: 50_000_000n,
            active: true,
            max_claims: 0,
            claims: 3,
          }),
          reward({
            id: 2,
            threshold: 500n,
            amount: 250_000_000n,
            active: true,
            max_claims: 10,
            claims: 4,
          }),
          reward({
            id: 3,
            threshold: 900n,
            amount: 5_000_000n,
            active: false,
            max_claims: 2,
            claims: 2,
          }),
        ]);
    }
  }
  if (id === QUEST && fn === 'get_week') return u64(2921);
  return simError(MISSING_FN);
}

// getLatestLedger answers must carry a decodable header and close meta (SDK 16 parses both).
const ZERO = Buffer.alloc(32);
const HEADER = new xdr.LedgerHeader({
  ledgerVersion: 23,
  previousLedgerHash: ZERO,
  scpValue: new xdr.StellarValue({
    txSetHash: ZERO,
    closeTime: xdr.Uint64.fromString('0'),
    upgrades: [],
    ext: xdr.StellarValueExt.stellarValueBasic(),
  }),
  txSetResultHash: ZERO,
  bucketListHash: ZERO,
  ledgerSeq: 4242,
  totalCoins: xdr.Int64.fromString('0'),
  feePool: xdr.Int64.fromString('0'),
  inflationSeq: 0,
  idPool: xdr.Uint64.fromString('0'),
  baseFee: 100,
  baseReserve: 5_000_000,
  maxTxSetSize: 100,
  skipList: [ZERO, ZERO, ZERO, ZERO],
  ext: new xdr.LedgerHeaderExt(0),
});
const LATEST = {
  id: ZERO.toString('hex'),
  protocolVersion: 23,
  sequence: 4242,
  closeTime: '0',
  headerXdr: HEADER.toXDR('base64'),
  metadataXdr: new xdr.LedgerCloseMeta(
    0,
    new xdr.LedgerCloseMetaV0({
      ledgerHeader: new xdr.LedgerHeaderHistoryEntry({
        hash: ZERO,
        header: HEADER,
        ext: new xdr.LedgerHeaderHistoryEntryExt(0),
      }),
      txSet: new xdr.TransactionSet({ previousLedgerHash: ZERO, txes: [] }),
      txProcessing: [],
      upgradesProcessing: [],
      scpInfo: [],
    }),
  ).toXDR('base64'),
};

/** Fake Soroban RPC: answers getLatestLedger and simulateTransaction, records every call. */
async function fakeRpc(answer) {
  const calls = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const { id, method, params } = JSON.parse(body);
      const reply = (payload) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ jsonrpc: '2.0', id, ...payload }));
      };
      calls.push(method);
      if (method === 'getLatestLedger') return reply({ result: LATEST });
      if (method !== 'simulateTransaction') {
        return reply({ error: { code: -32601, message: `method not found: ${method}` } });
      }
      const tx = TransactionBuilder.fromXDR(params.transaction, Networks.TESTNET);
      const call = tx.operations[0].func.invokeContract();
      const out = answer(
        Address.fromScAddress(call.contractAddress()).toString(),
        call.functionName().toString(),
        call.args(),
      );
      if (!(out instanceof xdr.ScVal))
        return reply({ result: { error: out.error, latestLedger: 4242 } });
      reply({
        result: {
          results: [{ xdr: out.toXDR('base64'), auth: [] }],
          transactionData: new SorobanDataBuilder().build().toXDR('base64'),
          minResourceFee: '100',
          latestLedger: 4242,
        },
      });
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}`, calls, close: () => srv.close() };
}

const IDS = {
  NEXT_PUBLIC_REPUTATION_CONTRACT_ID: REP,
  NEXT_PUBLIC_QUEST_REGISTRY_CONTRACT_ID: QUEST,
  NEXT_PUBLIC_REWARDS_CONTRACT_ID: REWARDS,
  NEXT_PUBLIC_USDC_SAC_ID: USDC,
};

const roots = [];
after(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));
/** A config root for scripts/lib/env.mjs, with deployments/testnet.json when given. */
function configRoot(manifest) {
  const root = fs.mkdtempSync(join(os.tmpdir(), 'status-test-'));
  roots.push(root);
  if (manifest) {
    fs.mkdirSync(join(root, 'deployments'));
    fs.writeFileSync(join(root, 'deployments', 'testnet.json'), JSON.stringify(manifest));
  }
  return root;
}

/** Runs status.mjs with the given RPC URL and contract ids (`ids: {}` passes none). */
function run(rpcUrl, env = {}, { ids = IDS, root = configRoot() } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT], {
      env: {
        PATH: process.env.PATH,
        ALVINMUNK_CONFIG_ROOT: root,
        ...(rpcUrl === undefined ? {} : { NEXT_PUBLIC_RPC_URL: rpcUrl }),
        ...ids,
        ...env,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (code) => resolve({ code, stdout, stderr, out: stdout + stderr }));
  });
}

async function withRpc(answer, env, check, opts) {
  const rpc = await fakeRpc(answer);
  try {
    await check(await run(rpc.url, env, opts), rpc.calls);
  } finally {
    rpc.close();
  }
}

const line = (out, label) => out.split('\n').find((l) => l.includes(label));

test('a healthy deployment prints every value and exits 0', () =>
  withRpc(healthy, {}, ({ code, stdout, out }, calls) => {
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /ERROR|NaN|FAILED/);
    assert.match(line(stdout, 'ledger'), /ledger 4242$/);
    assert.match(line(stdout, 'USDC balance'), /\s1234\.567 USDC$/);
    assert.match(line(stdout, 'daily cap'), /\s100 USDC$/);
    assert.match(line(stdout, 'paid today'), /\s25 USDC$/);
    assert.match(line(stdout, 'proof-of-funding gate'), /gate off \(testnet\)$/);
    assert.match(line(stdout, 'weekly epoch'), /epoch 2921$/);
    assert.match(stdout, /#1 {2}100 XP → 5 USDC {2}3 claimed \(no cap\)\n/);
    assert.match(stdout, /#2 {2}500 XP → 25 USDC {2}4\/10 claimed\n/);
    assert.match(stdout, /#3 {2}900 XP → 0\.5 USDC {2}2\/2 claimed \(sold out\) {2}\(inactive\)\n/);
    // Simulation only: no account lookup, so no funded account is needed.
    assert.deepEqual([...new Set(calls)].sort(), ['getLatestLedger', 'simulateTransaction']);
    assert.equal(calls.filter((c) => c === 'simulateTransaction').length, 6);
  }));

test('an unlimited daily cap reads as unlimited', () =>
  withRpc(
    (id, fn, args) => (fn === 'get_daily_cap' ? i128(0) : healthy(id, fn, args)),
    {},
    ({ code, stdout }) => {
      assert.equal(code, 0);
      assert.match(line(stdout, 'daily cap'), /\sunlimited$/);
    },
  ));

test('rewards pointed at a non-rewards contract prints explicit errors and exits 1', () =>
  withRpc(
    (id, fn, args) => {
      if (id === NOT_REWARDS) return simError(MISSING_FN);
      if (id === USDC) return i128(0); // its balance is still readable
      return healthy(id, fn, args);
    },
    { NEXT_PUBLIC_REWARDS_CONTRACT_ID: NOT_REWARDS },
    ({ code, stdout, stderr, out }) => {
      assert.equal(code, 1, out);
      assert.doesNotMatch(out, /NaN|\bON\b|#undefined|FAILED/);
      for (const m of ['get_daily_cap', 'get_daily_paid', 'get_require_funding', 'get_rewards']) {
        assert.match(
          stdout,
          new RegExp(`ERROR ${m}: HostError: Error\\(WasmVm, MissingValue\\)\\n`),
        );
      }
      // The reads that did succeed still print.
      assert.match(line(stdout, 'USDC balance'), /\s0 USDC$/);
      assert.match(line(stdout, 'weekly epoch'), /epoch 2921$/);
      assert.match(line(stdout, 'ledger'), /ledger 4242$/);
      assert.match(stderr, /4 reads failed/);
    },
  ));

test('values of the wrong shape are errors, never NaN or a truthy ON', () =>
  withRpc(
    (id, fn, args) => {
      if (id !== REWARDS) return healthy(id, fn, args);
      switch (fn) {
        case 'get_daily_cap':
          return nativeToScVal('ERR(get_daily_cap)', { type: 'string' });
        case 'get_daily_paid':
          return xdr.ScVal.scvVoid();
        case 'get_require_funding':
          return nativeToScVal(1, { type: 'u32' });
        case 'get_rewards':
          return nativeToScVal('abc', { type: 'string' });
      }
      return healthy(id, fn, args);
    },
    {},
    ({ code, stdout, out }) => {
      assert.equal(code, 1, out);
      assert.doesNotMatch(out, /NaN|\bON\b|#undefined/);
      assert.match(
        line(stdout, 'daily cap'),
        /ERROR get_daily_cap: unexpected value "ERR\(get_daily_cap\)"$/,
      );
      assert.match(line(stdout, 'paid today'), /ERROR get_daily_paid: unexpected value null$/);
      assert.match(
        line(stdout, 'proof-of-funding gate'),
        /ERROR get_require_funding: unexpected value 1$/,
      );
      assert.match(stdout, /ERROR get_rewards: unexpected value "abc"\n/);
      assert.match(line(stdout, 'USDC balance'), /\s1234\.567 USDC$/);
    },
  ));

test('a malformed reward row fails the table instead of printing #undefined', () =>
  withRpc(
    (id, fn, args) =>
      fn === 'get_rewards'
        ? xdr.ScVal.scvVec([nativeToScVal({ id: 1 }, { type: { id: ['symbol', 'u32'] } })])
        : healthy(id, fn, args),
    {},
    ({ code, stdout, out }) => {
      assert.equal(code, 1, out);
      assert.doesNotMatch(out, /NaN|#undefined/);
      assert.match(stdout, /ERROR get_rewards: unexpected value \[\{"id":1\}\]\n/);
    },
  ));

test('a rewards contract without supply counters still prints its table', () =>
  withRpc(
    (id, fn, args) =>
      fn === 'get_rewards'
        ? xdr.ScVal.scvVec([
            nativeToScVal(
              { id: 7, threshold: 100n, amount: 10_000_000n, active: true },
              {
                type: {
                  id: ['symbol', 'u32'],
                  threshold: ['symbol', 'u64'],
                  amount: ['symbol', 'i128'],
                  active: ['symbol', null],
                },
              },
            ),
          ])
        : healthy(id, fn, args),
    {},
    ({ code, stdout, out }) => {
      assert.equal(code, 0, out);
      assert.match(stdout, /#7 {2}100 XP → 1 USDC\n/);
    },
  ));

test('an empty reward table says so', () =>
  withRpc(
    (id, fn, args) => (fn === 'get_rewards' ? xdr.ScVal.scvVec([]) : healthy(id, fn, args)),
    {},
    ({ code, stdout }) => {
      assert.equal(code, 0);
      assert.match(stdout, /\(no rewards registered\)/);
    },
  ));

test('an unreachable RPC prints an error for every read and exits 1', async () => {
  // Grab a free port, then close it: nothing listens there.
  const probe = http.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const { port } = probe.address();
  await new Promise((r) => probe.close(r));

  const { code, stdout, stderr, out } = await run(`http://127.0.0.1:${port}`);
  assert.equal(code, 1, out);
  assert.doesNotMatch(out, /NaN|\bON\b|#undefined|FAILED/);
  assert.match(line(stdout, 'ledger'), /ERROR getLatestLedger: /);
  for (const m of [
    'balance',
    'get_daily_cap',
    'get_daily_paid',
    'get_require_funding',
    'get_week',
    'get_rewards',
  ]) {
    assert.match(stdout, new RegExp(`ERROR ${m}: \\S`));
  }
  assert.match(stderr, /7 reads failed/);
});

test('with no ids in the env, the ids come from deployments/testnet.json', async () => {
  const rpc = await fakeRpc(healthy);
  try {
    const root = configRoot({
      network: 'testnet',
      passphrase: Networks.TESTNET,
      rpcUrl: rpc.url,
      contracts: { reputation: REP, questRegistry: QUEST, rewards: REWARDS, usdcSac: USDC },
    });
    // The manifest's rpcUrl is used too: the env sets no NEXT_PUBLIC_RPC_URL here.
    const { code, stdout, out } = await run(undefined, {}, { ids: {}, root });
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /ERROR/);
    assert.match(line(stdout, 'USDC balance'), /\s1234\.567 USDC$/);
    assert.equal(rpc.calls.filter((c) => c === 'simulateTransaction').length, 6);
  } finally {
    rpc.close();
  }
});

test('a missing contract id exits 2 naming it, before any RPC call', () =>
  withRpc(
    healthy,
    {},
    ({ code, stdout, stderr }, calls) => {
      assert.equal(code, 2);
      assert.equal(stdout, '');
      assert.match(stderr, /NEXT_PUBLIC_QUEST_REGISTRY_CONTRACT_ID is not set/);
      assert.match(stderr, /NEXT_PUBLIC_USDC_SAC_ID is not set/);
      assert.doesNotMatch(stderr, /NEXT_PUBLIC_REWARDS_CONTRACT_ID/);
      assert.deepEqual(calls, []);
    },
    { ids: { NEXT_PUBLIC_REPUTATION_CONTRACT_ID: REP, NEXT_PUBLIC_REWARDS_CONTRACT_ID: REWARDS } },
  ));

test('a placeholder id is refused, not simulated against', () =>
  withRpc(
    healthy,
    { NEXT_PUBLIC_REWARDS_CONTRACT_ID: 'REPLACE_WITH_REWARDS_ID' },
    ({ code, stderr }, calls) => {
      assert.equal(code, 2);
      assert.match(stderr, /NEXT_PUBLIC_REWARDS_CONTRACT_ID \(from environment\) is not a contract id/);
      assert.deepEqual(calls, []);
    },
  ));
