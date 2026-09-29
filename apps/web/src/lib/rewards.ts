/**
 * Typed Rewards client — the Green-belt USDC tip rail + Earned-gated reward claim.
 *
 * A tip is a direct USDC transfer wallet -> wallet through the Rewards contract
 * (it emits a `tipped` event for the social feed). USDC is a classic Stellar asset
 * wrapped as a SAC, so a wallet must hold the trustline before it can RECEIVE —
 * `enableUsdc` establishes it. Test USDC is dispensed by the serverless faucet
 * (`/api/faucet`); the issuer key never reaches the client (belts/08 security).
 *
 * Keystone (belts/08-anti-sybil): `claim_reward` reads the EARNED track only —
 * social/vouch XP is never cashable.
 */
import { Asset, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import {
  invokeAndWait,
  invokeAndWaitHash,
  readContract,
  readPublic,
  args,
  rewardsId,
} from './contracts';
import { server, horizon, networkPassphrase, config } from './stellar';
import type { Wallet } from './wallet';

const usdcSacId = () => config.contracts.usdcSac;

// USDC, like every Stellar asset, has 7 decimals (1 USDC = 10_000_000 stroops).
const ONE_USDC = 10_000_000n;

/** Thrown when an amount string is not a valid USDC amount. */
export class InvalidAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAmountError';
  }
}

/** Parse a human display amount ("2.5" or "2,5") into i128 stroops. */
export function usdcToStroops(display: string): bigint {
  const trimmed = display.trim();

  // Digits, with an optional single , or . separator followed by digits — rejects
  // negatives, multiple separators, exponents and any other non-numeric input.
  if (!/^\d*([.,]\d+)?$/.test(trimmed)) {
    throw new InvalidAmountError(`Invalid amount: "${display}"`);
  }

  const normalized = trimmed.replace(',', '.');
  const [whole, frac = ''] = normalized.split('.');
  // Truncate (never round up) beyond 7 decimals, so a tip never over-pays.
  const fracPadded = (frac + '0000000').slice(0, 7);
  const result = BigInt(whole || '0') * ONE_USDC + BigInt(fracPadded || '0');

  // Zero, empty and sub-stroop input (truncates to 0) are not valid amounts.
  if (result <= 0n) {
    throw new InvalidAmountError(`Amount must be greater than zero: "${display}"`);
  }

  return result;
}

/** Check if a string is a valid USDC amount for UI validation (non-throwing). */
export function isValidAmount(display: string): boolean {
  try {
    usdcToStroops(display);
    return true;
  } catch {
    return false;
  }
}

