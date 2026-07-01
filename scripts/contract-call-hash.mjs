/**
 * Produces a REAL, verifiable contract-call transaction on testnet for the Level-2 README.
 *
 * Self-contained + secret-free: spins up a throwaway Friendbot-funded keypair and invokes
 * `mint_vouch` on the deployed Reputation contract (a genuine contract write that emits the
 * canonical events). Prints the tx hash + Stellar Expert link.
 *
 * Run from repo root:  node scripts/contract-call-hash.mjs
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, '..', 'apps', 'web');
const require = createRequire(join(webDir, 'package.json'));
const { Address, Contract, Keypair, Networks, TransactionBuilder, nativeToScVal, scValToNative, rpc } =
  require('@stellar/stellar-sdk');

// Read the deployed contract id + RPC straight from the app's env.local.
const env = Object.fromEntries(
  readFileSync(join(webDir, '.env.local'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const REP = env.NEXT_PUBLIC_REPUTATION_CONTRACT_ID;
const RPC = env.NEXT_PUBLIC_RPC_URL || 'https://soroban-testnet.stellar.org';
const PASS = Networks.TESTNET;
if (!REP) throw new Error('NEXT_PUBLIC_REPUTATION_CONTRACT_ID not found in apps/web/.env.local');

const server = new rpc.Server(RPC);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function friendbot(pk) {
  const r = await fetch(`https://friendbot.stellar.org/?addr=${pk}`);
  if (!r.ok && r.status !== 400) throw new Error('friendbot ' + r.status);
}

(async () => {
  const kp = Keypair.random();
  console.log('caller :', kp.publicKey());
  console.log('funding via Friendbot…');
  await friendbot(kp.publicKey());
  await sleep(3000);

  const secret = crypto.randomBytes(32);
  const claimHash = new Uint8Array(crypto.createHash('sha256').update(secret).digest());
  const args = [
    new Address(kp.publicKey()).toScVal(),
    nativeToScVal(claimHash, { type: 'bytes' }),
    nativeToScVal('Level 2 — contract call demo', { type: 'string' }),
  ];

  const acc = await server.getAccount(kp.publicKey());
  const built = new TransactionBuilder(acc, { fee: '2000000', networkPassphrase: PASS })
    .addOperation(new Contract(REP).call('mint_vouch', ...args))
    .setTimeout(60)
    .build();
  const prepared = await server.prepareTransaction(built);
  prepared.sign(kp);

  const sent = await server.sendTransaction(prepared);
  if (sent.status === 'ERROR') throw new Error('send: ' + JSON.stringify(sent.errorResult));
  console.log('submitted:', sent.hash);

  for (let i = 0; i < 30; i++) {
    const r = await server.getTransaction(sent.hash);
    if (r.status === 'SUCCESS') {
      const vouchId = r.returnValue ? scValToNative(r.returnValue) : null;
      console.log('\n✅ CONTRACT CALL CONFIRMED');
      console.log('contract :', REP);
      console.log('method   : mint_vouch  → vouch id', String(vouchId));
      console.log('tx hash  :', sent.hash);
      console.log('explorer : https://stellar.expert/explorer/testnet/tx/' + sent.hash);
      return;
    }
    if (r.status === 'FAILED') throw new Error('tx failed on-chain ' + sent.hash);
    await sleep(1000);
  }
  throw new Error('not confirmed in time: ' + sent.hash);
})().catch((e) => {
  console.error('FAILED ❌', e.message);
  process.exit(1);
});
