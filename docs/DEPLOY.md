# Deploy your own (Stellar testnet)

Step-by-step for standing up a fresh alvinmunk instance on **Stellar testnet**: generate keys → deploy contracts → wire `.env.local` → run or host the web app.

For mainnet cutover, see [`DEPLOY_MAINNET.md`](./DEPLOY_MAINNET.md).

**Acceptance check:** you should be able to follow this doc alone (plus the linked files it points at) and get a working testnet instance.

---

## Prerequisites

| Tool | Why |
| --- | --- |
| **Node ≥ 20** + **pnpm 9** | Web app (`corepack enable && corepack prepare pnpm@9 --activate`) |
| **Rust via rustup** + `wasm32v1-none` | Soroban contract builds (repo pins the channel in `contracts/rust-toolchain.toml`) |
| **Stellar CLI** (`stellar`) | Keygen, deploy, invoke — `brew install stellar-cli` or `cargo install --locked stellar-cli` |

```bash
# Rust: use rustup (not a bare Homebrew rustc). From the repo root:
cd contracts && rustup show   # installs the pinned channel from rust-toolchain.toml
rustup target add wasm32v1-none
cd ..
```

If `stellar contract build` says `can't find crate for core` / `wasm32v1-none may not be installed`, your PATH is likely preferring Homebrew `cargo`/`rustc` over rustup — put the rustup toolchain bins first, or run builds from a shell where `which rustc` points at rustup.

Clone the repo and install JS deps once:

```bash
git clone https://github.com/mericcintosun/alvinmunk.git
cd alvinmunk
pnpm install
```

---

## 1. Generate funded testnet keys

You need two identities: an **admin** (deploys + initializes contracts) and an **attester** (allowlisted on-chain; its secret later powers `/api/attest` if you enable quests).

```bash
stellar keys generate --fund admin --network testnet
stellar keys generate --fund attester --network testnet

# Confirm addresses (G…)
stellar keys address admin
stellar keys address attester
```

`--fund` hits Friendbot so each account has testnet XLM for deploy fees. If Friendbot flakes, retry: `stellar keys fund admin --network testnet`.

---

## 2. Pick a testnet USDC SAC

Rewards tips/claims move USDC through a Stellar Asset Contract (SAC). On testnet you can reuse the project's issued test USDC:

```text
CAKT2EK2SFGNXTXVSYZLZXA5YB5QPVHLTVUMRHLJTF5RFFAFMIRNPZT2
```

Or wrap/issue your own SAC and pass that id instead. `USDC_SAC` is required: without a valid contract id (`C…`), `deploy-testnet.sh` exits before building or deploying anything. It also refuses any `NETWORK` other than `testnet` (the default) or `futurenet`.

---

## 3. Deploy contracts (`scripts/deploy-testnet.sh`)

This builds the Wasm, deploys **reputation**, **quest_registry**, and **rewards**, initializes them, wires attesters (quest contract + your off-chain attester address), and points rewards at quest_registry (`set_quest_registry`) so rewards can require a weekly quest streak.

A rewards contract deployed before streak-gated rewards and then upgraded in place (`upgrade`) has no quest registry set: run `set_quest_registry --quest_registry <quest_registry id>` on it once before giving any reward a streak requirement (`set_reward_min_streak` refuses until then). Its existing rewards keep working without it. The gate relies on `get_streak` reading a lapsed streak as 0, so the quest_registry must run that version too.

```bash
USDC_SAC=CAKT2EK2SFGNXTXVSYZLZXA5YB5QPVHLTVUMRHLJTF5RFFAFMIRNPZT2 \
  ADMIN=admin \
  ATTESTER=attester \
  ./scripts/deploy-testnet.sh
```

On success the script prints something like:

```text
✅ Deployed. Put these in apps/web/.env.local:

NEXT_PUBLIC_REPUTATION_CONTRACT_ID=C…
NEXT_PUBLIC_QUEST_REGISTRY_CONTRACT_ID=C…
NEXT_PUBLIC_REWARDS_CONTRACT_ID=C…
NEXT_PUBLIC_USDC_SAC_ID=CAKT2EK2…
```

Copy those four lines — you will paste them in the next step.

Each contract id is also printed (`REP_ID=…`, `QUEST_ID=…`, `REWARDS_ID=…`) as soon as its deploy returns, so if a later step fails you still have every id deployed so far. Offline tests for the pre-flight checks: `bash scripts/deploy-testnet.test.sh` (stubs the CLI).

