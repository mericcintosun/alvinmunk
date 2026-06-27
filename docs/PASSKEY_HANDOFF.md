# Passkey Integration — Handoff for the Next Agent

_Stellar Passport (alvinmunk monorepo). Status as of this session. Read this fully before touching the passkey code._

---

## 1. What we are trying to do (the goal)

Ship **real passkey / FaceID smart-wallet onboarding** for the app: a user picks a handle,
authenticates with FaceID/passkey (no seed phrase), and a **smart-account contract wallet
(C…)** is created + used to sign on-chain actions (claim handle, vouch, quests). Fees are
sponsored by a relayer so the user needs no XLM.

Today the app runs on a **dev wallet** fallback (ephemeral Friendbot-funded G… keypair) which
already drives the ENTIRE app (onboarding, vouch, claim, quests). Passkey is the polish we are
wiring. `getWallet()` in `apps/web/src/lib/wallet.ts` returns the passkey wallet when
`isPasskeyConfigured()` is true, else the dev wallet.

## 2. THE DECISION YOU NEED TO KNOW: use `passkey-kit`, NOT `smart-account-kit`

We spent a long time on **`smart-account-kit` (0.2.10)** + OpenZeppelin smart-account contracts.
It is bleeding-edge and its published bindings (`smart-account-kit-bindings@0.1.2`) do **not**
match any released OZ contract. We fixed a 7-layer cascade (see §5) and hit a **final
unfixable blocker**: the OZ smart account's `__check_auth` calls an **external verifier
contract**, and the kit's `signResimulateAndPrepare` re-simulation does **not** put the verifier
in the tx footprint (and never handles `restorePreamble`) → `Error(Auth, InvalidAction)` /
`"non-existing value for contract instance"`. This is inside the kit; not fixable from the app.

**`passkey-kit` (kalepail, 0.12.0) is the canonical, mature Stellar passkey SDK.** Its wallet
contract verifies the secp256r1 passkey signature **INLINE** (`env.crypto`), with **no external
verifier contract call** → the footprint bug simply does not exist. This is the right path and
the user explicitly asked for it.

➡️ **Plan: rip out smart-account-kit, integrate passkey-kit.**

## 3. Canonical values + what's verified (passkey-kit)

- `passkey-kit@0.12.0` is **already installed** in `apps/web`. It ships **raw TS** (no `.d.ts`/
  compiled JS) → consumers must transpile it. **No native deps** → Vercel-safe.
- **Wallet WASM hash (testnet, LIVE, inline secp256r1 verify):**
  `ecd990f0b45ca6817149b6175f79b32efb442f35731985a084131e8265c4cd90`
- **Native XLM SAC:** `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`
- **Submitter:** OpenZeppelin **Relayer Channels** — `relayerUrl = https://channels.openzeppelin.com/testnet`,
  `relayerApiKey` = free, get from `…/testnet/gen`. (passkey-kit 0.12 `PasskeyServer` uses
  `@openzeppelin/relayer-plugin-channels`.)
- **Mercury** (indexer, only for `connectWallet` returning-user lookup): `mercuryUrl =
  https://api.mercurydata.app`, plus a project name + JWT/key. **DEFER THIS** — store the
  `contractId` + `keyId` in `localStorage` and pass `getContractId` yourself; you don't need
  Mercury for create-then-use.

### passkey-kit API (from `node_modules/.pnpm/passkey-kit@0.12.0/.../src/kit.ts`)
```ts
const account = new PasskeyKit({ rpcUrl, networkPassphrase, walletWasmHash });
// first run (FaceID enroll + build deploy tx):
const { keyId, keyIdBase64, contractId, signedTx } = await account.createWallet('Stellar Passport', user);
// returning user:
await account.connectWallet({ keyId, getContractId });   // getContractId: (keyId)=>Promise<string|undefined>
// sign a contract call's auth entries with the passkey:
await account.sign(assembledTx, { keyId });
// submit (server-side, holds the relayer key):
const server = new PasskeyServer({ rpcUrl, relayerUrl, relayerApiKey });
await server.send(signedTxOrAssembledTxOrXdr);            // → { hash, ... } via OZ Channels
```

## 4. The implementation plan (do this)

