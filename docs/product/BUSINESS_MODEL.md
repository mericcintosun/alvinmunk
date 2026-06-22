# Business Model

_How Stellar Passport sustains itself without becoming a faucet for sybils. The economics
are the anti-sybil model (belts/08) read as a business: **every cashable dollar is backed
by real external value.** Honest stage note: today = testnet, zero revenue; this is the
path, not a claim._

---

## 1. The core economic rule

> **Payout ≤ realized external revenue.** The treasury never pays out more than real
> money has entered it. This is what makes the economy un-farmable: sybils race against
> economic gravity, not a detection cat-and-mouse.

Two-track model as economics:
- **Social XP** (vouches) — clout, leaderboard, rank. **Never touches the treasury.** Free
  to mint, infinitely abundant, zero cash liability. This is the *growth/engagement* layer.
- **Earned XP** (attester-verified quests only) — the **only** track that can unlock USDC,
  and even then bounded by per-reward amount + a global daily cap + (on mainnet) a
  proof-of-funding gate. This is the *money* layer, deliberately scarce.

## 2. Who pays, and for what (revenue streams)

Ordered by how soon they're realistic.

1. **Sponsored quest / bounty pools (primary).** A community, brand, or protocol funds a
   pool to reward verified actions (referrals, merged PRs, event attendance, on-chain
   tasks). Passport takes a **platform fee** (e.g. 5–10%) on funded pools. The sponsor gets
   sybil-resistant distribution; Passport's payout is fully pre-funded → no faucet risk.
   *This is the wedge revenue: cohort leaders/sponsors already want exactly this.*
2. **Tipping rail fee.** USDC tips wallet→wallet (already built) can carry a thin fee or a
   "boost" upsell. Small per-unit, but it's real value movement and it's on by design.
3. **Anchor off-ramp partnership (Black-belt).** When earned USDC is cashed out via a
   Stellar **SEP-24 anchor**, Passport can earn a referral/rev-share, and the anchor gains a
   consumer funnel that already holds USDC. Anchors also *harden* the economy (anchor
   deposits are the cheapest real proof-of-funding signal).
4. **Reputation-as-a-primitive (later / Master).** The `att_set` attestation + `get_score`/
   `get_attestation` read views can be consumed by other apps (gating, allowlists, KYC
   tiering signals). Monetize via a read API / partner tier once there's a reputation graph
   worth reading. (Kept architecturally free from day one — never a second write path.)
5. **Non-dilutive: SCF grant + InstaAward.** Reaching Master belt opens the Stellar
   Community Fund. This funds runway while the above streams mature — it is *fuel*, not a
   business model.

## 3. What we will NOT do

- **No native token / financialized speculation.** It would invert the brand (recognition,
  not grinding) and attract exactly the airdrop-farmers we design against.
- **No selling user data.** The graph is on-chain and public by nature; the product sells
  *distribution and verification*, not surveillance.
- **No unbacked rewards.** The treasury is demand-funded; we never promise payouts we
  haven't been funded for.

## 4. Cost structure

- **Near-zero variable cost per action:** Stellar sub-cent fees + fee sponsorship from a
  capped, rate-limited pool (belt/demo scale). At scale, sponsorship is funded by the pools
  in §2.1, not by us.
- **No standing backend:** serverless attester + faucet (testnet) + RPC-direct reads. Hosting
  is a flat, small Vercel cost. A durable indexer is the main future infra cost (Blue/Black).
- **The real cost is trust/integrity:** audit, attester key opsec (KMS), ring detection,
  treasury circuit breakers — already partly built; these are the moat, so they're worth it.

## 5. Unit economics (the shape, pre-revenue)

- A **completed vouch pair** costs ≈ 2 sponsored tx fees (sub-cent) and generates a viral
  invitation (K-factor target > 1) → **acquisition cost trends toward ~free** as the loop
  compounds.
- A **sponsored bounty** is cash-positive by construction: revenue = platform fee on a
  pre-funded pool; payout liability ≤ the funded pool. There is no scenario where verified
  payouts exceed funded revenue (enforced on-chain by the daily cap + amount registry).
- **LTV** lives in repeat sponsored seasons per community + cross-app reputation reads, not
  in extracting from consumers.

## 6. Defensibility / moat

1. **The graph.** A dense, real proof-of-people graph is hard to replicate and compounds.
2. **Honest anti-sybil.** The two-track + demand-funded design is the credibility that lets
   sponsors trust the distribution — competitors that skip it get farmed.
3. **Stellar-native economics.** Sub-cent fees + USDC + anchors make consumer micro-rewards
   viable where other chains price them out.
4. **Warm brand.** "Collect people, not points" is a positioning competitors (cold quest
   farms) structurally can't copy without becoming us.

## 7. Stage & honesty

- **Now (testnet):** no revenue, no real users; treasury is test USDC; proof-of-funding gate
  is built but toggled off for demos.
- **Next (real cohort):** prove the loop (PMF doc), then land **one sponsored pool** with a
  cohort leader — the first real dollar in, validating §2.1.
- **Then (mainnet + anchor):** turn on proof-of-funding, integrate an anchor off-ramp, and
  let payout-≤-revenue run for real.

The business model is intentionally boring and bounded: **make recognition spread for free,
make money only move when someone external funds it.**
