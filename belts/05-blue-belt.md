# 🔵 Blue Belt — Level 5

**Rise In requirement:** Scale the product to 50 users, improve based on user feedback, prepare a professional pitch deck + demo.

**Milestone (Nicole):** 50 **REAL external users** onboarded and run through the weekly loop; structured feedback + pitch deck/demo ready.

> ### 🎯 How to hit 50 users (external, NOT a cohort)
> Seed from warmed-up Discord/communities + a Twitter build-in-public audience. Run a time-boxed **"Season 0"** launch: public weekly quests + a referral quest that grants reputation for bringing a friend (viral coefficient) + a small USDC bounty pool to draw in the crypto-curious. Let **<20% of the 50** come from the Rise In cohort, the rest from external channels. Co-host the season with 1-2 community mods.

**Scope guard — DON'T:** Don't move to mainnet, don't start the audit, don't add advanced features. Stabilize the loop at 50-user scale; fix retention leaks, don't open new surfaces. No early token/economy expansion.

**Success metrics:**
- ≥50 onboarded, <20% from the program cohort.
- WAU ≥25 (50% of the base).
- Week-over-week retention ≥25%.
- Referral quest viral coefficient measured (>0.3 target).

---

## 🔧 Technical tasks

### Smart contract / on-chain (Tyler)
- NO new core contract; scale + observability for 50 users. RPC redundancy (primary + fallback), client retry/backoff, pre-submit simulation on every invocation (pre-flight catch of fee/auth errors).
- Wire the contract event stream to metrics (claims/day, XP minted, failed auth) — feeds feedback iteration and the pitch deck.
- ⚠️ **#1 scaling cliff:** load-test the sponsor/fee-bump path — 50 concurrent passkey users = sponsor account sequence-number bottleneck. Parallelize submissions with a **channel-account pool** for fee sponsorship.
- Iterate contract params from feedback via admin fn (XP threshold, quest config, reward cap) **without redeploy** — validates the upgradeability/admin-config decision from Orange.
- Config-driven contract-ID registry on the client (same build can point at staging vs prod — preparation for the mainnet swap in Black).

### Engineering / full-stack (Elliot)
- Feature-flag + config system: iterate quest/reward without redeploy. **AC:** a new quest type added via config, no contract redeploy.
- Analytics + funnel instrumentation (onboard→first stamp→first claim) for the 50-user cohort. **AC:** dashboard shows step-by-step conversion for real users.
- Feedback loop tooling: in-app feedback widget, bug intake, wallet-linked (privacy-respecting) telemetry. **AC:** feedback maps to a session/tx (repro).
- Iteration backlog: ship the top-N fixes from the 50-user test, a regression test per fix. **AC:** every shipped fix has a test pinning the reported behavior.
- Demo/pitch support: stable demo seed environment + scripted demo flow + reset script. **AC:** one-command demo reset.
- **Anti-abuse v1:** stamp mint rate-limit, collusion/self-vouch loop detection in the indexer. **AC:** self-vouch and rapid-fire mint patterns are flagged/throttled.
- Leaderboard read scale: caching/materialized view for 50+ users. **AC:** leaderboard p95 <200ms.

---

## 🎨 UX / Frontend (Kaan)
- **Screens:** leaderboard UI (not self-stat, but by **number of people connected**), in-app feedback widget, demo/pitch mode for the passport.
- **Delight mechanic:** LEADERBOARD socially framed — "most connected", "top voucher of the week" + a weekly recap card ("you connected 6 people", auto-shareable).
- **Feedback-capture UI:** a lightweight in-context prompt after a key action (thumbs + one line) + NPS/"would you share?" micro-survey + a tagged bug/idea reporter; instrument **share-button taps as a core funnel metric**.
- **Share surface:** Weekly Recap Card + leaderboard-rank brag card ("#3 most connected") — for the 50-user cohort to post.
- **Empty states:** low-user leaderboard → "be the first to connect 10 people"; thanks-state after feedback widget submit.
- **Accessibility:** leaderboard rows readable one-handed, feedback widget keyboard/screen-reader compatible, demo mode works on a projector (large type, high contrast).

---

## 📣 Product / GTM (Nicole)
- **"Season 0"**: public quest calendar + referral mechanic + small bounty pool = acquisition fuel.
- Recruit 1-2 external community co-hosts/ambassadors; give them a share on the leaderboard.
- Systematize feedback: weekly NPS + churned-user exit micro-survey + top-friction triage.
- Finalize the pitch deck + record a 2-min demo (with REAL retention/viral numbers).
- Identify the power user cohort → candidate mainnet early-adopters for Black.

---

## ✅ Definition of Done
≥50 real external users (<20% cohort), WAU ≥25, week-over-week retention ≥25%, viral coefficient measured. Fee-sponsor bottleneck solved with a channel-account pool. Professional pitch deck + 2-min demo with real numbers ready.

## ⛓️ Dependencies
Green (weekly loop). Its output (power user cohort + scaling infrastructure) feeds Black's mainnet season.
