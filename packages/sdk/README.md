# @alvinmunk/sdk

A read-only client for alvinmunk reputation, `@handles` and gates on Stellar.

Every method simulates a Soroban contract view over RPC: nothing is signed, paid or
submitted, and no key is needed. It is a read-only adapter, never a second write path. The
alvinmunk web app reads through this same client.

## Install

```bash
npm install @alvinmunk/sdk
```

ESM only, Node 20+ or any modern bundler. The one runtime dependency is
`@stellar/stellar-sdk`.

## Quickstart

Read a live testnet profile:

```ts
import { createClient } from '@alvinmunk/sdk';

const client = createClient({ network: 'testnet' });
const address = 'GC7K66B2IL3KWQC25EVY3BQI3SVCRWIJLWZ3R5LBBWAL2ZXW4CELFFGU';

const profile = await client.getProfile(address); // { social, earned, verified }
const handle = await client.reverseHandle(address); // '@handle' or null
const passesGate1 = await client.checkGate(address, 1);
console.log({ handle, profile, passesGate1 });
```

## API

### `createClient({ network, rpcUrl?, networkPassphrase?, contracts?, server? })`

- `network`: `'testnet'` or `'mainnet'`.
- `rpcUrl`: Soroban RPC endpoint. Defaults to `https://soroban-testnet.stellar.org` on
  testnet. Mainnet has no built-in endpoint, so pass one there.
- `networkPassphrase`: override the network passphrase (e.g. a local network).
- `contracts`: override any of `{ reputation, registry, gate }`. The testnet ids are built in;
  mainnet ids are added at cutover. An empty string marks a contract as not deployed, and
  reads against it reject.
- `server`: an existing `rpc.Server` (or anything with `simulateTransaction`) to reuse.

### Methods

Each method resolves the view's value or rejects with the RPC or contract error. Nothing is
retried or cached.

| Method | Contract view | Resolves |
| --- | --- | --- |
| `getProfile(address)` | reputation `get_profile` | `{ social, earned, verified }` |
| `getScore(address)` | reputation `get_profile` | `{ social, earned }` |
| `resolveHandle(handle)` | registry `resolve` | holder address, or `null` |
| `reverseHandle(address)` | registry `reverse` | handle, or `null` |
| `getVouch(id)` | reputation `get_vouch` | the vouch card, or `null` |
| `checkGate(address, gateId)` | gate `check` | `true` when `address` passes the gate |

Social XP comes from vouches and is never cashable. Earned XP comes from verified quests and
is the only USDC-eligible track. On a reputation contract deployed before `get_profile`,
`getProfile` and `getScore` read `get_score`, `get_earned` and `is_verified` instead.

The package also exports its building blocks: `simulateRead` (simulate any view), the `args`
ScVal builders, `decodeProfile`, `decodeVouch`, `isMissingFunction` and the `NETWORKS`
defaults.

## Development

```bash
pnpm --filter @alvinmunk/sdk build      # ESM + .d.ts into dist/
pnpm --filter @alvinmunk/sdk test       # unit tests against a stubbed RPC
pnpm --filter @alvinmunk/sdk typecheck
```

Inside the monorepo the package resolves to its TypeScript source; `pnpm publish` switches
`main`, `types` and `exports` to the built `dist/` (see `publishConfig`) and builds first.
