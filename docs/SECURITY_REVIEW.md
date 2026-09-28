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
| `reputation` | vouch TTL `created + VOUCH_TTL_SECS` | `created.saturating_add(VOUCH_TTL_SECS)` |
| `quest_registry` | weekly-streak `weeks += 1` / `last_week + 1` | `.saturating_add(1)` |

Re-scan after the fix: **0 critical.**

## Medium findings — triaged (accepted / false-positive)

| Category | Count | Verdict |
| --- | --- | --- |
| `unnecessary_admin_parameter` | 5 | **False positive** — the `admin` argument to `init()` is *stored* (`set(DataKey::Admin, admin)`) and used for later access control (`upgrade`, admin-gated setters), not unused. |
| `missing_new_admin_auth` | 5 | **Accepted** — flagged on one-time `init()` (guarded by an `AlreadyInitialized` check). There is no unprotected `set_admin`; admin-mutating paths (`upgrade`) require `admin.require_auth()`. A 2-step ownership transfer is a possible future enhancement, not a vulnerability. |
| `unsafe_unwrap` | 5 | **Accepted low-risk** — every flagged `unwrap()` reads a config address (`Usdc`, `Reputation`) that is set at `init()`; it can only be `None` on a mis-initialised contract, in which case it aborts (no silent failure, no exploit). |
| `dos_unexpected_revert_with_storage` | 4 | **Accepted low-risk** — the flagged reverts are intentional guard clauses (`require_auth`, cap checks) that abort a single caller's tx; no shared-state DoS. |
| `dynamic_storage` | 3 | **Accepted** — dynamic keys are per-user/per-day namespaced (`DailyCount(addr, day)`, handle/address maps); this is the intended data model, not unbounded growth in a single entry. |

## Anti-sybil / economic security (design-level)

Beyond tooling, the contracts implement the anti-sybil model documented in
[`belts/08-anti-sybil`](../belts/08-anti-sybil.md): two-track XP (non-cashable Social vs
cashable Earned), first-pair-only rewards, per-day caps, claim-secret vouches (rings can't be
pre-computed), an XP stake slashed on unclaimed vouches, and a treasury circuit breaker
(daily cap + frozen set + proof-of-funding toggle) on the payout side.

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
