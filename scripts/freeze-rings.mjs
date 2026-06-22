/**
 * Blue anti-abuse — off-chain ring/cluster detector → on-chain `frozen` set.
 *
 * Reads the Reputation `vouch/claimed` events from RPC, builds (from→claimer) pairs,
 * flags reciprocal rings (A↔B), and calls `Rewards.set_frozen(addr, true)` so the
 * contract blocks those accounts from claim/tip. The on-chain hook shipped with the
 * Green rewards-hardening pass; this is the off-chain brain that drives it.
 *
 * Secret-free: the admin key is read from $ADMIN_SECRET_KEY (never committed).
 * Dry-run by default — set APPLY=1 to actually freeze.
 *
 * Run from apps/web:  ADMIN_SECRET_KEY=S... [APPLY=1] node ../../scripts/freeze-rings.mjs
 */
// stellar-sdk lives in apps/web/node_modules (pnpm, no root hoist) — resolve from there.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'package.json'));
const {
  Address, Contract, Keypair, Networks, TransactionBuilder, nativeToScVal, scValToNative, rpc, xdr,
} = require('@stellar/stellar-sdk');

const RPC = process.env.NEXT_PUBLIC_RPC_URL ?? 'https://soroban-testnet.stellar.org';
const REPUTATION = process.env.NEXT_PUBLIC_REPUTATION_CONTRACT_ID ?? 'CBNIZXITUVTRVW6RZGEGCI7KNF46REG4EDM4XUVHKDAV63WOHWW75SZM';
const REWARDS = process.env.NEXT_PUBLIC_REWARDS_CONTRACT_ID ?? 'CBUKGIFOEOS74I2IUUHYNRBZODQFOFCFWIJY3DUJHOUUJV7TT2QYADOU';
const APPLY = process.env.APPLY === '1';
const server = new rpc.Server(RPC);
const toNative = (v) => scValToNative(typeof v === 'string' ? xdr.ScVal.fromXDR(v, 'base64') : v);

/** Canonical tested version lives in @passport/shared (detectReciprocalRings). */
function detectReciprocalRings(pairs) {
  const edges = new Set(pairs.map((p) => `${p.from}>${p.claimer}`));
  const flagged = new Set();
  for (const p of pairs) {
    if (edges.has(`${p.claimer}>${p.from}`)) {
      flagged.add(p.from);
      flagged.add(p.claimer);
    }
  }
  return [...flagged].sort();
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
  const flagged = detectReciprocalRings(pairs);
  if (!flagged.length) { console.log('no reciprocal rings detected ✅'); return; }
  console.log(`flagged ${flagged.length} ring member(s):`);
  flagged.forEach((a) => console.log('  ' + a));
  if (!APPLY) { console.log('\n(dry-run) set APPLY=1 + ADMIN_SECRET_KEY to freeze on-chain.'); return; }
  const secret = process.env.ADMIN_SECRET_KEY;
  if (!secret) { console.error('APPLY=1 needs ADMIN_SECRET_KEY'); process.exit(1); }
  const admin = Keypair.fromSecret(secret);
  for (const who of flagged) { console.log(`freezing ${who} …`); console.log('  tx ' + (await setFrozen(admin, who))); }
  console.log('done ✅');
})().catch((e) => { console.error('FAILED ❌', e.message); process.exit(1); });
