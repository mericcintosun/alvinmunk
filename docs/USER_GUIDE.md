# alvinmunk — User Guide

**Collect people, not points.** alvinmunk is a social *proof-of-people* reputation game on
Stellar. You earn reputation through mutual actions — vouching for people you trust,
completing verifiable quests, and tipping — not solo grinding. This guide walks a new user
from zero to their first on-chain reputation.

**Live app:** https://alvinmunk.vercel.app · **Network:** Stellar testnet (no real funds needed)

---

## 1. Getting started (30 seconds, no seed phrase)

1. Open **[alvinmunk.vercel.app](https://alvinmunk.vercel.app)**.
2. In the hero, type a **handle** (e.g. `@ezgi`) and tap **Start free**.
3. That's it — we provision a wallet for you, sponsor the fees, write your first on-chain
   transaction (a *Genesis* stamp), and claim your handle in the on-chain registry.

> **What just happened on-chain?** Two things: a `manageData` genesis entry on your account,
> and a `registry.claim(handle)` call so `@yourhandle` publicly resolves to your address. No
> seed phrase, no gas — fees are sponsored on testnet.

**Wallets you can use**
- **One-tap (default):** a passkey smart wallet (`C…` address) or a testnet dev wallet — created for you.
- **Bring your own:** connect Freighter, xBull, Albedo, Rabet, LOBSTR, or Hana at
  **[/wallet](https://alvinmunk.vercel.app/wallet)** (Stellar Wallets Kit).

---

## 2. The core loop — Vouch → Claim

A **vouch** is you publicly backing another person. It mints a *half-card* that becomes their
invite; when they claim it, the card completes and **both of you earn Social XP**.

### Vouch for someone
1. Go to **Vouch** (`/app/vouch`).
2. Type who you're backing (a `@handle` — the app resolves it on-chain — or a wallet address)
   and add one line on *why*.
3. Tap **Send** → you get a **share link**. Send it to them (WhatsApp, DM, anywhere).

### Claim a vouch (as the person vouched for)
1. Open the share link (`/claim/<id>`).
2. Tap once to connect — fees are sponsored — and **claim**.
3. The two half-cards become one. Both people get Social XP, and the voucher can get a
   **push notification** that their star ignited.

> **Anti-sybil:** the first vouch between a specific pair is the only one that grants XP
> (repeat pairs still mint the card but grant 0), there's a daily cap, and claiming needs the
> secret embedded in the share link — so you can't farm reputation by vouching yourself.

---

## 3. Two kinds of reputation

alvinmunk deliberately keeps **clout** separate from **cash**:

| Track | How you earn it | What it's for |
| --- | --- | --- |
| **Social XP** | Vouches (mutual backing) | Leaderboard, fun, status — **non-cashable** |
| **Earned XP** | Attester-verified **quests** | The **only** track that unlocks USDC rewards |

This is the heart of the anti-sybil design: social popularity can never be converted to money.

---

## 4. Quests — earn verified (Earned) XP

1. Go to **Quests** (`/app/quests`).
2. Pick a quest and complete its real-world action (e.g. a verifiable referral or a GitHub PR).
3. The app requests a signed attestation from the serverless attester; the `quest_registry`
   contract verifies the signature on-chain and credits your **Earned XP**.

Earned XP is what gates the cashable side of the app.

---

## 5. Rewards — tips & USDC (the cashable rail)

Go to **Rewards** (`/app/rewards`):

- **Enable USDC** (one tap) — adds the trustline so you can receive USDC.
- **Get test USDC** from the faucet.
- **Send a tip** — type a **`@handle`** (resolved on-chain) or a `G…`/`C…` address and an amount;
  it's a real wallet → wallet USDC transfer, confirmed on-chain.
- **Claim rank rewards** once your Earned XP clears the bar (treasury has a daily cap +
  circuit breaker for safety).

---

## 6. Discover, rank, and share

- **People** (`/app/people`) — search users by `@handle` and vouch them directly.
- **Leaderboard** (`/leaderboard`) — the most-connected people by Social XP, live from chain.
- **Your public profile** (`/u/<handle>`) — a shareable card anyone can open; reputation about
  *others* is viral, reputation about *yourself* is a résumé.
- **Network stats** (`/stats`) — live count of wallets active on-chain, read straight from
  Soroban RPC.
- **Language** — switch between **English and Turkish** from the footer.

---

## 7. FAQ & troubleshooting

- **Do I need real money?** No — everything runs on **testnet**; fees are sponsored.
- **Do I need a seed phrase?** No — one-tap onboarding provisions a wallet and sponsors fees.
- **"Handle taken."** Handles are first-come and unique; pick another.
- **A tip button is disabled.** The recipient handle didn't resolve, or you don't hold the USDC
  trustline yet — tap **Enable USDC** first.
- **I don't see my reputation update.** The leaderboard/feed poll Soroban RPC every ~5s; give it
  a moment. Every action is verifiable on **Stellar Expert** (linked throughout the app).
- **Which wallet types work?** Passkey smart wallets (`C…`), classic accounts (`G…`), and the
  Stellar Wallets Kit multi-wallet picker at `/wallet`.

---

## 8. For developers

Want to run or extend alvinmunk? See:
- **[`README.md`](../README.md)** — architecture and the "no standing backend" decision.
- **[`docs/DEPLOY.md`](./DEPLOY.md)** — deploy your own instance on testnet.
- **[`docs/ON_CHAIN_EVENTS.md`](./ON_CHAIN_EVENTS.md)** — the canonical on-chain event schema.
- **[`CONTRIBUTING.md`](../CONTRIBUTING.md)** — how to contribute.
