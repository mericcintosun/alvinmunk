/**
 * FOCUS MODE — the anti-sybil validation stance (belts/08). On by default: the dashboard
 * shows ONLY the social loop (vouch → claim → ignite) and hides the cashable / capability
 * surface (verified quests / Earned XP / USDC tips + rank rewards) until that loop is proven.
 *
 * Flip it off to reveal the full product: NEXT_PUBLIC_FOCUS_MODE=false.
 *
 * NEXT_PUBLIC_* is inlined at build time, so this resolves to a constant in the client bundle.
 */
export const FOCUS_MODE = process.env.NEXT_PUBLIC_FOCUS_MODE !== 'false';
