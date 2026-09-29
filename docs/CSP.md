# Content-Security-Policy

The web client signs wallet transactions, creates passkey credentials and reads claim secrets
from the URL fragment. A CSP is the browser-side second line of defence: an injected script
that loads from, or talks to, an origin the policy doesn't list is reported (and, once
enforced, blocked). Issue #179.

| Piece | Where |
| --- | --- |
| Policy builder (plain ESM, built from env) | `apps/web/src/config/csp.mjs` |
| Header | `headers()` in `apps/web/next.config.mjs`, on every route |
| Violation endpoint | `POST /api/csp-report` (`app/api/csp-report/route.ts`, parsing in `lib/csp-report.ts`) |
| Tests | `src/config/csp.test.ts`, `src/config/security-headers.test.ts`, `app/api/csp-report/route.test.ts` |

The builder is `.mjs` on purpose: Next loads `next.config.mjs` with plain Node, which cannot
import TypeScript. `security-headers.test.ts` loads the config in a real Node process to keep
it that way.

## Phase 1 — report-only (current)

The policy ships as `Content-Security-Policy-Report-Only`: nothing is blocked, and every
violation is POSTed to `/api/csp-report` (`report-uri`).

### What the policy allows, and why

| Directive | Sources | Needed by |
| --- | --- | --- |
| `default-src` | `'self'` | everything not listed below (manifest, media) |
| `script-src` | `'self' 'unsafe-inline'` | Next's inline bootstrap scripts and the pre-paint theme script in `app/layout.tsx`. No hash or nonce may be added while `'unsafe-inline'` is relied on: browsers then ignore `'unsafe-inline'` and block every inline script. Dev adds `'unsafe-eval'` (React Refresh) and `https://va.vercel-scripts.com` (Vercel's debug analytics scripts). |
| `style-src` | `'self' 'unsafe-inline'` | inline style attributes (React, Radix, motion) and the Stellar Wallets Kit's runtime styles |
| `img-src` | `'self' data: blob: https://stellar.creit.tech` | local art and the wallet icons in the Stellar Wallets Kit picker |
| `font-src` | `'self'` | `next/font` self-hosts the Google fonts |
| `connect-src` | `'self'`, the RPC and Horizon origins, Friendbot (not on mainnet), the anchor, and on a non-testnet deployment the testnet RPC | `/api/*` and the `/_vercel/*` analytics and Speed Insights beacons (same origin), Soroban RPC + Horizon (also used by passkey-kit), the testnet dev wallet's funding, the SEP-1/10/24 anchor flow, the read-only `?network=testnet` views (`lib/read-network.ts`) |
| `worker-src` | `'self'` | `public/sw.js` (push notifications) |
| `frame-src` | `'none'` | nothing embeds a frame: Albedo, xBull's web wallet and the SEP-24 flow open popups, which CSP does not govern; Freighter, Rabet, LOBSTR, Hana and xBull's extension talk over `postMessage`; WebAuthn (passkeys) is not a CSP fetch |
| `frame-ancestors` | `'none'` | matches `X-Frame-Options: DENY` |
| `object-src` / `base-uri` / `form-action` | `'none'` / `'self'` / `'self'` | standard lockdown |
| `report-uri` | `/api/csp-report` | the violation endpoint |

On preview deployments (`VERCEL_ENV=preview`) the policy also allows the Vercel toolbar
(`https://vercel.live` and its assets), so previews can run clean too.

### The env it reads

Resolved exactly like `readNetworkConfig` (`@alvinmunk/shared`); `csp.test.ts` checks the two
agree:

- `NEXT_PUBLIC_STELLAR_NETWORK` — `mainnet` drops Friendbot and the testnet defaults
- `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_HORIZON_URL` — their origins (defaults per network)
- `NEXT_PUBLIC_ANCHOR_HOME_DOMAIN` (bare host → `https://host`), `NEXT_PUBLIC_ANCHOR_TRANSFER_SERVER`
- `NEXT_PUBLIC_TESTNET_RPC_URL` — the testnet RPC the `?network=testnet` views read (default: the SDK's `NETWORKS.testnet.rpcUrl`); only on a deployment that isn't testnet
- `NODE_ENV`, `VERCEL_ENV` — the dev and preview additions above

Only a plain `http(s)://host[:port]` origin from an env value reaches the policy, so a stray
path, query, `;` or quote can never add a source or a directive.

The policy is computed when Next loads its config (at build on Vercel), so a changed env
var needs a redeploy, like every `NEXT_PUBLIC_*` value.

**Anchor caveat:** the SEP-10 `WEB_AUTH_ENDPOINT` and SEP-24 `TRANSFER_SERVER_SEP0024` come
from the anchor's `stellar.toml` at runtime. When they live on a host other than the home
domain or `NEXT_PUBLIC_ANCHOR_TRANSFER_SERVER`, the cash-out flow reports `connect-src`
violations: add that origin in `csp.mjs` before enforcing.

### Reading the reports

Each violation is one log line:

```json
{"csp":"violation","directive":"img-src","blocked":"https://cdn.example.com","document":"https://alvinmunk.vercel.app/claim/7","line":12,"disposition":"report"}
```

The endpoint logs the directive, the blocked origin (or keyword: `inline`, `eval`, `data`…)
and the page and script as origin + path. It never logs a query or fragment — a legacy claim
link carries its secret in `?s=` — nor the referrer or script sample. It answers with an
empty body (204 for a report, 400 for anything else, 413 above 16 KB).

Violations from browser extensions (`blocked` or `document` of `chrome-extension:`,
`moz-extension:`) are the extension's, not the app's. Anything else from a real flow means
a source is missing: add it to `csp.mjs` with the reason, and a test.

## Phase 2 — enforce (follow-up)

Once a preview and production have each run a week with no violations from real flows
(wallet connect + sign with Freighter, Albedo, xBull, the Stellar Wallets Kit picker,
passkey onboarding, a claim link, the SEP-24 cash-out):

1. In `next.config.mjs`, rename the header key `Content-Security-Policy-Report-Only` to
   `Content-Security-Policy`, and update `security-headers.test.ts` to expect it.
2. Ship to a preview, run the flows above, then production.
3. To roll back, rename the key back; nothing else changes.

After that, `'unsafe-inline'` in `script-src` can be replaced by a per-request nonce set in
middleware (Next's documented nonce setup), which also covers the layout's theme script.
