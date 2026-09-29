# Security review — alvinmunk Soroban contracts

**Date:** 2026-08-04 · **Scope:** the 5 Soroban contracts in `contracts/` (`reputation`,
`quest_registry`, `rewards`, `registry`, `gate`) · **Type:** internal self-audit with the free,
industry-standard Rust/Soroban security toolchain (pre-mainnet).

> This is a **free self-audit**, not a paid third-party audit. For mainnet, alvinmunk is also
> eligible for a professional review via the [Stellar Soroban Security Audit Bank](https://stellar.org/grants-and-funding/soroban-audit-bank).

## Result

**0 critical, 0 exploitable findings after remediation.** The scanners' 4 "critical"
integer-overflow findings were fixed with explicit saturating arithmetic; the remaining 22
"medium" findings are triaged below as false-positives or accepted low-risk. All **59 contract
tests pass** after the fixes.

## Tools run

| Tool | Purpose | Result |
| --- | --- | --- |
| **[Scout](https://github.com/CoinFabrik/scout-audit)** (`cargo-scout-audit`) | Soroban-specific vulnerability detector | 4 critical → **fixed**; 22 medium triaged |
| **`cargo audit`** (RustSec) | Dependency CVE scan (1,189 advisories) | **0 vulnerabilities** (3 informational — see below) |
| **`cargo deny`** | Advisories + banned crates + source trust | **bans ok, sources ok** |
| **`cargo clippy`** (`-W all -W pedantic -W arithmetic_side_effects -W unwrap_used`) | Lints incl. security-relevant | **0 production warnings** |
| **`cargo-geiger`** / grep | `unsafe` code detection | **0 `unsafe` blocks** in any contract |
| **`cargo test`** (incl. property/fuzz) | Behavioural correctness | **59 tests pass** |

## Hardening already in place

- **`overflow-checks = true`** in the release profile — arithmetic overflow **aborts the
  transaction** rather than wrapping silently (critical for a financial contract).
- **`panic = "abort"`** — no unwinding.
- **`#![no_std]`** on all 5 contracts — minimal attack surface.
- **No `unsafe`** anywhere in the contract code.

## Critical findings — FIXED

Scout flagged 4 `integer_overflow_or_underflow` sites. All operate on values that are
practically unreachable (a `u64` sequence/timestamp or a capped `u32` counter would need ~2⁶⁴
operations to overflow) **and** `overflow-checks = true` already makes any overflow abort — so
none were exploitable. They were nonetheless converted to explicit **`saturating_add`** so the
arithmetic can never wrap and the intent is self-documenting:

| Contract | Site | Fix |
| --- | --- | --- |
| `reputation` | daily-cap counter `used + 1` | `used.saturating_add(1)` |
| `reputation` | vouch sequence id `+ 1` | `.saturating_add(1)` |
| `reputation` | vouch TTL `created + VOUCH_TTL_SECS` | `claim_deadline()` = `created.saturating_add(VOUCH_TTL_SECS)`, shared by both claim paths (`claim_vouch_signed`, `claim_vouch`) and `expire_vouch` |
| `quest_registry` | weekly-streak `weeks += 1` / `last_week + 1` | `.saturating_add(1)` |

Re-scan after the fix: **0 critical.**

## Medium findings — triaged (accepted / false-positive)

| Category | Count | Verdict |
| --- | --- | --- |
| `unnecessary_admin_parameter` | 5 | **False positive** — the `admin` argument to `init()` is *stored* (`set(DataKey::Admin, admin)`) and used for later access control (`upgrade`, admin-gated setters), not unused. |
| `missing_new_admin_auth` | 5 | **Accepted** — flagged on one-time `init()` (guarded by an `AlreadyInitialized` check). There is no unprotected `set_admin`; admin-mutating paths (`upgrade`) require `admin.require_auth()`. A 2-step ownership transfer is a possible future enhancement, not a vulnerability. |
| `unsafe_unwrap` | 5 | **Accepted low-risk** — every flagged `unwrap()` reads a config address (`Usdc`, `Reputation`) that is set at `init()`; it can only be `None` on a mis-initialised contract, in which case it aborts (no silent failure, no exploit). |
| `dos_unexpected_revert_with_storage` | 4 | **Accepted low-risk** — the flagged reverts are intentional guard clauses (`require_auth`, cap checks) that abort a single caller's tx; no shared-state DoS. |
| `dynamic_storage` | 3 | **Accepted** — dynamic keys are per-user/per-day namespaced (`DailyCount(addr, day)`, handle/address maps); this is the intended data model. Caller-sized values inside an entry are capped: `mint_vouch_signed` / `mint_vouch` revert with `NoteTooLong` (#12) on a `Vouch.note` over 240 UTF-8 bytes (unbounded until issue #124; 240 is the web app's 60-character limit at 4 bytes per character), so no voucher can inflate what a claim rewrites, and a registry bio is capped at 80 bytes. |

## Anti-sybil / economic security (design-level)

Beyond tooling, the contracts implement the anti-sybil model documented in
[`belts/08-anti-sybil`](../belts/08-anti-sybil.md): two-track XP (non-cashable Social vs
cashable Earned), first-pair-only rewards, per-day caps, claim-key vouches (rings can't be
pre-computed), an XP stake slashed on unclaimed vouches, and a treasury circuit breaker
(daily cap + frozen set + proof-of-funding toggle) on the payout side.

## No-value tips: faked "received a spend" (issue #144)

**Threat.** `tip(from, to, amount)` validated only the wallet's own gates — paused, sender
auth, not frozen — and handed the transfer straight to the Stellar Asset Contract. The SAC
rejects a *negative* amount, so two shapes reached it that mint the frozen canonical
`tipped` event while moving no USDC:

- `tip(a, b, 0)` from a wallet holding no USDC at all. The SAC is happy: nothing is
  debited, nothing is credited.
- `tip(a, a, 50)`. The SAC moves `a`'s balance to itself and leaves it unchanged, and the
  call succeeds.

Both are cheap (the fee) and repeatable, and `tipped` is what the social feed and the
indexer read as proof that somebody *received* a spend — the PRD's Green de-risk metric
("D7 return among users who received a spend", `docs/PRD.md` §5) and the traction proof
suggested in `docs/USER_FEEDBACK.md` §3. A wallet could "receive" any number of tips from
itself, or send zero-value tips to anyone, and the metric would read it as traction.

**Fix.** `validate_tip` runs before the SAC call and before the event: `amount <= 0`
reverts with `InvalidAmount` (#8, which already existed), and `from == to` reverts with a
new `SelfTip` (#20). `SelfTip` is numbered at 20, outside the SAC's own 1–13 error range,
so a code can never be read as the token contract's own error — the collision that
`humanizeError` already works around for insufficient balance. An emitted `tipped` now
always means USDC moved from `from` to a different `to`. The web app runs the same two
checks (`validateTip` in `lib/admin.ts`) before prompting for a signature, so a shape the
chain would reject never costs a fee.

**Residual risk.**
- `tipped` events from a contract deployed before the upgrade are not re-validated, so a
  historical zero/self tip can still appear in a historical scan. It is a fixed one-time
  set and normal events already carry `amount > 0` and two distinct wallets; consumers that
  need to be strict can check both off the event (`lib/events.ts` → `fetchTipsSent`).
- The check bounds *this* contract's tip path only. A plain SAC transfer made outside
  alvinmunk emits no `tipped` event, so it never enters the feed or the metric.

## Vouch claims: front-running (issue #121)

**Threat.** The original `claim_vouch(claimer, vouch_id, secret)` authorizes a claim by
knowledge of the secret alone, and the secret is a plain transaction argument. It is
disclosed before the claim is final: to the RPC provider during simulation, to every peer
when the transaction is flooded, and permanently in ledger history if the claim lands but
fails. Anyone watching can submit `claim_vouch(own_address, id, secret)` first and take the
vouch edge and its claimer XP; the intended recipient sees "already claimed".

**Fix.** New cards are bound to the claimer with a signature, the pattern `quest_registry`
already uses for attester awards. The share link carries a 32-byte ed25519 seed generated in
the voucher's browser; `mint_vouch_signed` stores its public key. To claim, the recipient's
browser signs `xdr([domain tag, network id, contract, vouch id, claimer])` with the seed and
calls `claim_vouch_signed(claimer, vouch_id, sig)`, which requires `claimer.require_auth()`
and verifies the signature with `ed25519_verify` against the stored key. The seed never
leaves the browser and never reaches a server (it lives in the URL fragment). A signature
copied from a pending claim is useless for any other claimer, card, contract deployment or
network, and the claimer's own auth is still required for the one it names. The exact
message and a test vector are in [`ON_CHAIN_EVENTS.md`](ON_CHAIN_EVENTS.md#claim-keys-mint_vouch_signed--claim_vouch_signed--get_claim_key);
the web app builds the message locally rather than asking an RPC node for it, since a
dishonest node could return the message for its own address.

**Residual risk.**
- Whoever holds the link can still claim: the link is a bearer credential, so share it with
  the intended person only.
- Cards minted before the upgrade, and any card an integration still mints with the legacy
  `mint_vouch`, remain front-runnable until claimed or expired. They stay claimable through
  `claim_vouch` so no deployed half-card is stranded; each card only claims through the
  entrypoint that matches how it was minted (`WrongClaimMethod`, #13).

## Reproduce

```bash
cd contracts
cargo clippy --all-targets --release
cargo audit
cargo deny check
cargo test
cargo scout-audit            # cargo install cargo-scout-audit
```

## Next step for mainnet

This free self-audit is the security gate for the current stage. Before/after mainnet launch,
a professional audit or a mentor/team security review (Stellar Soroban Audit Bank) is the
recommended next layer.
