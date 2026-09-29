# @alvinmunk/sdk
A read-only client for Alvinmunk reputation, handles, and gates.

The SDK exposes the same simulation-only read helpers that power apps/web, with no signing, no keys, and no write path.

## Install

```bashnpm install @alvinmunk/sdk
```

## Quickstart

10 lines to read a live testnet profile:

```ts
import { createClient } from '@alvinmunk/sdk';

const client = createClient({ network: 'testnet' });
const addr = '0:123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const profile = await client.getProfile(addr);
const score = await client.getScore(addr);
console.log({ profile, score });
```

## API

`createClient({ network, rpcUrl?, contracts? })
`

Built-in testnet contract ids are provided by default. Mainnet ids
are added at cutover. Pass `rpcUrl` to override the default REC endpoint,
or `contracts` to override individual contract ids.

### Methods

- `getProfile(addr)` — returns the reputation profile for an address
- `getScore(addr)` — returns the numeric reputation score
- `resolveHandle(h)` — resolves a handle to an address
- `reverseHandle(addr)` — returns the handle for an address
-
`getVouch(id)` — returns a vouch by id
- `checkGate(addr, gateId)` — evaluates gate access for an address

All methods are simulation-only and read-only.

## Development

```bashnpm run build --workspace @alvinmunk/sdk
npm run test --workspace @alvinmunk/sdk
```

The package builds EES + type declarations with `tsc`.
