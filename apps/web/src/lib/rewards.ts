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
import { invokeAndWait, readContract, args, rewardsId } from './contracts';
import { server, horizon, networkPassphrase, config } from './stellar';
import type { Wallet } from './wallet';

const usdcSacId = () => config.contracts.usdcSac;

// USDC, like every Stellar asset, has 7 decimals (1 USDC = 10_000_000 stroops).
const ONE_USDC = 10_000_000n;

/** Parse a human display amount ("2.5") into i128 stroops. */
export function usdcToStroops(display: string): bigint {
  const [whole, frac = ''] = display.trim().split('.');
  const fracPadded = (frac + '0000000').slice(0, 7);
  return BigInt(whole || '0') * ONE_USDC + BigInt(fracPadded || '0');
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

/** Does this classic account already trust the USDC asset? */
export async function hasUsdcTrustline(address: string): Promise<boolean> {
  try {
    const acct = await horizon.loadAccount(address);
    return acct.balances.some((b) => 'asset_code' in b && b.asset_code === 'USDC');
  } catch {
    return false; // account not found / not funded yet
  }
}

/** Establish the USDC trustline so the wallet can receive tips and rewards. */
export async function enableUsdc(wallet: Wallet): Promise<string> {
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

/** Claim an Earned-XP-gated reward from the treasury (cashable track only). */
export async function claimReward(
  wallet: Wallet,
  rewardId: number,
  threshold: number,
  amount: bigint,
): Promise<void> {
  await invokeAndWait(
    rewardsId(),
    'claim_reward',
    [args.addr(wallet.address), args.u32(rewardId), args.u64(threshold), args.i128(amount)],
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
