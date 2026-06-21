# 🧭 Stellar Passport — Strategy & Decisions (source of truth)

This document holds the cross-cutting decisions that tie together all the belt files (01–07). In case of conflict, **this document prevails.**

---

## 1. Track / category decision (objective)

- **$20,000 prize pool = Builder Track / Belt Progression** (White→Master). **NO category restriction** — "build & ship real apps".
- The priority categories (Payments, Stablecoins, RWA, Cross-border, Wallet infra, Financial tooling, AI+Blockchain, Anchor) belong **only to the separate Startup Track** and its separate money (InstaAward $15k / SCF $150k).
- **Passport = a pure Builder-Track/$20k consumer play.** It does not fall into any priority category, and **it does not need to.**
- ✅ **CONFIRMED (official FAQ):** The same person **cannot enter TWO tracks / two projects in the same month** — one month, one track, one project. So "Passport=Builder + a separate SCF project in parallel" is **INVALID.**
- ✅ **The path to SCF = Master Belt (L7).** Official table: *"Master Belt = Startup track with SCF grants and InstaAward."* So it is not a separate project; **taking Passport to Master** is the SCF gateway. Focus on the single project; a separate SCF idea would at most become a **mentor-approved pivot** next month.
- Do **not build** an "infra/SDK/partner-portal" product surface — the belt jury doesn't care about composable primitives; that tug-of-war brings "death by two audiences". (But keep emitting the `att_set` event from day 1 — it's free for Master/SCF.)
- ⚠️ **Mentor & Market-Fit checkpoint MANDATORY:** at L5 (Blue) and L6 (Black), get technical + market-fit approval from a mentor BEFORE onboarding users. Users onboarded without approval **DO NOT COUNT** toward the belt.
- ⚠️ **Idea Submission (after Orange):** the official text says *"ideas that resonate with Stellar Anchors"*. Passport doesn't touch an anchor → add an **anchor angle** at Orange (reward cash-out via an anchor, or reputation as an anchor onboarding signal).

---

## 2. North-star metric

> **Weekly count of "closed reputation loops"** = a vouched stamp being staked and redeemed to USDC by a user **different** from the one who minted it.

Why it's belt-shaped: the jury verifies on-chain; a captive cohort can't fake it by self-minting (counterparty + spend required); it grows through real network usage, not vanity installs.

---

## 3. The most critical design decision — cold-start fix

"Two people side by side → tap-to-mint" is **nearly fatal** for a solo builder (the empty-room problem). The core mechanic is an **async, one-sided VOUCH**:

> A picks B — who may not have installed the app yet — and mints them a **half-card** — A's side is filled, B's side is a *glowing empty slot*. The card is instantly shareable ("X vouched for you. 1/1. Claim your own side →") = **the install funnel itself.** When B claims, B's side blooms and both get the full card.

- IRL "tap-to-mint" (NFC/QR collision-bloom) = **a secondary flavor**, not the primary hook.
- **KILL:** the scrollable endorsement/skill grid (=LinkedIn). Just a generative-art card deck; each card is one human + one moment. *"Never show a number where you could show a face."*

---

## 4. Policy for keeping the SCF gateway ~free to crack open

- **Emit a canonical event from day 1:** `attestation_set{addr, schema_id, issuer, value, ts}`. Events are append-only, **impossible to backfill** — if skipped, the historical claim trail is lost.
- The `get_attestation(addr, schema_id)` / `get_score(addr)` read-view = **the next cheap upgrade** (thanks to Orange upgradeability, no migration needed, ~30 min). A read-only adapter, **never a second write path** → no two-audience architectural mess.
- The leaderboard indexer + the (future) SCF integrator read **the same event.** So the primitive is nearly free on the off-chain side too.
- **Do NOT build now:** schema registry, issuer registry (the allowlist already exists), revocation workflow (just store a `revoked` bool), developer portal.

---

## 5. Retention de-risk (at Green, early)

**Ship the tip/bounty rail BEFORE** quests/ranks. Measure **D7 return** in users who *receive* spend. If USDC from a stranger doesn't bring people back, no gamification will — pivot the reward early, not the whole app.

---

## 6. The demo moment (the thing that wins the room)

Put a **real iPhone** in the jury's hands → passkey **FaceID** → first on-chain action, sponsored, **<15s** (aim for 8s, promise 15). On screen: **"Fees paid by app: $0.00"** + a live clock. The architecture diagram wins the write-up; **the jury's own finger wins the room.**

---

## 7. Single-project rule (UPDATED — official FAQ)

- ❌ The old "two-project (Passport + a separate SCF)" plan is **cancelled** — two tracks/projects in the same month are forbidden.
- ✅ **ONE project: Passport. ONE track: Builder.** All focus on Passport. SCF opens up once you reach Master Belt (L7 = Startup track + SCF/InstaAward).
- "The belt chain must not break": each month the highest **valid** belt is rewarded; if you skip an intermediate belt, you get rewarded from where the chain broke. So each belt must genuinely be met.
- "You can't resubmit the same version" → each belt requires **meaningful new commits/progress** (git history matters).

---

## 8. Belt-winning priority (Justin's ranking)

1. **Demo polish / live working proof** (highest weight).
2. **Traction signal** (20 real users > a polished mock). Passport's *weak* spot — invest here.
3. **Narrative coherence** (one sentence; strong if it stays consumer-pure).
4. **Novelty** (least decisive; "tap/vouch social reputation" is fresh enough, don't over-invest).
