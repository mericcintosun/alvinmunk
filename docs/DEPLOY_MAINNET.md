# alvinmunk — Mainnet Deployment Runbook (Black belt)

This is the step-by-step for taking the five Soroban contracts from testnet to **Stellar mainnet**, plus the app cutover. Mainnet moves real value and is not reversible — do not skip a gate.

> Status: prepared at Green. Run this when you reach Black (mainnet + audit/security review + 20+ mainnet users).

---

## Gate 1 — Pre-deployment verification (do not skip a box)

**Contract correctness**
- [x] Full test suite green: 57 contract tests (`cargo test`) incl. property/fuzz, + 77 web/shared. CI green on every push.
- [x] End-to-end integration test exists: `scripts/e2e-testnet.mjs` (deploy → invoke vouch/quest/tip/reward → assert state, happy + negative paths).
- [x] Storage/TTL: every contract bumps TTL on long-lived keys (`BUMP_THRESHOLD`/`BUMP_EXTEND`); daily counters use temporary storage that auto-GCs. Re-profile before deploy with `scripts/bump-ttl.sh`.
- [ ] Re-review every `require_auth`: `mint_vouch`(from), `claim_vouch`(claimer), `award_quest`(recipient + ed25519 sig), `tip`/`claim_reward`(from/to), all admin setters. Confirm no sensitive op is unauthenticated.
- [x] Cross-contract calls are read-only where they should be (`rewards`→`get_earned`, `gate`→`get_score/get_earned`) and write only via the allowlisted attester (`quest_registry`→`award_xp`).

**Security**
- [ ] Grep for `unwrap()` on user-controlled paths; prefer `?` + typed errors. (Storage `get().unwrap()` on admin-set instance keys is acceptable; document each.)
- [ ] Confirm no panic on malformed input (fuzz already covers the XP math and payout).
- [x] Integer math: XP uses `u64`, USDC uses `i128`; payout paths use registered amounts (caller can never set the amount). Re-check for any raw `+`/`-` that should be `checked_*`.
- [x] Admin ops gated by `Admin.require_auth()` on all five contracts.
- [x] USDC handled via the Stellar Asset Contract (SAC) `token::Client`, not a custom token.

**Security review (mandatory for Black — pick one)**
- [ ] Third-party audit, OR
- [ ] Mentor/team security review approved. Capture the reviewer, date, and sign-off in `deployment-log.md`.
- [ ] Run `/security-review` on the contracts branch and resolve findings before deploy.

**Operational**
- [ ] Admin + attester keys generated fresh for mainnet and held in a **hardware wallet**, never in CI secrets or `.env`.
- [x] Upgrade path: all five contracts expose admin-gated `upgrade(new_wasm_hash)`.
- [x] Emergency controls: `rewards.set_paused`, `set_daily_cap`, `set_frozen`, `set_require_funding` (turn proof-of-funding ON for mainnet).
- [ ] Write a 1-page deploy SOP: who can deploy, key custody, contract-id location.

---

## Gate 2 — Deployment mechanics

Verify the CLI and **the mainnet passphrase** (contains `Public Global Stellar Network`, NOT `Test`).

```bash
stellar --version   # install: brew install stellar-cli

stellar network add mainnet \
  --rpc-url https://mainnet.sorobanrpc.com \
  --network-passphrase "Public Global Stellar Network ; September 2015"

# Fund the deployer with real XLM first (a few XLM covers all five deploys).
stellar keys generate admin --network mainnet     # then fund from an exchange/wallet
stellar keys generate attester --network mainnet   # fund minimally
```

**USDC on mainnet:** do NOT issue your own. Use Circle's canonical mainnet USDC and its SAC address as `NEXT_PUBLIC_USDC_SAC_ID`. Verify the issuer `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` on stellar.expert before wiring it.

**Deploy the five contracts** with `scripts/deploy-mainnet.sh`, a dedicated script (never an edited copy of the testnet one). Before it submits anything it passes three gates, and it aborts at the first one that fails:

1. **Passphrase gate.** The `mainnet` network must resolve to `Public Global Stellar Network ; September 2015` in three places: the CLI config (`stellar network ls --long`), the CLI's actual resolution at run time (it derives the native XLM SAC id, which only matches under the mainnet passphrase; `STELLAR_RPC_URL` + `STELLAR_NETWORK_PASSPHRASE` in the environment or in a `.env` file in the repo or a parent directory override `--network`), and the passphrase the RPC server itself reports (`stellar network info`). A testnet passphrase anywhere aborts.
2. **USDC gate.** It derives Circle's SAC with `stellar contract id asset --asset USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN --network mainnet` and requires `USDC_SAC` to equal it (`CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75`).
3. **Operator gate.** After printing the plan (commit, admin, attester key, USDC SAC, daily cap in stroops and USDC, seed data, wasm hashes) it asks you to type `mainnet`. The answer is read from the terminal, not stdin, so it cannot be piped or scripted; without a terminal a real run stops here.

It also checks, before any network call: every input is present and well-formed, `ADMIN` and `ATTESTER` are identity names (never secret keys), the attester is a different key from the admin, and `contracts/` has no uncommitted changes, so the logged commit is the code that ships (a dry run only warns).

