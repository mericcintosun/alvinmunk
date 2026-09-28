# How we built a sybil-resistant proof-of-people reputation on Stellar

*A technical write-up of [alvinmunk](https://alvinmunk.vercel.app) — an open-source reputation
game on Stellar/Soroban. Code: [github.com/mericcintosun/alvinmunk](https://github.com/mericcintosun/alvinmunk).*

---

Most on-chain reputation is one of two things: a self-issued résumé (you mint your own badges),
or a pile of one-time attestations that bots farm in minutes. We wanted something different —
reputation that is **made of other people**, is **expensive to fake**, and is actually
**spendable**. This post walks through the three ideas that made alvinmunk work on Stellar, with
pointers into the code.

## 1. The cold-start problem, and the asynchronous vouch

A solo builder can't ask two strangers to stand next to each other and tap. So the core action
is a **one-sided, asynchronous vouch**. You pick someone you trust, write one line about *why*,
and mint a **half-card** bound to `sha256(secret)`. Crucially, **you never enter their
address** — you might not even know it.

The claim-secret rides in the **share link fragment** (`#...`), which browsers never send to a
server. Whoever opens the link binds *their own* address at claim time, and the contract checks
`sha256(secret)` against the stored hash. Two consequences fall out of this design:

1. **The link is the install funnel.** Every vouch is an invite; growth is built into the
   primitive.
2. **Rings can't be pre-computed.** The minter doesn't know the claimer, so an attacker can't
   pre-wire a cluster of fake relationships.

> Code: `contracts/reputation/src/lib.rs` (`mint_vouch`, `claim_vouch`),
> `apps/web/src/lib/reputation.ts`.

## 2. Separating money from fun (the two-track model)

The lethal version of this product pays **both** sides of a free, self-initiable vouch in
cashable value. That's a money printer for sybils. So we split reputation into two tracks:

- **Social XP** — comes from vouches, drives the leaderboard, and is **never cashable**.
- **Earned XP** — comes *only* from attester-verified quests, and is the **only** track the
  `rewards` contract reads.

On top of the split, the anti-sybil design layers several independent guards:

- **First-pair-only** rewards (repeat vouches between the same pair grant 0 XP).
- **Per-day caps** on vouches.
- An **XP stake** that is *slashed* if a vouch is never claimed (spam has a cost).
- A **second-order gate** that only pays the voucher after the claimer does something *verified*.
- A **proof-of-funding gate** plus a **treasury circuit breaker** (daily cap + frozen set) on the
  payout side.

The result: sybils can farm clout all they want, but **every cashable dollar is gated** and, at
scale, backed by real revenue — not by minting.

> Code: the `Social`/`Earned` split in `reputation`; `rewards` reads only `get_earned`;
> `gate` cross-reads reputation for composable access.

## 3. No seed phrase, no gas, no backend

Three production concerns, three deliberate choices:

- **No seed phrase.** Onboarding uses **passkey smart wallets** (secp256r1 / WebAuthn) through
  passkey-kit — an *account-abstraction* smart account. The user signs with Face ID; there's no
  mnemonic to lose.
- **No gas.** Every contract call is **fee-sponsored and fee-bumped** through an OpenZeppelin
  Channels relayer, so a brand-new user never holds XLM to transact.
- **No standing backend.** The leaderboard, activity feed, and public profiles all read Soroban
  **events directly over RPC** — there's no always-on indexer to run. The *only* server-side
  secret is a single serverless **attester** that verifies off-chain evidence and signs it, with
  the contract verifying that signature on-chain.

> Code: `apps/web/src/lib/wallet.ts`, `apps/web/src/app/api/passkey-send/route.ts`,
> `apps/web/src/app/api/attest/route.ts`.

## The long game: a portable primitive

From day one the contract emits a canonical `att_set` event — append-only, retroactively
impossible to forge. That turns alvinmunk's reputation into a **signal any anchor or app can
read** without us building a second write path. `get_score` / `get_earned` / `get_profile` are
pure read adapters over that same event history.

That's the bet: not just a game, but a **portable proof-of-people primitive on Stellar** —
sybil-resistant, spendable, and open source.

---

*Built for the Rise In "Stellar Journey to Mastery" program. Try it on testnet:
[alvinmunk.vercel.app](https://alvinmunk.vercel.app) · Code:
[github.com/mericcintosun/alvinmunk](https://github.com/mericcintosun/alvinmunk) · Tag
`#Stellar #Soroban`.*
