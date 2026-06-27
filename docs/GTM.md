# alvinmunk — Go-to-Market kit (traction sprint)

> Binding constraint = traction. One "yes" from a community lead starts both Orange's 10
> testers and Green's 2-week clock. This is content + outreach, not code.
>
> **Product one-liner:** _Collect people, not points._ A social, proof-of-people reputation
> game on Stellar — someone you trust vouches for you and you become a star in their
> constellation. Passkey/FaceID onboarding (no seed phrase, fees sponsored), spendable
> reputation (USDC tips + rewards).
> **Live:** alvinmunk.vercel.app · **Network:** Stellar testnet.

---

## 1) Five standalone tweets (post one/day, or pick the best 3)

**T1 — the thesis (lead with this)**
> Most "web3 reputation" is just a number going up.
>
> That's a résumé. Not a reputation.
>
> alvinmunk flips it: you don't farm points — someone who trusts you *vouches* for you, and you become a star in their sky.
>
> Collect people, not points. Live on @StellarOrg 👇
> alvinmunk.vercel.app

**T2 — the onboarding wow (demo-friendly)**
> Onboarded a friend to a Stellar app in ~10 seconds today:
>
> → tap "create"
> → Face ID
> → done. on-chain.
>
> no seed phrase. no "write these 12 words." no gas. just a passkey smart wallet.
>
> this is what web3 onboarding should've always felt like. (built with passkey-kit)

**T3 — the mechanic (visual: the constellation)**
> The core loop in alvinmunk:
>
> 1. you vouch for someone — one line, no wallet address needed
> 2. you get a link → they open it → their star ignites
> 3. both of you earn reputation
>
> Your profile becomes a living constellation of the people who back you. 🌌

**T4 — the anti-sybil / "it's real" angle (for the technical crowd)**
> "reputation games get farmed" — yeah, so we split it in two:
>
> • Social XP (vouches) = clout. never cashable.
> • Earned XP (verified quests) = the ONLY thing that unlocks USDC.
>
> + daily caps, first-pair-only, claim-secret vouches. recognition you can't fake into money.

**T5 — the call (recruit the first cohort)**
> Looking for 10 people to break alvinmunk this week. 🛠️
>
> If you're in the @StellarOrg community: vouch for a friend, complete a quest, claim real testnet USDC — and tell me everything that feels janky.
>
> Reply or DM "in" and I'll send you the link + a 60-sec walkthrough.

---

## 2) Launch thread (pin this)

