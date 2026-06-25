# Passkey Wiring Runbook

_How real passkey/FaceID onboarding is wired, and the infra you (the human) still need to
provision to turn it on. Until the env vars below are set, the app stays on the testnet
**dev wallet** (ephemeral Friendbot-funded keypair), which already drives the full
vouch/quest/tip loop._

## Status (updated)

| Piece | State |
| --- | --- |
| **Vercel build blocker** | ✅ **SOLVED** — see below |
| Wallet seam + `connectPasskey()` | ✅ implemented (`apps/web/src/lib/wallet.ts`) |
| Contract calls via smart account | ✅ routed (`invoke` branch in `contracts.ts`) |
| Genesis for passkey | ✅ handled (skipped; registry `claim` is the identity binding) |
| Testnet infra (WASM hash + verifier) | ✅ **live OZ contracts, env pre-filled** (no deploy needed; relayer optional) |
| Quests via passkey (`signMessage`) | ⏳ deferred follow-up (attester signer change) |
| USDC trustline / tip-receiving for passkey | ⏳ deferred follow-up |

## ✅ The Vercel build blocker — how it was solved

The old blocker: the legacy `passkey-kit` + `@creit.tech/stellar-wallets-kit` pulled
**native node-gyp modules** (`node-hid`/`usb` for Ledger/Trezor) that compile C/C++ at
`pnpm install` and failed Vercel's build.

The fix — **switch to [`smart-account-kit`](https://github.com/kalepail/smart-account-kit)**
(the current OpenZeppelin-Smart-Account SDK that supersedes `passkey-kit`):

1. It ships **compiled ESM JS** (not raw TS) and has **zero native deps** — it added only
   4 pure-JS packages (`@simplewebauthn/browser`, `base64url`, `smart-account-kit-bindings`).
   So the node-gyp install-time break is gone **by construction**.
2. It *lazy*-imports the **optional** external-wallet adapter
   (`@creit-tech/stellar-wallets-kit`, hyphen scope) only when you connect a Freighter/LOBSTR
   signer. We use the passkey path only, so that adapter is **stubbed to an empty module** in
   [`apps/web/next.config.mjs`](../apps/web/next.config.mjs) (`resolve.alias … = false`).
   We deliberately **do not install** it — installing would drag the native deps back.

Proof: `pnpm --filter ./apps/web build` is green with `smart-account-kit` imported through
`wallet.ts` (full route table, 11/11 static pages). This is the same `next build` Vercel runs.

## The seam (how feature code stays untouched)

Every caller depends only on the `Wallet` interface in
[`apps/web/src/lib/wallet.ts`](../apps/web/src/lib/wallet.ts):

```ts
interface Wallet {
  kind; address;
  sign(xdr); signMessage(message);
  invoke?(contractId, method, args);  // ← passkey-only: smart-account-mediated call
}
getWallet() // -> connectPasskey() when isPasskeyConfigured(), else getDevWallet()
```

A passkey wallet's `address` is a **contract** (`C…`), which can't be a classic tx source.
So `contracts.ts › invokeAndWait` branches: if `wallet.invoke` exists, the call is built as an
`AssembledTransaction`, the passkey signs the Soroban auth entry, and the **relayer** submits +
sponsors the fee. Dev/Freighter wallets keep the classic build→sign→send path. **No feature
file (registry/reputation/rewards/gate) changed** — they all go through `invokeAndWait`.

Genesis (a classic `manageData` op) is **skipped for passkey** in `app/page.tsx` — the registry
`claim` contract call is the real on-chain identity binding for every wallet kind.

## Required infra + env (what you provision)

**On testnet you provision NOTHING** — OpenZeppelin keeps the smart-account WASM + the
WebAuthn verifier deployed, and the kit pays fees from a shared, well-known deployer account
(derived from the seed `"openzeppelin-smart-account-kit"`, kept funded on testnet). So a
relayer is **optional** on testnet; just set the two values below (already filled in
`apps/web/.env.local`), and add the same two to Vercel:

| Env var | What it is | Testnet value (live, verified) |
| --- | --- | --- |
| `NEXT_PUBLIC_SMART_ACCOUNT_WASM_HASH` | OZ smart-account WASM hash | `8537b8166c0078440a5324c12f6db48d6340d157c306a54c5ea81405abcc2611` |
| `NEXT_PUBLIC_WEBAUTHN_VERIFIER_ID` | WebAuthn (secp256r1) verifier contract (`C…`) | `CCMR63YE5T7MPWREF3PC5XNTTGXFSB4GYUGUIT5POHP2UGCS65TBIUUU` |
| `NEXT_PUBLIC_RELAYER_URL` _(optional)_ | Fee-sponsoring submitter | OZ Relayer **Channels** — testnet `https://channels.openzeppelin.com/testnet` (key at `/gen`). Required on **mainnet** (no shared deployer there). |

> Testnet values come from the smart-account-kit demo (`demo/.env.example`) and were verified
> live with `stellar contract info` (the WASM hash resolves a spec; the verifier exposes
> `fn verify`). Testnet resets periodically — if onboarding suddenly errors with
> "contract/code not found", re-pull these from the kit's `demo/.env.example`.

> `NEXT_PUBLIC_*` are inlined at **build time** → after setting them on Vercel you must
> **redeploy**. WebAuthn needs a secure context, but **localhost and https both qualify**, so
> it tests on `localhost:3000` and on Vercel with no extra certs.

With the two set, `isPasskeyConfigured()` flips true and `getWallet()` returns the passkey
wallet automatically — onboarding becomes FaceID/passkey enroll → smart account (`C…`)
created → handle claimed on-chain. No other code change needed.

### Mainnet note
There is no shared funded deployer on mainnet, so set `NEXT_PUBLIC_RELAYER_URL` (and deploy/point
to a mainnet smart-account WASM + verifier) before going live. The dev wallet stays
hard-disabled on mainnet, so passkey is the only mainnet provider.

## Deferred follow-ups (not blocking onboarding)

1. **Quests via passkey** — the `/api/attest` ownership proof currently verifies an **ed25519
   `G…`** signature. A passkey signer is **secp256r1 against the smart account (`C…`)**, so
   `signMessage` throws a clear "use the in-app wallet" error for now (mirrors how Freighter
   quests are deferred). To wire it: extend the attester to verify the smart-account signer
   (via `kit.authenticatePasskey()` / the WebAuthn verifier), then implement `signMessage`.
2. **USDC trustline / tip-receiving for passkey** — `enableUsdc` is a classic `changeTrust`
   op; smart accounts hold SAC balances differently. Tip-**sending** routes through `invoke`;
   tip-**receiving** needs the smart-account trustline path wired.

## Verification checklist (needs a real device)

1. Vercel preview build green (already true locally).
2. On a phone: FaceID enroll → smart account (`C…`) created → handle claimed, fee sponsored,
   in <15s.
3. Returning user: FaceID → `connectWallet()` resolves the same `C…` address (silent restore).
4. Vouch / claim / reward / gate all succeed through `invoke` (the smart-account path).
5. Dev wallet still hard-disabled on mainnet; passkey is the only mainnet provider.
