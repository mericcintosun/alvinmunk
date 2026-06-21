# 🛡️ Anti-Sybil & Abuse — Decisions (source of truth)

The **definitive decisions** coming out of the red-team + Tyler (defense) + Justin (economics) round. The integrity of async-vouch and the unfakeability of the north-star depend on this. In case of conflict, this document + [00-strategy](./00-strategy.md) prevail.

## Threat (red-team summary)
Free vouch + sponsored gas + frictionless passkey wallet = **~1,000 fake accounts per hour, and tens of thousands of "closed loops" at zero marginal cost.** The single most lethal feature: **in a free, self-initiable vouch, both sides earn XP + that XP converts to USDC.** "Just add stake" doesn't stop the attack (the attacker owns both sides and recycles the stake back).

---

## KEYSTONE DECISION — Separate money from fun (two-track)

> **Social XP (NOT cashable):** earned from vouch/social actions. Leaderboard, badges, rank, a tipping *limit*, fun. **NEVER touches the treasury directly.**
>
> **Earned XP (USDC eligibility):** **only from attester-verified quests** (cryptographically/API-verifiable actions). The rewards contract reads **only Earned XP.**

This severs all economic motivation for sybils: farming vouches earns **clout**, not **cash**. The fun is preserved (the social layer stays frictionless), the treasury is safe.

---

## Decisions (belt-realistic)

### 1. Vouch mechanics — keep the "free" feel but stop spray/ring
- **NO XLM/USDC fee** (it kills the fun). Instead, **XP-stake:** a vouch escrows a small amount of Social XP from the voucher; refunded if claimed within 7 days, otherwise **slashed**. Give every new wallet **starter Social XP** (so the first vouch feels free).
- **Asymmetric reward:** the claimer gets XP on claim; the **voucher bonus only unlocks once the claimer later performs a *verified* action** (a second-degree gate). This breaks pure-ring auto-confirm.
- **first-pair-only:** the same (from→to) pair produces XP **only the first time**; repeats give 0 XP (the card still mints, the fun continues, but the pump stops). → kills the self-collusion back-and-forth pump. **[on-chain, cheap — present in MVP]**
- **Daily cap:** max N vouches/day per account. **[on-chain]**

### 2. Hardening the treasury (USDC) path
- **Only Earned XP (attester-signed quest) opens the treasury** — not vouches. (Keystone)
- **Proof-of-funding (NOT KYC):** to be able to `claim_reward`/cash-out, a wallet must have **received external value at least once** (e.g. ≥ $1 USDC from an external anchor / funded account). The cheapest real uniqueness signal. **[Black belt]**
- Per-reward replay guard + **per-claim cap + global daily cap + pause/circuit-breaker**. **[partially in the contract; complete at Black]**
- **Off-chain indexer ring/cluster detection** (A→B→C→A, dense bidirectional clusters, common-funding source) → a **`frozen` set** that the contract checks before reward. **[Blue/Black]**

### 3. Proof-of-uniqueness
- Passkey = **anti-bot**, not anti-sybil (one device produces many keys). Enforce uniqueness only on the **payout path** (proof-of-funding above), not on the social layer.

### 4. Funding model — make the payout side genuinely scarce (Justin)
- The sponsored pool is only for belt/demo, **capped + rate-limited**.
- At scale: **demand-funded** — brand/sponsor quests, redemption/fee revenue. **payout ≤ realized external revenue.** Every cashable dollar is backed by a paying counterparty → not a faucet; sybils race against real economic gravity.

---

## North-star — an unfakeable new definition

The old "weekly closed loop" is **open to free fabrication** — demoted to a vanity sub-metric.

> **Verified Value Loops / week** = the number of loops where (i) the redeeming counterparty has passed **proof-of-funding/uniqueness** **AND** (ii) the USDC is backed by **real external value** (sponsor/fee revenue).

**One-sentence economic verdict (Justin):** *Let cashable USDC be redeemable only against real external revenue — what kills sybils is not detection, but scarcity on the payout side.*

---

## Distribution across belts (summary)
- **Yellow/Orange (MVP):** two-track split (Social vs Earned), rewards read only Earned, first-pair-only, daily cap, XP-stake + asymmetric.
- **Green:** tip-rail-first retention measurement on the Social layer (no money at risk), Earned path via attester.
- **Blue:** off-chain ring/cluster detection + `frozen` set; metric = Verified Value Loops.
- **Black:** proof-of-funding payout gate, demand-funded treasury, per-claim/global cap, pause, audit.
