/**
 * Stellar/Soroban client helpers (RPC). Used by both client components and the
 * serverless attester route. No standing backend — leaderboard reads RPC directly
 * (belts/00-strategy: defer the indexer until scale demands it).
 */
import { Horizon, rpc, Networks } from '@stellar/stellar-sdk';
import { readNetworkConfig } from '@alvinmunk/shared';

// Next.js only inlines LITERAL `process.env.NEXT_PUBLIC_*` member expressions into the
// client bundle — passing the whole `process.env` object would leave these undefined in
// the browser (and contract IDs empty). So we reference each var literally here.
export const config = readNetworkConfig({
  NEXT_PUBLIC_STELLAR_NETWORK: process.env.NEXT_PUBLIC_STELLAR_NETWORK,
  NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL,
  NEXT_PUBLIC_NETWORK_PASSPHRASE: process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE,
  NEXT_PUBLIC_HORIZON_URL: process.env.NEXT_PUBLIC_HORIZON_URL,
  NEXT_PUBLIC_REPUTATION_CONTRACT_ID: process.env.NEXT_PUBLIC_REPUTATION_CONTRACT_ID,
  NEXT_PUBLIC_QUEST_REGISTRY_CONTRACT_ID: process.env.NEXT_PUBLIC_QUEST_REGISTRY_CONTRACT_ID,
  NEXT_PUBLIC_REWARDS_CONTRACT_ID: process.env.NEXT_PUBLIC_REWARDS_CONTRACT_ID,
  NEXT_PUBLIC_USDC_SAC_ID: process.env.NEXT_PUBLIC_USDC_SAC_ID,
  NEXT_PUBLIC_REGISTRY_CONTRACT_ID: process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_ID,
  NEXT_PUBLIC_GATE_CONTRACT_ID: process.env.NEXT_PUBLIC_GATE_CONTRACT_ID,
});

export const server = new rpc.Server(config.rpcUrl, {
  allowHttp: config.rpcUrl.startsWith('http://'),
});

/** Horizon — used for balances (RPC has no simple balance endpoint). */
export const horizon = new Horizon.Server(config.horizonUrl, {
  allowHttp: config.horizonUrl.startsWith('http://'),
});

export const networkPassphrase =
  config.network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

/** Native XLM balance as a string, or '0' if the account isn't funded yet. */
export async function getXlmBalance(address: string): Promise<string> {
  // Smart accounts (C…) aren't classic Horizon accounts — querying /accounts/C… 400s.
  // Their balance lives in the native SAC; skip the Horizon lookup here.
  if (address.startsWith('C')) return '0';
  try {
    const acct = await horizon.loadAccount(address);
    const native = acct.balances.find((b) => b.asset_type === 'native');
    return native?.balance ?? '0';
  } catch {
    return '0'; // not funded yet
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Block until a submitted tx is applied on-chain. Onboarding fires two txs back-to-back
 * from the same account (genesis → claim); the second must not build its sequence number
 * until the first has landed, or it collides (txBAD_SEQ). Throws on on-chain failure or
 * if it never confirms within the budget.
 */
export async function waitForTransaction(hash: string, tries = 30): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await server.getTransaction(hash);
      if (res.status === 'SUCCESS') return;
      if (res.status === 'FAILED') throw new Error(`tx ${hash} failed on-chain`);
    } catch (e) {
      if (e instanceof Error && e.message.endsWith('failed on-chain')) throw e;
      // NOT_FOUND yet / transient RPC error — keep polling.
    }
    await sleep(1000);
  }
  throw new Error(`tx ${hash} not confirmed in time — the network is slow, try again.`);
}

/**
 * Poll until a freshly-funded account is visible to the RPC. Friendbot can return before
 * the creating ledger has propagated to our RPC node, so the very next getAccount would
 * 404. Bounded; stays quiet on failure and lets the downstream call surface a clear error.
 */
export async function waitForAccountReady(address: string, tries = 20): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      await server.getAccount(address);
      return;
    } catch {
      await sleep(800);
    }
  }
}

/** Explorer link for a tx hash (Stellar Expert). */
export function txExplorerUrl(hash: string): string {
  const net = config.network === 'mainnet' ? 'public' : 'testnet';
  return `https://stellar.expert/explorer/${net}/tx/${hash}`;
}

/**
 * MVP leaderboard: read recent `att_set` / `xp` contract events straight from RPC.
 * At Blue/Black belt, replace with a durable indexer (cursor + reorg handling).
 */
export async function getRecentReputationEvents(startLedger: number) {
  return server.getEvents({
    startLedger,
    filters: [
      {
        type: 'contract',
        contractIds: [config.contracts.reputation],
        topics: [['*']],
      },
    ],
    limit: 100,
  });
}
