# Design System — Tokens

_Implementable design tokens for [BRAND_DESIGN.md](./BRAND_DESIGN.md). Drop-in for
shadcn/ui (token names match its convention). Dark-first; this product is dark by default
and may never ship a light theme — but tokens are structured so it could._

---

## 1. Color tokens (CSS variables, HSL — shadcn-compatible)

```css
/* apps/web/src/app/globals.css */
:root {
  /* Deep-space base */
  --background: 230 33% 4%;          /* #07080D */
  --foreground: 40 33% 94%;          /* #F4F1EA soft white */

  --card: 228 24% 7%;                /* #0E1018 lifted surface */
  --card-foreground: 40 33% 94%;
  --popover: 228 24% 8%;
  --popover-foreground: 40 33% 94%;

  /* Soft orange — the ONE warm CTA color */
  --primary: 24 100% 68%;            /* #FF9E5E */
  --primary-foreground: 230 33% 6%;  /* near-black on orange (AAA) */

  /* Stellar violet — on-chain / verified moments ONLY */
  --secondary: 255 92% 76%;          /* #A78BFA */
  --secondary-foreground: 230 33% 6%;

  --muted: 228 14% 13%;
  --muted-foreground: 40 8% 64%;     /* warm gray */

  --accent: 28 90% 60%;              /* amber accent (hover/active warmth) */
  --accent-foreground: 230 33% 6%;

  --destructive: 0 72% 58%;
  --destructive-foreground: 40 33% 96%;
  --success: 150 55% 55%;
  --warning: 38 95% 60%;

  --border: 228 16% 16%;
  --input: 228 16% 16%;
  --ring: 24 100% 68%;               /* focus ring = primary */

  /* Brand-specific (not in stock shadcn) */
  --starlight: 40 100% 95%;          /* #FFF6E9 warm star */
  --star-dim: 40 20% 70%;            /* faint star dust */
  --onchain: 255 92% 76%;            /* alias of secondary for clarity in code */
  --radius: 0.75rem;
}
```

Tailwind wiring (v3 `tailwind.config.ts` `theme.extend.colors`): map each to
`hsl(var(--token) / <alpha-value>)` exactly as shadcn does. Add `starlight`, `onchain`,
`success`, `warning` as named colors.

**Usage law:** orange = human/CTA; violet(`onchain`) = verified-on-chain only; everything
else is deep-space + soft-white. Max **one** orange CTA per viewport.

## 2. Typography scale

```css
--font-display: "Bricolage Grotesque", system-ui, sans-serif;
--font-sans: "Inter", system-ui, sans-serif;
--font-mono: "Geist Mono", "JetBrains Mono", monospace;
```

| Token | size / line-height | use |
|-------|--------------------|-----|
| `display-2xl` | 3.75rem / 1.05, display, -0.02em | hero headline |
| `display-xl` | 2.75rem / 1.1, display | section heroes |
| `h1` | 2rem / 1.15, display | page titles |
| `h2` | 1.5rem / 1.2 | card group titles |
| `h3` | 1.125rem / 1.3, semibold | card titles |
| `body` | 1rem / 1.6, sans | default |
| `small` | 0.875rem / 1.5 | secondary |
| `caption` | 0.75rem / 1.4, muted | meta, timestamps |
| `mono` | 0.875rem / 1.5, mono | addresses, hashes |

Load with `next/font` (variable, `display: "swap"`, subset latin). Headings get
`font-feature-settings` defaults; mono for any `G…`/hash with middle-truncation.

## 3. Spacing, radius, layout

- **Spacing:** Tailwind default 4px scale. Section vertical rhythm: `py-16 md:py-24`.
- **Container:** `max-w-md` (app surfaces, mobile-first) · `max-w-6xl` (marketing).
- **Radius:** `--radius: 0.75rem` → `sm 0.5rem`, `md 0.75rem`, `lg 1rem`, `xl 1.5rem`,
  `full` for crests/avatars/pills.
- **Borders:** 1px `hsl(var(--border))`; cards use `border + bg-card`.

## 4. Elevation & glow (cosmic, not material)

We don't use heavy drop shadows (Material). We use **soft glow** for warmth and a starfield
backdrop.

```css
--shadow-card: 0 1px 0 0 hsl(0 0% 100% / 0.04) inset, 0 8px 30px -12px hsl(230 60% 2% / 0.8);
--glow-primary: 0 0 24px -4px hsl(24 100% 68% / 0.45);   /* CTA / ignite moment */
--glow-onchain: 0 0 24px -4px hsl(255 92% 76% / 0.40);   /* verified moment */
```

`.starfield` utility: fixed, pointer-events-none, low-opacity radial-gradient dots +
optional `<Stars/>` canvas layer (parallax on scroll, off under reduced-motion).

## 5. Motion tokens

```css
--ease-out: cubic-bezier(0.22, 1, 0.36, 1);
--dur-fast: 140ms;
--dur: 220ms;       /* default UI */
--dur-slow: 420ms;  /* card merge / reveal */
--breathe: 5200ms;  /* crest pulse loop */
```

Motion (`motion/react`) presets: `fadeUp` (y:12→0, opacity, `--dur`), `ignite` (scale
0.9→1 + `--glow-primary` bloom, `--dur-slow`), `breathe` (infinite scale 1→1.02 +
opacity), `drift` (star parallax). **All gated by `prefers-reduced-motion`.**

## 6. Z-index scale

`base 0 · starfield -1 · sticky-nav 40 · sticky-cta(mobile) 45 · dropdown 50 · toast 60 ·
modal-overlay 70 · modal 80`.

## 7. Iconography & imagery

- Icons: **lucide-react**, 1.5px stroke, `currentColor`, 20/24px.
- Avatars: the **crest** (constellation) is the default avatar — no stock blockies.
- OG/share cards: generated via `@vercel/og` using these exact tokens (deep-space bg,
  crest, soft-orange accent) so shared links carry the brand.

## 8. Theming notes

- Single `globals.css :root` block; `next-themes` with `defaultTheme="dark"`,
  `forcedTheme="dark"` until/unless a light theme is designed.
- Tokens are the **only** color source — no raw hex in components. A color not in this
  file does not exist in the product.
