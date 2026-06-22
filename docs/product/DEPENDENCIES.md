# Frontend Dependencies & Stack

_The exact libraries, why each, versions, install, and risk notes. Grounded in 2026
research + the personas' trade-offs. Principle: small dependency surface, owned code,
no stacked major upgrades._

---

## 1. Decisions at a glance

| Layer | Choice | Why (not the alternative) |
|-------|--------|---------------------------|
| Framework | **Next.js 14 → 15** (App Router) | 15 is stable + React 19; jump 14→15 now, defer 16. Don't stack majors. |
| Styling | **Tailwind CSS v3** (hold) | v4 is production-ready but is a ground-up CSS-first rewrite; not worth bundling with other migrations now. |
| Components | **shadcn/ui** (owned, copy-in) | Tailwind-native, zero runtime, you own the code. vs MUI/Mantine runtime theming + bundle lock-in. |
| Primitives | **Radix today → migrate new ones to Base UI / React Aria** | Radix maintenance has slowed; Base UI (MUI team) + React Aria are the active successors. |
| Animation | **Motion** (`motion/react`) | Successor to framer-motion; 120fps hybrid engine, `whileInView`/`useScroll`. |
| Server state | **TanStack Query** (in `(app)` only) | Caching/dedup/`refetchInterval`/retry for RPC polls. vs hand-rolled `useEffect`+`setInterval` (waterfalls, stale bugs). |
| Client state | **Zustand** *(only if needed)* | Server data stays in Query; Zustand only for genuine UI state. Likely not needed yet. |
| Theme | **next-themes** | dark-first, CSS-variable tokens. |
| Icons | **lucide-react** | shadcn standard, 1500+, tree-shakeable. |
| Toasts | **sonner** | shadcn's official toaster. |
| OG images | **@vercel/og** (Satori) | edge dynamic share cards (the viral surface). |
| Docs | **Fumadocs** | Next App-Router-native MDX + auto API tables + search, same repo. |
| Fonts | **next/font** (Bricolage Grotesque, Inter, Geist Mono) | self-hosted, no layout shift. |
| Forms/validation | **react-hook-form + zod** *(light use)* | vouch note / handle inputs; zod already idiomatic. |

Keep existing: `@stellar/stellar-sdk` (**pinned**), `@stellar/freighter-api`, `next`,
`react`, `typescript`, `tailwindcss`, the pnpm+turbo monorepo, `vitest`.

## 2. Install

```bash
# from apps/web
pnpm dlx shadcn@latest init           # wires tailwind tokens + components.json (owned components)
pnpm add motion @tanstack/react-query next-themes lucide-react sonner
pnpm add @vercel/og
pnpm add react-hook-form zod @hookform/resolvers
# docs (can live in the same app under (docs))
pnpm add fumadocs-ui fumadocs-core fumadocs-mdx
# fonts are pulled by next/font at build (Bricolage Grotesque, Inter, Geist Mono)
```

shadcn components are added on demand and **committed into the repo**
(`components/ui/*`) — not a runtime dependency.

## 3. Version pinning & coupling (Tyler/Elliot)

- **`@stellar/stellar-sdk`: pin exact** (`"16.x.y"`, no caret). Protocol-coupled; a silent
  minor can break tx decoding. Keep all SDK usage behind `lib/contracts.ts` + `lib/stellar.ts`
  (the adapter) so a future bump touches one place.
- **Next 14→15**: run `npx @next/codemod upgrade`; audit `fetch` caching + async request
  APIs (`cookies()/headers()` are async in 15). React/react-dom → 19. Node 20+.
- **Tailwind stays v3** until a deliberate, isolated migration (v4 = `@import "tailwindcss"`,
  CSS `@theme`, `@tailwindcss/postcss`). Our tokens are already CSS-variable-based, so a
  later v4 move is low-friction.
- **Do NOT** migrate Next-major + Tailwind-major + SDK-major in the same change. One at a time.

## 4. SSR / wallet boundary (the #1 footgun)

- Wallet code touches `window` → must be client-only. One **`WalletProvider` (`"use client"`)**
  wraps the `(app)` route group; any widget that reads the wallet is imported with
  `dynamic(() => import(...), { ssr: false })`.
- Marketing (`(marketing)`) imports **zero** wallet/SDK code → stays RSC, ships ~no client JS
  (this is what protects Lighthouse mobile ≥ 90).

## 5. Performance budget

- Marketing route JS < ~90KB gzip; app route lazy-loads wallet/Query.
- `next/font` swap + subset; `next/image` for any raster; route-level code splitting by group.
- Starfield/motion gated by `prefers-reduced-motion`; no ambient rAF loops on marketing.

## 6. What we deliberately do NOT add (YAGNI)

Standing backend · custom indexer (RPC-direct + snapshot for now) · i18n framework ·
a separate `packages/ui` (keep components in `apps/web` until a 2nd consumer exists) ·
auth/account system (the wallet is identity) · a CSS-in-JS runtime · a full component
library (MUI/Chakra/Mantine).

## 7. Risk register

| Risk | Mitigation |
|------|-----------|
| Radix slows / a primitive breaks | new primitives from Base UI / React Aria; Radix ones are already vendored via shadcn |
| SDK minor breaks tx decode | exact pin + single adapter module |
| Hydration errors from wallet | client boundary + `dynamic(ssr:false)` |
| OG generation rabbit-hole | start with one template + static fallback, expand later |
| Stacked migrations break everything | one major at a time, each its own green PR |
