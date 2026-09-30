# Brand & Design — alvinmunk

_The identity. Everything visual and verbal flows from here. Tokens that implement this
live in [DESIGN_SYSTEM_TOKENS.md](./DESIGN_SYSTEM_TOKENS.md)._

_Verified against `apps/web/src/app/globals.css` on 2026-09-30. Every colour in §3 is a
`:root` (dark, default) token, converted from HSL to hex with the CSS Color 4 `hslToRgb`
formula and each channel rounded to the nearest integer. The results equal `BRAND_DARK` in
`apps/web/src/lib/brand-palette.ts`, which `brand-palette.test.ts` recomputes from the
stylesheet._

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

## 3. Color direction

Black-heavy cosmic base · **soft white** text · **electric violet** primary (the chain) ·
**mint** for earned energy · **warm gold** for the human · **cyan** for connection ·
**lime** only in the sticker kit. Stars are cool-white dust over deep space.

| Role | Feel | Token (`:root`) | Hex |
|------|------|-----------------|-----|
| **Deep space** (bg) | near-black with a violet undertone | `--background: 264 52% 4.5%` | `#0A0611` |
| **Soft white** (text) | off-white with a faint violet cast, never pure `#FFF` | `--foreground: 250 28% 96%` | `#F3F2F8` |
| **Electric violet** (primary, `--onchain`) | the chain: on-chain / verified moments | `--primary: 265 100% 66%` | `#9A52FF` |
| **Mint** (secondary) | earned / verified energy | `--secondary: 157 84% 52%` | `#1EEB9D` |
| **Warm gold** (accent) | human warmth: a vouch, your own star; used sparingly | `--accent: 36 100% 64%` | `#FFB647` |
| **Cyan** (tertiary) | social / connection, sky depth | `--tertiary: 193 100% 52%` | `#0ACAFF` |
| **Lime** (sticker kit) | playful, warm/social surfaces only; never money/proof UI | `--lime: 79 94% 64%` | `#C3F94D` |
| **Starlight** (stars) | the brightest star tone, cool white | `--starlight: 250 100% 97%` | `#F2F0FF` |

`globals.css` comments `--background` as `#0B0512` and `--lime` as the asset kit's
`#C4FA4E`. Those are the source colours; the tokens resolve to the hex above. The light
theme (`:root.light`) keeps the same roles with its own values: see
[DESIGN_SYSTEM_TOKENS.md](./DESIGN_SYSTEM_TOKENS.md) §1 and §8.

Rule: **violet = the chain; mint = earned; gold = human; cyan = connection.** A page is
mostly black + soft-white. Violet is the solid default button (`Button variant="primary"`)
and marks on-chain moments (`--onchain` is the same colour). The headline CTAs use the
`.flow` ribbon, the violet → cyan → mint signature gradient. Gold stays sparing ("you" is
always gold), and lime appears only with the sticker kit. Don't let the accents outshine
the violet.

## 4. Logo & marks

- **Mark:** a small constellation of four stars joined by a faint starlight line, the top
  star violet (`--primary`) and the other three `--starlight`, in a 24×24 SVG. It is
  `LogoMark` in `components/brand/logo.tsx`.
- **Logo:** `Logo` in the same file is the mark + the lowercase wordmark "alvinmunk" in the
  display face (Bricolage Grotesque, semibold). It links home from the navbar and footer.
  The mark alone, breathing, holds the place of the `/app` 3D hero while three.js loads.
- **Every icon derives from the mark.** `scripts/brand-icons.mjs` redraws the same geometry
  in the dark-theme colours (`--background`, `--starlight` and `--primary`, as hex from
  `BRAND_DARK`) and writes the whole set: `app/favicon.ico` (16/32/48px), `app/icon.svg`,
  `app/apple-icon.png` (180px), the PWA icons in `apps/web/public/assets/brand/` (192,
  512 and maskable 512) and the white notification badge `alvinmunk-badge-96.png`
  (`apps/web/public/sw.js`). To change the mark, edit `logo.tsx` and rerun
  `node scripts/brand-icons.mjs`. `app/brand-icons.test.ts` fails if `icon.svg` drifts
  from the mark's geometry or colours.
- **Share card:** the root OG image (`app/opengraph-image.tsx`, 1200×630, also the
  `twitter:image`) renders `siteCard()` from `lib/og-card.tsx`: the same mark + wordmark,
  the tagline, and a seeded seven-star constellation.
- **Crest:** the generative per-wallet constellation (`Crest` in
  `components/brand/crest.tsx`, drawn from `stampArt` in `@alvinmunk/shared`) is the
  identity mark on the leaderboard, score, claim and invite pages, in onboarding and in the
  wallet button. A profile's *face* is a sticker portrait (`components/Avatar.tsx`) that
  sits beside the crest, never in place of it. The crest is not the favicon.
- **Never** a generic blockchain cube/hexagon. The mark is always a constellation.

_Paths are under `apps/web/src/` unless they start with `apps/` or `scripts/`._

## 5. Typography (humanist + warm, with a chain-mono)

- **Display / headings — Bricolage Grotesque** (variable, free): characterful, warm,
  modern. Carries the "human" feeling in heroes and card titles.
- **Body / UI — Inter** (variable): neutral, legible, excellent at small sizes.
- **Mono — JetBrains Mono**: addresses, hashes, code, the dev docs.

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
- Soft-white on deep-space is about 18:1 (AAA). Button labels clear AA (4.5:1) in both
  themes: the dark theme's violet carries the near-black `--primary-foreground` (white
  would fail there), the light theme's carries white; `app/button-contrast.test.ts` checks
  every variant. Coloured text reads the `--*-text` tokens, which clear 4.5:1 on every
  surface (`app/muted-foreground-contrast.test.ts`).
- Every generative crest has an accessible name (`aria-label`: "Constellation crest for
  @handle — 7 stars").
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

**Depth palette (added to the cosmic base, brand hues kept):** violet = chain, mint =
earned, gold = human, **a cyan `--tertiary` for sky/connection depth**. New surface system:
glassy translucent `--surface` panels with hairline borders + inner highlight, a slow
**aurora** gradient mesh, and a faint technical **grid** (the "engineered" chain-site
motif), masked to fade.

**Interactive primitives (`components/fx`, Magic-UI language, zero heavy deps):**
- **BorderBeam** — a light particle traveling a rounded border (`offset-path`); marks
  the `.flow` headline CTAs (landing, how-it-works, invite, claim, vouch compose).
- **NumberTicker** — count-up for XP / USDC / stats (eases in on scroll).
- **AuroraText** — the kinetic violet → cyan → mint gradient (`.text-gradient`) on
  headline words.

**Typography:** display = Bricolage Grotesque, fluid `.display-hero`
(`clamp(2.75rem,7vw,5.5rem)`, tight tracking) for heroes; `.eyebrow` uppercase kicker
above headings (chain-site rhythm); body Inter; mono for addresses/code.

**Still honors §9 accessibility:** `prefers-reduced-motion` freezes the 3D scenes (rotation,
star pulses and cursor parallax), paints the starfield once without animating it and snaps
NumberTicker to its value; faces/shapes over numbers holds.
