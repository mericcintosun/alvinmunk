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
import { Asset, Memo, Operation, StellarToml, TransactionBuilder, WebAuth, type Account } from '@stellar/stellar-sdk';
import { networkPassphrase, server } from './stellar';
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

/** The parts of an anchor's SEP-1 stellar.toml that the SEP-10/SEP-24 flow needs. */
export interface AnchorToml {
  /** SEP-24 base URL (`TRANSFER_SERVER_SEP0024`). */
  transferServer: string;
  /** SEP-10 endpoint (`WEB_AUTH_ENDPOINT`). */
  webAuthEndpoint: string;
  /** SEP-10 server account (`SIGNING_KEY`); every challenge must be signed by it. */
  signingKey: string;
  /** Issuer of the anchor's USDC (`CURRENCIES` entry with code USDC), if advertised. */
  usdcIssuer?: string;
}

/** A SEP-24 withdrawal as the UI tracks it. Field names follow the SEP-24 response. */
export interface Withdrawal {
  id: string;
  status: string;
  message?: string;
  url?: string;
  moreInfoUrl?: string;
  amountIn?: string;
  withdrawAnchorAccount?: string;
  withdrawMemo?: string;
  withdrawMemoType?: 'text' | 'id' | 'hash';
}

/** SEP-24 statuses after which the anchor will not change the transaction again. */
const TERMINAL = new Set(['completed', 'refunded', 'expired', 'error', 'no_market', 'too_small', 'too_large']);
export const isTerminalStatus = (status: string): boolean => TERMINAL.has(status);

/** The home domain without a scheme or trailing slash, as SEP-1/SEP-10 expect it. */
function bareDomain(homeDomain: string): string {
  return homeDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

function endpoint(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

async function readJson<T>(res: Response): Promise<T & { error?: string }> {
  return (await res.json().catch(() => ({}))) as T & { error?: string };
}

/** Resolve the configured anchor's stellar.toml and pick out the SEP-10/SEP-24 fields. */
export async function fetchAnchorToml(): Promise<AnchorToml> {
  const cfg = getAnchorConfig();
  if (!cfg) throw new Error('Anchor cash-out is not configured.');
  const domain = bareDomain(cfg.homeDomain);
  const toml = await StellarToml.Resolver.resolve(domain, {
    allowHttp: cfg.homeDomain.startsWith('http://'),
    timeout: 10_000,
  });
  const transferServer = toml.TRANSFER_SERVER_SEP0024 ?? cfg.transferServer;
  if (!toml.WEB_AUTH_ENDPOINT || !toml.SIGNING_KEY) {
    throw new Error('This anchor does not advertise SEP-10 authentication.');
  }
  const usdc = toml.CURRENCIES?.find((c) => c.code === 'USDC' && c.issuer);
  return {
    transferServer,
    webAuthEndpoint: toml.WEB_AUTH_ENDPOINT,
    signingKey: toml.SIGNING_KEY,
    usdcIssuer: usdc?.issuer,
  };
}

/**
 * SEP-10: fetch a challenge, VERIFY it, sign it and exchange it for a JWT.
 *
 * The challenge is validated with `WebAuth.readChallengeTx` before the wallet sees it:
 * it must be signed by the anchor's SIGNING_KEY, have sequence 0, contain only
 * `manage_data` ops for this home domain and web-auth domain, and be inside its time
 * bounds. Without this check a spoofed or compromised endpoint could hand the wallet an
 * arbitrary transaction — and the built-in dev wallet signs without a prompt.
 */
export async function authenticate(
  wallet: Wallet,
  toml: AnchorToml,
  homeDomain: string,
): Promise<string> {
  if (wallet.address.startsWith('C')) {
    throw new Error('Cash-out needs a classic wallet signature; passkey wallets are not supported yet.');
  }
  const domain = bareDomain(homeDomain);
  const url = `${toml.webAuthEndpoint}?account=${encodeURIComponent(wallet.address)}&home_domain=${encodeURIComponent(domain)}`;
  const challengeRes = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const challenge = await readJson<{ transaction?: string; network_passphrase?: string }>(challengeRes);
  if (!challengeRes.ok || !challenge.transaction) {
    throw new Error(challenge.error ?? `Anchor authentication failed (${challengeRes.status}).`);
  }
  if (challenge.network_passphrase && challenge.network_passphrase !== networkPassphrase) {
    throw new Error('The anchor is on a different Stellar network.');
  }

  const { clientAccountID } = WebAuth.readChallengeTx(
    challenge.transaction,
    toml.signingKey,
    networkPassphrase,
    domain,
    new URL(toml.webAuthEndpoint).host,
  );
  if (clientAccountID !== wallet.address) {
    throw new Error('The anchor challenge is for a different account.');
  }

  const signed = await wallet.sign(challenge.transaction);
  const tokenRes = await fetch(toml.webAuthEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transaction: signed }),
    signal: AbortSignal.timeout(10_000),
  });
  const auth = await readJson<{ token?: string }>(tokenRes);
  if (!tokenRes.ok || !auth.token) {
    throw new Error(auth.error ?? `Anchor authentication failed (${tokenRes.status}).`);
  }
  return auth.token;
}

