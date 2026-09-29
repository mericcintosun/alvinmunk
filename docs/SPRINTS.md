# alvinmunk — Sprint Plan

_Derived from [`PRD.md`](./PRD.md) + the belt roadmap. Sprints map 1:1 to belts. Each sprint has a **goal**, **stories** (with acceptance criteria), a **demo**, and a **definition of done**. Cadence ≈ 2 weeks/sprint; dates are the builder's to set._

> **Nicole's sequencing rules baked in:** (1) ship the **tip rail before** quests/ranks at Green to de-risk retention; (2) get **outside users** for the 50/20 gates, not the cohort; (3) only **verifiable** quests on-chain; (4) every sprint ends with a **demoable** increment.

> ### ⚠️ Official program rules (verified from Rise In, corrects earlier assumptions)
> - **One track, one project per month** — can't run Builder + Startup (or two projects) simultaneously. → **Single focus: alvinmunk on Builder Track.** SCF/InstaAward come via **Master Belt (L7 = Startup track)**, not a parallel project.
> - **Belt-chain must stay unbroken**; reward = highest *valid* belt that month; **can't resubmit the same version** (needs meaningful new commits).
> - **White (L1) rubric is literal:** Freighter connect/disconnect, balance display, **send an XLM payment** on testnet (success/fail + hash), public repo + README **with screenshots**. → shipped at `/wallet` (Freighter) in addition to the passkey alvinmunk flow.
> - **Green (L4): Production MVP + 10 users (testnet).** **Black (L6): Mainnet + Audit + 10+ mainnet users** (not 20) + Demo-Day ready.
> - **Mentor & Market-Fit checkpoint is MANDATORY before onboarding users for L5/L6** — users onboarded without it **don't count**.
> - **Idea Submission (post-Orange)** favors ideas that **resonate with Stellar Anchors** → add an anchor angle by Orange.

Legend: `AC` = acceptance criterion.

---

## Sprint 0 — Foundation ✅ (done)
**Goal:** green monorepo, contracts compile + test, web builds.
- ✅ pnpm+turbo monorepo; `contracts/` (reputation/quest_registry/rewards) compile to wasm.
- ✅ `cargo test` 6/6, clippy `-D warnings` clean, fmt clean.
- ✅ web `typecheck` + `next build` green; serverless attester route scaffold.
- ✅ Anti-sybil two-track model implemented (Social vs Earned, first-pair-only, Rewards reads Earned).
**DoD:** `pnpm build` + `pnpm contracts:test` green from clean clone.

---

## Sprint 1 — White Belt: Onboarding & Genesis (CURRENT)
**Goal:** A stranger goes from nothing → passkey wallet → first on-chain action → a unique Genesis Stamp, in under ~15s, fees sponsored.

### Stories
1. **Wallet layer** — passkey smart wallet (prod) + dev-keypair fallback (local/test).
   - `AC` `getWallet()` returns `{ address, sign }`; passkey path used when configured, dev path otherwise (clearly labeled, never in prod).
2. **Onboarding flow** — ≤3 taps: Face ID → handle → funded testnet wallet.
   - `AC` new user lands on a funded testnet account with balance shown; skeleton shimmer, never a blank balance.
   - `AC` profile (handle, address, art seed) persisted locally.
3. **First on-chain tx** — sponsored.
   - `AC` user triggers one signed on-chain tx; tx hash + explorer link shown; end-user holds 0 XLM (fees sponsored) OR friendbot-funded on testnet.
4. **Genesis Stamp + alvinmunk Cover** — deterministic generative art from the wallet address.
   - `AC` art is deterministic per address; encodes shape (not color-only) for a11y; "Save image" produces a shareable card.
5. **Design tokens + art engine locked** — reused by all later card types.
   - `AC` `artSeed`/sigil utilities in `@passport/shared`, covered by tests.

### Demo
Hand a phone to someone → Face ID → they're on-chain with a unique stamp in seconds. Show "Fees paid by app: $0.00" + a live timer.

### Definition of Done
Onboarding + first tx + Genesis Stamp working on testnet (passkey where infra is configured; dev-wallet fallback for local). Art engine + tests green. No seed phrase shown anywhere.

