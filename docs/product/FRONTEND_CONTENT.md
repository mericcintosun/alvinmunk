# Frontend — Content & Copy

_Ship-ready copy for every screen, in the brand voice (plain, honest, active, no-hype,
one voice). English is the product language. Microcopy library at the end._

---

## 1. Landing `/`

**Hero**
- Eyebrow: `Proof-of-people on Stellar`
- Headline: **Collect people, not points.**
- Sub: *Someone you trust vouches for you — and it becomes a star in your constellation.
  The more people back you, the brighter you shine.*
- Primary CTA: **Open the app →** · Secondary: `See how it works`
- Visual: breathing crest + a half-card merging; faint live vouch ticker behind.

**How it works (3 steps)**
1. **Vouch** — Pick someone you trust. Add one line: *why*. → "You light a star for them."
2. **Claim** — They open your link, connect, and claim their half. → "Two halves become one card."
3. **Constellation** — Every vouch adds a star. Your passport grows with your people.

**Why it's different (FeatureGrid)**
- *Names humans, not tasks.* Every card is one person + one moment — never a faceless badge.
- *Honest by design.* Daily caps, first-pair-only, and a separate cashable track keep it real, not farmable. ([Anti-sybil](/how-it-works#anti-sybil))
- *Spendable recognition.* Earned reputation can unlock real USDC rewards — backed, capped, and gated.
- *Yours, on-chain.* Your constellation lives on Stellar and can be read by other apps.

**Leaderboard peek:** "The most-connected this week" → 5 crests + `See the night sky →`.

**Dev teaser:** **Reputation other apps can read.** *One call returns a wallet's score.*
`get_score(address)` → `42` · `Read the docs →`

**Final CTA:** **Someone's waiting to be recognized.** `Open the app →`

## 2. How it works `/how-it-works`

Sections: *The vouch loop* (diagram) · *Two kinds of XP* (Social = clout, never cashable;
Earned = from verified quests, the only cashable track — shown plainly) · *Anti-sybil,
honestly* (caps, first-pair-only, ring detection, proof-of-funding, treasury circuit
breaker) · *Why Stellar* (sub-cent fees, USDC, fast finality).

Copy tone sample: *"We'd rather show you the limits than pretend they don't exist. Vouches
earn clout, not cash. Only attester-verified quests touch the treasury — and even then,
caps and a daily circuit breaker bound every payout."*

## 3. App home `/app`

- Connected, has crest: **"Your constellation"** + crest + `N people have vouched for you`
  (as faces) + primary **"Vouch someone"**.
- Connected, empty: EmptyState — **"Your sky is dark — for now."** *"Vouch for one person
  you trust. They'll vouch back, and your first star lights up."* → `Vouch someone`.
- Not connected: **"Step into your passport."** `Connect wallet` (with "fees sponsored on
  testnet" reassurance).
- Activity feed: VouchTicker scoped to you + NearComplete nudges ("@deniz claimed — vouch
  them back to complete the pair").

## 4. Vouch compose `/app/vouch`

- Title: **"Vouch for someone you trust."**
- Note field label: **"Why them? One line."** placeholder: *"unblocked me at 2am"*.
- Helper: *"You don't need their address — they'll claim with your link."*
- Submit: **"Light their star"** → success → ShareSheet.
- ShareSheet: **"Share their half of the sky."** `Copy link` · `Share on X` · `WhatsApp`.
  Preview: the half-card OG image. Sub: *"They claim it in two taps. You both get the card."*

## 5. Claim funnel `/claim/[id]` (the most important copy)

- **Preview (logged-out):** big half-card, the *voucher's* crest filled, your side a
  glowing empty socket. Headline: **"{voucher} vouched for you."** Their note shown.
  Sub: *"Claim your half of the sky."* Single CTA: **"Claim your star"** (→ connect).
- **Connecting:** "Setting up your passport… fees are on us (testnet)."
- **Claiming:** "Lighting your star…" (TxStatus pending).
- **Merged (success):** the two halves merge with a bloom, the crest gains a star.
  Headline: **"You're connected."** CTA: **"Now vouch someone back →"** (close the loop).
- **Already-claimed:** "This star is already lit." → `Go to your passport`.
- **Invalid/expired:** "This link can't be claimed." → `Open the app` (never a dead end).

## 6. Profile `/u/[handle]`

- Header: crest (large, breathing) + `@handle` + RankBadge + `Joined {date}`.
- Stat row (faces over numbers): **People who vouched** (AvatarStack) · **People you backed**
  · **Verified quests**. Raw counts are secondary text.
- ConstellationGraph: the vouch network as connected stars.
- CTA (others' profile): **"Vouch for @handle"**. (own): **"Share your passport"**.
- Not-found: "No passport here yet — be the first to vouch this handle."

## 7. Leaderboard `/leaderboard`

- Title: **"The most-connected."** Sub: *"Social score · clout, not cash · updates live."*
- Rows: crest + handle + connections (secondary); `you` highlight; `⚠ flagged` with tooltip
  *"reciprocal vouch pair — possible ring"* (honest).
- Empty: **"No constellations yet. Be the first to vouch for ten people."**

## 8. Quests `/app/quests` & Rewards `/app/rewards`

- Quests title: **"Earn it."** Sub: *"Verified actions earn Earned XP — the only kind that
  unlocks USDC. Vouches don't."* Quest CTA: **"Verify"**; success → `+30 Earned XP`.
- Streak: **"🔥 {n}-week streak"** (best {b}). Empty: "Complete a quest this week to start a streak."
- Rewards title: **"Rank rewards."** Row: `{threshold} XP → {amount} USDC`. States:
  `Claim` / `Locked` (needs N more XP) / `Claimed` / `Daily cap reached, try tomorrow` /
  `This wallet is flagged`.

## 9. Wallet `/app/wallet`

- **"Your keys, your passport."** Connect/disconnect (Freighter + in-app dev wallet on
  testnet). Balance (XLM + USDC). `Enable USDC` (trustline) · `Get test USDC` (faucet).
  L1 demo: send XLM (success/fail + hash).

## 10. Microcopy library (reuse everywhere)

| Context | Copy |
|---------|------|
| Vouch CTA | **Vouch for this person** · sub: *Your reputation backs theirs.* |
| Claim CTA | **Claim your star** |
| Loop-back CTA | **Now vouch someone back** |
| Empty (no vouches) | **No vouches yet. Reputation starts with one trusted connection.** |
| Near-complete | **1 step from claiming your star.** |
| Connect reassurance | *Fees are sponsored on testnet — no gas, no seed phrase.* |
| Tx pending | **Lighting your star…** |
| Tx success | **Done — verified on-chain.** (+ explorer link) |
| Tx failed | **That didn't go through.** *Nothing was charged.* `Try again` |
| Already claimed | **This star is already lit.** |
| Rate-limited | **Easy — give it a minute.** |
| Frozen account | **This wallet is flagged for review.** |
| Dev intro | **Stellar Passport turns trust into a number other apps can read.** |
| Footer manifesto | **Reputation should name humans, not hoard points. Lit on Stellar.** |

**Voice checks (every string):** plain? honest? active? hype-free? same voice for users
and devs? If any "no" → rewrite.
