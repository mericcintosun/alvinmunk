/**
 * The app's `@alvinmunk/sdk` client — the read-only client partners install, bound to this
 * deployment's resolved network config and RPC server. The profile, score, vouch, handle
 * and gate reads go through it, so the app and the SDK share one implementation.
 */
import { createClient, type AlvinmunkClient } from '@alvinmunk/sdk';
import { config, networkPassphrase, server } from './stellar';

let client: AlvinmunkClient | undefined;

/** Built on first use, so a module that only imports a read helper never touches the config. */
export function readClient(): AlvinmunkClient {
  client ??= createClient({
    network: config.network,
    rpcUrl: config.rpcUrl,
    networkPassphrase,
    // The app's own ids, empty ones included: an unconfigured contract stays unconfigured
    // instead of falling back to the SDK's built-in testnet deployment.
    contracts: {
      reputation: config.contracts.reputation,
      registry: config.contracts.registry,
      gate: config.contracts.gate,
    },
    server,
  });
  return client;
}
