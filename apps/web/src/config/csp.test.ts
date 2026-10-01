// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readNetworkConfig } from '@alvinmunk/shared';
import { NETWORKS } from '@alvinmunk/sdk';
import { CSP_REPORT_PATH, contentSecurityPolicy } from './csp.mjs';

type Env = Record<string, string | undefined>;

/** The policy as directive → sources. */
function parse(policy: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    expect(out[name], `directive ${name} appears twice`).toBeUndefined();
    out[name] = sources;
  }
  return out;
}
const csp = (env: Env = {}) => parse(contentSecurityPolicy({ NODE_ENV: 'production', ...env }));
const origin = (url: string) => new URL(url).origin;

const MAINNET: Env = {
  NEXT_PUBLIC_STELLAR_NETWORK: 'mainnet',
  NEXT_PUBLIC_RPC_URL: 'https://rpc.mainnet.example.com/v1/soroban',
};

describe('contentSecurityPolicy', () => {
  it('lets the client reach the default testnet RPC, Horizon and Friendbot', () => {
    expect(csp()['connect-src']).toEqual([
      "'self'",
      'https://soroban-testnet.stellar.org',
      'https://horizon-testnet.stellar.org',
      'https://friendbot.stellar.org',
    ]);
  });

  it('follows a mainnet cutover: its RPC origin and SDF Horizon, no Friendbot, no testnet Horizon', () => {
    const connect = csp(MAINNET)['connect-src'];
    expect(connect).toEqual([
      "'self'",
      'https://rpc.mainnet.example.com',
      'https://horizon.stellar.org',
      // the ?network=testnet read-only views (lib/read-network)
      'https://soroban-testnet.stellar.org',
    ]);
    expect(connect.join(' ')).not.toMatch(/horizon-testnet|friendbot/);
  });

  // The client builds its RPC and Horizon clients from readNetworkConfig: whatever it
  // resolves, the policy must allow — env overrides, blanks, defaults and odd casing alike.
  it.each<[string, Env]>([
    ['no env', {}],
    ['testnet overrides', { NEXT_PUBLIC_RPC_URL: 'https://rpc.test:8443/x', NEXT_PUBLIC_HORIZON_URL: 'https://horizon.test' }],
    ['blank overrides', { NEXT_PUBLIC_RPC_URL: '  ', NEXT_PUBLIC_HORIZON_URL: '' }],
    ['mainnet', MAINNET],
    ['mainnet, padded and capitalised', { ...MAINNET, NEXT_PUBLIC_STELLAR_NETWORK: ' Mainnet ' }],
    ['a local quickstart over http', { NEXT_PUBLIC_RPC_URL: 'http://localhost:8000/soroban/rpc', NEXT_PUBLIC_HORIZON_URL: 'http://localhost:8000' }],
  ])('allows the RPC and Horizon the client resolves (%s)', (_, env) => {
    const { rpcUrl, horizonUrl } = readNetworkConfig(env);
    const connect = csp(env)['connect-src'];
    expect(connect).toContain(origin(rpcUrl));
    expect(connect).toContain(origin(horizonUrl));
  });

  it('adds the anchor from its bare SEP-1 home domain and its transfer server', () => {
    const connect = csp({
      NEXT_PUBLIC_ANCHOR_HOME_DOMAIN: 'testanchor.stellar.org',
      NEXT_PUBLIC_ANCHOR_TRANSFER_SERVER: 'https://transfer.example.com/sep24',
    })['connect-src'];
    expect(connect).toContain('https://testanchor.stellar.org');
    expect(connect).toContain('https://transfer.example.com');
    expect(csp({ NEXT_PUBLIC_ANCHOR_HOME_DOMAIN: 'http://localhost:4000' })['connect-src']).toContain(
      'http://localhost:4000',
    );
  });

  it('never lets an env value add a source or a directive of its own', () => {
    const policy = contentSecurityPolicy({
      NODE_ENV: 'production',
      NEXT_PUBLIC_RPC_URL: "https://rpc.example.com/; script-src 'unsafe-eval' *",
      NEXT_PUBLIC_HORIZON_URL: "https://evil.com;script-src'unsafe-eval'",
      NEXT_PUBLIC_ANCHOR_HOME_DOMAIN: 'evil.com,frame-src',
      NEXT_PUBLIC_ANCHOR_TRANSFER_SERVER: 'javascript:alert(1)',
    });
    const d = parse(policy);
    expect(d['connect-src']).toEqual(["'self'", 'https://rpc.example.com', 'https://friendbot.stellar.org']);
    expect(d['script-src']).toEqual(["'self'", "'unsafe-inline'"]);
    expect(d['frame-src']).toEqual(["'none'"]);
    expect(policy).not.toMatch(/\*|javascript:|evil|unsafe-eval/);
  });

  it("allows Next's inline bootstrap and the layout's theme script, and nothing else inline-ish", () => {
    const script = csp()['script-src'];
    expect(script).toEqual(["'self'", "'unsafe-inline'"]);
    // A hash or nonce would make browsers ignore 'unsafe-inline' and block every inline
    // script, including the pre-paint theme script in app/layout.tsx.
    expect(script.join(' ')).not.toMatch(/'(sha256|sha384|sha512|nonce)-/);
  });

  it('allows eval and the Vercel debug scripts only in development', () => {
    const dev = csp({ NODE_ENV: 'development' })['script-src'];
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).toContain('https://va.vercel-scripts.com');
    expect(csp()['script-src']).not.toContain("'unsafe-eval'");
  });

  it('allows inline styles and the Stellar Wallets Kit wallet icons', () => {
    const d = csp();
    expect(d['style-src']).toEqual(["'self'", "'unsafe-inline'"]);
    expect(d['img-src']).toEqual(["'self'", 'data:', 'blob:', 'https://stellar.creit.tech']);
    expect(d['font-src']).toEqual(["'self'"]);
  });

  it('opens up for the Vercel toolbar on preview deployments only', () => {
    const preview = csp({ VERCEL_ENV: 'preview' });
    for (const directive of ['script-src', 'style-src', 'img-src', 'font-src', 'connect-src', 'frame-src']) {
      expect(preview[directive]).toContain('https://vercel.live');
    }
    expect(preview['frame-src']).not.toContain("'none'");
    expect(contentSecurityPolicy({ NODE_ENV: 'production', VERCEL_ENV: 'production' })).not.toContain('vercel.live');
  });

  it('locks down frames, plugins, <base>, forms and the service worker, and reports to the endpoint', () => {
    const d = csp();
    expect(d['default-src']).toEqual(["'self'"]);
    expect(d['worker-src']).toEqual(["'self'"]);
    expect(d['frame-src']).toEqual(["'none'"]);
    expect(d['frame-ancestors']).toEqual(["'none'"]);
    expect(d['object-src']).toEqual(["'none'"]);
    expect(d['base-uri']).toEqual(["'self'"]);
    expect(d['form-action']).toEqual(["'self'"]);
    expect(d['report-uri']).toEqual([CSP_REPORT_PATH]);
    expect(CSP_REPORT_PATH).toBe('/api/csp-report');
  });

  describe('the ?network=testnet override (#290)', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.resetModules();
    });

    it('allows exactly the RPC lib/read-network reads, default or pinned', async () => {
      for (const pin of [undefined, 'https://testnet-rpc.example.com:8443/v1/KEY']) {
        const env: Env = { ...MAINNET, NEXT_PUBLIC_TESTNET_RPC_URL: pin };
        vi.unstubAllEnvs();
        for (const [k, v] of Object.entries(env)) if (v !== undefined) vi.stubEnv(k, v);
        vi.resetModules();
        const { readNetworkFor } = await import('@/lib/read-network');
        const net = readNetworkFor('testnet')!;
        expect(net.rpcUrl).toBe(pin ?? NETWORKS.testnet.rpcUrl);
        const connect = csp(env)['connect-src'];
        expect(connect).toContain(origin(net.rpcUrl));
        // a pinned RPC replaces the default; its path (and key) never reaches the policy
        if (pin) {
          expect(connect).not.toContain('https://soroban-testnet.stellar.org');
          expect(connect.join(' ')).not.toContain('KEY');
        }
      }
    });

    it('adds nothing on a testnet deployment, where there is no override', () => {
      expect(csp({ NEXT_PUBLIC_TESTNET_RPC_URL: 'https://testnet-rpc.example.com' })['connect-src']).not.toContain(
        'https://testnet-rpc.example.com',
      );
    });

    it('takes only a plain origin from the pin', () => {
      const policy = contentSecurityPolicy({
        ...MAINNET,
        NODE_ENV: 'production',
        NEXT_PUBLIC_TESTNET_RPC_URL: "https://evil.com;script-src'unsafe-eval'",
      });
      expect(parse(policy)['connect-src']).toEqual(["'self'", 'https://rpc.mainnet.example.com', 'https://horizon.stellar.org']);
      expect(policy).not.toMatch(/evil|unsafe-eval/);
    });
  });
});