/** A started withdrawal plus what later calls need (JWT, transfer server, USDC issuer). */
export interface WithdrawalSession {
  withdrawal: Withdrawal;
  token: string;
  toml: AnchorToml;
}

const AMOUNT_RE = /^\d+(\.\d{1,7})?$/;

/** Authenticate and create a SEP-24 interactive USDC withdrawal. */
export async function startWithdrawal(wallet: Wallet, amount: string): Promise<WithdrawalSession> {
  const value = amount.trim();
  if (!AMOUNT_RE.test(value) || Number(value) <= 0) {
    throw new Error('Enter a valid USDC amount (up to 7 decimal places).');
  }
  const cfg = getAnchorConfig();
  if (!cfg) throw new Error('Anchor cash-out is not configured.');
  const toml = await fetchAnchorToml();
  const token = await authenticate(wallet, toml, cfg.homeDomain);

  const body = new URLSearchParams({ asset_code: 'USDC', account: wallet.address, amount: value });
  if (toml.usdcIssuer) body.set('asset_issuer', toml.usdcIssuer);
  const res = await fetch(endpoint(toml.transferServer, '/transactions/withdraw/interactive'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await readJson<{ id?: string; url?: string; message?: string }>(res);
  if (!res.ok || !data.id) {
    throw new Error(data.error ?? data.message ?? `Withdrawal could not be started (${res.status}).`);
  }
  // SEP-24: a freshly created interactive transaction is `incomplete` until the user
  // finishes the anchor's hosted flow.
  return { withdrawal: { id: data.id, status: 'incomplete', url: data.url }, token, toml };
}

/** Read the current SEP-24 transaction. The response nests it under `transaction`. */
export async function getWithdrawalStatus(
  id: string,
  token: string,
  transferServer: string,
): Promise<Withdrawal> {
  const res = await fetch(`${endpoint(transferServer, '/transaction')}?id=${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  const data = await readJson<{
    transaction?: {
      id?: string;
      status?: string;
      message?: string;
      more_info_url?: string;
      amount_in?: string;
      withdraw_anchor_account?: string;
      withdraw_memo?: string;
      withdraw_memo_type?: 'text' | 'id' | 'hash';
    };
  }>(res);
  const tx = data.transaction;
  if (!res.ok || !tx?.status) {
    throw new Error(data.error ?? `Could not read withdrawal status (${res.status}).`);
  }
  return {
    id: tx.id ?? id,
    status: tx.status,
    message: tx.message,
    moreInfoUrl: tx.more_info_url,
    amountIn: tx.amount_in,
    withdrawAnchorAccount: tx.withdraw_anchor_account,
    withdrawMemo: tx.withdraw_memo,
    withdrawMemoType: tx.withdraw_memo_type,
  };
}

function withdrawalMemo(w: Withdrawal): Memo {
  if (!w.withdrawMemo) return Memo.none();
  switch (w.withdrawMemoType) {
    case 'id':
      return Memo.id(w.withdrawMemo);
    case 'hash':
      // SEP-24 sends hash memos base64-encoded; Memo.hash takes hex. (No Buffer: this runs
      // in the browser.)
      return Memo.hash(
        Array.from(atob(w.withdrawMemo), (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join(''),
      );
    default:
      return Memo.text(w.withdrawMemo);
  }
}

/**
 * Build the payment that hands the USDC to the anchor once it reports
 * `pending_user_transfer_start`: `amount_in` to `withdraw_anchor_account`, carrying the
 * anchor's memo so it can match the payment to the withdrawal.
 */
export function buildWithdrawalPayment(source: Account, w: Withdrawal, usdcIssuer: string): string {
  if (w.status !== 'pending_user_transfer_start') {
    throw new Error('The anchor is not waiting for a transfer yet.');
  }
  if (!w.withdrawAnchorAccount || !w.amountIn) {
    throw new Error('The anchor did not say where to send the funds.');
  }
  return new TransactionBuilder(source, { fee: '1000', networkPassphrase, memo: withdrawalMemo(w) })
    .addOperation(
      Operation.payment({
        destination: w.withdrawAnchorAccount,
        asset: new Asset('USDC', usdcIssuer),
        amount: w.amountIn,
      }),
    )
    .setTimeout(60)
    .build()
    .toXDR();
}

/** Sign and submit the withdrawal payment; resolves with the tx hash once it lands. */
export async function sendWithdrawalPayment(
  wallet: Wallet,
  w: Withdrawal,
  usdcIssuer: string | undefined,
): Promise<string> {
  if (!usdcIssuer) throw new Error('This anchor does not publish its USDC issuer.');
  const account = await server.getAccount(wallet.address);
  const signedXdr = await wallet.sign(buildWithdrawalPayment(account, w, usdcIssuer));
  const sent = await server.sendTransaction(TransactionBuilder.fromXDR(signedXdr, networkPassphrase));
  if (sent.status === 'ERROR') throw new Error('The payment to the anchor was rejected.');
  for (let i = 0; i < 30; i++) {
    const res = await server.getTransaction(sent.hash);
    if (res.status === 'SUCCESS') return sent.hash;
    if (res.status === 'FAILED') throw new Error('The payment to the anchor failed on-chain.');
    await new Promise((r) => setTimeout(r, 1000));
  }
  return sent.hash;
}
