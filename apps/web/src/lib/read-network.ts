/**
 * The read-only network override for public pages (#290). After the mainnet cutover the
 * deployment reads mainnet, so `?network=testnet` on `/u/<handle>`, `/score/<address>` and
 * `/leaderboard` reads the testnet deployment instead — testnet history stays verifiable
 * without a second deployment. Only reads take a `ReadNetwork`; every write keeps the
 * deployment's own config (lib/stellar), and override pages offer none.
 */
import { rpc } from '@stellar/stellar-sdk';
import { createClient, NETWORKS, type AlvinmunkClient } from '@alvinmunk/sdk';
import { config } from './stellar';

export interface ReadNetwork {
  network: 'testnet';
  networkPassphrase: string;
  rpcUrl: string;
  /** The contracts the public pages read ('' = not deployed). */
  contracts: { reputation: string; registry: string };
  server: rpc.Server;
  client: AlvinmunkClient;
}

/** The query parameter, and the only value it takes. */
export const NETWORK_PARAM = 'network';
export const TESTNET = 'testnet';

const envValue = (v: string | undefined) => v?.trim() || undefined;

let testnet: ReadNetwork | undefined;

/**
 * The testnet deployment: the SDK's built-in one (`NETWORKS.testnet`), which
 * `NEXT_PUBLIC_TESTNET_RPC_URL` / `NEXT_PUBLIC_TESTNET_REPUTATION_CONTRACT_ID` /
 * `NEXT_PUBLIC_TESTNET_REGISTRY_CONTRACT_ID` can pin at the cutover. Built once, so every
 * caller shares one RPC client and one identity (safe as a React dependency).
 */
export function testnetNetwork(): ReadNetwork {
  if (testnet) return testnet;
  const d = NETWORKS.testnet;
  // Literal member expressions: Next inlines only those into the client bundle.
  const rpcUrl = envValue(process.env.NEXT_PUBLIC_TESTNET_RPC_URL) ?? d.rpcUrl;
  const contracts = {
    reputation: envValue(process.env.NEXT_PUBLIC_TESTNET_REPUTATION_CONTRACT_ID) ?? d.contracts.reputation,
    registry: envValue(process.env.NEXT_PUBLIC_TESTNET_REGISTRY_CONTRACT_ID) ?? d.contracts.registry,
  };
  const server = new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') });
  testnet = {
    network: 'testnet',
    networkPassphrase: d.passphrase,
    rpcUrl,
    contracts,
    server,
    client: createClient({ network: 'testnet', rpcUrl, networkPassphrase: d.passphrase, contracts, server }),
  };
  return testnet;
}

/**
 * The network a `?network=` value asks a public page to read, or null for the deployment's
 * own. Only `testnet` overrides, and only on a deployment that isn't already testnet — so
 * the same `?network=testnet` link works before and after the cutover.
 */
export function readNetworkFor(param: string | string[] | null | undefined): ReadNetwork | null {
  const value = Array.isArray(param) ? param[0] : param;
  if (value?.trim().toLowerCase() !== TESTNET || config.network === TESTNET) return null;
  return testnetNetwork();
}

/** The public pages that honour `?network=` (the rest always read the deployment's). */
const OVERRIDE_PAGE = /^\/(u|score)\/[^/]+\/?$|^\/leaderboard\/?$/;

/** Is `pathname` + `?network=` a read-only override view? Such a view offers no writes,
 *  so the navbar drops its wallet button there. */
export function isReadOnlyView(pathname: string | null, param: string | null): boolean {
  return !!pathname && OVERRIDE_PAGE.test(pathname) && readNetworkFor(param) !== null;
}

/** `path` with the override query kept, for links and share URLs that must stay on it. */
export function withReadNetwork(path: string, net: ReadNetwork | null): string {
  return net ? `${path}?${NETWORK_PARAM}=${net.network}` : path;
}
