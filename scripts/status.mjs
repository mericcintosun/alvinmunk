/**
 * Ops status snapshot (Green-belt observability — the codeable slice; a full metrics
 * dashboard is infra/later). Reads live on-chain state via simulation (no signing) and
 * prints a one-screen health view: contract liveness, treasury, daily-cap circuit
 * breaker usage, proof-of-funding toggle, and the rank-reward table.
 *
 * Run from repo root:  node scripts/status.mjs
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'package.json'));
const { Address, Contract, Networks, TransactionBuilder, scValToNative, rpc } = require('@stellar/stellar-sdk');

const RPC = process.env.NEXT_PUBLIC_RPC_URL ?? 'https://soroban-testnet.stellar.org';
const REP = process.env.NEXT_PUBLIC_REPUTATION_CONTRACT_ID ?? 'CBNIZXITUVTRVW6RZGEGCI7KNF46REG4EDM4XUVHKDAV63WOHWW75SZM';
const QUEST = process.env.NEXT_PUBLIC_QUEST_REGISTRY_CONTRACT_ID ?? 'CD6RZUVNQ3TV3X6MNQM25NB2YRFRGMSUGKWTMAIGJOC23C6ESHJKYNFO';
const REWARDS = process.env.NEXT_PUBLIC_REWARDS_CONTRACT_ID ?? 'CBUKGIFOEOS74I2IUUHYNRBZODQFOFCFWIJY3DUJHOUUJV7TT2QYADOU';
const USDC = process.env.NEXT_PUBLIC_USDC_SAC_ID ?? 'CAKT2EK2SFGNXTXVSYZLZXA5YB5QPVHLTVUMRHLJTF5RFFAFMIRNPZT2';
// Any funded account works as the simulation source.
const SRC = 'GDIS5BDXSI2DDJNTKRZPI6MNB5XCLMN4Z6PPRPM4RQLZ3PSQ2YTERLFA';
const server = new rpc.Server(RPC);
const usdc = (n) => (Number(n) / 1e7).toFixed(7).replace(/0+$/, '').replace(/\.$/, '');

async function read(id, method, args = []) {
  const acc = await server.getAccount(SRC);
  const tx = new TransactionBuilder(acc, { fee: '1000000', networkPassphrase: Networks.TESTNET })
    .addOperation(new Contract(id).call(method, ...args)).setTimeout(30).build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) return `ERR(${method})`;
  return sim.result?.retval ? scValToNative(sim.result.retval) : null;
}

(async () => {
  const latest = await server.getLatestLedger();
  console.log('\n📊 Stellar Passport — ops status');
  console.log('   RPC', RPC, '· ledger', latest.sequence);
  console.log('   contracts: reputation', REP.slice(0, 6), '· quest', QUEST.slice(0, 6), '· rewards', REWARDS.slice(0, 6));

  const [bal, cap, paid, reqFund, week, table] = await Promise.all([
    read(USDC, 'balance', [new Address(REWARDS).toScVal()]),
    read(REWARDS, 'get_daily_cap'),
    read(REWARDS, 'get_daily_paid'),
    read(REWARDS, 'get_require_funding'),
    read(QUEST, 'get_week'),
    read(REWARDS, 'get_rewards'),
  ]);

  console.log('\n💰 treasury');
  console.log('   USDC balance   ', usdc(bal), 'USDC');
  console.log('   daily cap      ', Number(cap) === 0 ? 'unlimited' : usdc(cap) + ' USDC');
  console.log('   paid today     ', usdc(paid), 'USDC');
  console.log('   proof-of-funding gate', reqFund ? 'ON' : 'off (testnet)');
  console.log('\n🗓  weekly epoch', String(week));
  console.log('\n🏅 rank → reward table');
  for (const r of table || []) {
    console.log(`   #${r.id}  ${Number(r.threshold)} XP → ${usdc(r.amount)} USDC  ${r.active ? '' : '(inactive)'}`);
  }
  console.log('');
})().catch((e) => { console.error('FAILED ❌', e.message); process.exit(1); });
