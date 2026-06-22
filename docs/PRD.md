# Stellar Passport — Product Requirements Document (PRD)

_Owner: Nicole (PM). Source-of-truth decisions live in [`belts/00-strategy.md`](../belts/00-strategy.md) and [`belts/08-anti-sybil.md`](../belts/08-anti-sybil.md); this PRD operationalizes them._

Status: **v1 (MVP through White→Green belts)** · Last updated: 2026-06-22 — White→Green code shipped on testnet (3 contracts verified on-chain, 61 tests); Green code complete (tip rail + rank rewards + weekly streak + treasury hardening).

---

## 1. Vision & one-liner
**Collect people, not points.** Stellar Passport is a social, gamified, non-betting *proof-of-people* reputation game. You earn reputation through mutual/social actions — not solo grinding — and reputation is **spendable**. Badges name *other humans* and auto-generate a shareable card, so the product grows by people pulling in the people they name.

## 2. Problem
- Web3 "reputation/quest" products are a graveyard of one-time mints (Galxe/Layer3): no repeat-use loop, no human warmth, easily sybil-farmed.
- Stellar's community unit is the **individual** (ambassador/builder/creator), not big DAOs — yet their contribution/reputation is locked in web2 silos (e.g. Rise In XP/CP), non-portable and non-verifiable.
- New users face a wallet/seed-phrase/gas cliff that kills consumer onboarding.

## 3. Target users
- **Primary:** crypto-curious individuals in creator/builder/student communities who already gather online or IRL and want a fun, low-friction way to recognize each other.
- **Secondary (later):** communities/brands sponsoring quests; Stellar ecosystem participants needing portable reputation.
- **Anti-persona:** speculators/airdrop farmers — explicitly designed *against* (see anti-sybil).

## 4. Why Stellar
- **Passkey smart wallets** → FaceID onboarding, no seed phrase, fee-sponsored: the demo-winning first-run.
- **Sub-cent fees** → every micro-action (vouch, co-sign, tip) can be its own on-chain artifact; other chains price this out.
- **USDC SAC + anchors** → real spendable rewards and fiat cash-out where it matters.
- **Soroban** → lean account-keyed reputation (SBT semantics) + verifiable attestations.

## 5. North-star & guardrail metrics
- **North-star:** **Verified Value Loops / week** — a vouch staked & redeemed into USDC by a *different*, proof-of-funding-verified user, where the USDC was backed by real external value (anti-sybil §North-star). Raw "closed loops" is a vanity sub-metric only.
- **Acquisition:** share-link → install → activation (wallet created **AND** first stamp).
- **Retention (de-risk gate, Green):** D7 return among users who *received* a spend (tip/reward).
- **Viral:** referral/vouch viral coefficient (>0.3 target at Blue).
- **Integrity:** % loops flagged by ring/cluster detection (lower is better).

## 6. The core loop
```
mint_vouch (async half-card)  →  share link = install funnel  →  claim_vouch (both earn SOCIAL XP)
        →  verifiable quest (attester) earns EARNED XP  →  rank unlocks reward
        →  tip / claim_reward in USDC (Earned-gated, proof-of-funding on payout)
```

## 7. Two-track model (keystone — anti-sybil)
- **Social XP** (from vouches): non-cashable. Powers leaderboard, badges, rank, tipping *limits*, fun.
- **Earned XP** (from attester-verified quests only): the **only** track the Rewards contract reads to gate USDC.
- Vouches grant Social only, **first-pair-only** (repeat pairs mint the card but grant 0 XP), with daily caps. USDC payout path adds **proof-of-funding** (not KYC) at Black belt. Treasury is **demand-funded** at scale (payout ≤ realized external revenue).

## 8. Scope

### In scope (MVP, White→Green)
- Passkey onboarding + fee sponsorship; profile + Genesis Stamp.
- Async half-card vouch (mint/claim) + generative-art shareable card + claim funnel.
- Reputation contract (Social/Earned/attestations/events) + leaderboard via RPC events.
- QuestRegistry + serverless attester (auto-verifiable quests only).
- Rewards: tip + Earned-gated claim; weekly loop with a rank-unlocked reward.

### Out of scope (deferred / explicit NON-goals)
- Betting/prediction mechanics (ever).
- Decentralized oracle; heavy KYC; schema/issuer registry & partner SDK (Master).
- Standing indexer (RPC-direct until Blue/Black); multi-asset rewards (Master).
- Native token / financialized speculation.

## 9. Functional requirements (MVP)
1. **Onboarding:** create/connect a passkey smart wallet in ≤3 taps; sponsored fees; pick a handle; land on a funded testnet wallet showing a Genesis Stamp. _(White)_
2. **Vouch (async):** a user mints a half-card at another (handle/contact/address) with a one-line note; receives a shareable link/card immediately. _(Yellow)_
3. **Claim:** recipient opens link → FaceID → claims; both sides earn Social XP (first-pair-only); the card blooms. _(Yellow)_
4. **Leaderboard:** social rank by people-connected, updated from on-chain events <5s. _(Yellow)_
5. **Quests:** allowlisted attester awards Earned XP after verifying a real action (merged PR / referral tx). _(Orange)_
6. **Spend:** tip USDC wallet→wallet; claim a reward gated on Earned XP threshold. _(Green)_
7. **Weekly loop:** fresh quests drop weekly; rank unlocks a real benefit; streak/stake mechanics. _(Green)_

## 10. Non-functional requirements
- **Mobile-first**, Lighthouse mobile ≥90; reduce-motion + a11y (AA, screen-reader alt-text on generative art).
- **Security:** deny-by-default `require_auth`; checked arithmetic; replay guards; pausable on real-money paths; audit before mainnet.
- **No standing backend:** attester = serverless route; leaderboard = RPC-direct for MVP.
- **Onboarding speed:** passkey → first on-chain action < 15s (target 8s).
- **Sybil resistance:** two-track split; first-pair-only; daily caps; off-chain ring detection + `frozen` set; proof-of-funding on payout.

## 11. Success criteria (by belt)
| Belt | Done means |
| --- | --- |
| White | passkey + sponsored first tx; Genesis Stamp; art engine locked |
| Yellow | vouch mint/claim on testnet; leaderboard from events; `att_set` emitted |
| Orange | 3 contracts + attester + full tests + testnet URL; 10 outside testers share; Idea Submission |
| Green | weekly loop live 2+ weeks; D7 (spend-receivers) ≥30%; tip rail shipped first |
| Blue | 50 real outside users (<20% cohort); WAU≥25; viral coeff measured; pitch deck |
| Black | mainnet + audit; 10+ distinct mainnet signers w/ settled USDC; ecosystem partner |
| Master | multi-season retention up-trend; ≥1 signed partnership; SCF/grant in flight |

## 12. Key risks
- **Cold-start** (two-people requirement) → mitigated by async half-card vouch.
- **Sybil farming** → two-track + caps + ring detection + proof-of-funding (belts/08).
- **Retention** (mint-and-forget) → tip-rail-first D7 gate at Green; rank must *buy* something.
- **Two-audience dilution** (consumer vs infra) → stay consumer-pure; attester read-view is gravy, not a product surface.
- **Resource split** (separate SCF project) → Passport is primary; weekly increment rule (belts/00-strategy §7).
