# Frontend — Pages & Components

_The complete surface. Page map (Kaan) inside the architecture (Tyler), with reuse notes
(Elliot). No phasing — this is the full product; build order is a separate concern._

---

## 1. App Router structure (one Next app, route groups)

```
apps/web/src/app/
  (marketing)/                 # RSC, static/ISR, NO wallet code (Lighthouse ≥90)
    layout.tsx                 # marketing nav + footer + starfield
    page.tsx                   # / landing
    how-it-works/page.tsx
    manifesto/page.tsx         # optional brand page
  (app)/                       # client-island; wallet lives here only
    layout.tsx                 # app nav + WalletProvider + Toaster + QueryProvider
    app/page.tsx               # /app — the home surface (vouch + activity)
    vouch/page.tsx             # compose a vouch (or modal over /app)
    quests/page.tsx            # verified quests + streak
    rewards/page.tsx           # rank → reward table + claim
    wallet/page.tsx            # connect / balance / classic L1 demo
    u/[handle]/page.tsx        # public profile (also reachable unauth)
    leaderboard/page.tsx       # night sky of the most-connected
  claim/[id]/page.tsx          # VIRAL funnel — unauth-first, its own minimal chrome
  (docs)/docs/[[...slug]]/page.tsx   # Fumadocs (for-devs)
  api/{attest,faucet,health,og}/route.ts
  layout.tsx                   # root: fonts, theme, <Starfield/>, metadata
```

Rationale (Tyler): one deploy, one design system. Marketing is RSC + zero wallet JS;
the `(app)` group is where `"use client"` + wallet + TanStack Query live. `claim/[id]`
sits outside both groups because it must render for logged-out visitors and is the most
shared URL — minimal chrome, maximum funnel.

## 2. Page map — every page, its job, its states

### Marketing
| Route | Job | Key states |
|-------|-----|-----------|
| `/` **Landing** | 3-second "what + why you"; the constellation promise; single CTA | hero, how-it-works strip, live-vouch ticker, leaderboard peek, dev teaser, footer |
| `/how-it-works` | trust & mechanics: vouch → claim → constellation; two-track honesty | static |
| `/manifesto` *(opt)* | brand story "collect people, not points" | static |

### App (wallet behind client boundary)
| Route | Job | States |
|-------|-----|--------|
| `/app` | home: your crest, "vouch someone", recent activity, near-complete nudges | connected / not-connected / empty / loading |
| `/app/vouch` | compose a vouch → ShareSheet with link + OG preview | idle / submitting / success(link) / error |
| `/app/quests` | verified quests (Earned XP) + weekly streak | locked / available / verifying / done / error |
| `/app/rewards` | rank→reward unlock table + claim | locked / unlockable / claimed / cap-reached / frozen |
| `/app/wallet` | connect/disconnect, balance, USDC trustline, classic L1 demo | disconnected / connecting / connected |
| `/u/[handle]` **Profile** | the shareable identity: constellation, vouch network, rank, moments | own / others' / not-found / loading |
| `/leaderboard` | most-connected night sky (faces, not numbers) | loading / empty / ranked / you-highlighted / flagged |

### Funnel & Docs
| Route | Job | States |
|-------|-----|--------|
| `/claim/[id]` **Claim** | THE viral moment; works logged-out | preview(unauth) / connecting / claiming / merged(success) / already-claimed / invalid / expired |
| `/docs/**` | for-devs: read reputation in one call | see [DEV_DOCS_OUTLINE.md](./DEV_DOCS_OUTLINE.md) |

## 3. Navbar & Footer (exact contents)

**Navbar — marketing (desktop):** left logo (crest + "Passport") · center `How it works`
· `Leaderboard` · `Docs` · right `Open app →` (primary). **Mobile:** logo + hamburger;
sheet menu with the same links + full-width `Open app` pinned bottom.

**Navbar — app (desktop):** left logo → `/app` · center `Vouch` · `Quests` · `Rewards`
· `Leaderboard` · right **Connect Wallet** (connected = mini-crest + `@handle` +
balance pill). **Mobile:** logo + crest avatar (opens menu) + a bottom tab bar
(`Home / Vouch / Quests / You`) for thumb reach; Connect as a sticky CTA when disconnected.

**Footer (all pages):**
- Manifesto line: *"Reputation should name humans, not hoard points. Lit on Stellar."*
- **Product:** App · Vouch · Leaderboard · Rewards
- **Learn:** How it works · Anti-sybil · Docs
- **Community:** X · GitHub · Discord
- Bottom row: © · "Live on Stellar **testnet**" badge · network/contract status link (`/api/health`).

## 4. Component inventory

