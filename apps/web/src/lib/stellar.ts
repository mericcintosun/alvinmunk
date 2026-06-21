/**
 * Stellar/Soroban client helpers (RPC). Used by both client components and the
 * serverless attester route. No standing backend — leaderboard reads RPC directly
 * (belts/00-strategy: defer the indexer until scale demands it).
 */
import { Horizon, rpc, Networks } from '@stellar/stellar-sdk';
import { readNetworkConfig } from '@passport/shared';

export const config = readNetworkConfig(
  typeof process !== 'undefined' ? (process.env as Record<string, string | undefined>) : {},
);

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
  try {
    const acct = await horizon.loadAccount(address);
    const native = acct.balances.find((b) => b.asset_type === 'native');
    return native?.balance ?? '0';
  } catch {
    return '0'; // not funded yet
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
