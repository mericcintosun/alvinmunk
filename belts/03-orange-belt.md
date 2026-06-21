# 🟠 Orange Belt — Level 3

**Rise In requirement:** A complete mini dApp — advanced smart contracts, testing, deployment.
**Note:** After this belt comes the **💡 Idea Submission Stage** — the Rise In team must approve the idea. Present a strong dossier with the concept in this repo + competitive analysis + PRD.

**Milestone (Nicole):** A complete vertical-slice mini dApp deployed to testnet — onboard → shared stamp mint → see it on the profile → share link — with automated tests + a public testnet URL.

**Scope guard — DO NOT:** NO retention loop (recurring quest/stake) or spend market. No weekly cadence, no "rank buys something". A single-session shareable flow. No early scaling/infra.

**Success metrics:**
- E2E test suite green.
- 10 external testers (NOT the program cohort) complete the share flow.
- Share link → new-visitor conversion observed at least once.

---

## 🔧 Technical tasks

### Smart contract / on-chain (Tyler)
- **`QuestRegistry` contract:** `create_quest`, `award_quest` (allowlist-gated + replay guard), `add_attester`/`remove_attester`, `verify_sig`. The attester allowlist in instance storage; quest config in persistent storage.
- **Replay guard:** `Map<(QuestId, Address), bool>` claimed-set (persistent), atomic check-and-set in `award_quest`. Unit tests proving double-claim reverts.
- **Signed-claim oracle:** `verify_sig` validates the ed25519 attester signature over `(quest_id, recipient, nonce)` with `env.crypto().ed25519_verify`. Nonce in the replay set → reuse is blocked.
- **Cross-contract call:** `QuestRegistry.award_quest` → `Reputation.award_xp`/`grant_badge` (typed client `reputation::Client::new`). Reputation must `require_auth` the QuestRegistry contract address (Reputation's attester = QuestRegistry contract). **Dependency:** Reputation (Yellow) deploys first.
- **Tap-to-mint shared stamp:** a mutual badge mint that two wallets co-sign in a single tx (multi-`require_auth` in one invocation). `mock_all_auths` + explicit per-address auth tests.
- **Testing depth:** full unit + integration (`Env::default`, `register_contract`) + one fork/integration test (against Testnet). Deploy the 3 contracts to Testnet; write the contract IDs to the deployment manifest.
- ⚠️ **Flag the upgradeability decision HERE:** add a `require_auth`-gated `upgrade(new_wasm_hash)` (`env.deployer().update_current_contract_wasm`) to all contracts **OR** commit to immutability. Decide now; retrofitting on mainnet is painful.

### Engineering / full-stack (Elliot)
- **`Rewards` contract:** reputation → USDC micro-bounty payout (SAC/USDC), tipping `tip(from,to,amount)`. **AC:** claim transfers USDC SAC, double-claim rejected.
- Cross-contract wiring: `Rewards` → `Reputation.score`, `QuestRegistry` eligibility gate; interfaces in the shared crate. **AC:** integration test covers all 3 contracts end-to-end.
- **Attester service (real):** Express/Fastify, allowlisted keypair, auto-verify quest = merged GitHub PR (API) + referral-wallet-real-tx check, returns a signed claim. **AC:** merged PR → a valid sig redeemable on-chain.
- **Indexer service:** Soroban event → Postgres, leaderboard + profile API; pin IPFS badge art. **AC:** the leaderboard endpoint reflects on-chain scores <10s after the event.
- Complete mini-dApp UX: profile, badge gallery, quest list, leaderboard, claim/tip buttons wired to contracts. **AC:** the full journey (connect→quest→claim→tip) works on testnet.
- **FULL test suite:** unit + integration + fuzz (proptest: amount/score/overflow) + attester/indexer API tests. **AC:** CI coverage gate ≥80% contracts.
- Testnet deploy pipeline: scripted deploy of 3 contracts, address registry in `/packages/shared`, seed data script. **AC:** `make deploy-testnet` reproducible addresses + bindings.
- CI/CD: build+test+deploy-to-testnet on main merge; log WASM hash. **AC:** a green main auto-deploys to testnet staging.

---

## 🎨 UX / Frontend (Kaan)
- **Screens:** the full mini-dApp loop — profile/passport (stamp grid), stamp detail, vouch/co-sign action sheet, error/failed-tx recovery.
- **Delight mechanic:** **VOUCH** — co-sign another person; it mints a small collectible naming them ("Kaan vouched for Alvin"). Every micro-action is its own card = "reputation about someone else goes viral".
- **Share surface:** Vouch Card (two handles + relationship line + generative motif) + a pre-filled share caption + a deep link back to the mint.
- **Onboarding:** returning-user fast path (FaceID → straight to passport) + a first-run coachmark on the vouch button.
- **Empty states:** a 0-stamp passport → a "starter quest" checklist; failed tx → a non-scary retry card, never a raw error code.
- **Accessibility:** stamp grid as an accessible list (label on every stamp), small-screen test (no horizontal scroll).
- ⚠️ **Sequence:** finalize the card layout template + share/deep-link infrastructure here — Green/Blue only add card types, not new infrastructure.

---

## 📣 Product / GTM (Nicole)
- Recruit a 10-person **external alpha pod** (NOT the program cohort) from the warmed-up communities; run a moderated walkthrough.
- Instrument the share funnel: mint → share → click → install → activate; capture drop-off.
- Referral/share copy + an OG-image badge that renders a person's name/handle (viral hook).
- 5 feedback calls → a ranked friction list that feeds Green.
- **Open the Twitter/X account;** start a weekly build-in-public cadence (seed the future user base).

---

## ✅ Definition of Done
3 contracts on testnet, cross-contract working; the attester service verifies a merged PR; the indexer feeds the leaderboard; full test suite + fuzz green; 10 external testers completed the share flow. **Idea Submission dossier ready.**

## ⛓️ Dependencies
Yellow (Reputation + event schema). The upgradeability decision is made here, enforced in Black.