1. **`apps/web/next.config.mjs`**: add to `transpilePackages`: `'passkey-kit'`, `'passkey-kit-sdk'`,
   `'sac-sdk'` (keep `'@passport/shared'`). The existing `@creit-tech/...` webpack alias was for
   smart-account-kit — remove it once smart-account-kit is gone.
2. **Env** (`apps/web/.env.local` + later Vercel): replace the smart-account-kit vars with:
   - `NEXT_PUBLIC_PASSKEY_WALLET_WASM_HASH=ecd990f0…`
   - server secrets: `PASSKEY_RELAYER_URL=https://channels.openzeppelin.com/testnet`,
     `PASSKEY_RELAYER_API_KEY=<from /gen>`
   Update `isPasskeyConfigured()` to check the wallet wasm hash (+ relayer for mainnet).
3. **`apps/web/src/lib/wallet.ts` `connectPasskey()`**: rewrite with `PasskeyKit`. First run →
   `createWallet` (returns `signedTx` deploy) → submit it via the API route below; persist
   `{keyId, contractId}` to localStorage. Return a `Wallet` whose `invoke(contractId, method,
   args)` builds an `AssembledTransaction` for the call, `account.sign(at, {keyId})`, then POSTs
   the signed tx to `/api/passkey-send` and decodes the result.
4. **New `apps/web/src/app/api/passkey-send/route.ts`**: `PasskeyServer({rpcUrl, relayerUrl,
   relayerApiKey}).send(xdr)` → returns the tx hash. Keeps the relayer key server-side.
