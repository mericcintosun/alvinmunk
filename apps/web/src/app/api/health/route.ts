/**
 * Health / readiness probe (Green-belt observability). Reports RPC reachability, the
 * resolved network config (validated — see validateNetworkConfig), attester+faucet config
 * presence (NOT the secrets), and the wired contract ids, so uptime checks and the ops
 * status script have a single endpoint to hit. No auth, no secrets — safe to expose.
 * Returns 200 when the core deps look healthy, 503 otherwise.
 *
 * A half-applied mainnet cutover (mainnet passphrase + testnet RPC, or a missing mainnet
 * contract id) shows up here as `configErrors` with a specific reason per problem, so the
 * deploy is caught before it does anything confusing on-chain.
 */
import { rpc } from '@stellar/stellar-sdk';
import { config, configErrors } from '../../../lib/stellar';

export const runtime = 'nodejs';
// Read env + RPC at REQUEST time, never at build. Without this, Next statically
// prerenders this GET (no request input) and freezes a build-time snapshot — where
// "Sensitive" secrets (ATTESTER_SECRET_KEY/USDC_ISSUER_SECRET_KEY) are absent, so the
// probe would falsely report them unconfigured even though they exist at runtime.
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const checks: Record<string, unknown> = {
    network: config.network,
    // Empty array = healthy. Each entry is a specific, actionable reason.
    configErrors,
    attesterConfigured: Boolean(process.env.ATTESTER_SECRET_KEY),
    faucetConfigured: Boolean(process.env.USDC_ISSUER_SECRET_KEY),
    contracts: {
      reputation: config.contracts.reputation || null,
      questRegistry: config.contracts.questRegistry || null,
      rewards: config.contracts.rewards || null,
    },
  };

  let rpcOk = false;
  try {
    const latest = await new rpc.Server(config.rpcUrl, {
      allowHttp: config.rpcUrl.startsWith('http://'),
    }).getLatestLedger();
    rpcOk = true;
    checks.latestLedger = latest.sequence;
  } catch {
    rpcOk = false;
  }
  checks.rpcOk = rpcOk;

  // Config errors alone are enough to fail the probe: a mixed network config would make
  // every transaction fail, so the deploy must not be considered ready.
  const ok = rpcOk && configErrors.length === 0;
  return new Response(JSON.stringify({ ok, ...checks }), {
    status: ok ? 200 : 503,
    headers: { 'content-type': 'application/json' },
  });
}
