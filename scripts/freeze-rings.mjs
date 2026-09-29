/**
 * Blue anti-abuse — off-chain ring/cluster detector → on-chain `frozen` set.
 *
 * Reads the Reputation `vouch/claimed` events from RPC, builds (from→claimer) pairs,
 * flags ring candidates (reciprocal A↔B pairs and A→B→C→A cycles), and calls
 * `Rewards.set_frozen(addr, true)` so the contract blocks those accounts from claim/tip.
 * The on-chain hook shipped with the Green rewards-hardening pass; this is the off-chain
 * brain that drives it.
 *
 * Secret-free: the admin key is read from $ADMIN_SECRET_KEY (never committed).
 * Dry-run by default — set APPLY=1 to actually freeze.
 *
 * The RPC URL and contract ids come from scripts/lib/env.mjs (NEXT_PUBLIC_* env, then
 * apps/web/.env.local, then deployments/testnet.json); a missing id exits 2.
 *
 * Run from apps/web:  ADMIN_SECRET_KEY=S... [APPLY=1] node ../../scripts/freeze-rings.mjs
 */
// stellar-sdk lives in apps/web/node_modules (pnpm, no root hoist) — resolve from there.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadDeployment } from './lib/env.mjs';
const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'package.json'));
const {
  Address, Contract, Keypair, Networks, TransactionBuilder, nativeToScVal, scValToNative, rpc, xdr,
} = require('@stellar/stellar-sdk');

// Testnet only: set_frozen below signs with the testnet passphrase.
const deployment = loadDeployment(['reputation', 'rewards'], { network: 'testnet', settings: ['rpcUrl'] });
const RPC = deployment.rpcUrl;
const { reputation: REPUTATION, rewards: REWARDS } = deployment.contracts;
const APPLY = process.env.APPLY === '1';
const server = new rpc.Server(RPC);
const toNative = (v) => scValToNative(typeof v === 'string' ? xdr.ScVal.fromXDR(v, 'base64') : v);

/**
 * Ring candidates in the claimed-vouch graph. Mirror of `detectRingCandidates` in
 * packages/shared (the unit-tested canonical version) — keep the two in sync.
 *
 * Rules (belts/08):
 * - reciprocal: A→B and B→A.
 * - cycle3:     A→B→C→A with three distinct members.
 * Self-loops and duplicate edges are ignored; a back-and-forth pair counts only as
 * reciprocal. There is deliberately no raw-degree rule, because the most active honest
 * users would be its first false positives.
 *
 * False positives: a small real community can form a genuine 3-cycle. Always review the
 * dry-run output (each address is printed with the rule that flagged it) before APPLY=1,
 * and unfreeze with `set_frozen(addr, false)` if a candidate turns out to be legitimate.
 */
function detectRingCandidates(pairs) {
  const adj = new Map();
  for (const { from, claimer } of pairs) {
    if (from === claimer) continue;
    if (!adj.has(from)) adj.set(from, new Set());
    adj.get(from).add(claimer);
  }
  const has = (a, b) => adj.get(a)?.has(b) ?? false;
  const reasons = new Map();
  const flag = (addr, why) => {
    if (!reasons.has(addr)) reasons.set(addr, new Set());
    reasons.get(addr).add(why);
  };
  for (const [a, outs] of adj) {
    for (const b of outs) {
      if (has(b, a)) {
        flag(a, 'reciprocal');
        flag(b, 'reciprocal');
      }
      for (const c of adj.get(b) ?? []) {
        if (c !== a && c !== b && has(c, a)) {
          flag(a, 'cycle3');
          flag(b, 'cycle3');
          flag(c, 'cycle3');
        }
      }
    }
  }
  return [...reasons.keys()].sort().map((address) => ({ address, reasons: [...reasons.get(address)].sort() }));
}

async function readPairs() {
  const latest = await server.getLatestLedger();
  const startLedger = Math.max(1, latest.sequence - 9000); // within RPC retention (≥16k returns 0)
  const res = await server.getEvents({
    startLedger,
    filters: [{ type: 'contract', contractIds: [REPUTATION], topics: [['*', '*']] }],
    limit: 1000,
  });
  const pairs = [];
  for (const ev of res.events) {
    const topics = ev.topic.map(toNative);
    const data = toNative(ev.value);
    if (topics[0] === 'vouch' && topics[1] === 'claimed' && Array.isArray(data)) {
      pairs.push({ from: String(data[1]), claimer: String(data[2]) });
    }
  }
  return pairs;
}

async function setFrozen(admin, who) {
  const acc = await server.getAccount(admin.publicKey());
  const tx = new TransactionBuilder(acc, { fee: '1000000', networkPassphrase: Networks.TESTNET })
    .addOperation(new Contract(REWARDS).call('set_frozen', new Address(who).toScVal(), nativeToScVal(true, { type: 'bool' })))
    .setTimeout(60).build();
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(admin);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === 'ERROR') throw new Error(JSON.stringify(sent.errorResult));
  for (let i = 0; i < 30; i++) {
    const r = await server.getTransaction(sent.hash);
    if (r.status === 'SUCCESS') return sent.hash;
    if (r.status === 'FAILED') throw new Error('tx failed');
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error('not confirmed');
}

(async () => {
  const pairs = await readPairs();
  console.log(`read ${pairs.length} claimed-vouch pair(s) in the window`);
  const candidates = detectRingCandidates(pairs);
  if (!candidates.length) { console.log('no ring candidates detected ✅'); return; }
  console.log(`flagged ${candidates.length} ring candidate(s):`);
  candidates.forEach((c) => console.log(`  ${c.address}  [${c.reasons.join(', ')}]`));
  const flagged = candidates.map((c) => c.address);
  if (!APPLY) { console.log('\n(dry-run) set APPLY=1 + ADMIN_SECRET_KEY to freeze on-chain.'); return; }
  const secret = process.env.ADMIN_SECRET_KEY;
  if (!secret) { console.error('APPLY=1 needs ADMIN_SECRET_KEY'); process.exit(1); }
  const admin = Keypair.fromSecret(secret);
  for (const who of flagged) { console.log(`freezing ${who} …`); console.log('  tx ' + (await setFrozen(admin, who))); }
  console.log('done ✅');
})().catch((e) => { console.error('FAILED ❌', e.message); process.exit(1); });
