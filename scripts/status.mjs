/**
 * Ops status snapshot (Green-belt observability — the codeable slice; a full metrics
 * dashboard is infra/later). Reads live on-chain state via simulation (no signing) and
 * prints a one-screen health view: contract liveness, treasury, daily-cap circuit
 * breaker usage, proof-of-funding toggle, and the rank-reward table with its supply.
 *
 * Simulation runs from a throwaway source account, so no funded account is needed. A read
 * that fails (or returns a value of the wrong shape) prints `ERROR <method>: <reason>` in
 * place of its value; the other reads still print, and the script then exits 1, so it can
 * run as a health check.
 *
 * Run from repo root:  node scripts/status.mjs
 * Env: NEXT_PUBLIC_RPC_URL, NEXT_PUBLIC_NETWORK_PASSPHRASE, NEXT_PUBLIC_*_CONTRACT_ID
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'package.json'));
const { Account, Address, Contract, Keypair, Networks, TransactionBuilder, scValToNative, rpc } = require('@stellar/stellar-sdk');

const RPC = process.env.NEXT_PUBLIC_RPC_URL ?? 'https://soroban-testnet.stellar.org';
const PASSPHRASE = process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE || Networks.TESTNET;
const REP = process.env.NEXT_PUBLIC_REPUTATION_CONTRACT_ID ?? 'CBNIZXITUVTRVW6RZGEGCI7KNF46REG4EDM4XUVHKDAV63WOHWW75SZM';
const QUEST = process.env.NEXT_PUBLIC_QUEST_REGISTRY_CONTRACT_ID ?? 'CD6RZUVNQ3TV3X6MNQM25NB2YRFRGMSUGKWTMAIGJOC23C6ESHJKYNFO';
const REWARDS = process.env.NEXT_PUBLIC_REWARDS_CONTRACT_ID ?? 'CBUKGIFOEOS74I2IUUHYNRBZODQFOFCFWIJY3DUJHOUUJV7TT2QYADOU';
const USDC = process.env.NEXT_PUBLIC_USDC_SAC_ID ?? 'CAKT2EK2SFGNXTXVSYZLZXA5YB5QPVHLTVUMRHLJTF5RFFAFMIRNPZT2';
const server = new rpc.Server(RPC, { allowHttp: RPC.startsWith('http://') });

const firstLine = (s) => String(s ?? '').split('\n')[0].trim() || 'unknown error';
const isInt = (v) => typeof v === 'bigint' || Number.isSafeInteger(v);
// Exact stroops → USDC (7 decimals), no float rounding and no NaN.
const usdc = (n) => {
  const v = BigInt(n);
  const abs = v < 0n ? -v : v;
  const frac = (abs % 10_000_000n).toString().padStart(7, '0').replace(/0+$/, '');
  return `${v < 0n ? '-' : ''}${abs / 10_000_000n}${frac ? `.${frac}` : ''}`;
};
const show = (v) => {
  const s = JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)) ?? String(v);
  return s.length > 60 ? `${s.slice(0, 57)}...` : s;
};

/** One simulated read: `{ ok: true, value }` or `{ ok: false, error }`, never an error posing as data. */
async function read(id, method, args = () => []) {
  try {
    // Simulation needs only a well-formed envelope, not an on-chain source account.
    const source = new Account(Keypair.random().publicKey(), '0');
    const tx = new TransactionBuilder(source, { fee: '1000000', networkPassphrase: PASSPHRASE })
      .addOperation(new Contract(id).call(method, ...args()))
      .setTimeout(30)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) return { ok: false, error: firstLine(sim.error) };
    return { ok: true, value: sim.result?.retval ? scValToNative(sim.result.retval) : null };
  } catch (e) {
    return { ok: false, error: firstLine(e?.message ?? e) };
  }
}

let failures = 0;
/** The failure line for a read, counted toward the exit code. */
function fail(method, error) {
  failures++;
  return `ERROR ${method}: ${error}`;
}
/** `format` returns the printable value, or undefined when the value has the wrong shape. */
function field(method, r, format) {
  if (!r.ok) return fail(method, r.error);
  return format(r.value) ?? fail(method, `unexpected value ${show(r.value)}`);
}
const amount = (v) => (isInt(v) ? `${usdc(v)} USDC` : undefined);

// A reward row from `get_rewards`. The supply counters (`max_claims`, `claims`) are absent
// on rewards contracts deployed before per-reward supply caps; the row still prints.
const isReward = (r) =>
  r !== null && typeof r === 'object' && isInt(r.id) && isInt(r.threshold) && isInt(r.amount) && typeof r.active === 'boolean';
function supply(r) {
  if (!isInt(r.max_claims) || !isInt(r.claims)) return '';
  if (BigInt(r.max_claims) === 0n) return `  ${r.claims} claimed (no cap)`;
  const out = BigInt(r.claims) >= BigInt(r.max_claims) ? ' (sold out)' : '';
  return `  ${r.claims}/${r.max_claims} claimed${out}`;
}

(async () => {
  let ledger;
  try {
    const latest = await server.getLatestLedger();
    ledger = isInt(latest?.sequence) ? latest.sequence : fail('getLatestLedger', `unexpected value ${show(latest)}`);
  } catch (e) {
    ledger = fail('getLatestLedger', firstLine(e?.message ?? e));
  }

  console.log('\n📊 Stellar Passport — ops status');
  console.log('   RPC', RPC, '· ledger', ledger);
  console.log('   contracts: reputation', REP.slice(0, 6), '· quest', QUEST.slice(0, 6), '· rewards', REWARDS.slice(0, 6));

  const [bal, cap, paid, reqFund, week, table] = await Promise.all([
    read(USDC, 'balance', () => [new Address(REWARDS).toScVal()]),
    read(REWARDS, 'get_daily_cap'),
    read(REWARDS, 'get_daily_paid'),
    read(REWARDS, 'get_require_funding'),
    read(QUEST, 'get_week'),
    read(REWARDS, 'get_rewards'),
  ]);

  console.log('\n💰 treasury');
  console.log('   USDC balance   ', field('balance', bal, amount));
  console.log('   daily cap      ', field('get_daily_cap', cap, (v) => (isInt(v) && BigInt(v) === 0n ? 'unlimited' : amount(v))));
  console.log('   paid today     ', field('get_daily_paid', paid, amount));
  console.log('   proof-of-funding gate', field('get_require_funding', reqFund, (v) => (typeof v === 'boolean' ? (v ? 'ON' : 'off (testnet)') : undefined)));
  console.log('\n🗓  weekly epoch', field('get_week', week, (v) => (isInt(v) ? String(v) : undefined)));
  console.log('\n🏅 rank → reward table');
  const rows = table.ok && Array.isArray(table.value) && table.value.every(isReward) ? table.value : undefined;
  if (!rows) {
    console.log('  ', table.ok ? fail('get_rewards', `unexpected value ${show(table.value)}`) : fail('get_rewards', table.error));
  } else if (rows.length === 0) {
    console.log('   (no rewards registered)');
  }
  for (const r of rows ?? []) {
    console.log(`   #${r.id}  ${r.threshold} XP → ${usdc(r.amount)} USDC${supply(r)}${r.active ? '' : '  (inactive)'}`);
  }
  console.log('');

  if (failures > 0) {
    console.error(`❌ ${failures} read${failures === 1 ? '' : 's'} failed`);
    process.exitCode = 1;
  }
})().catch((e) => { console.error('FAILED ❌', e.message); process.exit(1); });
