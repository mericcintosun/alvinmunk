# Passkey Wiring Runbook (deferred — demo-day milestone)

_How to turn on real passkey/FaceID onboarding when the infra + a device are available.
Until then the app runs on the testnet **dev wallet** (ephemeral Friendbot-funded
keypair), which already drives the full vouch/quest/tip loop. Decision record below._

## Why it's deferred (not skipped)

A 6-persona review (Tyler/architecture, Justin/strategy, Kaan/UX, Nicole/PM) was
unanimous: real passkey is **meaningful polish for the live jury demo, not on the
critical path to the next belt**. The dev wallet already delivers ~90% of the
onboarding "aha" (handle in → funded wallet + Genesis Stamp out, no seed phrase). The
remaining belt gates are **traction** (10 outside testers → 50 real users), which the
dev wallet supports today. So we keep a clean **adapter seam** and wire passkey only
for the Blue/Black demo-day milestone (which is also gated behind the mandatory
mentor + market-fit checkpoint).

## The seam (already complete)

Every caller depends only on the `Wallet` interface in [`apps/web/src/lib/wallet.ts`](../apps/web/src/lib/wallet.ts):

```ts
interface Wallet { kind; address; sign(xdr); signMessage(message); }
getWallet() // -> connectPasskey() when isPasskeyConfigured(), else getDevWallet()
```

`connectPasskey()` is the **only** function to fill. No feature code changes when it
lands — that's the point of the seam.

## ⚠️ The Vercel blocker (the reason there's no dependency yet)

`passkey-kit` (and `@creit.tech/stellar-wallets-kit`) pull **native node-gyp modules**
that compile C/C++ during `pnpm install`. That failed Vercel's build, so the packages
were **removed** from `apps/web/package.json`. The break is **install-time**, so a
`dynamic import` / `ssr:false` does NOT dodge it — the package compiles regardless of
whether it's imported. Re-adding it raw to `dependencies` risks breaking the live
deploy.

**Safe re-add options (pick one):**

1. **`pnpm.overrides`** — pin the offending transitive native dep to a pure-JS or
   prebuilt-binary version so node-gyp never runs. Add to root `package.json`:
   ```jsonc
   "pnpm": { "overrides": { "<native-dep>": "<prebuilt-or-pure-js-version>" } }
   ```
2. **Isolate** passkey behind its own workspace package loaded via a thin runtime
   boundary, so its install never enters the web app's Vercel build graph.

Avoid `optionalDependencies` (a silent skip yields a broken passkey, not a safe
fallback). After re-adding, do a throwaway Vercel preview deploy **before** prod.

## Required infra + env

Set ALL THREE (half-set = the app stays on the dev wallet by design — see
`isPasskeyConfigured()`):

| Env var | What it is | How to get it |
| --- | --- | --- |
| `NEXT_PUBLIC_WALLET_WASM_HASH` | Deployed smart-wallet contract WASM hash | `stellar contract install` the wallet WASM on the target network |
| `NEXT_PUBLIC_PASSKEY_FACTORY_ID` | Smart-account factory contract id (`C…`) | Deploy/locate the passkey factory on the target network |
| `NEXT_PUBLIC_LAUNCHTUBE_URL` | Submitter endpoint for fee-sponsored txs | A launchtube instance (hosted or self-run) + its access token |

Fee sponsorship also uses `NEXT_PUBLIC_SPONSOR_PUBLIC_KEY` (+ server-only
`SPONSOR_SECRET_KEY`) if you sponsor outside launchtube.

## Integration contract (fill `connectPasskey()`)

Map passkey-kit onto the `Wallet` interface (already sketched in `wallet.ts`):

```ts
const kit = new PasskeyKit({
  rpcUrl: config.rpcUrl,
  networkPassphrase,
  walletWasmHash:    process.env.NEXT_PUBLIC_WALLET_WASM_HASH!,
  factoryContractId: process.env.NEXT_PUBLIC_PASSKEY_FACTORY_ID!,
});
// First run: createWallet() (FaceID enroll). Return user: connectWallet().
// Submit signed txs via launchtube (NEXT_PUBLIC_LAUNCHTUBE_URL) for sponsored fees.
return {
  kind: 'passkey',
  address: contractId,                  // the C… smart-account address
  sign: (xdr) => /* kit.sign -> launchtube.send -> signedXdr */,
  signMessage: (m) => kit.signMessage(m), // used for the /api/attest ownership proof
};
```

Note: `address` becomes a **contract** address (`C…`), not a `G…`. The `/api/attest`
ownership proof currently verifies an ed25519 signature against a `G…` recipient — when
passkey lands, extend the attester to verify the smart-account's signer (a known follow-up).

## Verification checklist (needs a real device)

1. Throwaway Vercel preview builds green after the dep re-add.
2. On a phone: FaceID enroll → smart account created → first on-chain action,
   fees sponsored, in <15s. On screen: "Fees paid by app: $0.00" + a live timer.
3. Returning user: FaceID → `connectWallet()` resolves the same `C…` address.
4. Quest flow: `signMessage` proof accepted by `/api/attest` (after the signer change).
5. Dev wallet still hard-disabled on mainnet; passkey is the only mainnet provider.
