# Contributing to alvinmunk

Thanks for your interest in contributing! alvinmunk is a social proof-of-people reputation game on Stellar/Soroban.

## Quick Start

```bash
# Prerequisites: Node ≥20, pnpm 9, Rust stable + wasm32 target, Stellar CLI
pnpm install                          # install JS deps
pnpm contracts:build                  # build Soroban contracts (wasm32)
pnpm contracts:test                   # run Rust contract tests
pnpm typecheck && pnpm test           # TS typecheck + vitest
pnpm dev                              # start dev server (turbo → next dev)
```

## Project Structure

```
alvinmunk/
├── apps/web/          # Next.js 14 frontend
├── packages/shared/   # Shared TS types & utilities
├── contracts/         # Soroban Rust contracts (reputation, quest_registry, rewards, registry, gate)
├── belts/             # Strategy & belt roadmaps
├── docs/              # PRD, sprints, product docs
└── scripts/           # Deploy & utility scripts
```

## Development Workflow

1. **Branch**: `feat/`, `fix/`, `chore/` prefixed branches off `main`
2. **Commits**: Conventional commits preferred (`feat:`, `fix:`, `test:`, `docs:`, `chore:`)
3. **Code style**: Prettier (JS/TS) + `cargo fmt` + `cargo clippy -D warnings` (Rust)
4. **Testing**: All tests must pass before PR — `pnpm contracts:test && pnpm test && pnpm typecheck`

## Pull Request Process

1. Open a PR against `main` with a clear description
2. Reference related issues and belt/sprint context
3. Ensure CI passes (contract tests + web typecheck/lint/test)
4. Add screenshots for UI changes
5. Update docs and README if needed

## The e2e job needs a contract set of its own

The `web-e2e` job runs a smoke test that **writes** on-chain (wallet, genesis tx, handle claim,
vouch). It runs against a dedicated CI contract set published as repository variables
(`CI_REPUTATION_CONTRACT_ID`, `CI_QUEST_REGISTRY_CONTRACT_ID`, `CI_REWARDS_CONTRACT_ID`,
`CI_REGISTRY_CONTRACT_ID`, optionally `CI_GATE_CONTRACT_ID` / `CI_USDC_SAC_ID`) — never the
contracts in the README table, whose wallets `/api/stats` counts as users. A missing variable
fails the job on purpose. Deploy/rotate the set and publish the ids with
`./scripts/deploy-ci-contracts.sh` — see [docs/CI_CONTRACTS.md](./docs/CI_CONTRACTS.md).

## Scripts

`node --test scripts/*.test.mjs` runs the offline tests for the deploy/guard scripts
(`node:test`, no network) — the same command CI runs.

## Contract Development

- Run `cd contracts && cargo test` for contract tests
- Run `cd contracts && cargo clippy -D warnings` before committing
- Contract addresses on testnet are in `apps/web/.env.local`
- Use `scripts/deploy-testnet.sh` for fresh deploys

## Questions?

Open an issue or refer to `belts/00-strategy.md` for architectural context.

