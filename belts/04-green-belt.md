# 🟢 Green Belt — Level 4

**Rise In requirement:** Production-ready MVP with advanced smart contracts; prepare the app for production.

**Milestone (Nicole):** Production-ready MVP — the **core weekly retention loop** live end-to-end on testnet.

> ### 🔁 Core weekly loop (clear definition)
> Each week N fresh quests drop (most auto-verifiable: did-a-tx, vouched-N-people, referred-a-friend). To commit, the user **stakes** reputation/a small amount of USDC → completes → earns reputation + a weekly stamp → rank updates → rank **unlocks a real benefit** (bounty-board access tier, higher tipping limit, exclusive badge, fee discount). Miss the week = stake slash / streak reset. **Rank must BUY something, otherwise it's mint-and-forget.**

**Scope guard — DON'T:** Don't scale users yet, don't go mainnet, don't build a fully open bounty marketplace — just the minimum spend-sink that makes rank matter. Don't build the subjective-quest quorum at full complexity; stub it. Depth in the loop, not feature breadth.

> ⚠️ **SEQUENCING (00-strategy §5):** Ship the **tip/bounty USDC rail BEFORE** the quest/rank engine and measure D7 retention. The question "does receiving USDC from a stranger bring people back?" is answered most cheaply here. If the answer is no, pivot the reward — not the whole app.

**Success metrics:**
- **North-star (00-strategy §2):** the weekly count of "closed reputation loops" is rising (vouch → stake → a *different* user redeems USDC).
- **Retention de-risk:** measured D7 return among users who *receive* USDC spend (this is the real signal).
- Week-1→Week-2 return rate in the alpha pod ≥30%.
- ≥60% of active users complete the weekly quests.

---

## 🔧 Technical tasks

### Smart contract / on-chain (Tyler)
- **`Rewards` contract:** XP threshold-gated `claim_reward` (cross-contract read `Reputation.get_profile`), USDC SAC payout (`token::Client::new` → `transfer`). Per-(reward_id, address) replay guard.
- **Treasury model:** Rewards holds USDC or pulls from the treasury with `require_auth`; admin deposit/withdraw fns. ⚠️ the payout path must not be drainable — bound it with a per-claim cap + threshold check.
- Tipping: direct wallet→wallet USDC SAC transfer + optional `tipped` event (social feed). If it's a pure SAC transfer, no new contract is needed.
- **Production hardening:** deny-by-default auth audit on every fn, integer overflow (`checked_add`), explicit error enum (`contracterror`) instead of panic. Property/fuzz tests on the award/claim math.
- **Storage TTL strategy:** reasonable `bump_ledgers` for instance vs persistent; a keeper job that extends TTL on hot entries (admin config, attester list). ⚠️ instance storage archival bricks the contract — bump aggressively.
- Indexer → production: from polling to a durable cursor (last-processed ledger), reorg handling, event-ID keyed idempotent upsert. Profile + leaderboard + bounty API.
- Still Testnet; produce a release candidate: deterministic build (`stellar contract build`), recorded WASM hash, written deployment runbook.

### Engineering / full-stack (Elliot)
- Production-hardening: checked arithmetic, reentrancy/auth review, admin/upgrade pattern, event versioning. **AC:** clippy pedantic clean, no `unwrap` in contract paths.
- Smart-wallet onboarding polish: passkey create/recover, sponsored-fee paymaster service, session handling. **AC:** a zero-crypto user onboards without a seed-phrase, fee sponsored.
- Backend hardening: attester key in KMS/secrets manager, rate limiting, nonce replay protection on claim, idempotent indexer ingestion. **AC:** a replayed claim is rejected; the indexer produces no dups on event re-delivery.
- Observability: structured logs, Prometheus metrics, Sentry, health/readiness endpoints. **AC:** dashboard shows tx success rate / indexer lag / attester latency.
- Staging env (prod mirror): managed Postgres, IPFS pinning, services behind HTTPS. **AC:** an external tester can run the whole app from the staging URL.
- E2E (Playwright) core flow + indexer/attester load test. **AC:** E2E suite green in CI.
- Performance/UX: optimistic UI on mints, skeleton loaders, mobile-first responsive. **AC:** Lighthouse mobile ≥90.

---

## 🎨 UX / Frontend (Kaan)
- **Screens:** production passport profile (handle, crest, stat row: stamp/vouch/people-named), badge gallery, settings/recovery, polished share-sheet modal.
- **Delight mechanic:** **BADGES THAT NAME PEOPLE** — milestone badges are auto-generated ("Connector: vouched for 5 people") + a thank-you/tip-back micro-stamp closes the social loop.
- **Share surface (hero shareable):** auto-generated Badge Card — generative art + named people + crest + app handle/QR; "Share to X" primary action.
- **Onboarding:** harden passkey edge cases — multi-device, account recovery, lost-device path — with clear, human copy.
- **Empty states:** a designed empty state on every gallery/section + an "almost there" near-complete state (pull toward the next milestone).
- **Accessibility (full pass):** contrast AA, dynamic type, screen-reader alt-text on generative art, offline/weak-network states.
- ⚠️ **Sequence:** ship the visual-regression baseline for all card types — so later belts don't silently break the share artifacts.

---

## 📣 Product / GTM (Nicole)
- Document the weekly quest calendar (4-week rolling) + a clear rank→reward unlock table.
- Turn the alpha pod into a recurring weekly-active cohort; run the loop live for **2+ consecutive weeks** before Blue.
- Retention analytics dashboard (WAU, week-over-week return, quest completion, stake-slash rate).
- "Why come back on Monday" hook message + push/notification copy.
- Pitch-deck skeleton (problem, loop, early retention numbers) — fill in as the metrics come.

---

## ✅ Definition of Done
The weekly loop ran live on testnet for 2+ weeks, with measured Week-1→2 retention ≥30%. The Rewards contract is production-hardened (checked math, error enum, caps). Staging env open to external testers. Pitch-deck skeleton ready.

## ⛓️ Dependencies
Orange (3 contracts + attester + indexer). This loop is the core of Blue's 50-user and Black's mainnet seasons.