### Rubric compliance (added)
The official Level-1 checklist wants **Freighter** connect/disconnect + a plain **XLM payment** (success/fail + hash). Shipped at **`/wallet`** (Freighter provider in `lib/wallet.ts` + `lib/payments.ts`) alongside the passkey alvinmunk onboarding, so the submission satisfies the checklist literally. **TODO before review:** add screenshots (wallet connected, balance, successful tx) to the repo README.

---

## Sprint 2 — Yellow Belt: The Vouch Loop ✅ (testnet)
**Goal:** async half-card vouch mint→claim on testnet; live leaderboard from events.
### Stories
1. ✅ Deploy `reputation` to testnet; typed client (`lib/reputation.ts`, ScVal + invoke-and-wait) — _used a lean typed wrapper instead of generated bindings; bindings remain an option._ `AC` met: id in `.env.local` (`CAEOUYJ4…EVP`).
2. ✅ `mint_vouch` from UI (`VouchCompose`) → shareable half-card link (`buildClaimUrl`).
3. ✅ `claim_vouch` wired (`/claim/[id]`) → both earn **Social XP only**; first-pair-only enforced. _Verified on-chain: social 10/10, earned 0/0._
4. ✅ Leaderboard (`/leaderboard`) folds `social` events RPC-direct (`lib/leaderboard.ts` + pure `rankLeaderboard`), polled every 5s.
5. ✅ Event schema **frozen** in `@passport/shared` (`EVENTS`, incl. `social`); `att_set` emitted on the Earned path only.
**DoD:** ✅ two testnet wallets completed async mint→claim; events emitted + read; 21 tests + typecheck + build green.
**Remaining for later:** handle→address resolution (currently address-based); real passkey/FaceID + sponsored fees (White-belt infra); second-device live demo.

---

## Sprint 3 — Orange Belt: Verifiable Quests + full tests → Idea Submission  🟡 (mostly done)
**Goal:** complete mini-dApp; attester-verified quests; full test suite; testnet URL.
### Stories
1. ✅ Deploy `quest_registry` + `rewards`; wire QuestRegistry as a Reputation attester (cross-contract). `AC` met: integration tests span all 3 contracts; **verified on-chain** (award_quest→earned, claim_reward→USDC paid).
2. ✅ Serverless attester: verifies **merged GitHub PR** + **referral tx**, then signs+submits `award_quest`. `AC` met: e2e tested — `referral_tx` → on-chain Earned XP (dave +30); bad evidence rejected (422).
3. ✅ Replay guard + cross-contract + keystone tests (31 contract tests incl. property/fuzz). `AC` met: double-claim/replay/non-attester/below-threshold all revert; Social XP can't open the treasury.
4. 🟡 Public testnet URL + screens (profile/quest/leaderboard/claim). Screens built; **deploy to Vercel + recruit 10 outside testers** outstanding.
5. ✅ **Idea Submission** package with anchor angle → [`IDEA_SUBMISSION.md`](./IDEA_SUBMISSION.md).
**Pre-Sprint-3 risk fixes also shipped:** claim-secret vouch (cold-start keystone now truly works), daily cap + asymmetric reward, leaderboard snapshot cache + reciprocal-ring flag, stellar-sdk → 16 (protocol-23 fix).
**Deployed (testnet):** Reputation `CBNIZ…SZM` · QuestRegistry `CD6RZ…YNFO` (Green redeploy: weekly streak) · Rewards `CBUKGI…ADOU` (Green v4: reward registry + daily-cap + frozen gate + proof-of-funding toggle) · USDC SAC `CAKT2…PZT2`.
**Remaining for Orange DoD:** public URL + 10 outside testers; optional fuzz/property tests.

---

