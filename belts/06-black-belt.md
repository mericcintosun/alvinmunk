# ⚫ Black Belt — Level 6

**Rise In requirement:** The project's Twitter profile + project-related posts; 30+ new users onboarded; more advanced features than Level 5; **Stellar Mainnet launch**; real mainnet users (at least 20); security review/audit; real ecosystem adoption.

**Milestone (Nicole):** Live on MAINNET; 30+ onboarded, 20+ real mainnet users sending tx; advanced features shipped; audited; first ecosystem-adoption signal.

> ### 🎯 How to hit 20 mainnet users (real, external)
> Migrate Blue's Season-0 power users (already engaged, externally sourced) to a mainnet **"Season 1"** with real USDC micro-bounty/tipping draw — **real money = the conversion lever.** Keep passkey onboarding ≤2 min (minimize mainnet drop-off). Require **20+ DISTINCT mainnet signers** who each complete ≥1 on-chain action + a real USDC tip/bounty settled per user.

**Scope guard — DON'T:** Chase Master-tier partnership/fundraising yet; expand scope mid-audit. Feature freeze before the audit; ship only the audited surface to mainnet. An unaudited contract should not hold real USDC.

**Success metrics:**
- 30+ onboarded, 20+ distinct mainnet signers (each with ≥1 settled USDC action).
- Clean/triaged audit report.
- ≥1 ecosystem partner integrating or co-promoting.

---

## 🔧 Technical tasks

### Smart contract / on-chain (Tyler)
- **Mainnet launch:** Deploy the 4 contracts to Pubnet with a fresh, hardware-secured **(or multisig)** admin key. ⚠️ the admin is NOT a single hot key — multisig or timelock'd governance. Record all mainnet WASM hashes.
- **Audit prep:** contract code freeze + threat model (drain path, replay, auth bypass, attester key compromise, integer overflow, archival/TTL DoS) + `cargo audit` + Soroban-focused static pass + external review. Fix findings before 20-user exposure.
- **Real USDC:** integrate the canonical mainnet USDC SAC (Circle), fund the treasury with real USDC, conservative per-claim cap + global daily payout cap (circuit breaker fn). ⚠️ real money → **pausable/emergency-stop** admin fn (`require_auth`, `paused` flag checked in all mutators).
- **Attester-key opsec:** move signing keys to an HSM/KMS signer service; key-rotation without redeploy via `add_attester`/`remove_attester`.
- **Mainnet fee sponsorship at scale:** production channel-account pool + monitoring + sponsor account auto-refill; sponsor balance alerting.
- **Advanced features (vs Blue):** USDC micro-bounty market maturity (escrow + dispute/expiry refund path) + shareable badges that name people (the two-party co-mint from Orange, now on mainnet).
- Indexer/infra hardening: deep-history backfill (Hubble/Galexie or RPC archive), monitoring/alerting, public read API + status page.

### Engineering / full-stack (Elliot)
- **Audit-readiness:** interface freeze, full docs, threat model, fix all clippy/audit-tool findings. **AC:** frozen tagged commit + docs to the audit firm.
- **Fork + differential tests:** test against mainnet-fork state, replay scenarios, invariant tests (total-score conservation, no-USDC-mint). **AC:** invariant + fork suite green; contract coverage ≥90%.
- Mainnet deploy runbook: multisig admin key ceremony, staged rollout, contract-hash verification, rollback plan. **AC:** 3 contracts on mainnet, hashes verified, admin in multisig.
- Mainnet USDC: real USDC SAC trustline/SEP-41, paymaster funded, treasury limits. **AC:** a real USDC micro-bounty paid to a mainnet user.
- 30+ onboarding + Twitter/social share: shareable badge cards that name co-signers, deep link, on-chain referral attribution. **AC:** 20+ mainnet users with real tx, referral attribution tracked.
- Advanced: USDC tipping at scale, vouch-graph reputation weighting, badge showcase. **AC:** weighted reputation leaderboard + reflected in payout.
- Production observability + on-call: tx-failure/paymaster-drain/indexer-lag alerting, incident runbook, SLO. **AC:** paymaster-low and indexer-lag alerts page.

---

## 🎨 UX / Frontend (Kaan)
- **Screens:** mainnet/testnet mode indicator, real-USDC micro-bounty + tipping flow, Twitter/X connect, invite-link onboarding/first-run for 20+ mainnet users.
- **Delight mechanic:** **USDC MICRO-BOUNTY + TIPPING** (spendable reputation); a tip mints a "thank-you" collectible that names both parties — fusion of a viral artifact + real money movement.
- **Share surface:** auto-post hook to X on badge/stamp mint (image card + tag) + public passport URL (OG-image = crest card) → nice unfurl in the timeline.
- **Onboarding:** invite-link onboarding (link tap → passkey → first shared stamp with the inviter) = the highest-conversion acquisition loop; show an "audited" trust badge in the UI.
- **Empty states / safety:** mainnet first-tip confirmation (real-money clarity), low-balance/failed-payment state, scam/abuse guardrail when naming others.
- **Accessibility:** explicit confirm + undo-window copy on real-money flows, large touch targets on payment CTAs, **clear visual distinction between mainnet vs testnet** (never confuse them).

---

## 📣 Product / GTM (Nicole)
- Commission an audit of the mainnet contract surface (stamp mint, stake/slash, bounty/tip settlement); triage + fix.
- Run the mainnet **"Season 1"** with a real USDC bounty/tip pool; convert Blue power users first.
- Consistent Twitter/X presence: ship log, leaderboard moments, user spotlight → drive onboarding.
- Line up 1 ecosystem partner (wallet, Stellar project, or community) for co-promotion/quest integration.
- Run subjective-quest staked-quorum review for real now (economic stake exists).

---

## ✅ Definition of Done
4 contracts on mainnet (multisig admin, emergency-stop, real USDC caps); external audit report clean/triaged; 30+ onboarded + 20+ distinct mainnet signers each with ≥1 settled USDC action; ≥1 ecosystem partner co-promoting/integrating; Twitter active.

## ⛓️ Dependencies
Blue (power user cohort + scale). The upgradeability decision from Orange is enforced here. Its output is Master's partnership/investor story.
