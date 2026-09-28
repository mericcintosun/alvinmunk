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
| 3 | `u64` | `amount` — XP amount credited |
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
award bumps it).

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

> **Note**: `admin_release()` does **not** emit an event (admin-only
> operation that cleans up state silently).

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

```rust
pub struct Attestation {
    pub issuer: Address,
    pub value: i128,       // XP amount (stored as i128, interpret as u64)
    pub timestamp: u64,
    pub revoked: bool,
}
```

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
    pub last_week: u64, // epoch (timestamp / WEEK_SECS) of most recent completion
    pub best: u32,    // all-time high
}
```

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
  // handle, gate, unlocked, streak, rwd_set, rwd_cap, attester are not yet mirrored
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

