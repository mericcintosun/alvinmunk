import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { rpc } from '@stellar/stellar-sdk';

/** The ids the core loop needs, as `readNetworkConfig` resolves them (unset = ''). */
const REQUIRED_IDS = {
  reputation: 'CREP',
  registry: 'CREG',
  questRegistry: 'CQUEST',
  rewards: 'CREWARDS',
};

const { state } = vi.hoisted(() => ({
  state: {
    configErrors: [] as string[],
    config: {
      network: 'testnet',
      rpcUrl: 'https://rpc.test',
      contracts: {} as Record<'reputation' | 'registry' | 'questRegistry' | 'rewards' | 'gate', string>,
    },
  },
}));

vi.mock('@stellar/stellar-sdk', () => {
  return {
    rpc: {
      Server: vi.fn(),
    },
  };
});

// The route reads the app's one resolved config; each test can change it (live getters).
vi.mock('../../../lib/stellar', () => ({
  get config() {
    return state.config;
  },
  get configErrors() {
    return state.configErrors;
  },
}));

import { GET } from './route';

/** A `getLatestLedger()` response whose ledger closed `ageSeconds` ago. */
function freshLatestLedger(ageSeconds = 0) {
  return {
    id: 'abc',
    sequence: 100,
    protocolVersion: '21',
    closeTime: String(Math.floor(Date.now() / 1000) - ageSeconds),
  };
}

function mockServer(getHealth: ReturnType<typeof vi.fn>, getLatestLedger: ReturnType<typeof vi.fn>) {
  // The route calls `new rpc.Server(...)`, and Vitest 4 constructs the implementation with `new`,
  // so it has to be a `function` (an arrow function is not constructible).
  vi.mocked(rpc.Server).mockImplementation(function () {
    return { getHealth, getLatestLedger } as unknown as InstanceType<typeof rpc.Server>;
  });
}

/** An RPC that is up, fresh and keeps a long enough history. */
function healthyRpc() {
  mockServer(
    vi.fn().mockResolvedValue({ status: 'healthy', latestLedger: 100, ledgerRetentionWindow: 20000 }),
    vi.fn().mockResolvedValue(freshLatestLedger(2)),
  );
}

const RELAYER = {
  PASSKEY_RELAYER_URL: 'https://relayer.example.test',
  PASSKEY_RELAYER_API_KEY: 'relayer-api-key-secret',
};
const PUSH = {
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'vapid-public',
  VAPID_PUBLIC_KEY: 'vapid-public',
  VAPID_PRIVATE_KEY: 'vapid-private-secret',
  VAPID_SUBJECT: 'mailto:ops@example.test',
};
// Read from the environment by the route but not set by a test unless it says so.
const OPTIONAL_ENV = [
  'NEXT_PUBLIC_PASSKEY_WALLET_WASM_HASH',
  'ATTESTER_SECRET_KEY',
  'USDC_ISSUER_SECRET_KEY',
  ...Object.keys(RELAYER),
  ...Object.keys(PUSH),
];

