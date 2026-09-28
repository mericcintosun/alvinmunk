# Canonical On-Chain Event Schema

> **Source of truth** for every Soroban event emitted by the Stellar Passport
> contracts. These shapes are **frozen** (belts/00-strategy §4) — changing a
> topic tuple or data layout breaks off-chain indexing. Add new fields by
> incrementing `schema_version`, never by reshuffling existing events.

## Legend

- **Topics** = the Soroban event topic vector (first element is the event
  discriminator; subsequent elements are indexed keys).
- **Data** = the non-indexed payload (a tuple/struct serialized via the
  contract's XDR encoding).
- **Version** = `schema_version` field if the event is versioned for forward
  compatibility.

---

## 1. Reputation Contract

### `att_set` (Attestation Set)

The **fundable primitive** (00-strategy §4). Emitted whenever an allowlisted
attester credits Earned XP. Versioned so future B2B consumers read the version
first and can evolve safely.

| Field | Type | Description |
|-------|------|-------------|
| **topics[0]** | `Symbol("att_set")` | Event discriminator |
| **topics[1]** | `Address` | The subject (who earned) |

**Data tuple** (schema_version = 1):

| Index | Type | Description |
|-------|------|-------------|
| 0 | `u32` | `schema_version` (currently `1`) |
| 1 | `Address` | `issuer` — the allowlisted attester contract/account |
| 2 | `u32` | `schema_id` — off-chain agreed namespace, passed through from `award_xp`. Every deployed quest uses `2` (QUEST). `1` is reserved and never emitted: vouches credit only the Social track, so they never produce `att_set` |
| 3 | `u64` | `amount` — XP credited by this award (a delta, not the running total; for the per-schema total read [`get_attestation`](#attestation)) |
| 4 | `u64` | `timestamp` — ledger timestamp at emission |

**Contract source**: `reputation/src/lib.rs` → `fn add_earned()`

```rust
// Emission (v1):
const ATTESTATION_SET: Symbol = symbol_short!("att_set");
const ATT_SCHEMA_VERSION: u32 = 1;
env.events().publish(
    (ATTESTATION_SET, to.clone()),
    (ATT_SCHEMA_VERSION, issuer.clone(), schema_id, amount, ts),
);
```

---

### `xp` (Earned Track Total)

Running total of the Earned (cashable) track for an address. A monotonic
sequence — indexers fold to get the latest balance per address.

| Field | Type | Description |
|-------|------|-------------|
| **topics[0]** | `Symbol("xp")` | Event discriminator |
| **topics[1]** | `Address` | The subject |

**Data tuple**:

| Index | Type | Description |
|-------|------|-------------|
| 0 | `u64` | `amount` — the delta just added |
| 1 | `u64` | `newTotal` — the new running total |

**Contract source**: `reputation/src/lib.rs` → `fn add_earned()`

```rust
env.events().publish(
    (symbol_short!("xp"), to.clone()),
    (amount, next),
);
```

---

### `social` (Social Track Total)

Running total of the Social (non-cashable, vouch-based) track. This is the
**leaderboard source**. Emitted on every social XP mutation (add or sub).
**Starter XP** (once-per-wallet `STARTER_SOCIAL = 20`) is **silent** — it
does NOT emit a `social` event, so brand-new wallets don't clutter the
event-sourced leaderboard until they first act.

| Field | Type | Description |
|-------|------|-------------|
| **topics[0]** | `Symbol("social")` | Event discriminator |
| **topics[1]** | `Address` | The subject (who gained/lost) |

**Data tuple**:

| Index | Type | Description |
|-------|------|-------------|
| 0 | `u64` | `amount` — an unsigned magnitude. The direction comes from comparing `newTotal` with the previous total (the address's prior `social` event, or the silent `STARTER_SOCIAL` balance for its first one): higher is a credit, lower is a debit |
| 1 | `u64` | `newTotal` — the new running total |

**Contract source**: `reputation/src/lib.rs` → `fn add_social()` / `fn sub_social()`

```rust
// Credit (add_social):
env.events().publish(
    (symbol_short!("social"), to.clone()),
    (amount, next),
);

// Debit (sub_social):
env.events().publish(
    (symbol_short!("social"), from.clone()),
    (amount, next),
);
```

---

### `attester` (Allowlist Change)

Emitted when an attester contract/account is added to or removed from the
allowlist.

| Field | Type | Description |
|-------|------|-------------|
| **topics[0]** | `Symbol("attester")` | Event discriminator |
| **topics[1]** | `Symbol("add")` or `Symbol("rm")` | Operation |

**Data**:

| Type | Description |
|------|-------------|
| `Address` | The attester address being added or removed |

**Contract source**: `reputation/src/lib.rs` → `fn add_attester()` / `fn remove_attester()`

```rust
// Add:
env.events().publish(
    (symbol_short!("attester"), symbol_short!("add")), attester);

// Remove:
env.events().publish(
    (symbol_short!("attester"), symbol_short!("rm")), attester);
```

---

### `vouch` (Async Half-Card Lifecycle)

Three sub-types track the lifecycle of an async vouch (the cold-start fix /
install funnel).

#### `vouch` / `minted`

A half-card is minted by `from` for an unknown recipient (bound to
`sha256(secret)`).

| Field | Type | Description |
|-------|------|-------------|
| **topics[0]** | `Symbol("vouch")` | Event discriminator |
| **topics[1]** | `Symbol("minted")` | Sub-type |

**Data tuple**:

| Index | Type | Description |
|-------|------|-------------|
| 0 | `u64` | `id` — auto-incremented vouch ID |
| 1 | `Address` | `from` — the voucher |

#### `vouch` / `claimed`

A recipient claims a half-card by presenting its secret.

| Field | Type | Description |
|-------|------|-------------|
| **topics[0]** | `Symbol("vouch")` | Event discriminator |
| **topics[1]** | `Symbol("claimed")` | Sub-type |

**Data tuple**:

| Index | Type | Description |
|-------|------|-------------|
| 0 | `u64` | `vouch_id` |
| 1 | `Address` | `from` — the original voucher |
| 2 | `Address` | `claimer` — the recipient who claimed |

#### `vouch` / `slashed`

An unclaimed half-card expires after its 7-day window; the staked Social XP
is forfeit (not refunded).

| Field | Type | Description |
|-------|------|-------------|
| **topics[0]** | `Symbol("vouch")` | Event discriminator |
| **topics[1]** | `Symbol("slashed")` | Sub-type |

**Data tuple**:

| Index | Type | Description |
|-------|------|-------------|
| 0 | `u64` | `vouch_id` |
| 1 | `Address` | `from` — the voucher whose stake was slashed |
| 2 | `u64` | `stake` — the slashed amount |

**Contract source**: `reputation/src/lib.rs` → `fn mint_vouch()` / `fn claim_vouch()` / `fn expire_vouch()`

```rust
// Mint:
env.events().publish(
    (symbol_short!("vouch"), symbol_short!("minted")), (id, from));

// Claim:
env.events().publish(
    (symbol_short!("vouch"), symbol_short!("claimed")),
    (vouch_id, vouch.from, claimer));

// Slash:
env.events().publish(
    (symbol_short!("vouch"), symbol_short!("slashed")),
    (vouch_id, vouch.from, vouch.stake));
```

---

## 2. QuestRegistry Contract

### `quest` / `created`

A new quest is registered by the admin.

| Field | Type | Description |
|-------|------|-------------|
| **topics[0]** | `Symbol("quest")` | Event discriminator |
| **topics[1]** | `Symbol("created")` | Sub-type |

**Data**:

| Type | Description |
|------|-------------|
| `u32` | `id` — the quest ID |

### `quest` / `awarded`

A quest is awarded to a recipient after off-chain attester verification.
Note: this event is emitted **after** the cross-contract call to
`Reputation.award_xp`, which itself emits `att_set` and `xp` events.

| Field | Type | Description |
|-------|------|-------------|
| **topics[0]** | `Symbol("quest")` | Event discriminator |
| **topics[1]** | `Symbol("awarded")` | Sub-type |

**Data tuple**:

| Index | Type | Description |
|-------|------|-------------|
| 0 | `u32` | `quest_id` |
| 1 | `Address` | `recipient` |

### `streak` (Weekly Retention)

Emitted whenever a player's consecutive-week streak is updated (after a quest
award bumps it). A run that lapses without a new award emits nothing; see
[`Streak`](#streak) for how `get_streak` reports it.

| Field | Type | Description |
|-------|------|-------------|
| **topics[0]** | `Symbol("streak")` | Event discriminator |
| **topics[1]** | `Address` | `player` — the streak subject |

**Data tuple**:

| Index | Type | Description |
|-------|------|-------------|
| 0 | `u32` | `weeks` — the new consecutive-week count |
| 1 | `u32` | `best` — the all-time high |

**Contract source**: `quest_registry/src/lib.rs` → `fn bump_streak()`

```rust
env.events().publish(
    (symbol_short!("streak"), player.clone()), (s.weeks, s.best));
```

---

## 3. Registry Contract (Handles)

### `handle` / `claimed`

A wallet takes a handle, either its first one or as a rename. On a rename the
old handle is announced with `handle` / `released` in the same transaction,
immediately before this event. Re-claiming the handle the wallet already holds
changes nothing and emits no event.

| Field | Type | Description |
|-------|------|-------------|
| **topics[0]** | `Symbol("handle")` | Event discriminator |
| **topics[1]** | `Symbol("claimed")` | Sub-type |

**Data tuple**:

| Index | Type | Description |
|-------|------|-------------|
| 0 | `Address` | `caller` — the claiming wallet |
| 1 | `Symbol` | `handle` — the claimed handle |

### `handle` / `released`

A handle is freed: the wallet released it (`release()`), or renamed away from
it (`claim()` with a different handle, emitted right before the new `claimed`).
Either way the handle no longer resolves and anyone may claim it.

| Field | Type | Description |
|-------|------|-------------|
| **topics[0]** | `Symbol("handle")` | Event discriminator |
| **topics[1]** | `Symbol("released")` | Sub-type |

**Data tuple**:

| Index | Type | Description |
|-------|------|-------------|
| 0 | `Address` | `caller` — the wallet that held the handle |
| 1 | `Symbol` | `handle` — the freed handle |

An indexer keyed by handle stays in sync by applying both sub-types in event
order: `claimed` sets `handle → caller`, `released` deletes `handle`. The one
gap is `admin_release()` (see the note below).

**Contract source**: `registry/src/lib.rs` → `fn claim()` / `fn release()`

```rust
// Rename (inside claim, before the claimed event):
env.events().publish(
    (symbol_short!("handle"), symbol_short!("released")),
    (caller.clone(), old));

// Claim:
env.events().publish(
    (symbol_short!("handle"), symbol_short!("claimed")),
    (caller, handle));

// Release:
env.events().publish(
    (symbol_short!("handle"), symbol_short!("released")),
    (caller, handle));
```

> **Note**: `admin_release()` does **not** emit a `handle` event (admin-only
> operation that cleans up state silently). It does emit `meta` / `cleared` when
> the holder had a profile.

### `meta` / `set`

A handle holder publishes its profile face and bio (`set_meta()`), replacing any
earlier ones. Only an address that holds a handle can set one; a rename keeps it.
The stored shape is [`ProfileMeta`](#profilemeta-get_meta).

| Field | Type | Description |
|-------|------|-------------|
| **topics[0]** | `Symbol("meta")` | Event discriminator |
| **topics[1]** | `Symbol("set")` | Sub-type |

**Data tuple**:

| Index | Type | Description |
|-------|------|-------------|
| 0 | `Address` | `caller` — the handle holder |
| 1 | `u64` | `avatar` — the packed face (layout under `ProfileMeta`) |
| 2 | `String` | `bio` — plain text, may be empty |

### `meta` / `cleared`

An address's profile is deleted because it gave up its handle: `release()`
(right after `handle` / `released`) or `admin_release()`. Emitted only when there
was a profile to delete. Meta is keyed by address, so whoever claims the freed
handle next starts with none.

| Field | Type | Description |
|-------|------|-------------|
| **topics[0]** | `Symbol("meta")` | Event discriminator |
| **topics[1]** | `Symbol("cleared")` | Sub-type |

**Data**:

| Type | Description |
|------|-------------|
| `Address` | The address whose profile was deleted |

An indexer keyed by address folds both in order: `set` replaces the profile,
`cleared` deletes it.

**Contract source**: `registry/src/lib.rs` → `fn set_meta()` / `fn clear_meta()`

```rust
// Set:
env.events().publish(
    (symbol_short!("meta"), symbol_short!("set")),
    (caller, avatar, bio));

// Cleared (from release / admin_release):
env.events().publish(
    (symbol_short!("meta"), symbol_short!("cleared")), addr);
```

---

## 4. Gate Contract

### `gate` / `created`

An access gate is defined by the admin.

| Field | Type | Description |
|-------|------|-------------|
| **topics[0]** | `Symbol("gate")` | Event discriminator |
| **topics[1]** | `Symbol("created")` | Sub-type |

**Data**:

| Type | Description |
|------|-------------|
| `u32` | `id` — the gate ID |

### `unlocked`

A user claims a gate they pass, recording on-chain proof of unlock.

| Field | Type | Description |
|-------|------|-------------|
| **topics[0]** | `Symbol("unlocked")` | Event discriminator |
| **topics[1]** | `Address` | `caller` — the user who unlocked |

**Data**:

| Type | Description |
|------|-------------|
| `u32` | `id` — the gate ID |

**Contract source**: `gate/src/lib.rs` → `fn create_gate()` / `fn unlock()`

```rust
// Create:
env.events().publish(
    (symbol_short!("gate"), symbol_short!("created")), id);

// Unlock:
env.events().publish(
    (symbol_short!("unlocked"), caller), id);
```

---

## 5. Rewards Contract

### `tipped`

A direct USDC transfer from one wallet to another, with a social
"thank-you" event for the feed.

| Field | Type | Description |
|-------|------|-------------|
| **topics[0]** | `Symbol("tipped")` | Event discriminator |
| **topics[1]** | `Address` | `from` — sender |
| **topics[2]** | `Address` | `to` — receiver |

**Data**:

| Type | Description |
|------|-------------|
| `i128` | `amount` — USDC stroops transferred |

> **Reading it**: RPC `getEvents` topic filters only match events with exactly as many
> topics as filter segments, so a 2-segment `['*', '*']` scan never returns `tipped`. Use a
> 3-segment filter such as `[tipped, <from>, '*']` (`apps/web/src/lib/events.ts` →
> `fetchTipsSent`).

### `rwd_set` (Reward Registered/Updated)

An admin registers or updates a reward row in the unlock table.

| Field | Type | Description |
|-------|------|-------------|
| **topics[0]** | `Symbol("rwd_set")` | Event discriminator |
| **topics[1]** | `u32` | `reward_id` — the reward row ID |

**Data tuple**:

| Index | Type | Description |
|-------|------|-------------|
| 0 | `u64` | `threshold` — Earned XP required |
| 1 | `i128` | `amount` — USDC stroops payout |

`add_reward` reverts, and emits nothing, for a zero `threshold` (`InvalidThreshold` #15)
or, while a daily cap is set, an `amount` above the cap (`AmountExceedsCap` #16). So every
`rwd_set` has `threshold ≥ 1`. Rows registered before this rule are not re-checked. The
cap can't be lowered below an active row's `amount` either (`set_daily_cap` reverts with
`CapBelowActiveReward` #17).

### `reward` (Reward Claimed)

A user claims a registered reward. Note: the payout amount is the
**admin-stored** amount — the caller can never dictate it (anti-drain).

| Field | Type | Description |
|-------|------|-------------|
| **topics[0]** | `Symbol("reward")` | Event discriminator |
| **topics[1]** | `Address` | `to` — the claimant |

**Data tuple**:

| Index | Type | Description |
|-------|------|-------------|
| 0 | `u32` | `reward_id` |
| 1 | `i128` | `amount` — USDC stroops paid |
| 2 | `u32` | `claims` — claims paid for this reward so far, including this one |

Index 2 was appended when fixed-size pools landed; readers that only look at
indexes 0–1 are unaffected.

### `rwd_cap` (Reward Supply Set)

An admin caps how many wallets can claim a reward (a fixed-size bounty pool), or
removes the cap with `0`. Once `claims` reaches the cap, `claim_reward` reverts with
`RewardExhausted` (#13).

| Field | Type | Description |
|-------|------|-------------|
| **topics[0]** | `Symbol("rwd_cap")` | Event discriminator |
| **topics[1]** | `u32` | `reward_id` — the reward row ID |

**Data**:

| Type | Description |
|------|-------------|
| `u32` | `max_claims` — the new cap (`0` = unlimited) |

**Contract source**: `rewards/src/lib.rs` → `fn tip()` / `fn add_reward()` / `fn set_reward_supply()` / `fn claim_reward()`

```rust
// Tip:
env.events().publish(
    (symbol_short!("tipped"), from, to), amount);

// Reward set:
env.events().publish(
    (symbol_short!("rwd_set"), reward_id), (threshold, amount));

// Reward supply set:
env.events().publish(
    (symbol_short!("rwd_cap"), reward_id), max_claims);

// Reward claimed:
env.events().publish(
    (symbol_short!("reward"), to), (reward_id, entry.amount, stats.claims));
```

---

## Event Index Map

Quick-reference table of all event discriminators and their sub-types.

| Discriminator | Sub-type | Contract | Page |
|---------------|----------|----------|------|
| `att_set` | *(none)* | Reputation | [↑](#att_set-attestation-set) |
| `xp` | *(none)* | Reputation | [↑](#xp-earned-track-total) |
| `social` | *(none)* | Reputation | [↑](#social-social-track-total) |
| `attester` | `add`, `rm` | Reputation | [↑](#attester-allowlist-change) |
| `vouch` | `minted`, `claimed`, `slashed` | Reputation | [↑](#vouch-async-half-card-lifecycle) |
| `quest` | `created`, `awarded` | QuestRegistry | [↑](#2-questregistry-contract) |
| `streak` | *(none)* | QuestRegistry | [↑](#streak-weekly-retention) |
| `handle` | `claimed`, `released` | Registry | [↑](#3-registry-contract-handles) |
| `meta` | `set`, `cleared` | Registry | [↑](#meta--set) |
| `gate` | `created` | Gate | [↑](#4-gate-contract) |
| `unlocked` | *(none)* | Gate | [↑](#unlocked) |
| `tipped` | *(none)* | Rewards | [↑](#tipped) |
| `rwd_set` | *(none)* | Rewards | [↑](#rwd_set-reward-registeredupdated) |
| `rwd_cap` | *(none)* | Rewards | [↑](#rwd_cap-reward-supply-set) |
| `reward` | *(none)* | Rewards | [↑](#reward-reward-claimed) |

---

## Read-View Shapes (for Indexers)

These are not events but the canonical **storage shapes** that indexers may
read via `get_attestation()`, `get_vouch()`, etc.

### `Attestation`

`get_attestation(addr, schema_id)` returns `Option<Attestation>` — one record per
`(addr, schema_id)`, `None` until the first award under that schema. Every award
(`award_xp`) updates it in place:

```rust
pub struct Attestation {
    pub issuer: Address,   // attester of the most recent award under this schema
    pub value: i128,       // running total of every award under this schema (a u64 XP sum)
    pub timestamp: u64,    // ledger timestamp of the most recent award
    pub revoked: bool,     // always false — there is no revoke path yet
}
```

- `value` is the subject's standing under the schema, not the last award. Two quests
  of 50 and 25 XP under schema `2` read `value: 75`. The add is checked in `u64`: an
  award that would overflow reverts with `Overflow` (#7), leaving the record as it was.
- `issuer` and `timestamp` describe only the latest award. For who issued each award
  and when, fold the [`att_set`](#att_set-attestation-set) events for the subject and
  schema; each one's `amount` is that award's delta.
- Summed over every schema, the `value`s equal `get_earned(addr)` (but see the next
  point).
- **Records from before accumulation (issue #123).** Before the upgrade that made the
  record accumulate, each award overwrote it, so an entry written then holds only its
  last award. It decodes unchanged (same four fields) and counts on from that value at
  its next award. For a subject with such a record, `value` stays below the true
  per-schema total and the sum over schemas stays below `get_earned`. The full history
  is in the `att_set` events; `get_earned` is always the subject's exact Earned total.

### `Vouch`

```rust
pub struct Vouch {
    pub id: u64,
    pub from: Address,
    pub claim_hash: BytesN<32>,  // sha256 of the claim secret
    pub note: String,            // free-text note from the voucher
    pub claimed: bool,
    pub claimer: Option<Address>,
    pub created: u64,            // ledger timestamp
    pub stake: u64,              // escrowed Social XP
    pub slashed: bool,
}
```

### `Profile` (`get_profile`)

`get_profile(addr)` returns Social + Earned + verified in one call. It is computed on
read, never stored.

```rust
pub struct Profile {
    pub social: u64,
    pub earned: u64,
    pub verified: bool,  // has done >= 1 Earned action
}
```

This shape is **frozen**. Soroban decodes a struct only when the returned map has exactly
its fields, so adding a field breaks every existing caller that decodes `Profile` (another
contract, a generated binding). New per-address data ships as its own view instead, like
`get_counts` below.

### People counts (`get_counts`)

`get_counts(addr) -> (u32, u32)` returns `(vouched_by, backed)`:

| Index | Type | Description |
|-------|------|-------------|
| 0 | `u32` | `vouched_by` — distinct people who vouched for `addr` |
| 1 | `u32` | `backed` — distinct people `addr` vouched for |

Both are persistent counters (`DataKey::VouchedBy(addr)` / `DataKey::Backed(addr)`) that
`claim_vouch` increments only on a **fresh first pair** — the same `Seen(from, claimer)`
guard that gates the claim XP. Repeat vouches between the same two people, self-vouches
and rejected claims never move them. Direction matters: `alice -> bob` and `bob -> alice`
are two pairs. No new event is emitted; each increment happens alongside a
`vouch` / `claimed` event.

**No backfill.** The counters start at the contract upgrade that introduced them. A pair
first claimed before it is not counted (and never will be — the pair is already `Seen`).
To cover those, fold `vouch` / `claimed` events: distinct `from` per `claimer` is
`vouched_by`, distinct `claimer` per `from` is `backed` (de-duplicate repeat pairs). Both
the counter and an event fold are lower bounds on the same number, so take the larger —
the web app does this over the recent RPC window (`getPeopleCounts` in
`apps/web/src/lib/constellation.ts`). A contract deployed before the upgrade has no
`get_counts` at all, so treat a failed call as "unknown", not 0.

### `PendingBonus` (`get_pending`)

`get_pending(claimer) -> Vec<PendingBonus>` returns the 2nd-order voucher bonuses queued
on `claimer` (`DataKey::Pending(claimer)`), oldest first:

```rust
pub struct PendingBonus {
    pub voucher: Address,  // who is owed the bonus
    pub amount: u64,       // Social XP (BONUS_VOUCHER = 5)
}
```

`claim_vouch` queues one entry per fresh first pair while the claimer is unverified. The
claimer's first Earned credit (`award_xp`) pays every entry out as a `social` event for
its voucher and removes the queue, so the view is empty from then on — as it is for any
address with nothing queued. Bonuses for an already-verified claimer are paid at claim
time and never queued. At most `MAX_PENDING` (64) entries; bonuses past the cap are
dropped. Keyed by claimer only: "what am I owed" means reading `get_pending` for each
person you vouched and keeping the entries whose `voucher` is you.

### `ProfileMeta` (`get_meta`)

`get_meta(addr) -> Option<ProfileMeta>` returns the profile `addr` published with
`set_meta` (`DataKey::Meta(addr)`), or `None` if it never set one or has since given
up its handle. A registry deployed before `set_meta` has no `get_meta`, so treat a
failed call as "no profile" and show the default face.

```rust
pub struct ProfileMeta {
    pub avatar: u64,  // packed face, below
    pub bio: String,  // <= 80 BYTES of UTF-8, no control characters
}
```

`set_meta` reverts with `BioTooLong` (#5) past 80 bytes (not characters: `ş` is 2
bytes, most emoji 4), `BadBio` (#6) for text that isn't UTF-8 or contains a control
character (C0, DEL, C1), U+2028/U+2029, or a bidi embedding/override/isolate mark
(U+202A–U+202E, U+2066–U+2069), and `BadAvatar` (#7) for any `avatar` outside this
layout — one byte per field, every unlisted byte zero:

| Byte | Face (`byte 7 = 0`) | Kit (`byte 7 = 1`) |
|------|---------------------|--------------------|
| 7 | kind `0` | kind `1` |
| 5 | — | `skin` 1–6 |
| 4 | — | `hair` 1–10 |
| 3 | — | `eyes` 1–10 |
| 2 | — | `mouth` 1–9 |
| 1 | — | `acc` 0–13 (0 = none) |
| 0 | face number 1–5 (`face-01`…`face-05`) | `bg` 0–5 (0 = none) |

So `face-03` is `0x0000000000000003` and the kit skin 3 / hair 7 / eyes 5 / mouth 4 /
acc 9 / bg 2 is `0x0100030705040902`. The ranges are the portrait assets the web app
ships (`FACE_IDS` / `KIT_COUNTS` in `apps/web/src/lib/avatar.ts`, which packs with
`encodeAvatar`); adding assets means upgrading the contract to accept them.

### `QuestConfig`

```rust
pub struct QuestConfig {
    pub id: u32,
    pub schema_id: u32,  // forwarded to Reputation as attestation schema
    pub xp: u64,
    pub active: bool,
}
```

### `Streak`

```rust
pub struct Streak {
    pub weeks: u32,   // current consecutive-week run
    pub last_week: u64, // week index (timestamp / WEEK_SECS) of most recent completion
    pub best: u32,    // all-time high
}
```

The stored run only changes when a quest is awarded, so `get_streak(player)` normalizes
it on read: when `last_week + 1 < current week` (a full week was skipped), it returns
`weeks = 0`. `last_week` and `best` are returned as stored, and storage is not rewritten.
A completion in the current or the previous week still reads as the live count. No event
marks the lapse — the last `streak` event keeps the old `weeks` — so an indexer folding
`streak` events applies the same rule against the current week.

### Streak weeks (`get_week` / `get_week_bounds`)

A streak week is `timestamp / WEEK_SECS` (`WEEK_SECS = 604_800`), counted from the Unix
epoch. 1970-01-01 was a Thursday, so every week runs **Thursday 00:00:00 to Wednesday
23:59:59 UTC** — not Monday to Sunday. `get_week()` returns the current index.

`get_week_bounds() -> (u64, u64)` returns the current week as UTC unix timestamps:

| Index | Type | Description |
|-------|------|-------------|
| 0 | `u64` | `start` — the week's first second (`get_week() * WEEK_SECS`, a Thursday 00:00:00) |
| 1 | `u64` | `end` — the week's last second, **inclusive** (`start + WEEK_SECS - 1`, a Wednesday 23:59:59) |

The next week starts at `end + 1`, and a live run with no completion yet this week lapses
then. The bounds follow the ledger time the read is simulated at, which trails wall-clock
time by up to one ledger close. A contract deployed before this view has no
`get_week_bounds`; treat a failed call as "unknown" (the web app hides its countdown).

The alignment is frozen: every stored `Streak.last_week` is an index in this epoch, so
moving weeks to another start day would break every live streak. A different alignment
would need a versioned epoch and a migration.

### `RewardEntry`

```rust
pub struct RewardEntry {
    pub id: u32,
    pub threshold: u64,  // Earned XP required to unlock
    pub amount: i128,     // USDC stroops paid from the treasury
    pub active: bool,
}
```

### `RewardStats` / `RewardInfo`

`get_reward_stats(id)` returns the supply counters; `get_rewards()` returns each row
joined with them. `max_claims == 0` means unlimited.

```rust
pub struct RewardStats {
    pub max_claims: u32,
    pub claims: u32,
}

pub struct RewardInfo {
    pub id: u32,
    pub threshold: u64,
    pub amount: i128,
    pub active: bool,
    pub max_claims: u32,
    pub claims: u32,
}
```

### `Gate`

```rust
pub struct Gate {
    pub id: u32,
    pub track: u32,   // 0 = Social, 1 = Earned
    pub min: u64,     // minimum reputation to pass
    pub label: String,
    pub active: bool,
}
```

---

## Shared TypeScript Mirrors

The `@alvinmunk/shared` package (`packages/shared/src/index.ts`) maintains
mirrored TypeScript types and constants. Keep these in lockstep with the
Rust contract definitions:

```typescript
export const SCHEMA = { RESERVED: 1, QUEST: 2 } as const; // 1 is never emitted

export const EVENTS = {
  ATTESTATION_SET: 'att_set',
  XP: 'xp',
  SOCIAL: 'social',
  VOUCH: 'vouch',
  QUEST: 'quest',
  TIPPED: 'tipped',
  REWARD: 'reward',
  // handle, meta, gate, unlocked, streak, rwd_set, rwd_cap, attester are not yet mirrored
} as const;
```

---

## Versioning & Migration Policy

| Event | Schema Version | Frozen Since | Notes |
|-------|---------------|--------------|-------|
| `att_set` | 1 | Yellow belt | Versioned — add fields by bumping to v2 |
| All others | N/A | Yellow belt | Not explicitly versioned; add new fields by appending to the data tuple or introducing a new sub-type |

**Rules:**
1. **Never** change the topic tuple shape — indexers key on topics.
2. **Never** reorder existing fields in the data tuple — append only.
3. For `att_set`: increment `schema_version` if the data tuple gains new
   fields. Old indexers read the version first and can skip unknown formats.
4. Introduce new event discriminators (e.g. `att_revoke`) over overloading
   existing ones with incompatible data.

