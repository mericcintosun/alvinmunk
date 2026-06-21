# Stellar Passport — Sprint Plan

_Derived from [`PRD.md`](./PRD.md) + the belt roadmap. Sprints map 1:1 to belts. Each sprint has a **goal**, **stories** (with acceptance criteria), a **demo**, and a **definition of done**. Cadence ≈ 2 weeks/sprint; dates are the builder's to set._

> **Nicole's sequencing rules baked in:** (1) ship the **tip rail before** quests/ranks at Green to de-risk retention; (2) get **outside users** for the 50/20 gates, not the cohort; (3) only **verifiable** quests on-chain; (4) every sprint ends with a **demoable** increment.

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
4. **Genesis Stamp + Passport Cover** — deterministic generative art from the wallet address.
   - `AC` art is deterministic per address; encodes shape (not color-only) for a11y; "Save image" produces a shareable card.
5. **Design tokens + art engine locked** — reused by all later card types.
   - `AC` `artSeed`/sigil utilities in `@passport/shared`, covered by tests.

### Demo
Hand a phone to someone → Face ID → they're on-chain with a unique stamp in seconds. Show "Fees paid by app: $0.00" + a live timer.

### Definition of Done
Onboarding + first tx + Genesis Stamp working on testnet (passkey where infra is configured; dev-wallet fallback for local). Art engine + tests green. No seed phrase shown anywhere.

### Out of scope (guard)
No vouch/quest/leaderboard/contract logic. Wallet + balance + one tx + stamp only.

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

## Sprint 3 — Orange Belt: Verifiable Quests + full tests → Idea Submission
**Goal:** complete mini-dApp; attester-verified quests; full test suite; testnet URL.
### Stories
1. Deploy `quest_registry`; wire it as a Reputation attester (cross-contract award). `AC` integration test spans all 3 contracts.
2. Serverless attester: verify **merged GitHub PR** + **referral tx**; return/submit signed award. `AC` merged PR → on-chain Earned XP; self-claim rejected.
3. Replay guard + fuzz/property tests (amounts/score/overflow). `AC` CI coverage ≥80% contracts; double-claim reverts.
4. Public testnet URL + profile/quest/leaderboard/claim screens. `AC` 10 outside testers complete the share flow.
5. **Idea Submission** package (concept + competitive landscape + this PRD).
**DoD:** full suite green; testnet dApp public; submission ready.

---

## Sprint 4 — Green Belt: Retention loop (tip rail FIRST)
**Goal:** production-ready MVP; weekly loop; **retention de-risked**.
### Stories
1. **Ship the tip/bounty USDC rail FIRST**; measure D7 return of spend-receivers. `AC` D7 (receivers) ≥30% on alpha pod, or pivot the reward.
2. `Rewards.claim_reward` Earned-gated; rank→reward unlock table. `AC` rank buys a real benefit (limit/badge/payout tier).
3. Weekly quest calendar (4-week rolling) + stake/streak (decay). `AC` loop runs 2+ consecutive weeks live.
4. Production hardening: checked math, error enums, TTL keeper, observability. `AC` clippy pedantic clean; dashboards live.
**DoD:** weekly loop live 2+ weeks; retention gate measured; pitch-deck skeleton.

---

## Sprint 5 — Blue Belt: 50 outside users + Season 0
**Goal:** 50 real outside users through the loop; pitch deck + demo.
### Stories
1. **Season 0** launch (public quest + referral quest + small bounty pool). `AC` ≥50 onboarded, <20% from cohort.
2. Channel-account pool for fee sponsor (scaling cliff). `AC` 50 concurrent passkey users without sequence bottleneck.
3. Anti-abuse v1: rate-limit mint; off-chain ring/cluster detection → `frozen` set. `AC` self-vouch/rapid-mint flagged.
4. Feedback systematization (NPS + exit survey) + analytics funnel. `AC` per-step conversion dashboard.
5. Pitch deck + 2-min demo with real retention/viral numbers.
**DoD:** WAU≥25; week-over-week retention ≥25%; viral coeff measured; deck done.

---

## Sprint 6 — Black Belt: Mainnet + audit + 20 real users
**Goal:** mainnet launch with real USDC, audited; 20+ distinct mainnet signers.
### Stories
1. Mainnet deploy (multisig/timelock admin); record wasm hashes. `AC` 3 contracts live, admin multisig.
2. Security review/audit: threat model, fork/differential/invariant tests, fixes. `AC` coverage ≥90%; clean audit report.
3. Real USDC + caps + global daily cap + pausable; **proof-of-funding** on payout. `AC` real USDC bounty paid; payout gated by external-funding proof.
4. Season 1 (real USDC) converting Blue power users; Twitter presence; 1 ecosystem partner. `AC` 20+ distinct mainnet signers each w/ a settled USDC action.
**DoD:** mainnet + audit + 20 users + partner signal + Twitter active.

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
