/**
 * Anchor off-ramp hook — the IDEA_SUBMISSION anchor angle. Earned rewards + USDC tips
 * are spendable; through a Stellar SEP-24 anchor a user can withdraw to local fiat.
 * We RESERVE the config now (Orange) so the full SEP-24 interactive withdraw + SEP-10
 * auth (Black belt: a real anchor partner + compliance) slots in WITHOUT rework. Until
 * an anchor is configured we surface the path honestly ("coming at mainnet").
 *
 * Anchors also harden the economy: an anchor deposit is the ideal proof-of-funding
 * signal for the payout gate (belts/08) — the cheapest real uniqueness signal short of
 * heavy KYC. So anchors both receive our users and harden alvinmunk's treasury.
 */
import type { Wallet } from './wallet';

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
 * A safe entry URL to the configured anchor (its SEP-1 home domain).
 */
export function anchorEntryUrl(): string | null {
  const cfg = getAnchorConfig();
  if (!cfg) return null;
  return cfg.homeDomain.startsWith('http') ? cfg.homeDomain : `https://${cfg.homeDomain}`;
}

export interface AnchorToml {
  transferServer: string;
  webAuthEndpoint?: string;
}

export interface Withdrawal {
  id: string;
  status: string;
  message?: string;
  url?: string;
  token?: string;
}

function homeUrl(homeDomain: string): string {
  return homeDomain.startsWith('http') ? homeDomain : `https://${homeDomain}`;
}

function endpoint(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** Fetch the anchor's SEP-1 metadata and resolve its SEP-24/SEP-10 endpoints. */
export async function fetchAnchorToml(): Promise<AnchorToml> {
  const cfg = getAnchorConfig();
  if (!cfg) throw new Error('Anchor cash-out is not configured.');
  const res = await fetch(endpoint(homeUrl(cfg.homeDomain), '/.well-known/stellar.toml'), {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Anchor metadata unavailable (${res.status}).`);
  const text = await res.text();
  const value = (key: string): string | undefined => {
    const match = text.match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, 'm'));
    return match?.[1];
  };
  return {
    transferServer: value('TRANSFER_SERVER') ?? cfg.transferServer,
    webAuthEndpoint: value('WEB_AUTH_ENDPOINT'),
  };
}

async function authenticate(wallet: Wallet, webAuthEndpoint: string): Promise<string> {
  if (wallet.address.startsWith('C')) {
    throw new Error('This anchor requires a classic wallet signature; passkey cash-out is not supported yet.');
  }
  const challenge = await fetch(`${webAuthEndpoint}?account=${encodeURIComponent(wallet.address)}`, {
    method: 'GET',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(10_000),
  });
  const challengeData = (await challenge.json().catch(() => ({}))) as {
    transaction?: string;
    error?: string;
  };
  if (!challenge.ok || !challengeData.transaction) {
    throw new Error(challengeData.error ?? `Anchor authentication failed (${challenge.status}).`);
  }
  const signed = await wallet.sign(challengeData.transaction);
  const auth = await fetch(webAuthEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ transaction: signed, account: wallet.address }).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  const authData = (await auth.json().catch(() => ({}))) as { token?: string; error?: string };
  if (!auth.ok || !authData.token) {
    throw new Error(authData.error ?? `Anchor authentication failed (${auth.status}).`);
  }
  return authData.token;
}

/** Authenticate with the anchor and create a SEP-24 interactive USDC withdrawal. */
export async function startWithdrawal(wallet: Wallet, amount: string): Promise<Withdrawal> {
  if (!amount.trim() || Number(amount) <= 0 || !/^\d+(\.\d{1,7})?$/.test(amount.trim())) {
    throw new Error('Enter a valid USDC amount (up to 7 decimal places).');
  }
  const metadata = await fetchAnchorToml();
  if (!metadata.webAuthEndpoint) throw new Error('Anchor does not advertise SEP-10 authentication.');
  const token = await authenticate(wallet, metadata.webAuthEndpoint);
  const response = await fetch(endpoint(metadata.transferServer, '/transactions/withdraw/interactive'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      asset_code: 'USDC',
      account: wallet.address,
      amount: amount.trim(),
    }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await response.json().catch(() => ({}))) as {
    id?: string;
    url?: string;
    message?: string;
    error?: string;
  };
  if (!response.ok || !data.id) {
    throw new Error(data.error ?? data.message ?? `Withdrawal could not be started (${response.status}).`);
  }
  return { id: data.id, status: 'pending_user_transfer', url: data.url, message: data.message, token };
}

/** Read the current SEP-24 transaction status. */
export async function getWithdrawalStatus(
  id: string,
  token: string,
  transferServer: string,
): Promise<Withdrawal> {
  const response = await fetch(`${endpoint(transferServer, '/transaction')}?id=${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await response.json().catch(() => ({}))) as Withdrawal & { error?: string };
  if (!response.ok || !data.status) {
    throw new Error(data.error ?? `Could not read withdrawal status (${response.status}).`);
  }
  return { id, status: data.status, message: data.message, url: data.url };
}
