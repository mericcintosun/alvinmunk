/**
 * Reverse-resolve onboarded wallets -> handles via registry.reverse_many (one simulation
 * per REVERSE_MANY_CAP wallets), or registry.reverse per wallet on a registry deployed
 * before reverse_many. Prints the first N handles found (default 15).
 * Read-only simulation, no signing. Run from repo root: node scripts/list-handles.mjs [N]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const webDir = path.join(root, 'apps', 'web');
const require = createRequire(path.join(webDir, 'package.json'));
const { rpc, Contract, Address, Account, Keypair, TransactionBuilder, BASE_FEE, scValToNative, xdr } =
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

// Mirrors REVERSE_MANY_CAP in contracts/registry/src/lib.rs.
const REVERSE_MANY_CAP = 50;
// What simulation reports when the deployed registry has no such function.
const MISSING_FN = /Error\(WasmVm, MissingValue\)|non-existent contract function/;

async function simulate(method, arg) {
  const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(reg.call(method, arg))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (sim.error) throw new Error(sim.error);
  const rv = sim.result?.retval;
  return rv ? scValToNative(rv) : null;
}

const scAddr = (a) => Address.fromString(a).toScVal();

// Handles for `chunk`, in order (null = none, or unreadable). Drops to one `reverse` per
// wallet for the rest of the run once the registry turns out to predate `reverse_many`.
let batched = true;
async function reverseChunk(chunk) {
  if (batched) {
    try {
      const hs = await simulate('reverse_many', xdr.ScVal.scvVec(chunk.map(scAddr)));
      return chunk.map((_, i) => (Array.isArray(hs) ? (hs[i] ?? null) : null));
    } catch (e) {
      const msg = String(e?.message ?? e);
      if (!MISSING_FN.test(msg)) {
        console.warn(`reverse_many failed, skipping ${chunk.length} wallets: ${msg.split('\n')[0]}`);
        return chunk.map(() => null);
      }
      batched = false;
    }
  }
  const hs = [];
  for (const a of chunk) {
    try {
      hs.push(await simulate('reverse', scAddr(a)));
    } catch {
      hs.push(null);
    }
  }
  return hs;
}

const found = [];
for (let i = 0; i < addrs.length && found.length < LIMIT; i += REVERSE_MANY_CAP) {
  const chunk = addrs.slice(i, i + REVERSE_MANY_CAP);
  const hs = await reverseChunk(chunk);
  chunk.forEach((addr, j) => hs[j] && found.push({ handle: String(hs[j]), addr }));
}
const out = found.slice(0, LIMIT);

console.log(`\nResolved ${out.length} handles (of ${addrs.length} wallets):\n`);
for (const { handle, addr } of out) console.log(`@${handle.padEnd(16)} ${addr.slice(0, 6)}…${addr.slice(-4)}`);
