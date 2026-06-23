/**
 * Anchor off-ramp hook — the IDEA_SUBMISSION anchor angle. Earned rewards + USDC tips
 * are spendable; through a Stellar SEP-24 anchor a user can withdraw to local fiat.
 * We RESERVE the config now (Orange) so the full SEP-24 interactive withdraw + SEP-10
 * auth (Black belt: a real anchor partner + compliance) slots in WITHOUT rework. Until
 * an anchor is configured we surface the path honestly ("coming at mainnet").
 *
 * Anchors also harden the economy: an anchor deposit is the ideal proof-of-funding
 * signal for the payout gate (belts/08) — the cheapest real uniqueness signal short of
 * heavy KYC. So anchors both receive our users and harden Passport's treasury.
 */
export interface AnchorConfig {
  /** SEP-1 stellar.toml host, e.g. "anchor.example.com" */
  homeDomain: string;
  /** SEP-24 transfer server base URL */
  transferServer: string;
}

export function getAnchorConfig(): AnchorConfig | null {
  // Next inlines only LITERAL process.env.NEXT_PUBLIC_* member expressions.
  const homeDomain = process.env.NEXT_PUBLIC_ANCHOR_HOME_DOMAIN ?? '';
  const transferServer = process.env.NEXT_PUBLIC_ANCHOR_TRANSFER_SERVER ?? '';
  if (!homeDomain || !transferServer) return null;
  return { homeDomain, transferServer };
}

export function isAnchorConfigured(): boolean {
  return getAnchorConfig() !== null;
}

/**
 * A safe entry URL to the configured anchor (its SEP-1 home domain). The full SEP-24
 * interactive withdraw (SEP-10 challenge → POST /transactions/withdraw/interactive) is
 * wired at Black belt; this hook reserves the surface so the UI never dead-ends.
 */
export function anchorEntryUrl(): string | null {
  const cfg = getAnchorConfig();
  if (!cfg) return null;
  return cfg.homeDomain.startsWith('http') ? cfg.homeDomain : `https://${cfg.homeDomain}`;
}
