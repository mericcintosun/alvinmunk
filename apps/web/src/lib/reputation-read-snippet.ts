/**
 * The one "read reputation from your own app" snippet — shown on the landing page,
 * /how-it-works and /score/[address] through `<ReputationSnippet>`, so they cannot drift
 * apart. It has to run as written from outside this repo: plain `@stellar/stellar-sdk`, no
 * `@/…` imports, the configured contract id, and only views the DEPLOYED reputation
 * contract exports. `get_score` and `get_earned` are in every deployment; newer views such
 * as `get_profile` and `get_counts` are not on the live testnet contract yet (the app's own
 * `getScores` falls back the same way), so the snippet sticks to the two.
 * reputation-read-snippet.test.ts runs it against a stubbed RPC and checks both views
 * against contracts/reputation/src/lib.rs.
 */
import { config } from './stellar';

/** File name above the snippet — `.mjs`, so `node read-reputation.mjs` runs its top-level await. */
export const REPUTATION_READ_FILE = 'read-reputation.mjs';

/** The contract views the snippet calls: each takes `addr: Address` and returns a `u64`. */
export const REPUTATION_READ_VIEWS = ['get_score', 'get_earned'] as const;

/** Shown when no reputation contract is configured (local dev without an .env). */
export const CONTRACT_ID_PLACEHOLDER = '<REPUTATION_CONTRACT_ID>';

/** The reputation contract's admin (deployer) account — read when the page has no address of its own. */
export const SAMPLE_ADDRESS = 'GDIS5BDXSI2DDJNTKRZPI6MNB5XCLMN4Z6PPRPM4RQLZ3PSQ2YTERLFA';

type SnippetConfig = Pick<typeof config, 'network' | 'rpcUrl'> & {
  contracts: Pick<typeof config.contracts, 'reputation'>;
};

/** The snippet source for `address`, pointed at the app's own network and reputation contract. */
export function reputationReadSnippet(address: string = SAMPLE_ADDRESS, cfg: SnippetConfig = config): string {
  const passphrase = cfg.network === 'mainnet' ? 'Networks.PUBLIC' : 'Networks.TESTNET';
  return `import {
  Account,
  Address,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  rpc,
  scValToNative,
} from '@stellar/stellar-sdk';

const server = new rpc.Server('${cfg.rpcUrl}');
const contractId = '${cfg.contracts.reputation || CONTRACT_ID_PLACEHOLDER}'; // reputation contract (${cfg.network})
const address = '${address}';

// A read-only view is simulated: nothing is signed or paid, so any well-formed
// source account works.
async function read(method) {
  const source = new Account(Keypair.random().publicKey(), '0');
  const tx = new TransactionBuilder(source, { fee: '100', networkPassphrase: ${passphrase} })
    .addOperation(new Contract(contractId).call(method, new Address(address).toScVal()))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  return scValToNative(sim.result.retval);
}

const social = await read('get_score'); // Social XP: from vouches, never cashable
const earned = await read('get_earned'); // Earned XP: from verified quests, the USDC-eligible track
console.log({ social, earned }); // u64 decodes to BigInt, e.g. { social: 15n, earned: 0n }`;
}
