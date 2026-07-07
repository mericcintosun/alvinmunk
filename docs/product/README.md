# alvinmunk — Product & Design Package

This folder turns the belt-driven build into a **product**. It's the single source of
truth for brand, frontend, content, design tokens, go-to-market, and business model —
synthesized from a 6-persona working session (Justin, Nicole, Kaan, Tyler, Elliot, Bri)
plus 2026 frontend research.

> **One line:** *Collect people, not points.* alvinmunk is a social
> "proof-of-people" reputation game where a community vouches for each other. Your
> passport is a **constellation** — every person who vouches for you is a star.

## The documents (read in this order)

| # | Doc | What it answers |
|---|-----|-----------------|
| 1 | [BRAND_DESIGN.md](./BRAND_DESIGN.md) | Who we are, how we look & sound, the constellation metaphor, color/type/motion/voice |
| 2 | [DESIGN_SYSTEM_TOKENS.md](./DESIGN_SYSTEM_TOKENS.md) | Implementable tokens — CSS variables, color/type/space/radius/motion scales |
| 3 | [FRONTEND_PAGES_COMPONENTS.md](./FRONTEND_PAGES_COMPONENTS.md) | Every page + every component, their states and jobs |
| 4 | [FRONTEND_CONTENT.md](./FRONTEND_CONTENT.md) | Real copy for every screen + the microcopy library |
| 5 | [DEPENDENCIES.md](./DEPENDENCIES.md) | The exact frontend stack/libraries, versions, install, risks |
| 6 | [PRODUCT_MARKET_FIT.md](./PRODUCT_MARKET_FIT.md) | Beachhead, the "aha", activation, GTM, how the end user meets us |
| 7 | [BUSINESS_MODEL.md](./BUSINESS_MODEL.md) | How it sustains itself: two-track economics, revenue, treasury, grants |
| + | [DEV_DOCS_OUTLINE.md](./DEV_DOCS_OUTLINE.md) | The `/docs` "for devs" surface — reputation as a readable primitive |

## Non-negotiables (everyone agreed)

- **Wallet code lives behind a client boundary**; marketing pages stay RSC (Lighthouse mobile ≥ 90).
- **Never show a number where you could show a face.** Faces/crests > counters, everywhere.
- **Honest about trust.** Sybil caps, limits, and the two-track model are shown plainly, never hidden.
- **One Next app, route-grouped** (`(marketing)` / `(app)` / `(docs)`), one shared design system.
- **Don't stack major upgrades.** Pin `stellar-sdk` and isolate it behind an adapter.

## Strategic frame (Justin)

Position narrow: not "reputation for everyone" (that's the Galxe/Lens graveyard) but
**"a game where a cohort gets to know each other."** Beachhead = Stellar/Soroban
hackathon & bootcamp cohorts. Distribution is **B2Community2C** — a cohort leader seeds
it, the half-card share link spreads it.
