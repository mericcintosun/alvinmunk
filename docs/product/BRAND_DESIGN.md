# Brand & Design — alvinmunk

_The identity. Everything visual and verbal flows from here. Tokens that implement this
live in [DESIGN_SYSTEM_TOKENS.md](./DESIGN_SYSTEM_TOKENS.md)._

---

## 1. The idea in one breath

**Collect people, not points.**

alvinmunk is where a community recognizes its own. Someone you trust *vouches*
for you — they put their reputation behind yours — and that moment becomes a small piece
of on-chain art. The more people vouch for you, the brighter your **constellation**.

This is not a leaderboard of strangers grinding tasks. It's the warm, human opposite of
Galxe/POAP: **"someone saw you and backed you."**

## 2. The central metaphor — the Constellation 🌌

We lean fully into "Stellar" and the user's instinct for **galaxy / stars**:

- Your passport is a **constellation**. Every person who vouches for you is a **star**.
- A vouch link is **"someone lit a star for you — claim your half of the sky."**
- The generative crest (already deterministic per wallet) is reframed as a **personal
  constellation** that grows as your network grows.
- The leaderboard is a **night sky of the most-connected**, not a number column.

Why it works: it unifies the product soul ("collect people") with the visual language
("stars/galaxy") and the chain ("Stellar"). One metaphor, end to end.

## 3. Color direction (synthesizing the user + Kaan)

Black-heavy cosmic base · **soft orange** primary (warmth) · **soft white** foreground ·
violet reserved for on-chain moments. Stars are warm-white dust over deep space.

| Role | Feel | Approx |
|------|------|--------|
| **Deep space** (bg) | near-black, faint blue-violet undertone | `#07080D` |
| **Soft white** (text) | warm off-white, never pure `#FFF` | `#F4F1EA` |
| **Soft orange / amber** (primary) | warmth, "a medal", "someone vouched" | `#FF9E5E` |
| **Stellar violet** (secondary) | cold, used ONLY for on-chain / verified moments | `#A78BFA` |
| **Starlight** (accents) | warm-white + faint amber/violet star dust | `#FFF6E9` |

Rule: **orange = human warmth; violet = the chain.** A page is mostly black + soft-white
with orange as the single warm CTA color; violet appears only when something is *verified
on-chain* (a claim confirms, an attestation lands). Don't let violet compete with orange.

## 4. Logo & marks

- **Wordmark:** "alvinmunk" in the display face; the dot/▲ of the mark is a small star.
- **Crest mark:** a 5–7 point constellation derived from the wallet seed (we already
  generate this in `GenesisStamp`). It doubles as favicon, avatar, and OG anchor.
- **Never** a generic blockchain cube/hexagon. The mark is always a constellation.

## 5. Typography (humanist + warm, with a chain-mono)

- **Display / headings — Bricolage Grotesque** (variable, free): characterful, warm,
  modern. Carries the "human" feeling in heroes and card titles.
- **Body / UI — Inter** (variable): neutral, legible, excellent at small sizes.
- **Mono — Geist Mono / JetBrains Mono**: addresses, hashes, code, the dev docs.

Pairing rationale: a characterful humanist display + a neutral humanist body is the 2026
"warm product" pattern; mono signals the on-chain layer. Load via `next/font` (self-hosted,
no layout shift). Type scale lives in the tokens doc.

## 6. Motion — "the sky breathes" (Kaan)

- Easing: **ease-out, 180–280ms** for UI; nothing snaps.
- The crest **breathes** (slow 4–6s opacity/scale pulse), stars **drift** with subtle
  parallax (respecting `prefers-reduced-motion` — then they're static).
- The signature moment: when a half-card is claimed, the two halves **merge with a light
  bloom** (not confetti) and a star "ignites" in the constellation.
- Library: **Motion** (`motion/react`). Keep it on `whileInView` for the landing and on
  discrete moments in the app — never ambient CPU burn.

## 7. Brand voice (Bri's 5 rules — canonical for ALL copy)

1. **Plain over clever.** "Vouch for someone you trust", not wordplay.
2. **Honest about trust.** Show the sybil caps/limits; trust is built by being transparent.
3. **Active & short.** "Read a score in one call." No passive constructions.
4. **No hype.** Banned: "revolutionary", "web3 magic", "next-gen". Write the concrete benefit.
5. **One voice, two audiences.** Consumer copy and dev copy share the same calm, human tone.

Signature lines:
- Tagline: **"Collect people, not points."**
- Hero: **"Someone vouched for you. Claim your half of the sky."**
- Manifesto (footer): **"Reputation should name humans, not hoard points. Lit on Stellar."**
- Dev intro: **"alvinmunk turns trust into a number other apps can read."**

## 8. Feelings & anti-patterns

| We feel like… | We are NOT… |
|---------------|-------------|
| being recognized, warmth, a night sky, a keepsake | a quest grind, an airdrop farm, a cold dashboard |
| a face/constellation first | a number/rank first |
| honest and calm | hype, urgency-bait, FOMO |

**Brand promise:** *Here, your reputation has a face — and the people who believe in you
become the stars you carry.*

## 9. Accessibility as brand (non-negotiable)

- Shape + position encode meaning, never color alone (crest vertices, star count).
- Soft-white on deep-space meets AA; orange CTA text uses near-black foreground for AAA.
- Every generative crest ships `alt` text ("a 6-point constellation for @handle").
- `prefers-reduced-motion` disables drift/breathing/bloom.

---

## 10. 2026 Immersive Refresh (implemented)

The metaphor is now **literal and interactive** — the constellation is a real 3D scene,
not just a 2D crest. This is the current shipped design language across landing + app.

**Hero = a live 3D constellation (WebGL / react-three-fiber).** Your star burns at the
center; everyone who vouched you orbits as a star, beamed to you. Hover lights a star
(tooltip: who · note · when), the field tilts to the cursor (parallax) and slowly
rotates. Alive even with an empty sky — orbital rings + drifting particles + a
parallaxing starfield — so a brand-new passport still feels cosmic. three.js is
lazy-loaded (`dynamic(ssr:false)`) so it never touches SSR or the marketing bundle.
Shared scene primitives: `components/brand/constellation-parts` (Star, OrbitRing, glow
sprite); the app hero (`constellation-3d`) and the marketing backdrop
(`constellation-backdrop`) share them so product and pitch are one world.

**Depth palette (added to the cosmic base, brand hues kept):** orange = human,
violet = chain, **+ a cyan `--tertiary` for sky/connection depth**. New surface system:
glassy translucent `--surface` panels with hairline borders + inner highlight, a slow
**aurora** gradient mesh, and a faint technical **grid** (the "engineered" chain-site
motif), masked to fade.

**Interactive primitives (`components/fx`, Magic-UI language, zero heavy deps):**
- **MagicCard** — glass surface with a cursor-tracked spotlight glow; replaces every
  flat `bg-card` box.
- **BorderBeam** — a light particle traveling a rounded border (`offset-path`); marks
  live primary CTAs.
- **NumberTicker** — count-up for XP / USDC / stats (eases in on scroll).
- **AuroraText / ShinyText** — kinetic gradient headline + shimmering eyebrows.

**Typography:** display = Bricolage Grotesque, fluid `.display-hero`
(`clamp(2.75rem,7vw,5.5rem)`, tight tracking) for heroes; `.eyebrow` uppercase kicker
above headings (chain-site rhythm); body Inter; mono for addresses/code.

**Still honors §9 accessibility:** `prefers-reduced-motion` calms autonomous motion
(rotation/drift/ticker) while keeping cursor parallax; faces/shapes over numbers holds.
