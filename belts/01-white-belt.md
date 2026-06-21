# ⚪ White Belt — Level 1

**Rise In requirement:** Set up a wallet, manage balance, send your first on-chain transaction.

**Milestone (Nicole):** The user can create/recover a passkey-backed smart-account wallet, read balance, and send their first signed testnet payment from within the app.

**Scope guard — DO NOT:** NO stamps, reputation, quests, or social mechanics. No backend, no leaderboard, no contract logic — just wallet + balance + a single tx. Do not attempt to design a "passport schema".

**Success metrics:**
- 100% of test devices complete the passkey create → first-tx flow in <2 min.
- The first testnet tx is on-chain confirmed.

---

## 🔧 Technical tasks

### Smart contract / on-chain (Tyler)
- Set up the dev infrastructure first: pin `stellar-cli` and Soroban Rust SDK versions, a `contracts/` workspace cargo project (shared `Cargo.toml`). Every belt builds on top of this.
- Testnet RPC endpoint + Friendbot funding script; wrap account creation, balance read (`getAccountEntry`/Horizon) and the first classic payment tx in a thin TS client (`@stellar/stellar-sdk`).
- **Set up the passkey smart-wallet onboarding skeleton NOW** (every social feature depends on it): integrate a passkey-kit/smart-wallet contract (secp256r1 `__check_auth`). Deploy the wallet factory to testnet; sign + verify a tx with passkey.
- Wire fee sponsorship with a sponsor account + fee-bump tx (`TransactionBuilder` → `buildFeeBumpTransaction`). Verify the end-user sends a tx while holding 0 XLM.
- ⚠️ **Flag:** the smart-wallet `__check_auth` + signer storage TTL must be bumped on every use — set up the bump pattern here, do not defer it.

### Engineering / full-stack (Elliot)
- Monorepo init (pnpm/turborepo): `/contracts`, `/apps/web` (Next.js), `/services`, `/packages/shared`. **AC:** from a clean clone, `pnpm install && pnpm build` is green.
- Stellar tooling scaffold: `stellar-cli` pin, `Makefile`/scripts (build/test/deploy), testnet network alias. **AC:** `make build` compiles the empty workspace.
- Frontend wallet connect: Stellar Wallets Kit + passkey smart-wallet flow; create wallet, fetch XLM balance from RPC. **AC:** connect → funded testnet address + balance visible.
- First payment tx: build/sign/submit a classic XLM payment from the UI; show tx hash + RPC status. **AC:** the user sends XLM and sees the confirmed ledger + explorer link.
- Friendbot funding helper + unfunded account error surfacing. **AC:** new account auto-funded on testnet.
- CI baseline: GitHub Actions → `cargo fmt --check`, `cargo clippy`, `pnpm lint`, `pnpm typecheck`. **AC:** a red CI blocks merge.

---

## 🎨 UX / Frontend (Kaan)
- **Screens:** passkey onboarding (FaceID, zero seed-phrase), wallet home with a single live balance, "send your first tx" flow, post-tx receipt.
- **Delight mechanic:** The first transaction mints a **"Genesis Stamp"** — deterministic generative art derived from the wallet address (color/shape DNA), so every passport is unique from the second second onward.
- **Share surface:** a "Passport Cover" card (generative crest + handle + join date) + one-tap "Save image" — the first screenshottable artifact.
- **Onboarding:** max 3 taps — FaceID → pick handle → land on a funded testnet wallet; skeleton shimmer, never an empty balance.
- **Empty state:** before the first tx, a dashed "ghost stamp" placeholder on home: "Your first stamp will land here".
- **Accessibility:** thumb-zone CTA, 44px+ targets, biometric → PIN fallback; color-DNA must also encode **shape** (color-only fails for color-blind users).
- ⚠️ **Sequence:** the generative-art seed system + design-token palette are LOCKED HERE; all downstream (stamps, badges, cards) reuse this engine.

---

## 📣 Product / GTM (Nicole)
- Write the one-sentence product promise + the single "aha" moment (tap → shared stamp mint), and pin it for every belt.
- A value-prop sentence usable as both an App Store blurb and a tweet.
- Identify 2-3 candidate **EXTERNAL communities** (Stellar Discords, mobile-first crypto-curious groups, niche hobby/creator communities); start lurking/logging contacts now — no pitch yet.
- Clearly define the activation event (wallet created **AND** first stamp minted) — for later funnel tracking.

---

## ✅ Definition of Done
A **single on-chain testnet tx** signed with a passkey wallet + sponsored-fee. Genesis Stamp generative-art engine + design tokens locked. Monorepo + CI green.

## ⛓️ Dependencies
None — foundational. Its output (passkey + sponsorship + art engine) is a prerequisite for Yellow.
