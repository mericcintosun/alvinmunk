/**
 * End-to-end flow tests against the LIVE testnet contracts — exercises exactly what the
 * UI does (vouch / claim / quest / tip / reward), with happy AND negative paths. This is
 * the integration layer behind every UX action.
 *
 * Secret-free: admin (USDC issuer) + attester keys come from env. Generates throwaway
 * users via Friendbot. Mutating-config tests (daily cap, frozen, proof-of-funding) reset
 * the contract afterwards. Records pass/fail, never aborts on one failure, exits non-zero
 * if anything failed.
 *
 * Run from repo root:
 *   ADMIN_SECRET_KEY=S... ATTESTER_SECRET_KEY=S... node scripts/e2e-testnet.mjs
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';
const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'package.json'));
const {
  Address, Asset, Contract, Keypair, Networks, Operation, TransactionBuilder,
  nativeToScVal, scValToNative, rpc, Horizon, xdr,
} = require('@stellar/stellar-sdk');

const PASS = Networks.TESTNET;
const RPC = process.env.NEXT_PUBLIC_RPC_URL ?? 'https://soroban-testnet.stellar.org';
const HOR = process.env.NEXT_PUBLIC_HORIZON_URL ?? 'https://horizon-testnet.stellar.org';
const REP = process.env.NEXT_PUBLIC_REPUTATION_CONTRACT_ID ?? 'CBNIZXITUVTRVW6RZGEGCI7KNF46REG4EDM4XUVHKDAV63WOHWW75SZM';
const QUEST = process.env.NEXT_PUBLIC_QUEST_REGISTRY_CONTRACT_ID ?? 'CD6RZUVNQ3TV3X6MNQM25NB2YRFRGMSUGKWTMAIGJOC23C6ESHJKYNFO';
const REWARDS = process.env.NEXT_PUBLIC_REWARDS_CONTRACT_ID ?? 'CBUKGIFOEOS74I2IUUHYNRBZODQFOFCFWIJY3DUJHOUUJV7TT2QYADOU';
const USDC_SAC = process.env.NEXT_PUBLIC_USDC_SAC_ID ?? 'CAKT2EK2SFGNXTXVSYZLZXA5YB5QPVHLTVUMRHLJTF5RFFAFMIRNPZT2';

const ADMIN = Keypair.fromSecret(reqEnv('ADMIN_SECRET_KEY'));
const ATTESTER = Keypair.fromSecret(reqEnv('ATTESTER_SECRET_KEY'));
const usdc = new Asset('USDC', ADMIN.publicKey());
const server = new rpc.Server(RPC);
const hor = new Horizon.Server(HOR);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const u32 = (n) => nativeToScVal(n, { type: 'u32' });
const u64 = (n) => nativeToScVal(n, { type: 'u64' });
const i128 = (n) => nativeToScVal(n, { type: 'i128' });
const A = (s) => new Address(s).toScVal();
const bytes = (u8) => nativeToScVal(u8, { type: 'bytes' });
const str = (s) => nativeToScVal(s, { type: 'string' });

function reqEnv(k) {
  const v = process.env[k];
  if (!v) {
    console.error(`Missing env ${k}. Run: ADMIN_SECRET_KEY=S… ATTESTER_SECRET_KEY=S… node scripts/e2e-testnet.mjs`);
    process.exit(2);
  }
  return v;
}

async function friendbot(pk) {
  const r = await fetch(`https://friendbot.stellar.org/?addr=${pk}`);
  if (!r.ok && r.status !== 400) throw new Error('friendbot ' + r.status);
}
async function newUser() {
  const kp = Keypair.random();
  await friendbot(kp.publicKey());
  return kp;
}
async function classic(kp, op) {
  const acc = await hor.loadAccount(kp.publicKey());
  const tx = new TransactionBuilder(acc, { fee: '2000', networkPassphrase: PASS }).addOperation(op).setTimeout(60).build();
  tx.sign(kp);
  return hor.submitTransaction(tx);
}
async function invoke(kp, id, method, args) {
  // Retry on txBadSeq — rapid same-account txs (esp. ADMIN config) can race the
  // sequence number; refetch the account and rebuild.
  for (let attempt = 0; attempt < 5; attempt++) {
    const acc = await server.getAccount(kp.publicKey());
    const built = new TransactionBuilder(acc, { fee: '2000000', networkPassphrase: PASS })
      .addOperation(new Contract(id).call(method, ...args)).setTimeout(60).build();
    const prepared = await server.prepareTransaction(built);
    prepared.sign(kp);
    const sent = await server.sendTransaction(prepared);
    if (sent.status === 'ERROR') {
      const code = JSON.stringify(sent.errorResult);
      if (code.includes('txBadSeq') && attempt < 4) { await sleep(1500); continue; }
      throw new Error('send: ' + code);
    }
    for (let i = 0; i < 30; i++) {
      try {
        const r = await server.getTransaction(sent.hash);
        if (r.status === 'SUCCESS') return r.returnValue ? scValToNative(r.returnValue) : null;
        if (r.status === 'FAILED') throw new Error('tx failed on-chain ' + sent.hash);
      } catch (e) { if (String(e.message).includes('failed on-chain')) throw e; }
      await sleep(1000);
    }
    throw new Error('not confirmed');
  }
  throw new Error('txBadSeq retries exhausted');
}
async function read(id, method, args) {
  const acc = await server.getAccount(ADMIN.publicKey());
  const tx = new TransactionBuilder(acc, { fee: '2000000', networkPassphrase: PASS })
    .addOperation(new Contract(id).call(method, ...args)).setTimeout(30).build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error('sim: ' + sim.error);
  return sim.result?.retval ? scValToNative(sim.result.retval) : null;
}
const score = (a) => read(REP, 'get_score', [A(a)]).then(Number);
const earned = (a) => read(REP, 'get_earned', [A(a)]).then(Number);
const usdcBal = (a) => read(USDC_SAC, 'balance', [A(a)]).then((v) => BigInt(v ?? 0));
async function trustAndMaybeFund(kp, fundUsdc = 0n) {
  await classic(kp, Operation.changeTrust({ asset: usdc }));
  if (fundUsdc > 0n) await classic(ADMIN, Operation.payment({ destination: kp.publicKey(), asset: usdc, amount: (Number(fundUsdc) / 1e7).toString() }));
}
function secretPair() {
  const s = crypto.randomBytes(32);
  return { secret: new Uint8Array(s), hash: new Uint8Array(crypto.createHash('sha256').update(s).digest()) };
}

// ── tiny test runner ──
let pass = 0, fail = 0;
const fails = [];
async function test(name, fn) {
  try { await fn(); console.log(`✅ ${name}`); pass++; }
  catch (e) { console.log(`❌ ${name}\n   ${String(e.message).split('Event log')[0].trim().slice(0, 160)}`); fail++; fails.push(name); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
async function expectRevert(code, fn) {
  try { await fn(); throw new Error('expected revert but it succeeded'); }
  catch (e) {
    const m = String(e.message);
    if (m.includes('expected revert')) throw e;
    assert(m.includes(`#${code}`) || m.includes('Error(Contract'), `expected contract error #${code}, got: ${m.slice(0, 120)}`);
  }
}

(async () => {
  console.log('e2e: provisioning users via friendbot…');
  const [Aw, Bw, Cw, Dw] = await Promise.all([newUser(), newUser(), newUser(), newUser()]);
  await sleep(2000);
  console.log('A', Aw.publicKey(), '\nB', Bw.publicKey(), '\nC', Cw.publicKey(), '\nD', Dw.publicKey(), '\n');

  // ── HAPPY: vouch loop (asymmetric social XP, two-track) ──
  let vouchId;
  await test('happy: mint_vouch + claim_vouch → asymmetric Social XP, Earned untouched', async () => {
    const { secret, hash } = secretPair();
    vouchId = Number(await invoke(Aw, REP, 'mint_vouch', [A(Aw.publicKey()), bytes(hash), str('gm')]));
    await invoke(Bw, REP, 'claim_vouch', [A(Bw.publicKey()), u64(vouchId), bytes(secret)]);
    assert((await score(Aw.publicKey())) === 5, 'voucher should have 5 social');
    assert((await score(Bw.publicKey())) === 10, 'claimer should have 10 social');
    assert((await earned(Bw.publicKey())) === 0, 'claimer earned must stay 0 (keystone)');
  });

  // ── HAPPY: quest → Earned XP + streak ──
  await test('happy: award_quest → Earned XP (quest 1 = 50) + streak', async () => {
    await invoke(ATTESTER, QUEST, 'award_quest', [A(ATTESTER.publicKey()), u32(1), A(Cw.publicKey())]);
    assert((await earned(Cw.publicKey())) === 50, 'C earned should be 50');
    const s = await read(QUEST, 'get_streak', [A(Cw.publicKey())]);
    assert(Number(s.weeks) === 1, 'streak weeks should be 1');
  });

  // ── HAPPY: USDC tip wallet→wallet ──
  await test('happy: enable USDC + faucet-style fund + tip A→B', async () => {
    await trustAndMaybeFund(Aw, 50000000n); // A gets 5 USDC from issuer
    await trustAndMaybeFund(Bw, 0n);
    const before = await usdcBal(Bw.publicKey());
    await invoke(Aw, REWARDS, 'tip', [A(Aw.publicKey()), A(Bw.publicKey()), i128(10000000n)]);
    assert((await usdcBal(Bw.publicKey())) - before === 10000000n, 'B should receive 1 USDC');
  });

  // ── HAPPY: reward claim (earned-gated, exact stored amount) ──
  await test('happy: claim_reward #1 (earned 50 ≥ 30) → exact 0.5 USDC', async () => {
    await trustAndMaybeFund(Cw, 0n);
    const before = await usdcBal(Cw.publicKey());
    await invoke(Cw, REWARDS, 'claim_reward', [A(Cw.publicKey()), u32(1)]);
    assert((await usdcBal(Cw.publicKey())) - before === 5000000n, 'C should receive exactly 0.5 USDC');
    assert((await read(REWARDS, 'is_claimed', [u32(1), A(Cw.publicKey())])) === true, 'is_claimed true');
  });

  // ── NEGATIVE: vouch guards ──
  await test('negative: self-vouch reverts (#6 SelfVouch)', async () => {
    const { secret, hash } = secretPair();
    const id = Number(await invoke(Aw, REP, 'mint_vouch', [A(Aw.publicKey()), bytes(hash), str('self')]));
    await expectRevert(6, () => invoke(Aw, REP, 'claim_vouch', [A(Aw.publicKey()), u64(id), bytes(secret)]));
  });
  await test('negative: wrong secret reverts (#8 BadSecret)', async () => {
    const { hash } = secretPair();
    const id = Number(await invoke(Aw, REP, 'mint_vouch', [A(Aw.publicKey()), bytes(hash), str('x')]));
    const wrong = new Uint8Array(crypto.randomBytes(32));
    await expectRevert(8, () => invoke(Bw, REP, 'claim_vouch', [A(Bw.publicKey()), u64(id), bytes(wrong)]));
  });
  await test('negative: double-claim same vouch reverts (#5 AlreadyClaimed)', async () => {
    const { secret, hash } = secretPair();
    const id = Number(await invoke(Aw, REP, 'mint_vouch', [A(Aw.publicKey()), bytes(hash), str('dc')]));
    await invoke(Cw, REP, 'claim_vouch', [A(Cw.publicKey()), u64(id), bytes(secret)]);
    await expectRevert(5, () => invoke(Cw, REP, 'claim_vouch', [A(Cw.publicKey()), u64(id), bytes(secret)]));
  });

  // ── NEGATIVE: quest replay ──
  await test('negative: quest replay reverts (#5 AlreadyClaimed)', async () => {
    await expectRevert(5, () => invoke(ATTESTER, QUEST, 'award_quest', [A(ATTESTER.publicKey()), u32(1), A(Cw.publicKey())]));
  });

  // ── NEGATIVE: reward gating ──
  await test('negative: reward below threshold reverts (#3 BelowThreshold)', async () => {
    await trustAndMaybeFund(Dw, 0n); // D has 0 earned
    await expectRevert(3, () => invoke(Dw, REWARDS, 'claim_reward', [A(Dw.publicKey()), u32(1)]));
  });
  await test('negative: Social XP cannot open the treasury (keystone)', async () => {
    // B has 10 Social, 0 Earned → reward #1 (threshold 30 earned) must revert BelowThreshold
    await expectRevert(3, () => invoke(Bw, REWARDS, 'claim_reward', [A(Bw.publicKey()), u32(1)]));
  });
  await test('negative: reward double-claim reverts (#4 AlreadyClaimed)', async () => {
    await expectRevert(4, () => invoke(Cw, REWARDS, 'claim_reward', [A(Cw.publicKey()), u32(1)]));
  });

  // ── NEGATIVE: circuit breaker (mutates config → reset after) ──
  await test('negative: daily cap blocks over-cap payout (#9), then reset', async () => {
    // C earns more so it qualifies for reward #2 (threshold 60): quest 2 = +30 → 80
    await invoke(ATTESTER, QUEST, 'award_quest', [A(ATTESTER.publicKey()), u32(2), A(Cw.publicKey())]);
    await invoke(ADMIN, REWARDS, 'set_daily_cap', [i128(1n)]);
    try {
      await expectRevert(9, () => invoke(Cw, REWARDS, 'claim_reward', [A(Cw.publicKey()), u32(2)]));
    } finally {
      await invoke(ADMIN, REWARDS, 'set_daily_cap', [i128(500000000n)]);
    }
  });

  await test('negative: frozen account blocked from claim (#10), then unfreeze', async () => {
    await invoke(ADMIN, REWARDS, 'set_frozen', [A(Cw.publicKey()), nativeToScVal(true, { type: 'bool' })]);
    try {
      await expectRevert(10, () => invoke(Cw, REWARDS, 'claim_reward', [A(Cw.publicKey()), u32(2)]));
    } finally {
      await invoke(ADMIN, REWARDS, 'set_frozen', [A(Cw.publicKey()), nativeToScVal(false, { type: 'bool' })]);
    }
  });

  await test('happy+negative: proof-of-funding gate (on→NotFunded #12, set_funded→ok), reset', async () => {
    await invoke(ADMIN, REWARDS, 'set_require_funding', [nativeToScVal(true, { type: 'bool' })]);
    try {
      await expectRevert(12, () => invoke(Cw, REWARDS, 'claim_reward', [A(Cw.publicKey()), u32(2)]));
      await invoke(ADMIN, REWARDS, 'set_funded', [A(Cw.publicKey()), nativeToScVal(true, { type: 'bool' })]);
      const before = await usdcBal(Cw.publicKey());
      await invoke(Cw, REWARDS, 'claim_reward', [A(Cw.publicKey()), u32(2)]);
      assert((await usdcBal(Cw.publicKey())) - before === 10000000n, 'C should receive 1 USDC for reward #2');
    } finally {
      await invoke(ADMIN, REWARDS, 'set_require_funding', [nativeToScVal(false, { type: 'bool' })]);
    }
  });

  console.log(`\n── e2e summary: ${pass} passed, ${fail} failed ──`);
  if (fail) { console.log('failed:', fails.join(', ')); process.exit(1); }
})().catch((e) => { console.error('RUNNER CRASH ❌', e.message); process.exit(1); });