## Sprint 4 — Green Belt: Retention loop (tip rail FIRST)  🟡 (code complete)
**Goal:** production-ready MVP; weekly loop; **retention de-risked**.
### Stories
1. ✅ **Tip/bounty USDC rail shipped FIRST** — `lib/rewards.ts` (tip + trustline `enableUsdc`), serverless `/api/faucet` (test USDC), `Tip.tsx`. Verified on-chain (trustline→faucet→tip). **Remaining (human/time):** measure D7 (receivers) ≥30% on alpha pod, or pivot the reward.
2. ✅ `Rewards.claim_reward` Earned-gated + **on-chain rank→reward unlock table** (`add_reward`/`get_rewards`, caller can't set the amount — fixes a treasury-drain). `Rewards.tsx` shows the table. Verified on-chain. `AC` met: rank buys a real USDC payout.
3. ✅ **Weekly streak** (consecutive-week run + all-time best, resets on a gap) in `quest_registry` (`get_streak`/`get_week`) + 🔥 UI badge. Verified on-chain. _Stake/slash STUBBED (green-belt "stub complexity") — needs a reputation escrow API; deferred._ **Remaining (time):** run the loop 2+ consecutive weeks live.
4. ✅ Production hardening: checked math + `#[contracterror]` enums, **TTL keeper** (`scripts/bump-ttl.sh`), **treasury circuit breaker** (daily cap + frozen-set gate + proof-of-funding toggle), **property/fuzz tests** (proptest), structured route logs + `/api/health` + `scripts/status.mjs`, off-chain ring detector (`scripts/freeze-rings.mjs`). clippy `-D warnings` clean. _Full metrics dashboard = infra._
**DoD:** code complete + verified on-chain; **open: weekly loop live 2+ weeks + measured D7** (needs real users).

---

## Sprint 5 — Blue Belt: 50 outside users + Season 0
**Goal:** 50 real outside users through the loop; pitch deck + demo.
### Stories
1. **Season 0** launch (public quest + referral quest + small bounty pool). `AC` ≥50 onboarded, <20% from cohort.
2. Channel-account pool for fee sponsor (scaling cliff). `AC` 50 concurrent passkey users without sequence bottleneck.
3. ✅ (code) Anti-abuse v1: **mint rate-limit** (on-chain `MAX_VOUCH_PER_DAY=20`, from Yellow) + **off-chain reciprocal-ring detection → `frozen` set** (`scripts/freeze-rings.mjs` reads events → `detectReciprocalRings` → `Rewards.set_frozen`; frozen blocks claim+tip). Verified on-chain end-to-end (manufactured ring → both frozen). _Full cluster detection (A→B→C→A) later._ `AC` met for reciprocal pairs.
4. Feedback systematization (NPS + exit survey) + analytics funnel. `AC` per-step conversion dashboard.
5. Pitch deck + 2-min demo with real retention/viral numbers.
**DoD:** WAU≥25; week-over-week retention ≥25%; viral coeff measured; deck done.

---

## Sprint 6 — Black Belt: Mainnet + audit + 10 real users
**Goal:** mainnet launch with real USDC, audited; 10+ distinct mainnet signers.
### Stories
1. Mainnet deploy (multisig/timelock admin); record wasm hashes. `AC` 3 contracts live, admin multisig.
2. Security review/audit: threat model, fork/differential/invariant tests, fixes. `AC` coverage ≥90%; clean audit report.
3. Real USDC + caps + global daily cap + pausable; **proof-of-funding** on payout. `AC` real USDC bounty paid; payout gated by external-funding proof.
4. Season 1 (real USDC) converting Blue power users; Twitter presence; 1 ecosystem partner. `AC` 10+ distinct mainnet signers each w/ a settled USDC action.
**DoD:** mainnet + audit + 10 users + partner signal + Twitter active.

---

## Sprint 7 — Master Belt: Scale & ecosystem
**Goal:** scaling path, ≥1 partnership, investor/SCF visibility.
### Stories
1. Reputation-as-primitive read API (`get_attestation`/`get_score`) + minimal docs; partner reads it. `AC` external partner reads reputation in one call.
2. Off-chain decentralization path (m-of-n attesters) — design + optional pilot.
3. Data story (retention curves, viral coeff, USDC volume) → SCF/InstaAward submission.
4. Governance/multisig + bug bounty + recurring audit.
**DoD:** multi-season up-trend; ≥1 signed partnership; SCF/grant in flight.

---

### Cross-sprint backlog (anti-sybil, belts/08)
- XP-stake on vouch (escrow + slash on no-claim) — Yellow/Green.
- Daily vouch cap (on-chain counter) — Yellow.
- Asymmetric reward (voucher bonus on claimer's 2nd-order verified action) — Green.
- Ring/cluster detection + `frozen` set — Blue.
- Proof-of-funding payout gate + demand-funded treasury — Black.
