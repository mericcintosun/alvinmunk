# Agent Handoff — alvinmunk / Stellar Passport

_For the next AI agent session. Read this first, then `belts/00-strategy.md` and `belts/08-anti-sybil.md`._

## 1. What this project is
**alvinmunk** (repo/package name) ships **Stellar Passport** (product name): a social, non-betting
*proof-of-people* reputation game on Stellar/Soroban, built for the Rise In "Stellar Journey to
Mastery" belt program ($20k, White→Master, Builder Track). You earn reputation through mutual/social
actions (vouch, verified quests, tips); reputation is spendable. Core viral loop = an async
**half-card vouch** link (no recipient address needed — claim-secret).

## 2. Current state (as of 2026-06-22)
- **Live:** https://alvinmunk.vercel.app (Vercel, project `mericcintosun/alvinmunk`, Root Directory = `apps/web`).
- **Sprints 0–2 done; Sprint 3 (Orange) build done + deployed.** ~30% toward Master.
- **42 tests green** (16 contract + 26 web/shared), typecheck + next build + clippy + fmt all green.
- All 3 contracts deployed to **testnet** and verified ON-CHAIN (not just unit tests).
- Quests are LIVE and secured (wallet-ownership proof + freshness + rate limit).
- **Remaining for Orange DoD (non-code):** 10 outside testers use the share flow + submit the idea on the Rise In panel.

## 3. How to work on this project (rules that matter)
1. **Read the docs before coding.** Source of truth: `belts/00-strategy.md` (strategy) and
   `belts/08-anti-sybil.md` (security keystone). Roadmap per belt: `belts/01..07`. Product: `docs/PRD.md`.
   Plan: `docs/SPRINTS.md`. Idea packet: `docs/IDEA_SUBMISSION.md`.
2. **Keep it GREEN at every step:** `cd contracts && cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --all -- --check`;
   `pnpm typecheck && pnpm test && pnpm -C apps/web build`.
3. **Verify on-chain, don't just claim.** Contract changes must be deployed to testnet and exercised
   with `stellar contract invoke` (or the live route) before saying "done". The user explicitly values this.
4. **Be honest about what's unverified.** Never fake success. If something needs infra/a device
   (e.g. real passkey/FaceID), say so; don't write code you can't verify and call it done.
5. **Two-track keystone is sacred (anti-sybil):** Social XP (vouches) is NEVER cashable; Earned XP
   (attester-verified quests) is the ONLY track Rewards reads. Don't blur this.
6. **One project, one track per month** (official rule). SCF/funding comes via reaching Master Belt,
   NOT a separate parallel project. Don't revive the "separate SCF project" idea.
7. **Commits are the user's job.** Don't `git commit`/`push` unless asked. Deploy only when asked.
8. **Persistent memory** lives at `~/.claude/projects/-Users-mericcintosun-alvinmunk/memory/` —
   read `stellar-passport-project.md` for the full decision history; update it when you make big decisions.

## 4. Architecture (where things are)
```
contracts/                Soroban (Rust), soroban-sdk 22.0.11, builds to wasm32v1-none
  reputation/             Social vs Earned XP, claim-secret vouch, per-day cap, asymmetric, attestations
  quest_registry/         allowlisted-attester quests + replay guard; cross-calls reputation.award_xp
  rewards/                USDC tip + Earned-gated claim_reward (cross-reads reputation.get_earned) + pause
apps/web/                 Next.js 14, stellar-sdk 16 (protocol 23), @stellar/freighter-api
  src/lib/wallet.ts       providers: dev (Friendbot keypair, default on testnet), freighter, passkey(stub); sign + signMessage
  src/lib/contracts.ts    invokeAndWait / readContract / args (ScVal builders)
  src/lib/reputation.ts   mintVouch (claim-secret), claimVouch, getSocial/Earned
  src/lib/leaderboard.ts  RPC social events + localStorage snapshot cache + reciprocal-ring flag
  src/lib/quests.ts       completeQuest (signs ownership, POSTs /api/attest)
  src/lib/genesis.ts      first on-chain tx (manageData); src/lib/payments.ts (Level-1 XLM send)
  src/app/api/attest/     SERVERLESS ATTESTER (the only server-side key user). Hardened.
  src/app/page.tsx        onboarding → vouch + quests + leaderboard links
  src/app/claim/[id]/     vouch claim funnel (reads ?s=secret)
  src/app/wallet/         Freighter Level-1 demo  ·  src/app/leaderboard/
packages/shared/          pure logic + types (artSeed/stampArt, rankLeaderboard, mergeSocialRecords,
                          detectReciprocalRings, EVENTS schema, config) — ALL unit-tested. Put pure logic here.
belts/ docs/              strategy, anti-sybil, 7 belt roadmaps, PRD, SPRINTS, IDEA_SUBMISSION, this file
scripts/deploy-testnet.sh · scripts/screenshots.mjs (playwright)
```
**No standing backend** (decision): the only server-side piece is the serverless `/api/attest`.
Leaderboard reads RPC directly (+ localStorage cache). Indexer deferred to Blue/Black.

