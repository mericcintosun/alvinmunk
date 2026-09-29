# Security Policy

## Reporting a Vulnerability

We take the security of this project seriously. If you believe you have found a security vulnerability, please report it privately through GitHub's private vulnerability reporting feature:

[**Report a vulnerability**](https://github.com/mericcintosun/alvinmunk/security/advisories/new)

Please do **not** open a public issue for security problems. Public disclosure of a contract bug on mainnet can be exploited before a fix is shipped.

## Scope

### In scope

- The five smart contracts in `contracts/` (reputation, registry, quest_registry, rewards and gate), including the rewards treasury and the Earned XP logic.
- The API routes `/api/attest`, `/api/faucet` and `/api/passkey-send`.
- Attester key handling and any code that signs, stores, or transmits attester keys or session credentials.

### Out of scope

- Testnet-only faucet abuse (e.g. requesting more testnet tokens than intended).
- Issues that are already publicly disclosed or otherwise publicly known.

## Response Time

We aim to acknowledge reports within 72 hours and to provide an initial assessment within 7 days. We will keep you updated as we investigate and remediate.

## Deployed Contract Ids

The live testnet contract ids are listed in the [README](README.md#deployed-contracts-stellar-testnet) with explorer links; [`docs/DEPLOY_MAINNET.md`](docs/DEPLOY_MAINNET.md) covers the mainnet deployment, and the scripts under `scripts/` print the ids they deploy.