**1/**
> I built alvinmunk: a reputation game on Stellar where you collect *people*, not points.
>
> Here's the idea, the loop, and how to try it in 2 taps 🧵

**2/**
> The problem: every "on-chain reputation" is a score that only goes up. That's a résumé you write about yourself. Nobody trusts a self-reported number.
>
> Real reputation is what *other people* say about you.

**3/**
> So in alvinmunk you don't earn points. You **vouch**.
>
> Write one line about someone you trust ("unblocked me at 2am"). You get a link. They open it → their star ignites in your constellation. Both earn reputation.

**4/**
> No wallet address needed to vouch — the link carries a claim-secret, so you can vouch for someone who hasn't even joined yet. They claim it and bloom. (this is the cold-start fix.)

**5/**
> Onboarding is the part I'm proudest of: pick a handle → Face ID → you're on-chain. A passkey smart wallet, no seed phrase, fees sponsored. ~10 seconds. Grandma-proof.

**6/**
> Reputation is *spendable*. Verified quests earn "Earned XP" → unlock real USDC rewards + tip rail. But vouches (Social XP) are never cashable — that two-track split is the anti-sybil keystone.

**7/**
> All on @StellarOrg — Soroban contracts for reputation, quests, rewards, a handle registry, and a composable reputation "gate" any app can read in one call.

**8/**
> It's live on testnet. I want 10 people to try the full loop and tell me what breaks.
>
> Try it: alvinmunk.vercel.app
> Reply "in" for a 60-sec walkthrough + I'll vouch for you to start. 🌌

---

## 3) 60-second Loom script (screen-record the real app)

**[0–8s] Hook (talking head or text overlay)**
> "Web3 onboarding usually means seed phrases and gas. Watch this instead."

**[8–22s] Onboarding** — share screen, alvinmunk.vercel.app → Open the app
> "I type a handle… hit Create… Face ID… and that's it — I'm on-chain. No seed phrase, no gas, a real smart wallet." (let the FaceID + "you're on-chain" moment land)

**[22–38s] The vouch (the magic)**
> "Now the core idea — I vouch for a friend. One line, no wallet address. I get a link." (copy link) "They open it, their star lights up in my constellation, and we both earn reputation."

**[38–52s] Spend it**
> "Reputation isn't just a number — complete a verified quest, earn XP, and claim real USDC. Here's a claim landing in the wallet." (show reward claim → balance updates)

**[52–60s] CTA**
> "That's alvinmunk — collect people, not points. Link's in the description, I'd love 10 of you to break it this week. DM me 'in'."

**Recording tips:** clear site data first for a fresh passkey; have a 2nd wallet ready to show a claim; keep the cursor calm; 1080p; no audio music needed.

---

## 4) DM templates

**A) Community lead / cohort organizer (the highest-leverage "yes")**
> Hey [name] — I'm building alvinmunk, a proof-of-people reputation game on Stellar (Soroban). It's the Rise-In belt project but I'm taking it seriously as a product.
>
> The onboarding is passkey/Face-ID, no seed phrase, ~10s to on-chain — I think your community would actually *enjoy* it (it's social, not a faucet grind).
>
> I'm looking for one cohort of ~10 to run the loop this week and give brutal feedback. Could I share it in [chapter/Discord/group], or grab 15 min to show you? 60-sec demo: [Loom link]

**B) Individual builder/friend (recruit a tester)**
> quick one — I shipped alvinmunk on Stellar testnet (collect people, not points). Onboarding is Face-ID, no seed phrase. Mind trying the loop and telling me what feels janky? Takes ~3 min: [link]. I'll vouch for you to start so your first star lights up 🌌

**C) Warm re-engage (D7 nudge — for Green's retention)**
> hey! you tried alvinmunk last week — since then [X] new people joined and there's a fresh weekly quest live. your streak's still alive if you vouch this week. 30s: [link]

---

## 5) First-cohort outreach plan (the unlock)

**Goal:** 1 cohort "yes" → 10 external testers (NOT friends/cohort-of-one — Rise-In doesn't count captive cohorts) → starts Orange's tester req + Green's 2-week clock.

**Target list (fill in 10, DM 5–10):**
- [ ] Stellar chapter/ambassador leads (Rise-In Stellar Ambassadors network)
- [ ] Stellar Discord / Telegram community mods
- [ ] Local Stellar/Soroban builder groups
- [ ] Hackathon teammates / other belt builders (cross-vouch)
- [ ] University blockchain clubs

**Sequence:**
1. Post **T1** (thesis) + the launch **thread**, pin the thread.
2. Record the **Loom**, drop the link in the thread's last tweet + your bio.
3. DM 5–10 leads with template **A** (personalize the first line — reference their community).
4. For every "in", send template **B** + the link, and **vouch for them yourself** so their first star is already lit (kills the empty-state).
5. Track: testers who completed vouch + quest (target 10), and who RECEIVED a tip/reward (Green's D7 cohort).

**Measure (write these down — they become the Green/Blue pitch deck):**
- testers onboarded · completed-loop count · # who received USDC · D7 return of USDC-receivers (target ≥30%).

**Two rules from the program:** testers must be **external** (cohort-of-friends doesn't count); and **open an X/Twitter profile now** — it's a Black-belt requirement and the earlier it exists, the more traction compounds.
