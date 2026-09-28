/**
 * Reverse-resolve onboarded wallets -> handles via registry.reverse(addr).
 * Read-only simulation, no signing. Run from repo root: node scripts/list-handles.mjs [N]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const webDir = path.join(root, 'apps', 'web');
const require = createRequire(path.join(webDir, 'package.json'));
const { rpc, Contract, Address, Account, Keypair, TransactionBuilder, BASE_FEE, nativeToScVal, scValToNative } =
  require('@stellar/stellar-sdk');

const env = {};
const envPath = path.join(webDir, '.env.local');
if (fs.existsSync(envPath))
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
const pick = (k) => process.env[k] || env[k];

const RPC = pick('NEXT_PUBLIC_RPC_URL') || 'https://soroban-testnet.stellar.org';
const PASSPHRASE = pick('NEXT_PUBLIC_NETWORK_PASSPHRASE') || 'Test SDF Network ; September 2015';
const REG = pick('NEXT_PUBLIC_REGISTRY_CONTRACT_ID');
const LIMIT = Number(process.argv[2] || 15);

const roster = JSON.parse(fs.readFileSync(path.join(webDir, 'src', 'data', 'onboarded-wallets.json'), 'utf8'));
const addrs = roster.testnet || [];
const server = new rpc.Server(RPC);
const src = new Account(Keypair.random().publicKey(), '0');
const reg = new Contract(REG);

const out = [];
const batch = addrs.slice(0, LIMIT);

// Build one `reverse_many` call per chunk of 50, falling back to individual
// per-address simulations if the deployed contract predates this view.
const CHUNK = 50;
let resolved = false;

try {
  const chunks = [];
  for (let i = 0; i < batch.length; i += CHUNK) {
    chunks.push(batch.slice(i, i + CHUNK));
  }

  for (const chunk of chunks) {
    const vecArg = nativeToScVal(chunk.map((a) => Address.fromString(a)), { type: 'vec' });
    const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
      .addOperation(reg.call('reverse_many', vecArg))
      .setTimeout(30)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (sim.error) throw new Error(sim.error);
    const results = scValToNative(sim.result?.retval);
    for (let i = 0; i < chunk.length; i++) {
      const handle = results[i];
      if (handle) out.push({ handle: String(handle), addr: chunk[i] });
    }
  }
  resolved = true;
} catch {
  /* contract predates reverse_many — fall back to per-address simulation */
}

if (!resolved) {
  for (const a of batch) {
    try {
      const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
        .addOperation(reg.call('reverse', nativeToScVal(Address.fromString(a), { type: 'address' })))
        .setTimeout(30)
        .build();
      const sim = await server.simulateTransaction(tx);
      const rv = sim.result?.retval;
      const handle = rv ? scValToNative(rv) : null;
      if (handle) out.push({ handle: String(handle), addr: a });
    } catch {
      /* skip */
    }
  }
}

console.log(`\nResolved ${out.length} handles (of ${addrs.length} wallets):\n`);
for (const { handle, addr } of out) console.log(`@${handle.padEnd(16)} ${addr.slice(0, 6)}…${addr.slice(-4)}`);