/** Format i128 stroops back to a trimmed display string. */
export function stroopsToUsdc(stroops: bigint): string {
  const neg = stroops < 0n;
  const abs = neg ? -stroops : stroops;
  const frac = (abs % ONE_USDC).toString().padStart(7, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${abs / ONE_USDC}${frac ? '.' + frac : ''}`;
}

/** The classic asset (code:issuer) the USDC SAC wraps, read from the SAC itself. */
let assetCache: Asset | null = null;
export async function getUsdcAsset(source: string): Promise<Asset> {
  if (assetCache) return assetCache;
  const name = await readContract<string>(usdcSacId(), 'name', [], source);
  const [code, issuer] = name.split(':');
  if (!issuer) throw new Error(`USDC SAC is not a classic-asset wrapper (name="${name}")`);
  assetCache = new Asset(code, issuer);
  return assetCache;
}

/** USDC balance in stroops (0 if no trustline / not funded). */
export async function getUsdcBalance(address: string, source: string): Promise<bigint> {
  try {
    const v = await readContract<bigint>(usdcSacId(), 'balance', [args.addr(address)], source);
    return v ?? 0n;
  } catch {
    return 0n;
  }
}

/** Does this account already trust the USDC asset (i.e. can it receive)? */
export async function hasUsdcTrustline(address: string): Promise<boolean> {
  // Contract (C…) accounts — passkey smart wallets — hold SAC tokens directly in contract
  // storage and need no classic trustline; Horizon's /accounts endpoint also rejects C… ids
  // (400). Treat them as always able to receive.
  if (address.startsWith('C')) return true;
  try {
    const acct = await horizon.loadAccount(address);
    return acct.balances.some((b) => 'asset_code' in b && b.asset_code === 'USDC');
  } catch {
    return false; // account not found / not funded yet
  }
}

/** Establish the USDC trustline so the wallet can receive tips and rewards. */
export async function enableUsdc(wallet: Wallet): Promise<string> {
  // Smart wallets (C…) hold the SAC directly and can't author a classic `changeTrust`; no
  // trustline is needed, so this is a no-op for them.
  if (wallet.address.startsWith('C')) return '';
  const asset = await getUsdcAsset(wallet.address);
  const account = await server.getAccount(wallet.address);
  const tx = new TransactionBuilder(account, { fee: '1000', networkPassphrase })
    .addOperation(Operation.changeTrust({ asset }))
    .setTimeout(60)
    .build();
  const signed = TransactionBuilder.fromXDR(await wallet.sign(tx.toXDR()), networkPassphrase);
  const sent = await server.sendTransaction(signed);
  if (sent.status === 'ERROR') {
    throw new Error(`trustline rejected: ${JSON.stringify(sent.errorResult)}`);
  }
  await waitConfirmed(sent.hash);
  return sent.hash;
}

/** Request test USDC from the serverless faucet (testnet only; trustline required first). */
export async function requestTestUsdc(recipient: string): Promise<string> {
  const res = await fetch('/api/faucet', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ recipient }),
  });
  const data = (await res.json().catch(() => ({}))) as { hash?: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? `faucet error ${res.status}`);
  return data.hash ?? '';
}

/** Send a USDC tip wallet -> wallet (through Rewards; emits a `tipped` event). */
export async function tip(wallet: Wallet, to: string, amount: bigint): Promise<void> {
  await invokeAndWait(
    rewardsId(),
    'tip',
    [args.addr(wallet.address), args.addr(to), args.i128(amount)],
    wallet,
  );
}

/** One row of the on-chain rank -> reward unlock table. */
export interface RewardEntry {
  id: number;
  threshold: bigint; // Earned XP required
  amount: bigint; // USDC stroops paid from the treasury
  active: boolean;
  /** Fixed-size pool cap (0 = unlimited). Absent on contracts deployed before supply caps. */
  max_claims?: number;
  /** Claims paid so far. Absent on contracts deployed before supply caps. */
  claims?: number;
  /** Live weekly quest streak required to claim, on top of `threshold` (0 = none). Absent on
   *  contracts deployed before streak-gated rewards. */
  min_streak?: number;
}

/** The full unlock table (admin-registered on-chain). */
export async function getRewards(source: string): Promise<RewardEntry[]> {
  const v = await readContract<RewardEntry[]>(rewardsId(), 'get_rewards', [], source);
  return (v ?? []).filter((r) => r.active);
}

// --- Admin content management. Every write is `admin.require_auth()`-gated on-chain. ---

/** The whole unlock table, INACTIVE rows included — for the admin view. Throws on RPC
 *  failure so an outage isn't shown as an empty table. Players use `getRewards`. */
export async function getAllRewards(): Promise<RewardEntry[]> {
  return (await readPublic<RewardEntry[]>(rewardsId(), 'get_rewards', [])) ?? [];
}

/** Max treasury payout per UTC day, in stroops (0 = unlimited). */
export async function getDailyCap(): Promise<bigint> {
  return BigInt((await readPublic<bigint>(rewardsId(), 'get_daily_cap', [])) ?? 0);
}

/** Register or replace a reward (always saved ACTIVE). Resolves the confirmed tx hash. */
export async function addReward(
  wallet: Wallet,
  id: number,
  threshold: bigint,
  amount: bigint,
): Promise<string> {
  return invokeAndWaitHash(
    rewardsId(),
    'add_reward',
    [args.u32(id), args.u64(threshold), args.i128(amount)],
    wallet,
  );
}

export async function setRewardActive(
  wallet: Wallet,
  id: number,
  active: boolean,
): Promise<string> {
  return invokeAndWaitHash(
    rewardsId(),
    'set_reward_active',
    [args.u32(id), args.bool(active)],
    wallet,
  );
}

/** Cap a reward at `maxClaims` wallets in total (0 = unlimited). */
export async function setRewardSupply(
  wallet: Wallet,
  id: number,
  maxClaims: number,
): Promise<string> {
  return invokeAndWaitHash(
    rewardsId(),
    'set_reward_supply',
    [args.u32(id), args.u32(maxClaims)],
    wallet,
  );
}

/** Per-reward supply counters (a fixed-size pool's cap + running claim count). */
export interface RewardStats {
  claims: number;
  max_claims: number;
}

/** On-chain claim count / cap for a reward (max_claims 0 = unlimited). */
export async function getRewardStats(rewardId: number, source: string): Promise<RewardStats> {
  const v = await readContract<RewardStats>(
    rewardsId(),
    'get_reward_stats',
    [args.u32(rewardId)],
    source,
  );
  return v ?? { claims: 0, max_claims: 0 };
}

/** The live weekly quest streak a reward requires (0 = none). `get_rewards` carries the
 *  same value as `min_streak`. */
export async function getRewardMinStreak(rewardId: number, source: string): Promise<number> {
  const v = await readContract<number>(
    rewardsId(),
    'get_reward_min_streak',
    [args.u32(rewardId)],
    source,
  );
  return Number(v ?? 0);
}

/** Require a live weekly quest streak of `weeks` to claim `rewardId` (0 removes it). A
 *  non-zero minimum needs the rewards contract wired to the QuestRegistry first. */
export async function setRewardMinStreak(
  wallet: Wallet,
  rewardId: number,
  weeks: number,
): Promise<string> {
  return invokeAndWaitHash(
    rewardsId(),
    'set_reward_min_streak',
    [args.u32(rewardId), args.u32(weeks)],
    wallet,
  );
}

/** Has this wallet already claimed `rewardId`? */
export async function isClaimed(rewardId: number, who: string, source: string): Promise<boolean> {
  return (await readContract<boolean>(rewardsId(), 'is_claimed', [args.u32(rewardId), args.addr(who)], source)) ?? false;
}

/**
 * Claim a registered reward from the treasury. The payout amount + threshold are read
 * on-chain from the admin-registered reward — the caller can't dictate them (the
 * treasury is not drainable). Earned-XP-gated (cashable track only).
 */
export async function claimReward(wallet: Wallet, rewardId: number): Promise<void> {
  await invokeAndWait(
    rewardsId(),
    'claim_reward',
    [args.addr(wallet.address), args.u32(rewardId)],
    wallet,
  );
}

async function waitConfirmed(hash: string): Promise<void> {
  for (let i = 0; i < 15; i++) {
    const res = await server.getTransaction(hash);
    if (res.status === 'SUCCESS') return;
    if (res.status === 'FAILED') throw new Error(`tx ${hash} failed on-chain`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}
