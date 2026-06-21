# 🟡 Yellow Belt — Level 2

**Rise In requirement:** Multi-wallet integration, smart contracts, transaction handling, real-time event synchronization.

**Milestone (Nicole):** Multi-wallet support + a Soroban contract deployed to testnet; it mints stamps and emits events that the app reads back.

**Scope guard — DO NOT:** NO bounty/USDC market, staking, or quorum review. One stamp type, one mint path. No tipping economy. No over-modeling reputation scoring.

**Success metrics:**
- Vouch mint → claim → event read round-trip >95% success (20 manual runs).
- The half-card link can be opened and claimed on a second device (async, coordination-free).
- 2+ wallet types connect.

---

## 🔧 Technical tasks

### Smart contract / on-chain (Tyler)
- **Scaffold the `Reputation` contract:** `Map<Address,u64>` XP (instance/persistent storage), `Map<(Address,BadgeId),Claim>` badges. `award_xp`, `grant_badge`, `get_profile`, `revoke`. Non-transferable by omitting any transfer fn.
- Emit a structured event on every mutation: `xp_awarded(addr, amount, source)`, `badge_granted(addr, badge_id, attester)`. This is the indexer's contract — **freeze the event topic/data shape now**.
- ⚠️ **For the SCF gate (00-strategy §4):** from day 1, emit the **canonical `attestation_set{addr, schema_id, issuer, value, ts}` event**. Append-only, impossible to backfill — you can defer the read-view (`get_attestation`) but you cannot defer the event.
- Auth model: gate `award_xp`/`grant_badge`/`revoke` on the admin/attester address with `require_auth` (instance storage `admin`). No public mint. `require_auth` unit tests for unauthorized calls.
- ⚠️ **Storage TTL/archival:** badge/XP `persistent` storage — `extend_ttl` bump within every write; document the archived-entry restore flow. Persistent entries can be archived; reads must handle restore.
- Set up a real-time event indexer: poll `getEvents` (RPC) by contract ID + topic, write to a small DB, expose a leaderboard read API. Depends on the frozen event shape above.
- Multi-wallet: extend the TS client to manage 2+ passkey wallets and dispatch contract invocations from each (needed for the tap-to-mint co-sign in Orange).

### Engineering / full-stack (Elliot)
- `Reputation` contract v0 — **the primary mechanic is ASYNC VOUCH** (cold-start fix, 00-strategy §3): `mint_vouch(from, to_handle_or_addr, note)` creates a half-card (pending), `claim_vouch(to)` completes the second party and bumps both scores; `score(addr)`. **AC:** unit test mints a half-card, B's score does not increase before claim, both parties increase after claim + double-claim reverts.
- (Secondary) `mint_stamp(a, b)` IRL two-wallet co-sign stamp — optional flavor, not primary.
- `QuestRegistry` contract v0: `register_quest`, `complete_quest(addr, quest_id, attester_sig)` with allowlisted attester pubkey check. **AC:** rejects an off-allowlist signature, accepts a valid one.
- `stamp_minted` / `quest_completed` Soroban events; define the event schema in `/packages/shared`. **AC:** events appear in `stellar contract events` output.
- Multi-wallet co-sign/vouch UX: two-party tap-to-mint (deep link / QR handshake), multi-source auth tx. **AC:** two test wallets co-sign a single mint tx, both on-chain.
- Real-time event consumer (thin): RPC `getEvents` polling → WebSocket/SSE to the UI. **AC:** a stamp mint updates the second browser within <5s.
- Robust tx handling: simulation, fee-bump/sponsored fee, `TRY_AGAIN_LATER` retry, restore-footprint. **AC:** tx with sponsored fee + passkey, 0 XLM in the user wallet.
- Unit tests for both contracts (happy + auth-failure); CI `cargo test`. **AC:** coverage on all public fns.

---

## 🎨 UX / Frontend (Kaan)
- **Screens:** "add a second wallet" / wallet switcher, contract-interaction screen, a live activity feed streaming real-time contract events.
- **Delight mechanic (PRIMARY):** **ASYNC VOUCH half-card** — A picks B and vouches for them; A's side is filled, B's side is a *glowing empty slot*. The generative sigil is seeded from A's wallet hash; when B claims, B's side blooms from the seam to form the full card. Zero coordination.
- **Share surface:** the half-card link — "X vouched for you. 1/1. Claim your side →" (no crypto wording). This card **is the install funnel itself.** (Secondary: IRL tap-to-mint collision-bloom animation, screen-recordable.)
- **Real-time feel:** event toasts ("Stamp confirmed in 4s") + a feed-item animation on on-chain confirm — make sub-cent/sub-5s settlement legible as a feature.
- **Empty state:** empty feed → "No stamps yet — bump a friend to get started" + a two-hands illustration.
- **Accessibility:** the wallet switcher is one-hand reachable; a reduce-motion (static reveal) variant for the mint animation.

---

## 📣 Product / GTM (Nicole)
- **Stamp taxonomy v1:** which stamps are API/crypto-verifiable (auto-mint) vs subjective (deferred to staked quorum later) — lock the verifiability boundary.
- Spec the co-sign/vouch human-reference mechanic on paper (who can vouch, what changes) — do not build yet.
- Sketch 3 shareable badge visual concepts; validate "would you share this?" via DM with 5 external contacts.
- Landing page + waitlist email capture; start warming up 2-3 external communities with build-in-public posts.

---

## ✅ Definition of Done
`Reputation` (+`QuestRegistry` v0) deployed on testnet; tap-to-mint shared stamp works with two wallets; the event indexer feeds the leaderboard; real-time UI update <5s.

## ⛓️ Dependencies
White (passkey + sponsorship + art engine). Its output (Reputation contract + event schema) is a prerequisite for Orange's cross-contract calls.