### Optional: registry + gate (handles + reputation gates)

`deploy-testnet.sh` covers the core three contracts. Public `/u/<handle>` profiles and reputation gates need **registry** and **gate** as well. The maintainer one-shot that deploys all five (and seeds quests/rewards) is `scripts/redeploy-all.sh` — read it before running (it hard-codes an admin identity and attester pubkey). You can also deploy those two Wasm files manually the way the script does, passing the constructor's arguments after `--` (`stellar contract deploy --wasm … -- --admin <G…>` for registry, `-- --admin <G…> --reputation <reputation id>` for gate; there is no separate `init`, #127), then add:

```bash
NEXT_PUBLIC_REGISTRY_CONTRACT_ID=C…
NEXT_PUBLIC_GATE_CONTRACT_ID=C…
```

Without them: vouch / tip / basic dashboard still work against the three contracts from step 3; `@handle` resolution and gate unlocks do not. `/api/health` returns 503 until the registry id is set (the gate id only adds a warning).

---

## 4. Wire `apps/web/.env.local`

```bash
cp .env.example apps/web/.env.local
```

Paste the printed `NEXT_PUBLIC_*` contract ids from step 3 into that file. Keep the testnet defaults already in the template:

```bash
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
```

**Site URL (metadata, robots, sitemap):** `NEXT_PUBLIC_SITE_URL` is the public origin used for `metadataBase` (absolute `og:image` and canonical URLs), `/robots.txt` and `/sitemap.xml`. Leave it empty for local `pnpm dev` (`http://localhost:3000`); set it when you host outside Vercel. See step 6 for Vercel.

**Never commit `.env.local`** — it is gitignored. Full variable list: [`.env.example`](../.env.example).

### Optional server secrets (and what degrades without them)

These are **server-only**. Leave them unset for a minimal read/write demo; set them when you want the matching feature.

| Env var | How to get it | If unset |
| --- | --- | --- |
| `ATTESTER_SECRET_KEY` | `stellar keys secret attester` (must be the same identity allowlisted in step 3) | `/api/attest` returns 500. Users cannot complete attester-verified quests / earn **Earned XP**. Social vouch mint/claim still works. |
| `QUEST_GITHUB_ID` | The quest id `/api/attest` may sign for `github_pr` evidence (a merged PR). Must differ from the referral / invite / vouch-back quest ids | `/api/attest` rejects GitHub PR evidence with 422. The other quests are unaffected. |
| `USDC_ISSUER_SECRET_KEY` | Secret of the classic-asset **issuer** behind your testnet USDC SAC (TESTNET ONLY — never on mainnet) | `/api/faucet` returns 500. Users cannot mint test USDC from the in-app faucet. Tips/claims still work if wallets already hold USDC. |
| `NEXT_PUBLIC_PASSKEY_WALLET_WASM_HASH` + `PASSKEY_RELAYER_URL` + `PASSKEY_RELAYER_API_KEY` | WASM hash from [`docs/PASSKEY_HANDOFF.md`](./PASSKEY_HANDOFF.md); free relayer key via `curl https://channels.openzeppelin.com/testnet/gen` | App falls back to the **dev wallet** (ephemeral Friendbot-funded `G…` keypair). Onboarding, vouch, tip still work on testnet. Passkey / Face ID onboarding and fee-sponsored `/api/passkey-send` do not. Dev wallet is hard-disabled on mainnet. |

Minimal “it runs” config = network vars + the three contract ids + USDC SAC. Everything else is progressive enhancement.

Quick sanity check after the app is up: `GET /api/health` reports all five contract ids and `attesterConfigured` / `faucetConfigured` / `relayerConfigured` / `pushConfigured` (booleans only — never the secrets), plus `configErrors` — every inconsistency in the network settings (a passphrase, RPC or Horizon URL for the other network, a mainnet contract id left unset), each naming its env var. It returns 503 when the RPC is down or stalled, when `configErrors` has any entry, or when anything in its `missing` list is unset: the reputation, registry, quest registry and rewards ids, plus the relayer URL and key on mainnet or once `NEXT_PUBLIC_PASSKEY_WALLET_WASM_HASH` is set. An unset gate id, relayer (elsewhere) or VAPID key only adds an entry to `warnings`.

---

## 5. Run the web app locally

