import type { Config } from 'tailwindcss';

/**
 * Stellar Passport design system (docs/product/DESIGN_SYSTEM_TOKENS.md).
 * Dark-first cosmic theme. Colors are CSS variables (HSL) so components never
 * hardcode hex. Legacy tokens (ink/stellar/sigil) are remapped to the brand:
 * stellar = soft-orange primary, sigil = on-chain violet, ink = deep space.
 */
const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: { '2xl': '1152px' },
    },
    extend: {
      colors: {
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        card: {
          DEFAULT: 'hsl(var(--card) / <alpha-value>)',
          foreground: 'hsl(var(--card-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover) / <alpha-value>)',
          foreground: 'hsl(var(--popover-foreground) / <alpha-value>)',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
          foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
          foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
        },
        success: 'hsl(var(--success) / <alpha-value>)',
        warning: 'hsl(var(--warning) / <alpha-value>)',
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
        starlight: 'hsl(var(--starlight) / <alpha-value>)',
        onchain: 'hsl(var(--onchain) / <alpha-value>)',
        tertiary: 'hsl(var(--tertiary) / <alpha-value>)',
        lime: {
          DEFAULT: 'hsl(var(--lime) / <alpha-value>)',
          foreground: 'hsl(var(--lime-foreground) / <alpha-value>)',
        },
        surface: {
          DEFAULT: 'hsl(var(--surface) / <alpha-value>)',
          2: 'hsl(var(--surface-2) / <alpha-value>)',
        },
        // Legacy aliases (existing components) → brand values.
        ink: 'hsl(var(--background) / <alpha-value>)',
        stellar: 'hsl(var(--primary) / <alpha-value>)',
        sigil: 'hsl(var(--secondary) / <alpha-value>)',
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 0.25rem)',
        sm: 'calc(var(--radius) - 0.5rem)',
        xl: 'calc(var(--radius) + 0.25rem)',
      },
      boxShadow: {
        card: '0 1px 0 0 hsl(0 0% 100% / 0.04) inset, 0 8px 30px -12px hsl(230 60% 2% / 0.8)',
        'glow-primary': '0 0 24px -4px hsl(var(--primary) / 0.45)',
        'glow-onchain': '0 0 24px -4px hsl(var(--onchain) / 0.40)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        breathe: {
          '0%,100%': { opacity: '0.9', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.02)' },
        },
        ignite: {
          '0%': { opacity: '0', transform: 'scale(0.9)' },
          '60%': { opacity: '1', transform: 'scale(1.04)' },
          '100%': { transform: 'scale(1)' },
        },
        twinkle: {
          '0%,100%': { opacity: '0.35' },
          '50%': { opacity: '1' },
        },
        float: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        'glow-pulse': {
          '0%,100%': { opacity: '0.5', transform: 'scale(1)' },
          '50%': { opacity: '0.85', transform: 'scale(1.08)' },
        },
        'gradient-pan': {
          '0%,100%': { 'background-position': '0% 50%' },
          '50%': { 'background-position': '100% 50%' },
        },
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'border-beam': {
          '100%': { 'offset-distance': '100%' },
        },
        shiny: {
          '0%': { 'background-position': '200% 0' },
          '100%': { 'background-position': '-200% 0' },
        },
        meteor: {
          '0%': { transform: 'rotate(215deg) translateX(0)', opacity: '0' },
          '10%': { opacity: '1' },
          '70%': { opacity: '1' },
          '100%': { transform: 'rotate(215deg) translateX(-520px)', opacity: '0' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.5s cubic-bezier(0.22,1,0.36,1) both',
        breathe: 'breathe 5.2s ease-in-out infinite',
        ignite: 'ignite 0.42s cubic-bezier(0.22,1,0.36,1) both',
        twinkle: 'twinkle 4s ease-in-out infinite',
        float: 'float 6s ease-in-out infinite',
        'glow-pulse': 'glow-pulse 6s ease-in-out infinite',
        'gradient-pan': 'gradient-pan 6s ease-in-out infinite',
        marquee: 'marquee 40s linear infinite',
        'border-beam': 'border-beam calc(var(--beam-duration, 8s)) linear infinite',
        shiny: 'shiny 4s linear infinite',
        meteor: 'meteor 5s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
