# alvinmunk — Pitch Deck (Blue belt)

Slide-by-slide content. Drop each block into Canva / Google Slides / Pitch. Keep one idea per slide, big type, one visual. Suggested length: 12 slides, 3–4 minutes.

---

### 1. Title
**alvinmunk**
Collect people, not points.
A proof-of-people reputation layer on Stellar, with anchor-backed cash-out.
`alvinmunk.vercel.app` · built for the Stellar Journey to Mastery

Visual: the constellation hero.

---

### 2. Problem
- Web3 reputation and quest apps (Galxe, Layer3) are graveyards of one-time mints: no repeat loop, trivially sybil-farmed, and the reputation is not portable.
- The reputation that matters — who vouches for you, what you have really done — is locked in web2 silos.
- Anchors and onboarding platforms burn money telling real, unique people apart from bots at signup; heavy KYC kills conversion.
- New users still hit the seed-phrase and gas wall on day one.

One line: **there is no portable, spendable, sybil-resistant reputation on-chain.**

---

### 3. Solution
alvinmunk turns social proof-of-people into a portable on-chain reputation that is:
- **Built from other people** — you earn it when real humans vouch for you (a social graph, not a résumé).
- **Sybil-resistant by economics** — two tracks keep clout separate from cash.
- **Spendable** — verified reputation unlocks USDC and, through a Stellar anchor, local currency.

Visual: vouch → share link → claim → both earn → cash out.

---

### 4. How it works (the loop)
`mint_vouch (half-card)` → `share link = the invite` → `claim_vouch (both earn Social XP)` → `verified quest = Earned XP` → `rank unlocks reward` → `tip / claim_reward in USDC` → `off-ramp via anchor`.

The share link IS the install funnel: every vouch names a specific person and pulls them in.

---

### 5. Why now / Why Stellar
- Sub-cent fees make every vouch its own on-chain artifact — impossible on other chains.
- Passkey smart wallets: Face ID onboarding, no seed phrase, fees sponsored.
- USDC + anchors (SEP-24) turn reputation into real, cash-outable value.
- Soroban: lean account-keyed reputation + a canonical, append-only attestation event any app can read.

---

### 6. Anti-sybil (the defensible core)
- Two-track XP: Social (clout, never cashable) vs Earned (verified quests, the only track that unlocks USDC).
- Claim-secret vouch: the voucher never knows the claimer; rings can't be pre-computed.
- First-pair-only, daily caps, XP-stake/slash, second-order verification gate.
- Payout gate: proof-of-funding + treasury circuit breaker; demand-funded so payouts scale with real revenue.

**Sybils farm clout, not cash. The treasury is safe.**

---

### 7. Market opportunity
- Every Stellar anchor, ramp, and wallet needs a cheaper anti-fraud signal at onboarding.
- Every creator/builder/student community (Stellar's unit is the individual) needs a way to reward real contributors.
- Reputation infrastructure is a horizontal primitive: one signal, many consumers (anchors, quests, DeFi under-collateralized lending, DAOs).

TAM framing: consumer social + B2B trust-signal + DeFi identity.

---

### 8. Traction (fill with live numbers)
- Live on testnet: `alvinmunk.vercel.app`, 5 Soroban contracts deployed + cross-verified on-chain.
- Belts cleared: White, Yellow, Orange, Idea approved.
- N users onboarded, M vouches, K closed loops (update from Vercel Analytics + the onboarding sheet).
- 134 passing tests, green CI, product analytics live.

---

### 9. Architecture
- Next.js on Vercel, passkey smart wallets (passkey-kit + OZ Channels relayer), Stellar Wallets Kit.
- Five Soroban contracts that call each other: reputation, quest_registry, rewards, gate, registry.
- No standing backend: the app reads chain events over RPC; the only server key is a serverless attester.
- Canonical `att_set` event = the reputation primitive anchors and apps read.

Visual: the README architecture diagram.

---

### 10. Growth strategy
- Viral by construction: the vouch link is the invite (target referral coefficient > 0.3).
- Community-led: onboard whole cohorts (ambassadors, student/builder groups) where people already know each other.
- Sponsored quests: brands/communities fund verifiable quests — the first revenue line.
- B2B wedge: anchors read the reputation signal to cut onboarding fraud.

---

### 11. Roadmap
- **Green:** production MVP, 10 users, SEP-24 cash-out on testnet, analytics live. ✅ in progress
- **Blue:** 50 users, feedback-driven iteration, pitch + demo.
- **Black:** mainnet + audit/security review, 20+ mainnet users, fee-sponsorship + account abstraction (already shipped), anchor off-ramp.
- **Master:** sustained growth, reputation primitive exposed as a public good, demand-funded treasury, revenue from sponsor quests + fees.

---

### 12. Ask / Close
- Reputation that names real humans, spendable in real money, safe from sybils by design.
- Try it: `alvinmunk.vercel.app` · Code: `github.com/mericcintosun/alvinmunk` · Demo: (YouTube link)
- Collect people, not points.