```bash
pnpm dev
# → http://localhost:3000 (turbo → next dev in apps/web)
```

Smoke checklist:

1. Open the app — onboarding should create/fund a testnet wallet (dev wallet if passkey unset).
2. Hit `/api/health` — expect `"ok": true`, your contract ids present and `missing` empty.
3. Mint or claim a vouch against your reputation contract (explorer link on success).
4. If you set `ATTESTER_SECRET_KEY`, run a quest verify; if you set the faucet issuer, request test USDC.

---

## 6. Deploy the web app (Vercel)

The app is a Next.js app under `apps/web` with serverless API routes (`/api/attest`, `/api/faucet`, `/api/passkey-send`, `/api/health`). There is no separate always-on backend.

1. Import the GitHub repo into [Vercel](https://vercel.com).
2. Set **Root Directory** to `apps/web`.
3. Use a monorepo-friendly install if the lockfile/pnpm version warns, e.g. `pnpm install --no-frozen-lockfile`.
4. In **Project → Settings → Environment Variables**, add every `NEXT_PUBLIC_*` you put in `.env.local`, plus any optional secrets you want live (`ATTESTER_SECRET_KEY`, `USDC_ISSUER_SECRET_KEY`, `PASSKEY_RELAYER_*`). Mark secrets as sensitive / not exposed to the client.
5. `NEXT_PUBLIC_SITE_URL` can stay unset on Vercel, forks included: production builds use the project's production domain (`VERCEL_PROJECT_PRODUCTION_URL`, a custom domain if one is assigned) and preview deployments their own host (`VERCEL_URL`), so a preview's link cards point at the preview. Set it only to pin a different canonical host, and then scope it to the **Production** environment — set for Preview too, it would send previews' `og:image` back to production.
6. Deploy (Git push or `vercel --prod` from a linked project).

Confirm: open `https://<your-deploy>/api/health` and walk through onboarding on the production URL.

### Ops scripts read the same ids

`scripts/status.mjs`, `scripts/bump-ttl.sh`, `scripts/e2e-testnet.mjs` and `scripts/freeze-rings.mjs` have no built-in contract ids. They get the network, RPC/Horizon URLs and ids from [`scripts/lib/env.mjs`](../scripts/lib/env.mjs), which takes each value from the first of:

1. the environment (the same `NEXT_PUBLIC_*` names as `.env.local`);
2. `apps/web/.env.local`, when its `NEXT_PUBLIC_STELLAR_NETWORK` is the network the script runs on;
3. [`deployments/testnet.json`](../deployments/testnet.json), the committed live testnet deployment (the README table). `scripts/redeploy-all.sh` rewrites it.

A missing or malformed id stops the script with exit code 2 and names the variable, before any network call. `bump-ttl.sh` also accepts `REPUTATION`, `QUEST` and `REWARDS`, but only all three together. `node scripts/lib/env.mjs` prints the resolved values as `NEXT_PUBLIC_*=…` lines. Offline tests: `node --test scripts/lib/env.test.mjs scripts/status.test.mjs` and `bash scripts/bump-ttl.test.sh`.

---

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `deploy-testnet.sh` fails on build | Missing Rust/`stellar` CLI, or wrong Wasm target — CLI 25+ writes to `contracts/target/wasm32v1-none/release/` |
| A deploy or `add_attester` fails | Admin not funded, or identity name mismatch (`ADMIN=` / `ATTESTER=` must match `stellar keys` names) |
| Health returns 503 | RPC unreachable or stalled (`rpc`), an inconsistent network config (`configErrors`), or a variable named in `missing` is unset |
| Quest verify 500 | Missing `ATTESTER_SECRET_KEY`, or secret is not the allowlisted attester |
| Faucet 500 | Missing `USDC_ISSUER_SECRET_KEY` or wrong SAC id |
| Passkey onboarding errors | WASM hash set but relayer URL/key missing — either set both, or unset the WASM hash to use the dev wallet |

---

## Related docs

- [`.env.example`](../.env.example) — full env template
- [`scripts/deploy-testnet.sh`](../scripts/deploy-testnet.sh) — contract deploy + wire
- [`docs/PASSKEY_HANDOFF.md`](./PASSKEY_HANDOFF.md) — passkey / relayer details
- [`docs/DEPLOY_MAINNET.md`](./DEPLOY_MAINNET.md) — mainnet gates (Black belt)
