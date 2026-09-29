# CI contract set (runbook)

CI must never write to the contracts the README publishes. This is the one-time setup for the
dedicated set the e2e job uses, and what to do when it needs replacing.

## Why a second set

`apps/web/e2e/smoke.spec.ts` is not a read-only smoke test — on every run it:

1. creates a fresh Friendbot wallet,
2. writes a genesis tx and claims a unique `e2e…` handle on the **registry**,
3. mints a vouch on the **reputation** contract (nobody claims it, so its stake is slashed later).

While `.github/workflows/ci.yml` fell back to the published testnet ids
(`vars.NEXT_PUBLIC_REPUTATION_CONTRACT_ID || 'C…'`), that happened against production on every
push to every branch and every PR, and up to three times per job (`retries: 2` in
`apps/web/playwright.config.ts`). Consequences:

- `/api/stats` counts every address it sees in recent registry/reputation events, so the public
  "unique wallets" number — cited as traction in the README and measured against the belt target
  in `apps/web/src/app/api/stats/route.ts` — included CI bots.
- `scripts/scan-roster.mjs` would fold those wallets into `apps/web/src/data/onboarded-wallets.json`
  **permanently** (the roster is the durable floor of the counter).
- `e2e…` handles and never-claimed vouches lingered in people search and the activity feed.

So CI gets its own disposable contract set, and the published set is only ever written by humans.

## One-time setup (maintainer)

### 1. Deploy the CI set

From a machine with the `stellar` CLI, using a **throwaway** testnet identity — not the one behind
the README table (CI writes to whatever it deploys):

```bash
stellar keys generate --fund ci-contracts --network testnet
ADMIN=ci-contracts ./scripts/deploy-ci-contracts.sh
```

The script builds, deploys and wires all five contracts, then prints the ids plus a block of
`gh variable set …` commands. `USDC=<testnet USDC SAC id>` and `ATTKEY=<hex ed25519 pubkey>` are
optional; without them `rewards` / `quest_registry` stay partially unconfigured, which the smoke
test does not need.

### 2. Publish the ids as repository variables

From a clone of the upstream repo with admin rights (variables, not secrets — ids are public):

```bash
gh variable set CI_REPUTATION_CONTRACT_ID      --body 'C…'
gh variable set CI_QUEST_REGISTRY_CONTRACT_ID --body 'C…'
gh variable set CI_REWARDS_CONTRACT_ID        --body 'C…'
gh variable set CI_REGISTRY_CONTRACT_ID       --body 'C…'
gh variable set CI_GATE_CONTRACT_ID           --body 'C…'
gh variable set CI_USDC_SAC_ID                --body 'C…'   # optional

gh variable list
```

Or in the UI: **Settings → Secrets and variables → Actions → Variables**.

The first four are **required**: the `web-e2e` job fails immediately if any is unset, rather than
falling back to the published contracts. `CI_GATE_CONTRACT_ID` and `CI_USDC_SAC_ID` are optional
(nothing in the smoke test invokes them) but are checked for shape when present.

### 3. Verify locally before you trust it

```bash
CI_REPUTATION_CONTRACT_ID=C… CI_QUEST_REGISTRY_CONTRACT_ID=C… \
CI_REWARDS_CONTRACT_ID=C… CI_REGISTRY_CONTRACT_ID=C… \
node scripts/check-ci-contracts.mjs

CI=true pnpm --dir apps/web e2e:smoke   # the real thing, against the same ids
```

## What the guard checks

`scripts/check-ci-contracts.mjs` runs as the first step of the `web-e2e` job, right after checkout
and before `pnpm install`, so a misconfigured job fails in seconds instead of timing out 5 minutes
into Playwright. It is dependency-free (`node` only) and exits non-zero unless all three hold:

1. **Set** — every required `CI_*` variable has a value.
2. **Well-formed** — each id is a real strkey contract id: `C` + 55 base32 characters, decodes to
   32 bytes, correct strkey version byte, and a valid CRC-16 checksum. A typo fails here.
3. **Not the published set** — no id appears in the README's contract table. The denylist is
   parsed from `README.md` at run time, so a future re-deploy that updates the table is covered
   automatically, and CI cannot be re-pointed at production by copying a production id into a
   `CI_*` variable.

Tests: `node --test scripts/check-ci-contracts.test.mjs` (run in CI by the `scripts` job; the suite
also asserts `ci.yml` contains no contract id and no `|| fallback` on one, so this cannot silently
regress).

## Rotating the set

The CI set is disposable — nothing depends on its state, so redeploy whenever you like:

```bash
ADMIN=ci-contracts ./scripts/deploy-ci-contracts.sh   # prints the new gh variable commands
gh variable set CI_REPUTATION_CONTRACT_ID --body 'C…' # …and the rest
```

Old ids keep serving old CI artifacts; no data needs migrating, and no wallet in the published
registry is affected.

## Cleaning up the damage this caused

The bots that ran before the split are already in the live event streams (and possibly in the
committed roster). To drop them from the counter, refresh the roster with the bot wallets removed
and commit the result:

```bash
node scripts/scan-roster.mjs        # rewrites apps/web/src/data/onboarded-wallets.json
```

They are recognizable as Friendbot wallets with an `e2e…` handle claim. Note the live scan in
`/api/stats` still sees them until the events age out of the RPC retention window (~7 days).
