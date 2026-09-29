# Design System — Tokens

_Implementable design tokens for [BRAND_DESIGN.md](./BRAND_DESIGN.md). Drop-in for
shadcn/ui (token names match its convention). Dark-first: dark is the default theme, and a
light theme (`:root.light`) redefines every token (see §8)._

---

## 1. Color tokens (CSS variables, HSL — shadcn-compatible)

```css
/* apps/web/src/app/globals.css */
:root {
  color-scheme: dark;

  /* Near-black violet base — "living cosmos" */
  --background: 264 52% 4.5%;        /* #0B0512 */
  --foreground: 250 28% 96%;

  --card: 266 38% 8%;
  --card-foreground: 250 28% 96%;
  --popover: 266 40% 9%;
  --popover-foreground: 250 28% 96%;

  /* Electric violet — primary / on-chain */
  --primary: 265 100% 66%;
  --primary-foreground: 265 60% 6%;

  /* Mint green — earned / verified energy */
  --secondary: 157 84% 52%;
  --secondary-foreground: 265 60% 6%;

  --muted: 265 20% 14%;
  --muted-foreground: 252 14% 67%;

  /* Warm gold — the human/vouch accent, used sparingly */
  --accent: 36 100% 64%;
  --accent-foreground: 265 60% 6%;

  --destructive: 350 82% 62%;
  --destructive-foreground: 265 60% 6%;
  --success: 157 84% 52%;
  --warning: 38 95% 62%;

  --border: 265 26% 16%;
  --input: 265 26% 16%;
  --ring: 265 100% 66%;              /* focus ring = primary */

  /* Brand-specific (not in stock shadcn) */
  --starlight: 250 100% 97%;
  --onchain: 265 100% 66%;           /* alias of primary — violet, on-chain moments only */
  --radius: 0.875rem;

  /* Signature flow + depth surfaces */
  --tertiary: 193 100% 52%;          /* cyan — social / connection */
  --flow-violet: 265 100% 66%;       /* violet stop of .flow (light: 68%, for its dark label) */
  --surface: 266 34% 9%;
  --surface-2: 266 30% 12%;
  --hairline: 260 60% 100%;

  /* Sticker-kit lime — playful human accent (#C4FA4E); never on money/proof UI */
  --lime: 79 94% 64%;
  --lime-foreground: 265 60% 6%;

  /* Decorative tokens (nebula, aurora, glass) */
  --nebula-a: 255 60% 16%;
  --nebula-b: 24 70% 18%;
  --aurora-base: 228 40% 7%;
  --glass-shadow: 230 60% 2%;
}

/* Light theme — the same token set with a pale violet base. */
:root.light {
  color-scheme: light;

  --background: 264 52% 96%;
  --foreground: 265 40% 12%;
  --card: 266 38% 98%;
  --card-foreground: 265 40% 12%;
  --popover: 266 40% 99%;
  --popover-foreground: 265 40% 12%;
  --primary: 265 100% 60%;
  --primary-foreground: 0 0% 100%;
  --secondary: 157 84% 45%;
  --secondary-foreground: 265 60% 8%;
  --muted: 265 20% 94%;
  --muted-foreground: 252 14% 40%;
  --accent: 36 100% 55%;
  --accent-foreground: 265 60% 8%;
  --destructive: 350 82% 55%;
  --destructive-foreground: 265 60% 8%;
  --success: 157 84% 45%;
  --warning: 38 95% 55%;
  --border: 265 26% 85%;
  --input: 265 26% 85%;
  --ring: 265 100% 60%;
  --starlight: 265 60% 15%;
  --onchain: 265 100% 60%;
  --radius: 0.875rem;
  --tertiary: 193 100% 45%;
  --flow-violet: 265 100% 68%;
  --surface: 266 34% 97%;
  --surface-2: 266 30% 93%;
  --hairline: 260 60% 15%;
  --lime: 79 94% 45%;
  --lime-foreground: 265 60% 8%;
  --nebula-a: 255 60% 80%;
  --nebula-b: 24 70% 82%;
  --aurora-base: 228 40% 96%;
  --glass-shadow: 230 40% 30%;
}
```

Both blocks define the same tokens; a token added to one must be added to the other.
`apps/web/src/app/design-tokens.test.ts` fails when either block here drifts from
`globals.css`, so update both files together.