5. **`apps/web/src/app/app/page.tsx` `createPassport()`**: for `kind==='passkey'` skip
   `recordGenesis` (already done — classic manageData can't be authored by a C… account); the
   registry `claim` (via `invoke`) is the on-chain identity.
6. Remove `smart-account-kit` dep + the now-unused webpack alias. The v0.6.0 contracts we
   deployed (account `8c45dfe3`, verifier `CAW2EUW2`) become dead — fine, ignore them.

### The `Wallet` seam (already in place — reuse it)
`apps/web/src/lib/wallet.ts` `interface Wallet` has an optional
`invoke?(contractId, method, args)`. `contracts.ts › invokeAndWait` branches: if `wallet.invoke`
exists, it routes the contract call through it (passkey path); otherwise the classic
build→sign→send (dev/freighter). **No feature file (registry/reputation/rewards/gate) changes.**

## 5. The smart-account-kit cascade we already solved (context / do NOT redo)

In order, each error was one real layer (all on the smart-account-kit path, now abandoned):
1. `get_context_rules` missing on the contract → we added it.
2. context-rule ids are **0-based** (`NextId` starts at 0) — our loop was 1-based.
3. `ContextRule` had **8 fields** (v0.7.x added `policy_ids`/`signer_ids`); bindings expect **6**.
4. Found **OZ stellar-contracts v0.6.0** matches bindings 0.1.2 (6-field ContextRule +
   `Signatures` map `__check_auth` + has `get_context_rules`). Built from source, deployed
   account WASM `8c45dfe3…` + a fresh v0.6.0 webauthn-verifier `CAW2EUW2…`.
5. `txBAD_SEQ` — the kit submits from a **shared deterministic deployer** account; back-to-back
   deploy→claim race on its sequence. We added a BAD_SEQ retry in `invoke`.
6. **FINAL blocker (unfixable):** verifier-not-in-footprint during the kit's re-simulation (see §2).

Lesson: smart-account-kit's bindings/demo-WASM/OZ-contracts are all at different versions — an
unstable SDK. passkey-kit avoids all of this (canonical wallet ships with the SDK).

## 6. Other work completed this session (already DONE + tested — don't break)

- **Quest dual-auth (sig-verify):** `quest_registry` was redeployed to
  `CAZXMV6WO6MUMP7ZJ5PDKPXUYTNG5BQTVSBS2IKT2R7CZR6HLLJUBG2R` (in `.env.local`). `award_quest`
  now verifies an **ed25519 attester signature** over `quest_payload(quest_id, recipient)` +
  `recipient.require_auth()` (works for G… and C…). `lib/quests.ts` (client) gets the sig from
  `/api/attest` then submits `award_quest` via `invokeAndWait`. `/api/attest` no longer submits —
  it returns `{attester, sig}`. **Tested end-to-end with the dev wallet: Earned XP +30.**
  `Quests.tsx` now has a "refer a friend's wallet" G… input (the old `ref: wallet.address`
  self-referral failed `validateEvidence`). Contract tests: 8/8. Web tests: 59/59.
- **Wallet connect UI:** `/wallet` route linked in the navbar; a light multi-wallet modal
  (`components/wallet/connect-wallet-modal.tsx`) with **Freighter + Albedo** working (Albedo via
  `@albedo-link/intent`, pure JS). xBull/Rabet shown "Not available".
- **Constellation visuals:** 5-point-star sprites, hero shifted right, no center dot, smaller.
- **Robust dev-wallet onboarding:** friendbot timeout, account-ready wait, genesis confirmed
  before claim (sequence race fix) — `lib/wallet.ts`, `lib/genesis.ts`, `lib/stellar.ts`.

## 7. Key on-chain values (testnet) + CLI identities

App contracts (see `apps/web/.env.local`):
- `NEXT_PUBLIC_REGISTRY_CONTRACT_ID = CBHLDLAJF4VY7DMVS344YJW7HY4KSTLMDQ2RVFE6KEVMQGGGJC3PBSDP`
- `NEXT_PUBLIC_REPUTATION_CONTRACT_ID = CBYMOFQLORYZSLV23LIJPI726M4XVZBIKLYA5NTSSYPETEIIWAXWDU3R`
- `NEXT_PUBLIC_QUEST_REGISTRY_CONTRACT_ID = CAZXMV6WO6MUMP7ZJ5PDKPXUYTNG5BQTVSBS2IKT2R7CZR6HLLJUBG2R` (new sig-verify)
- `NEXT_PUBLIC_GATE_CONTRACT_ID = CD62VOCIR7MIK66SB6Q65CBS4EFQD3HVRJK47W6ZN7NN2S2LW5HG7TV7`
- `NEXT_PUBLIC_REWARDS_CONTRACT_ID`, `NEXT_PUBLIC_USDC_SAC_ID` — in `.env.local`.

`stellar keys` identities (already funded on testnet):
- `passport-admin` = `GDIS5BDXSI2DDJNTKRZPI6MNB5XCLMN4Z6PPRPM4RQLZ3PSQ2YTERLFA` (admin of the app contracts)
- `passport-attester` = `GBC2FI2YWJPUU7TGEU7ATSP7PIZC64ZPX2F672OLIHHL7AEH7LUDITHJ` (= `ATTESTER_SECRET_KEY`)
- `passport-deployer` = `GB7V36IH4CG2AUIUNB7AC3TMWFLTRXRSTS2KDRKBKJ7HQR4V74UAHCKO`

⚠️ **Vercel still needs** (separate from local): `NEXT_PUBLIC_REGISTRY_CONTRACT_ID`,
`NEXT_PUBLIC_GATE_CONTRACT_ID` (were missing), the new `QUEST_REGISTRY` id, and the new code.
`NEXT_PUBLIC_*` are build-time inlined → redeploy after setting.

## 8. Gotchas / testing notes

- Passkey wallet address is a **C… contract** — cannot be a tx source; the relayer pays the fee.
- To test a FRESH passkey, **clear site data** (localStorage **and** IndexedDB) — a stale stored
  session reuses the old wallet/credential.
- Console spam from `inpage.js` / `contentscript.js` / MetaMask is **browser wallet extensions**,
  not the app — ignore.
- `app/page.tsx createPassport` has `console.error('🛑 createPassport failed →', e)` — keep it;
  the full Soroban diagnostic events (which name the failing contract/value) print there.
- WebAuthn needs a secure context — **localhost and https both qualify** (no cert needed).
- The dev server runs on `:3000`; restart it after `.env.local` changes (NEXT_PUBLIC are read at
  dev-server start, not hot-reloaded).

## 9. What's needed from the human

- A free **OpenZeppelin Relayer Channels API key** (`https://channels.openzeppelin.com/testnet` →
  `/gen`) for `PASSKEY_RELAYER_API_KEY`.
- A real device for the final FaceID test.
- (Optional, deferred) a Mercury token if you later want returning-user passkey lookup.

## 10. Fallback

If passkey stalls again, set `isPasskeyConfigured()` false (unset the passkey env) → the app runs
fully on the dev wallet, including the new quest dual-auth system. Ship-ready as-is.
</content>
</parameter>
</invoke>
