/**
 * Health / readiness probe (Green-belt observability). Reports RPC reachability, the
 * resolved network config and its problems (see validateNetworkConfig),
 * attester/faucet/relayer/push config presence (NOT the secrets), and the wired contract
 * ids, so uptime checks and the ops status script have a single endpoint to hit. No auth,
 * no secrets — safe to expose.
 *
 * Returns 200 when the core loop can work: a live RPC, a consistent network config, the
 * reputation, registry, quest registry and rewards ids, and the passkey relayer wherever
 * onboarding depends on it (mainnet, where the dev wallet is disabled, or once the passkey
 * wallet is enabled). Otherwise 503. Unset optional features (gate, relayer elsewhere,
 * push) only add a `warnings` entry.
 *
 * A half-applied mainnet cutover (a mainnet passphrase with a testnet RPC, a missing mainnet
 * contract id, …) shows up here as `configErrors`, one specific reason per problem, and
 * fails the probe — the client banner (ConfigStatusBanner) shows the same list. A missing
 * required id or relayer variable is named in `missing`.
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

// The env var behind each contract id. Every one but the gate is required.
const CONTRACT_ENV = {
  reputation: 'NEXT_PUBLIC_REPUTATION_CONTRACT_ID',
  registry: 'NEXT_PUBLIC_REGISTRY_CONTRACT_ID',
  questRegistry: 'NEXT_PUBLIC_QUEST_REGISTRY_CONTRACT_ID',
  rewards: 'NEXT_PUBLIC_REWARDS_CONTRACT_ID',
  gate: 'NEXT_PUBLIC_GATE_CONTRACT_ID',
} as const;
const REQUIRED_CONTRACTS = ['reputation', 'registry', 'questRegistry', 'rewards'] as const;

/** Names of the variables in `vars` that are unset or empty. */
const unset = (vars: Record<string, string | undefined>) =>
  Object.keys(vars).filter((name) => !vars[name]);

export async function GET(): Promise<Response> {
  const { network } = config;
  const contracts = {
    reputation: config.contracts.reputation || null,
    registry: config.contracts.registry || null,
    questRegistry: config.contracts.questRegistry || null,
    rewards: config.contracts.rewards || null,
    gate: config.contracts.gate || null,
  };
  // What /api/passkey-send needs to sponsor passkey transactions.
  const relayerUnset = unset({
    PASSKEY_RELAYER_URL: process.env.PASSKEY_RELAYER_URL,
    PASSKEY_RELAYER_API_KEY: process.env.PASSKEY_RELAYER_API_KEY,
  });
  // What /api/push/notify needs to send (it skips otherwise), plus the client's key to subscribe.
  const pushUnset = unset({
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT,
  });

  const checks: Record<string, unknown> = {
    network,
    // Empty = the config is consistent. Each entry is a specific, actionable reason.
    configErrors,
    attesterConfigured: Boolean(process.env.ATTESTER_SECRET_KEY),
    faucetConfigured: Boolean(process.env.USDC_ISSUER_SECRET_KEY),
    // Presence only: the relayer API key and the VAPID private key are secrets.
    relayerConfigured: relayerUnset.length === 0,
    pushConfigured: pushUnset.length === 0,
    contracts,
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

  // Onboarding needs the relayer on mainnet (no dev wallet there, docs/DEPLOY_MAINNET.md)
  // and wherever the passkey wallet is switched on.
  const relayerRequired =
    network === 'mainnet' || Boolean(process.env.NEXT_PUBLIC_PASSKEY_WALLET_WASM_HASH);
  const missing = [
    ...REQUIRED_CONTRACTS.filter((key) => !contracts[key]).map((key) => CONTRACT_ENV[key]),
    ...(relayerRequired ? relayerUnset : []),
  ];
  const warnings: string[] = [];
  if (!contracts.gate) {
    warnings.push(`${CONTRACT_ENV.gate} is not set: reputation gates are unavailable`);
  }
  if (!relayerRequired && relayerUnset.length > 0) {
    warnings.push(
      `${relayerUnset.join(', ')} not set: passkey onboarding is unavailable (the dev wallet is used)`,
    );
  }
  if (pushUnset.length > 0) {
    warnings.push(`${pushUnset.join(', ')} not set: push notifications are skipped`);
  }
  checks.missing = missing;
  checks.warnings = warnings;

  // A mixed network config fails the probe on its own: every transaction would go wrong.
  const ok = rpcStatus === 'ok' && configErrors.length === 0 && missing.length === 0;
  return new Response(JSON.stringify({ ok, ...checks }), {
    status: ok ? 200 : 503,
    headers: { 'content-type': 'application/json' },
  });
}