### `components/ui/` — primitives (shadcn-style, owned)
`Button` (variants: primary/secondary/ghost/outline; sizes) · `Card` · `Badge` ·
`Input` · `Textarea` · `Label` · `Dialog`/`Modal` · `Sheet` (mobile menu) ·
`DropdownMenu` · `Tabs` · `Tooltip` · `Skeleton` · `Avatar` · `Progress` (+ `ProgressRing`)
· `Toaster` (Sonner) · `Separator` · `ScrollArea`.

### `components/brand/` — the identity
- **`Logo`** — crest mark + wordmark; `size`, `markOnly`.
- **`Crest`** — the deterministic **constellation** from wallet seed (refactor of
  `GenesisStamp`); props `address`, `size`, `animate(breathe)`, `alt`. Default avatar.
- **`Starfield`** — fixed cosmic backdrop; parallax on scroll; off under reduced-motion.
- **`ConstellationGraph`** — a profile's vouch network rendered as connected stars.

### `components/cards/` — the artifacts (reuse existing behavior, new shell)
- **`HalfCard` / `FullCard`** — the vouch artifact; half = glowing empty socket, full =
  merged with both crests + the one-line note + moment/date.
- **`VouchCompose`** *(exists)* — note input → mint → ShareSheet.
- **`ShareSheet`** — copy link · X · WhatsApp · auto OG preview image of the half-card.
- **`QuestCard`** *(exists → reskin)* — title, evidence, `ProgressRing`, verify CTA.
- **`RewardRow`** *(exists in `Rewards.tsx` → reskin)* — threshold→USDC, claim/locked/claimed.
- **`TipModal`** *(exists in `Tip.tsx` → modal)* — enable USDC, faucet, send tip.

### `components/social/`
- **`RankBadge`** — rank tier as a constellation tier, not a raw number.
- **`StreakFlame`** — 🔥 weekly streak (current + best).
- **`AvatarStack`** — "vouched by" faces (crests) with overflow `+N`.
- **`VouchTicker`** — live "Ayşe lit a star for Mehmet · 2m" stream (landing + app).
- **`LeaderboardRow`** — crest + handle + connection count secondary; `you` / `flagged ⚠`.

### `components/states/` — never a dead end (Kaan)
- **`EmptyState`** (icon + warm line + single action) — e.g. "No vouches yet. Reputation
  starts with one trusted connection."
- **`NearComplete`** — "1 step from claiming your star."
- **`ErrorState`** — tx rejected / network / wallet-missing; always a recovery action.
- **`Skeleton*`** — card, leaderboard row, crest shimmer (never a blank balance).
- **`TxStatus`** — pending/success/failed with explorer link (uses `onchain` violet).

### `components/wallet/` — client boundary
- **`WalletProvider`** — single `"use client"` context wrapping `(app)`; wraps the existing
  `lib/wallet.ts` (dev/freighter/passkey) so feature components never touch `window`.
- **`ConnectButton`** — connect/disconnect; connected = `Crest` + handle + balance pill.
- Load any `window`-touching widget via `dynamic(() => ..., { ssr: false })`.

### `components/marketing/`
`Hero` · `HowItWorksStrip` (3 steps: vouch → claim → constellation) · `FeatureGrid` ·
`LeaderboardPeek` · `DevTeaser` ("read a score in one call") · `CTASection`.

## 5. Reuse map (Elliot)

- **Reuse as-is:** all of `lib/` (wallet, contracts, reputation, rewards, quests,
  leaderboard, stellar, payments, profile, genesis), `packages/shared` pure logic, all
  `api/` routes. Behavior is done; we wrap it in the new shell.
- **Refactor:** `GenesisStamp` → `Crest`; `Quests`/`Tip`/`Rewards`/`VouchCard`/`VouchCompose`
  → consume `components/ui` + `components/cards`; the single `/` page splits into
  `(marketing)/page.tsx` + `(app)/app/page.tsx`.
- **New:** the `ui/`, `brand/`, `states/`, `marketing/`, `wallet/provider` layers; route
  groups; `/u/[handle]`, `/claim` reskin, `(docs)`.

## 6. Cross-cutting requirements

- **Mobile-first**: every screen designed at 360px first; bottom tab bar in `(app)`.
- **Loading**: skeletons everywhere; never a blank/0 balance flash.
- **OG image** per shareable route (`/claim/[id]`, `/u/[handle]`) via `api/og`.
- **a11y**: focus-visible rings (token `--ring`), crest `alt`, reduced-motion, AA contrast.
- **SEO**: marketing + profile pages export `metadata` + dynamic OG; app/claim are `noindex`
  except the public profile.
