# For-Devs Docs — `/docs` Outline

_Bri's spec for the developer surface. Goal: a developer reads a real reputation score in
under 60 seconds, then learns to build on the attestation primitive. Tool: **Fumadocs**
(Next App-Router-native, MDX + auto API tables + search, same repo/deploy)._

---

## 1. Information architecture (by reader task)

```
/docs
  Get Started
    - What is Stellar Passport       # 3 sentences + the constellation idea
    - Read a score in 60 seconds     # copy-paste quickstart (the "wow")
    - Networks & contract IDs        # testnet now, mainnet later
  The Reputation Primitive
    - The att_set event model        # what's emitted, when, by whom
    - How a score is derived         # Social vs Earned, what each means
    - Two-track trust boundaries     # what each track guarantees (honest)
  Integrate
    - Read a user's score            # get_score / get_earned
    - Read an attestation            # get_attestation(addr, schema_id)
    - React to a new attestation     # event indexing via RPC
    - Gate a feature by threshold    # the canonical use case
  Contracts Reference
    - reputation                     # fn signatures, params, returns, errors
    - quest_registry
    - rewards
    (generated from the contracts — keep in sync, don't hand-write)
  Resources
    - Anti-sybil & the attester model
    - Rate limits & caps
    - Changelog
```

## 2. The quickstart (the wow — fits one screen)

> **Stellar Passport turns trust into a number other apps can read. Here's how to read it.**

```ts
import { Contract, TransactionBuilder, Address, scValToNative, rpc, Networks } from "@stellar/stellar-sdk";

const REPUTATION = "CBNIZ…SZM";                 // testnet
const server = new rpc.Server("https://soroban-testnet.stellar.org");

const account = await server.getAccount(SOME_FUNDED_ADDRESS);
const tx = new TransactionBuilder(account, { fee: "1000000", networkPassphrase: Networks.TESTNET })
  .addOperation(new Contract(REPUTATION).call("get_score", new Address(WHO).toScVal()))
  .setTimeout(30).build();

const sim = await server.simulateTransaction(tx);
const score = scValToNative(sim.result.retval);  // → 42
```

Paste your own address as `WHO`, get a real score back. That's the hook → then "now gate a
feature by it."

## 3. Tone (matches the brand voice)

Same calm, plain, honest voice as the consumer product. No "web3 magic." Show the trust
boundaries openly (Social XP is not cashable; only Earned is; here are the caps). A
developer trusts docs that admit limits.

## 4. Build / maintenance

- Lives at `app/(docs)/docs/[[...slug]]` in the same Next app (one deploy).
- Contracts Reference is **generated** from the contract interfaces so it can't drift.
- Repurpose internal `docs/PRD.md` + `belts/08-anti-sybil.md` into the "Primitive" +
  "Anti-sybil" conceptual pages. Write fresh: quickstart, contracts reference, voice-aligned
  intros.

## 5. Where it sits in the product

The for-devs surface is **part of the product, not a phase-gate** — it's how Passport
becomes "reputation other apps can read" (the Master/SCF and partner story). It also doubles
as credibility for the consumer side ("this is real, on-chain, and open").
