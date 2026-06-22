/**
 * Health / readiness probe (Green-belt observability). Reports RPC reachability,
 * attester+faucet config presence (NOT the secrets), and the wired contract ids, so
 * uptime checks and the ops status script have a single endpoint to hit. No auth, no
 * secrets — safe to expose. Returns 200 when the core deps look healthy, 503 otherwise.
 */
import { rpc } from '@stellar/stellar-sdk';

export const runtime = 'nodejs';

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? 'https://soroban-testnet.stellar.org';

export async function GET(): Promise<Response> {
  const checks: Record<string, unknown> = {
    network: process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? 'testnet',
    attesterConfigured: Boolean(process.env.ATTESTER_SECRET_KEY),
    faucetConfigured: Boolean(process.env.USDC_ISSUER_SECRET_KEY),
    contracts: {
      reputation: process.env.NEXT_PUBLIC_REPUTATION_CONTRACT_ID ?? null,
      questRegistry: process.env.NEXT_PUBLIC_QUEST_REGISTRY_CONTRACT_ID ?? null,
      rewards: process.env.NEXT_PUBLIC_REWARDS_CONTRACT_ID ?? null,
    },
  };

  let rpcOk = false;
  try {
    const latest = await new rpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith('http://') }).getLatestLedger();
    rpcOk = true;
    checks.latestLedger = latest.sequence;
  } catch {
    rpcOk = false;
  }
  checks.rpcOk = rpcOk;

  const ok = rpcOk && Boolean(process.env.NEXT_PUBLIC_REWARDS_CONTRACT_ID);
  return new Response(JSON.stringify({ ok, ...checks }), {
    status: ok ? 200 : 503,
    headers: { 'content-type': 'application/json' },
  });
}
