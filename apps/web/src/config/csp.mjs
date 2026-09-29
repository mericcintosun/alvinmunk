/**
 * The Content-Security-Policy (#179), built from the same env the client reads. Plain ESM
 * JS, not TS: next.config.mjs imports it, and Node loads that file without a compiler.
 *
 * Phase 1 sends it as `Content-Security-Policy-Report-Only`; docs/CSP.md has the inventory
 * behind each source and the switch to enforcing.
 */

/** readNetworkConfig's URL fallbacks (@alvinmunk/shared DEFAULT_URLS); csp.test.ts
 *  checks the two agree. */
const DEFAULT_URLS = {
  testnet: {
    rpcUrl: 'https://soroban-testnet.stellar.org',
    horizonUrl: 'https://horizon-testnet.stellar.org',
  },
  mainnet: { rpcUrl: '', horizonUrl: 'https://horizon.stellar.org' },
};

/** The testnet deployment lib/read-network reads for `?network=testnet` on any other
 *  network (#290): @alvinmunk/sdk's `NETWORKS.testnet.rpcUrl` unless
 *  NEXT_PUBLIC_TESTNET_RPC_URL pins one; csp.test.ts checks the two agree. */
const TESTNET_OVERRIDE_RPC = 'https://soroban-testnet.stellar.org';

/** Where browsers POST violation reports (app/api/csp-report). */
export const CSP_REPORT_PATH = '/api/csp-report';

/** Wallet icons in the Stellar Wallets Kit picker (each module's `productIcon`). */
const WALLETS_KIT_ICONS = 'https://stellar.creit.tech';

/** @param {string | undefined} v */
function envValue(v) {
  const t = v?.trim();
  return t ? t : undefined;
}

/** A plain http(s) origin. The URL parser keeps `;`, `,` and quotes in a host, and any of
 *  them would end or split a directive. */
const ORIGIN = /^https?:\/\/(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(:\d+)?$/i;

/** The origin of `url` (scheme, host, port) — never its path or query — or undefined when
 *  it isn't a plain http(s) URL, so an env value can only ever add one source.
 *  @param {string | undefined} url */
function originOf(url) {
  if (!url) return undefined;
  try {
    const { origin } = new URL(url);
    return ORIGIN.test(origin) ? origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The policy for a deployment's env (`process.env` in next.config.mjs).
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 */
export function contentSecurityPolicy(env) {
  // Resolve the network and its Stellar hosts exactly as readNetworkConfig does.
  const raw = env.NEXT_PUBLIC_STELLAR_NETWORK;
  const network = raw === undefined ? 'testnet' : raw.trim().toLowerCase();
  const defaults = network === 'mainnet' ? DEFAULT_URLS.mainnet : DEFAULT_URLS.testnet;
  const rpcUrl = envValue(env.NEXT_PUBLIC_RPC_URL) ?? defaults.rpcUrl;
  const horizonUrl = envValue(env.NEXT_PUBLIC_HORIZON_URL) ?? defaults.horizonUrl;
  // The anchor's home domain is a bare host ("anchor.example.com"): SEP-1 fetches its
  // stellar.toml over https unless it is configured with an explicit http:// scheme.
  const home = envValue(env.NEXT_PUBLIC_ANCHOR_HOME_DOMAIN);
  const anchorHome = home && originOf(/^https?:\/\//i.test(home) ? home : `https://${home}`);

  const dev = env.NODE_ENV === 'development';
  // The Vercel toolbar (comments, share) is injected on preview deployments only.
  const preview = env.VERCEL_ENV === 'preview';
  const toolbar = preview ? ['https://vercel.live'] : [];

  /** @type {Record<string, (string | false | undefined)[]>} */
  const directives = {
    'default-src': ["'self'"],
    // Next's inline bootstrap scripts and the pre-paint theme script in app/layout.tsx
    // need 'unsafe-inline' until nonces land (phase 2). A hash or nonce here would make
    // browsers ignore 'unsafe-inline' and block them all. Dev adds eval (React Refresh)
    // and Vercel's debug analytics scripts; production analytics load from /_vercel.
    'script-src': [
      "'self'",
      "'unsafe-inline'",
      dev && "'unsafe-eval'",
      dev && 'https://va.vercel-scripts.com',
      ...toolbar,
    ],
    // Inline style attributes (React, Radix, motion) and the wallet kit's runtime styles.
    'style-src': ["'self'", "'unsafe-inline'", ...toolbar],
    'img-src': [
      "'self'",
      'data:',
      'blob:',
      WALLETS_KIT_ICONS,
      ...toolbar,
      preview && 'https://vercel.com',
    ],
    // next/font self-hosts the Google fonts under /_next/static.
    'font-src': ["'self'", ...toolbar, preview && 'https://assets.vercel.com'],
    'connect-src': [
      "'self'", // the /api routes and /_vercel analytics + speed insights beacons
      originOf(rpcUrl),
      originOf(horizonUrl),
      // The read-only ?network=testnet views (lib/read-network), which only override on a
      // deployment that isn't testnet.
      network !== 'testnet' && originOf(envValue(env.NEXT_PUBLIC_TESTNET_RPC_URL) ?? TESTNET_OVERRIDE_RPC),
      network !== 'mainnet' && 'https://friendbot.stellar.org', // the dev wallet (never on mainnet)
      anchorHome, // SEP-1 stellar.toml (+ SEP-10/24 when served from the same host)
      originOf(envValue(env.NEXT_PUBLIC_ANCHOR_TRANSFER_SERVER)),
      ...toolbar,
      preview && 'wss://ws-us3.pusher.com',
    ],
    'worker-src': ["'self'"], // public/sw.js (push notifications)
    // Wallets that need a window (Albedo, xBull web, the SEP-24 flow) open a popup, which
    // CSP does not govern; nothing embeds a frame.
    'frame-src': preview ? toolbar : ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    'report-uri': [CSP_REPORT_PATH],
  };

  return Object.entries(directives)
    .map(([name, sources]) => [name, ...new Set(sources.filter(Boolean))].join(' '))
    .join('; ');
}
