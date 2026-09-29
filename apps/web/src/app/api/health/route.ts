/**
 * Health / readiness probe (Green-belt observability). Reports RPC reachability, the
 * resolved network config and its problems (see validateNetworkConfig), attester+faucet
 * config presence (NOT the secrets), and the wired contract ids, so uptime checks and the
 * ops status script have a single endpoint to hit. No auth, no secrets — safe to expose.
 * Returns 200 when the core deps look healthy, 503 otherwise.
 *
 * A half-applied mainnet cutover (a mainnet passphrase with a testnet RPC, a missing mainnet
 * contract id, …) shows up here as `configErrors`, one specific reason per problem, and
 * fails the probe — the client banner (ConfigStatusBanner) shows the same list.
 */
import { rpc } from '@stellar/stellar-sdk';
import { config, configErrors } from '../../../lib/stellar';

export const runtime = 'nodejs';
// Read env + RPC at REQUEST time, never at build. Without this, Next statically
// prerenders this GET (no request input) and freezes a build-time snapshot — where
// "Sensitive" secrets (ATTESTER_SECRET_KEY/USDC_ISSUER_SECRET_KEY) are absent, so the
// probe would falsely report them unconfigured even though they exist at runtime.
export const dynamic = 'force-dynamic';

// Bound how long the probe waits on the RPC before giving up, so a slow/dead
// endpoint fails the check instead of hanging the request indefinitely.
const RPC_TIMEOUT_MS = 5000;

// Matches the stats route's LIVE_WINDOW (see api/stats/route.ts) — the largest
// ledger window the app scans. An RPC that retains fewer ledgers than this
// silently breaks that scan, so we surface it as a warning here.
const MAX_REQUIRED_WINDOW = 17_280;

// Stellar closes a ledger roughly every 5-6s. If the latest ledger reported by
// the RPC is much older than that, the node has stopped ingesting even though
// it's still answering requests — a "stalled" RPC that a plain reachability
// check would otherwise call healthy. This threshold is a generous multiple of
// the normal close cadence to absorb jitter without masking a real stall.
const MAX_LEDGER_AGE_SECONDS = 30;

type RpcStatus = 'ok' | 'unhealthy' | 'timeout' | 'stalled';

export async function GET(): Promise<Response> {
  const checks: Record<string, unknown> = {
    network: config.network,
    // Empty = the config is consistent. Each entry is a specific, actionable reason.
    configErrors,
    attesterConfigured: Boolean(process.env.ATTESTER_SECRET_KEY),
    faucetConfigured: Boolean(process.env.USDC_ISSUER_SECRET_KEY),
    contracts: {
      reputation: config.contracts.reputation || null,
      questRegistry: config.contracts.questRegistry || null,
      rewards: config.contracts.rewards || null,
    },
  };

  let rpcStatus: RpcStatus = 'unhealthy';
  let rpcWarning: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const server = new rpc.Server(config.rpcUrl, { allowHttp: config.rpcUrl.startsWith('http://') });

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), RPC_TIMEOUT_MS);
    });

    // getHealth() gives status + retention window; getLatestLedger() is the
    // only call that carries the ledger's closeTime, which we need to detect
    // a stalled-but-responding RPC. Run them together so the combined wait is
    // still bounded by the single timeout below.
    const [health, latestLedger] = await Promise.race([
      Promise.all([server.getHealth(), server.getLatestLedger()]),
      timeoutPromise,
    ]);

    if (health.status === 'healthy') {
      checks.latestLedger = health.latestLedger;
      checks.ledgerRetentionWindow = health.ledgerRetentionWindow;

      const ledgerAgeSeconds = Date.now() / 1000 - Number(latestLedger.closeTime);
      if (Number.isFinite(ledgerAgeSeconds) && ledgerAgeSeconds > MAX_LEDGER_AGE_SECONDS) {
        rpcStatus = 'stalled';
        rpcWarning = `Latest ledger is ${Math.round(ledgerAgeSeconds)}s old (max ${MAX_LEDGER_AGE_SECONDS}s) — RPC may be stalled`;
      } else {
        rpcStatus = 'ok';
        checks.latestLedgerAgeSeconds = Math.round(ledgerAgeSeconds);
      }

      if (health.ledgerRetentionWindow != null && health.ledgerRetentionWindow < MAX_REQUIRED_WINDOW) {
        const retentionWarning = `RPC retention window (${health.ledgerRetentionWindow}) is smaller than required (${MAX_REQUIRED_WINDOW})`;
        rpcWarning = rpcWarning ? `${rpcWarning}; ${retentionWarning}` : retentionWarning;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    rpcStatus = message === 'timeout' ? 'timeout' : 'unhealthy';
  } finally {
    clearTimeout(timer);
  }

  checks.rpc = rpcStatus;
  if (rpcWarning) {
    checks.rpcWarning = rpcWarning;
  }

  // A mixed network config fails the probe on its own: every transaction would go wrong.
  const ok = rpcStatus === 'ok' && configErrors.length === 0 && Boolean(config.contracts.rewards);
  return new Response(JSON.stringify({ ok, ...checks }), {
    status: ok ? 200 : 503,
    headers: { 'content-type': 'application/json' },
  });
}
