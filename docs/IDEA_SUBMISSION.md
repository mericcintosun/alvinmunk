# Idea Submission — alvinmunk

_For the Rise In Builder-Track Idea Submission stage (after Orange). The official prompt favors ideas that **resonate with Stellar Anchors** — this document states alvinmunk's concept and its concrete anchor angle._

## One-liner
**alvinmunk — collect people, not points.** A social, non-betting *proof-of-people* reputation game: you earn portable on-chain reputation through mutual/social actions (vouch, verified quests, tips), and reputation is spendable.

## The gap it fills
Web3 "reputation/quest" products are one-time-mint graveyards (Galxe/Layer3): no repeat loop, no human warmth, trivially sybil-farmed. Stellar's community unit is the **individual** (ambassador/builder/creator), whose contribution is locked in web2 silos (non-portable, non-verifiable). alvinmunk makes reputation **on-chain, human-referencing, and spendable** — and is engineered against sybil from day one (two-track Social/Earned, claim-secret vouches, first-pair-only, per-day cap, asymmetric rewards, proof-of-funding payout).

## 🪝 Anchor angle (why this resonates with Stellar Anchors)
alvinmunk touches anchors on **two** concrete surfaces — not as decoration:

1. **Reward off-ramp via SEP-24 anchors.** Earned rewards and USDC tips are spendable; a user can **cash out to local fiat through a Stellar anchor** (SEP-24 interactive deposit/withdraw). This turns "reputation you earned" into "money in your local currency", which is exactly the anchor value proposition — and gives anchors a fresh, consumer-side funnel of users who arrive already holding USDC.

2. **Anchors as the anti-sybil proof-of-funding signal.** Our payout gate (belts/08-anti-sybil) requires a wallet to have **received external value once** before it can cash out — the cheapest real uniqueness signal that isn't heavy KYC. An **anchor deposit** (the user on-ramped real money via a regulated anchor) is the ideal proof-of-funding source. So anchors don't just receive alvinmunk's users; they **harden** alvinmunk's economy.

3. **(Future) Reputation as an anchor onboarding signal.** Portable on-chain reputation (the `att_set` attestation primitive we already emit) can feed an anchor's SEP-12 KYC tiering as a *signal* (not a replacement) — a returning, well-vouched user is lower-friction to onboard.

> Scope note: SEP-24 off-ramp + SEP-12 signal are **Black-belt** integrations (real anchor partner + compliance). At Orange we ship the consumer loop and reserve the anchor config (`NEXT_PUBLIC_ANCHOR_HOME_DOMAIN`, `NEXT_PUBLIC_ANCHOR_TRANSFER_SERVER`) so the off-ramp slots in without rework.

## Status at submission
- 3 Soroban contracts (Reputation / QuestRegistry / Rewards) deployed to **testnet** and verified on-chain (cross-contract award_quest, claim-secret vouch, USDC `claim_reward`).
- Two-track anti-sybil keystone live (Social vs Earned, asymmetric, per-day cap, first-pair-only).
- Consumer dApp: passkey/dev onboarding, async claim-secret vouch loop, live leaderboard.
- 61 automated tests (31 contract incl. property/fuzz + 30 web/shared) green; serverless attester verifies real actions (merged GitHub PR / referral tx).

## Why it can win the belts
Novel on Stellar (no consumer social-reputation game exists), demoable in seconds, a viral install loop (the half-card link), a credible anchor angle for funding, and a sybil-resistant economy that survives scrutiny.