## 5. Live deploy facts
- Vercel project `mericcintosun/alvinmunk`, org `team_YQ5WK4Onim7LNOVsBBq7yTF2`, projectId `prj_B3mYdNUOjRVGZCeqHv2u6dqcuIvz`.
- **Root Directory = apps/web** (set via API), **installCommand = `pnpm install --no-frozen-lockfile`** (lockfile was pnpm@10 vs packageManager 9.7.0).
- Env vars set in Vercel **production**: 8× `NEXT_PUBLIC_*` + `ATTESTER_SECRET_KEY` (testnet key, encrypted, server-only).
- Redeploy: `vercel --prod --yes` from repo root. GitHub repo connected (`github.com/mericcintosun/alvinmunk`).

## 6. Testnet contract IDs (also in apps/web/.env.local, gitignored)
- Reputation:     `CBNIZXITUVTRVW6RZGEGCI7KNF46REG4EDM4XUVHKDAV63WOHWW75SZM`
- QuestRegistry:  `CD6RZUVNQ3TV3X6MNQM25NB2YRFRGMSUGKWTMAIGJOC23C6ESHJKYNFO` (redeployed Green: weekly streak + `quest.active` enforced; old `CA4LP…AZX` de-allowlisted in Reputation)
- Rewards:        `CDABZALCZ6QAYH2DAUDC5V7UPFCZ5LZRAYVFIJNA3J2SJ5PKCKWWSHOT` (Green v3: reward registry + daily-cap circuit breaker + frozen-set gate; supersedes `CC3XB…`/`CDEO3…`. Daily cap set to 50 USDC; treasury 10 USDC)
- USDC test SAC:  `CAKT2EK2SFGNXTXVSYZLZXA5YB5QPVHLTVUMRHLJTF5RFFAFMIRNPZT2`
- CLI identities (in `stellar keys`): `passport-admin` (admin+issuer), `passport-attester` (allowlisted), `passport-alice/bob/carol/dave/eve/frank` (test users).
- If you change a contract's interface, you MUST redeploy + re-wire attesters (`reputation.add_attester(quest_id)`, `quest.add_attester(attester_pubkey)`) + update `.env.local` and Vercel env.

## 7. Security model (already shipped — don't regress)
- `/api/attest` requires: ed25519 **wallet-ownership proof** (client signs `attest:v1:{recipient}:{questId}:{type}:{ref}:{ts}`, server verifies vs recipient G-address), **±120s freshness**, **per-IP rate limit**. On-chain replay guard is the hard cap.
- Defense-in-depth: attester only grants Earned XP; USDC payout has caps/pause/proof-of-funding (Black belt).
- Before mainnet (Black): move attester key to KMS or a private worker; tighten verification; keep treasury circuit breakers. See the security discussion in the project memory.

## 8. What's next
- **Finish Orange (non-code):** get 10 outside testers through the share flow; submit idea on Rise In.
- **Sprint 4 / Green belt** (`belts/04-green-belt.md`): ship the **tip/bounty USDC rail FIRST** (retention de-risk — measure D7 of spend-receivers), then the weekly quest loop + rank-unlocks-reward; 10 testnet users; add an **anchor angle** hook (SEP-24 off-ramp, see IDEA_SUBMISSION). Mentor & market-fit checkpoint is MANDATORY before onboarding users for Blue/Black.
- Deferred backlog (honest): real passkey/FaceID (needs factory + launchtube + device); XP-stake/slash + 2nd-order voucher bonus + full ring clustering (later belts); durable indexer (Blue).

## 9. Gotchas / learnings (save yourself time)
- **Shell is zsh:** unquoted `$VAR` does NOT word-split → `--network testnet` in a var breaks the CLI. Write flags literally or use `${=VAR}`.
- **stellar CLI 25.x builds to `target/wasm32v1-none/release/`** (not wasm32-unknown-unknown).
- **stellar-sdk must be ≥16** for testnet protocol 23 — older threw `Bad union switch: 4` when decoding tx results. Poll loops swallow transient decode errors.
- **Vercel + pnpm monorepo:** set project Root Directory = apps/web (root package.json has no `next`); use `--no-frozen-lockfile` (lockfile pnpm-version mismatch). Remove unused heavy deps (we dropped `@creit.tech/stellar-wallets-kit` + `passkey-kit` — they pulled native node-gyp deps that fail on Vercel; app only uses freighter-api + stellar-sdk).
- **node -e from repo root can't resolve app deps** (pnpm, no hoist) → set `NODE_PATH="$PWD/apps/web/node_modules"`.
- **Symbol ≤ 9 chars** for `symbol_short!`; longer → `Symbol::new(&env, "...")`.
- Cross-contract args: build the Vec with `.into_val(&env)` (u64 has no `From<u64>` for Val).
- Run the app for screenshots: `scripts/screenshots.mjs` (playwright, drives the dev-wallet onboarding).