describe('/api/health', () => {
  let envBak: NodeJS.ProcessEnv;

  beforeEach(() => {
    envBak = { ...process.env };
    for (const key of OPTIONAL_ENV) delete process.env[key];
    state.configErrors = [];
    state.config.network = 'testnet';
    state.config.contracts = { ...REQUIRED_IDS, gate: '' };
  });

  afterEach(() => {
    process.env = envBak;
    vi.restoreAllMocks();
  });

  it('returns 200 ok when healthy and fresh', async () => {
    const getHealthMock = vi.fn().mockResolvedValue({
      status: 'healthy',
      latestLedger: 100,
      ledgerRetentionWindow: 20000,
    });
    const getLatestLedgerMock = vi.fn().mockResolvedValue(freshLatestLedger(2));
    mockServer(getHealthMock, getLatestLedgerMock);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBeTruthy(); // added by withRoute (#183)
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.rpc).toBe('ok');
    expect(body.latestLedger).toBe(100);
    expect(body.ledgerRetentionWindow).toBe(20000);
    expect(body.rpcWarning).toBeUndefined();
  });

  it('adds warning when retention is too small', async () => {
    const getHealthMock = vi.fn().mockResolvedValue({
      status: 'healthy',
      latestLedger: 100,
      ledgerRetentionWindow: 100,
    });
    const getLatestLedgerMock = vi.fn().mockResolvedValue(freshLatestLedger(2));
    mockServer(getHealthMock, getLatestLedgerMock);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.rpcWarning).toMatch(/RPC retention window \(100\) is smaller than required \(17280\)/);
  });

  it('returns 503 when unhealthy', async () => {
    const getHealthMock = vi.fn().mockResolvedValue({
      status: 'unhealthy',
    });
    const getLatestLedgerMock = vi.fn().mockResolvedValue(freshLatestLedger(2));
    mockServer(getHealthMock, getLatestLedgerMock);

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.rpc).toBe('unhealthy');
  });

  it('returns 503 within the timeout bound when the RPC never responds', async () => {
    vi.useFakeTimers();
    const neverResolves = vi.fn().mockImplementation(() => new Promise(() => {}));
    mockServer(neverResolves, neverResolves);

    const promise = GET();
    // Well past the 5s bound the probe promises, but the promise above never
    // resolves on its own — if the race weren't wired to the RPC calls, this
    // would hang forever instead of settling here.
    await vi.advanceTimersByTimeAsync(6000);

    const res = await promise;
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.rpc).toBe('timeout');
    vi.useRealTimers();
  });

  it('returns 503 when the RPC responds but the latest ledger is stale (stalled ingestion)', async () => {
    const getHealthMock = vi.fn().mockResolvedValue({
      status: 'healthy',
      latestLedger: 100,
      ledgerRetentionWindow: 20000,
    });
    // The RPC answers successfully, but the ledger it reports closed 10
    // minutes ago — well past MAX_LEDGER_AGE_SECONDS, so ingestion is stalled.
    const getLatestLedgerMock = vi.fn().mockResolvedValue(freshLatestLedger(600));
    mockServer(getHealthMock, getLatestLedgerMock);

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.rpc).toBe('stalled');
    expect(body.rpcWarning).toMatch(/stalled/i);
  });

  it('clears the timeout timer once the RPC responds, so it never fires later', async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const getHealthMock = vi.fn().mockResolvedValue({
      status: 'healthy',
      latestLedger: 100,
      ledgerRetentionWindow: 20000,
    });
    const getLatestLedgerMock = vi.fn().mockResolvedValue(freshLatestLedger(2));
    mockServer(getHealthMock, getLatestLedgerMock);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(clearTimeoutSpy).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('probes the RPC of the resolved config', async () => {
    healthyRpc();
    await GET();
    expect(rpc.Server).toHaveBeenCalledWith('https://rpc.test', { allowHttp: false });
  });

  it('returns 503 with each specific reason when the network config is mixed', async () => {
    healthyRpc();
    state.configErrors = [
      'NEXT_PUBLIC_NETWORK_PASSPHRASE is the testnet passphrase, but the network is mainnet',
      'NEXT_PUBLIC_RPC_URL points at testnet, but the network is mainnet: https://soroban-testnet.stellar.org',
    ];

    const res = await GET();

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.rpc).toBe('ok'); // the RPC is fine — the config alone fails the probe
    expect(body.configErrors).toEqual(state.configErrors);
  });

  it('reports an empty configErrors list when the config is consistent', async () => {
    healthyRpc();
    const body = await (await GET()).json();
    expect(body.configErrors).toEqual([]);
    expect(body.network).toBe('testnet');
  });

  it('still returns 503 without a rewards contract id', async () => {
    healthyRpc();
    state.config.contracts.rewards = '';
    const res = await GET();
    expect(res.status).toBe(503);
    expect((await res.json()).contracts.rewards).toBeNull();
  });

  it('reports all five contract ids and the relayer and push flags', async () => {
    healthyRpc();
    Object.assign(process.env, RELAYER, PUSH);
    state.config.contracts.gate = 'CGATE';

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.contracts).toEqual({
      reputation: 'CREP',
      registry: 'CREG',
      questRegistry: 'CQUEST',
      rewards: 'CREWARDS',
      gate: 'CGATE',
    });
    expect(body.relayerConfigured).toBe(true);
    expect(body.pushConfigured).toBe(true);
    expect(body.missing).toEqual([]);
    expect(body.warnings).toEqual([]);
  });

  it.each([
    ['reputation', 'NEXT_PUBLIC_REPUTATION_CONTRACT_ID'],
    ['registry', 'NEXT_PUBLIC_REGISTRY_CONTRACT_ID'],
    ['questRegistry', 'NEXT_PUBLIC_QUEST_REGISTRY_CONTRACT_ID'],
    ['rewards', 'NEXT_PUBLIC_REWARDS_CONTRACT_ID'],
  ] as const)('returns 503 when the %s id is missing', async (key, envName) => {
    healthyRpc();
    state.config.contracts[key] = '';

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.rpc).toBe('ok'); // the config alone fails the probe
    expect(body.contracts[key]).toBeNull();
    expect(body.missing).toEqual([envName]);
  });

  it('warns about unset optional features on testnet without failing', async () => {
    healthyRpc();

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.contracts.gate).toBeNull();
    expect(body.relayerConfigured).toBe(false);
    expect(body.pushConfigured).toBe(false);
    expect(body.missing).toEqual([]);
    expect(body.warnings).toEqual([
      'NEXT_PUBLIC_GATE_CONTRACT_ID is not set: reputation gates are unavailable',
      'PASSKEY_RELAYER_URL, PASSKEY_RELAYER_API_KEY not set: passkey onboarding is unavailable (the dev wallet is used)',
      'NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT not set: push notifications are skipped',
    ]);
  });

  it('names only the push variables that are unset', async () => {
    healthyRpc();
    Object.assign(process.env, PUSH);
    delete process.env.VAPID_SUBJECT; // /api/push/notify skips without it

    const body = await (await GET()).json();
    expect(body.pushConfigured).toBe(false);
    expect(body.warnings).toContain('VAPID_SUBJECT not set: push notifications are skipped');
  });

  it('requires the relayer on mainnet, where the dev wallet is disabled', async () => {
    healthyRpc();
    state.config.network = 'mainnet';

    let res = await GET();
    expect(res.status).toBe(503);
    let body = await res.json();
    expect(body.missing).toEqual(['PASSKEY_RELAYER_URL', 'PASSKEY_RELAYER_API_KEY']);
    expect(body.warnings.some((w: string) => w.includes('PASSKEY_RELAYER'))).toBe(false);

    Object.assign(process.env, RELAYER);
    res = await GET();
    expect(res.status).toBe(200);
    body = await res.json();
    expect(body.relayerConfigured).toBe(true);
  });

  it('requires the relayer once the passkey wallet is enabled', async () => {
    healthyRpc();
    process.env.NEXT_PUBLIC_PASSKEY_WALLET_WASM_HASH = 'abc123';
    process.env.PASSKEY_RELAYER_URL = RELAYER.PASSKEY_RELAYER_URL; // key still unset

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.relayerConfigured).toBe(false);
    expect(body.missing).toEqual(['PASSKEY_RELAYER_API_KEY']);
  });

  it('reports a down RPC and missing ids together', async () => {
    mockServer(
      vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    );
    state.config.contracts.reputation = '';

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.rpc).toBe('unhealthy');
    expect(body.missing).toEqual(['NEXT_PUBLIC_REPUTATION_CONTRACT_ID']);
  });

  it('never echoes a secret, only whether it is set', async () => {
    healthyRpc();
    Object.assign(process.env, RELAYER, PUSH, {
      ATTESTER_SECRET_KEY: 'SATTESTERSECRET',
      USDC_ISSUER_SECRET_KEY: 'SISSUERSECRET',
    });

    const res = await GET();
    const text = await res.text();
    for (const secret of [
      'SATTESTERSECRET',
      'SISSUERSECRET',
      RELAYER.PASSKEY_RELAYER_API_KEY,
      RELAYER.PASSKEY_RELAYER_URL,
      PUSH.VAPID_PRIVATE_KEY,
    ]) {
      expect(text).not.toContain(secret);
    }
    const body = JSON.parse(text);
    expect(body.attesterConfigured).toBe(true);
    expect(body.faucetConfigured).toBe(true);
    expect(body.relayerConfigured).toBe(true);
    expect(body.pushConfigured).toBe(true);
  });
});