Tailwind wiring (`apps/web/tailwind.config.ts` `theme.extend.colors`): map each to
`hsl(var(--token) / <alpha-value>)` exactly as shadcn does. Add `starlight`, `onchain`,
`tertiary`, `lime`, `surface`, `success`, `warning` as named colors. `hairline`, `flow-violet`
and the decorative tokens are not Tailwind colors; only the `.glass`, `.grid-faint`, `.nebula`,
`.aurora` and `.flow` utilities in `globals.css` read them.

**Usage law:** violet/`onchain` = on-chain / verified moments; mint/`secondary` = earned
energy; gold/`accent` = human warmth (vouch), used sparingly. No raw hex in components —
every color must trace back to a token in this file.

**`onchain` is one colour:** `--onchain` equals `--primary` in both themes, and everything
named `onchain` uses it: `Badge variant="onchain"` (`border-onchain/30 bg-onchain/10
text-onchain`), `Button variant="onchain"` (`bg-onchain text-primary-foreground
shadow-glow-onchain`) and the `shadow-glow-onchain` glow.

**Button labels clear AA (4.5:1) in both themes**, against every colour the background can
show. White fails on the dark theme's 66% violet (4.19:1), so there `--primary-foreground` is
the dark label (4.73:1); the light theme's 60% violet keeps white (5.30:1). `flow` labels use
`--secondary-foreground` over the whole `.flow` sweep (`--flow-violet` → `--tertiary` →
`--secondary`), which is why the light theme's `--flow-violet` is lighter than its `--primary`
(5.02:1 at the violet stop, where 60% would give 3.66:1). `destructive` labels are dark too
(5.61:1 dark, 4.63:1 light). `apps/web/src/app/button-contrast.test.ts` checks every variant.

## 2. Typography scale

```css
--font-display: "Bricolage Grotesque", system-ui, sans-serif;
--font-sans: "Inter", system-ui, sans-serif;
--font-mono: "JetBrains Mono", monospace;
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
- **Radius:** `--radius: 0.875rem` → `sm 0.375rem`, `md 0.625rem`, `lg 0.875rem`,
  `xl 1.125rem` (`tailwind.config.ts` `borderRadius`), `full` for crests/avatars/pills.
- **Borders:** 1px `hsl(var(--border))`; cards use `border + bg-card`.

## 4. Elevation & glow (cosmic, not material)

We don't use heavy drop shadows (Material). We use **soft glow** for warmth and a starfield
backdrop.

Tailwind `boxShadow` (`apps/web/tailwind.config.ts`); the glows read the colour tokens, so
they follow the theme:

```css
shadow-card:         0 1px 0 0 hsl(0 0% 100% / 0.04) inset, 0 8px 30px -12px hsl(230 60% 2% / 0.8);
shadow-glow-primary: 0 0 24px -4px hsl(var(--primary) / 0.45);  /* CTA / ignite moment */
shadow-glow-onchain: 0 0 24px -4px hsl(var(--onchain) / 0.40);  /* on-chain = same violet */
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

These are design values, not CSS variables in `globals.css`: the shipped curves and durations
live in `tailwind.config.ts` `animation` (`fade-up` 0.5s and `ignite` 0.42s on
`cubic-bezier(0.22,1,0.36,1)`, `breathe` 5.2s).

Motion (`motion/react`) presets: `fadeUp` (y:12→0, opacity, `--dur`), `ignite` (scale
0.9→1 + `shadow-glow-primary` bloom, `--dur-slow`), `breathe` (infinite scale 1→1.02 +
opacity), `drift` (star parallax). **All gated by `prefers-reduced-motion`.**

## 6. Z-index scale

`base 0 · starfield -1 · sticky-nav 40 · sticky-cta(mobile) 45 · dropdown 50 · toast 60 ·
modal-overlay 70 · modal 80`.

## 7. Iconography & imagery

- Icons: **lucide-react**, 1.5px stroke, `currentColor`, 20/24px.
- Avatars: the **crest** (constellation) is the default avatar — no stock blockies.
- OG/share cards: generated via `@vercel/og` using these exact tokens (deep-space bg,
  crest, the violet → cyan → mint signature) so shared links carry the brand.

## 8. Theming notes

- Two blocks in `globals.css`: `:root` (dark, the default) and `:root.light`. The theme is
  a `dark` / `light` class on `<html>`: the server renders `dark`, and an inline script in
  the root layout swaps it before first paint to the choice saved by `ThemeToggle`
  (`localStorage` key `alvinmunk.theme`), else the OS `prefers-color-scheme`.
- Tokens are the **only** color source — no raw hex in components. A color not in this
  file does not exist in the product.