Then it:
- builds with `stellar contract build --locked` into a fresh temporary directory and records each wasm's sha256;
- for each contract in order (reputation, quest_registry, rewards, registry, gate): uploads the wasm (checking the on-chain hash equals the local sha256), deploys it, and calls `init` straight away, because `init` is open to anyone until it has run. `init` is never retried: if it fails, someone may have initialized the contract first, so never use that id;
- sets `rewards.set_daily_cap(DAILY_CAP)` and `rewards.set_require_funding(true)`;
- wires the attesters: `reputation.add_attester(quest_registry)` and `quest_registry.add_attester_key(<attester ed25519 key>)`, the key `/api/attest` signs with;
- seeds the same quests (ids 1-4), reward table (ids 1-3: 30 / 60 / 100 Earned XP pays 0.5 / 1 / 2 USDC) and gates (1, 2) as `scripts/redeploy-all.sh`;
- reads back `get_require_funding`, `get_daily_cap` and `is_attester(quest_registry)`;
- appends the commit SHA, deployer (admin) public key, attester key, USDC SAC, daily cap, CLI version, and every contract id + wasm hash to `deployment-log.md`.

It never calls friendbot or the faucet and never moves USDC. If it fails or is interrupted after creating contracts, it appends an `INCOMPLETE (failed during: <step>)` entry with the ids created so far; don't wire the app to them.

### Usage

**Dry run first.** It runs every check (reading from the RPC) and the build, prints each transaction a real run would submit, and submits nothing; `deployment-log.md` is not touched.

```bash
DRY_RUN=1 ADMIN=admin ATTESTER=attester \
  USDC_SAC=CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75 \
  DAILY_CAP=500000000 \
  ./scripts/deploy-mainnet.sh
```

**Real deployment** (same inputs, no `DRY_RUN`; type `mainnet` when asked):

```bash
ADMIN=admin ATTESTER=attester \
  USDC_SAC=CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75 \
  DAILY_CAP=500000000 \
  ./scripts/deploy-mainnet.sh
```

**Inputs** (env vars only; the script takes no arguments besides `--help`):

| Variable | Required | Meaning |
| --- | --- | --- |
| `ADMIN` | yes | `stellar keys` identity name of the funded mainnet deployer. It becomes admin of all five contracts and signs every transaction. |
| `ATTESTER` | yes | Identity name or `G...` public key of the off-chain attester (its secret goes in `ATTESTER_SECRET_KEY` on the server). Must differ from `ADMIN`. |
| `USDC_SAC` | yes | Circle's mainnet USDC SAC, `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75`. Anything else aborts at the USDC gate. |
| `DAILY_CAP` | yes | Max treasury payout per UTC day, in USDC stroops (1 USDC = `10000000`, so `500000000` = 50 USDC). Must be positive: `0` would mean no cap. Must also be at least the largest reward in the table (`20000000` = 2 USDC), because `add_reward` rejects a payout above the cap. |
| `DRY_RUN` | no | `1` for a dry run, `0` or unset for a real run. Any other value aborts. |

Needs `stellar` (with `strkey decode`), `jq` and `git`. Offline tests for the gates and the dry run: `bash scripts/deploy-mainnet.test.sh` (stubs the CLI; needs `python3`).

### After deploy

- [ ] Commit the new `deployment-log.md` entry and add the mainnet contract ids to the README.
- [ ] Set `ATTESTER_SECRET_KEY` (server-only) to the attester key the script allowlisted.
- [ ] Read a view method from each contract on mainnet RPC to confirm it responds.
- [ ] Run the e2e smoke (a single vouch + claim) against the mainnet ids with a throwaway funded account.
- [ ] Only then fund the treasury: transfer USDC to the rewards contract id by hand. With proof-of-funding on, a claim reverts with `NotFunded` until the funding verifier has called `rewards.set_funded` for the claimer.
- [ ] Open each contract on `stellar.expert/explorer/public/contract/<ID>` (links are in `deployment-log.md`) and confirm.

---

## Gate 3 — Post-deployment

**App cutover**
- [ ] In Vercel prod env, flip `NEXT_PUBLIC_STELLAR_NETWORK=mainnet`, set the mainnet RPC/Horizon, the five mainnet contract ids, and the Circle USDC SAC id.
- [ ] The dev wallet is hard-disabled on mainnet, so passkey infra must be live: set `NEXT_PUBLIC_PASSKEY_WALLET_WASM_HASH` + the relayer secrets (already configured on Vercel).
- [ ] Remove/disable the testnet faucet route on mainnet (it already refuses when network=mainnet).
- [ ] Redeploy and smoke-test onboarding + one vouch on the live mainnet app.

**Monitoring**
- [x] Product analytics + error tracking already wired (Vercel Analytics + Speed Insights + PostHog). Add PostHog alerts on error-rate spikes.
- [ ] Add contract-event monitoring (RPC `getEvents` cron, or Mercury/Subquery) alerting on: admin ops, `set_paused`, large `reward`/`tipped` amounts.
- [ ] A simple metrics page (TVL paid, users, vouch loops/week) — even a Notion/Streamlit board.

**Advanced feature (Black requires ≥1 — already satisfied)**
- [x] **Fee Sponsorship** — gasless via the OZ Channels relayer + fee-bump (`/api/passkey-send`, `lib/wallet.ts`).
- [x] **Account Abstraction** — passkey smart wallet with secp256r1 custom auth.
- [ ] Optional second: **SEP-24/SEP-31 anchor** cross-border off-ramp (issue #1).

**Ecosystem + marketing**
- [ ] X/Twitter launch thread with the mainnet contract ids + stellar.expert links (see `docs/MARKETING.md`).
- [ ] Submit alvinmunk to the Stellar ecosystem directory (stellar.org/ecosystem) and lumenloop.com.
- [ ] Ecosystem contribution: the 26 open Wave-Program issues + a technical blog (`docs/MARKETING.md`) satisfy this.
