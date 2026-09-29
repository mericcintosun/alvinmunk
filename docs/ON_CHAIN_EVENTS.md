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

A half-card is minted by `from` for an unknown recipient, bound to an ed25519
claim key (`mint_vouch_signed`) or, on the legacy path, to `sha256(secret)`
(`mint_vouch`). Both emit this same event. A batch mint (`mint_vouches`, see
[Batch mint](#batch-mint-mint_vouches)) emits it once per card, in card order, each
right after that card's `social` stake debit — exactly the events of the same cards
minted one `mint_vouch_signed` call at a time, all in one transaction.

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

A recipient claims a half-card with a claim-key signature that names them
(`claim_vouch_signed`) or, for a card minted with a claim hash, by presenting its
secret (`claim_vouch`). Both emit this same event. See
[Claim keys](#claim-keys-mint_vouch_signed--claim_vouch_signed--get_claim_key).

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

A half-card's staked Social XP is forfeit (not refunded). There are **two paths** that
emit this event:

1. **`expire_vouch` path** — an unclaimed half-card is explicitly slashed by a keeper
   after its 7-day window. The card remains unclaimed (`claimed: false`).
2. **Late-claim path** — the card is claimed after its 7-day window but before anyone
   called `expire_vouch`. In this case `vouch`/`slashed` is emitted **before**
   `vouch`/`claimed` in the same transaction (the claimer's `social` claim-XP event
   falls between the two), so indexers see the slash before the claim.
   The stored vouch records `slashed: true, claimed: true`. A card `expire_vouch` already
   slashed can still be claimed; that claim emits no second `vouch`/`slashed`.

Both paths store `slashed: true` on the vouch and emit the same event shape:

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

**Contract source**: `reputation/src/lib.rs` → `fn mint()` (shared by `mint_vouch_signed` / `mint_vouches` / `mint_vouch`) / `fn settle_claim()` (shared by `claim_vouch_signed` / `claim_vouch`) / `fn expire_vouch()`

```rust
// Mint:
env.events().publish(
    (symbol_short!("vouch"), symbol_short!("minted")), (id, from));

// Claim (timely — refund, no slash event):
env.events().publish(
    (symbol_short!("vouch"), symbol_short!("claimed")),
    (vouch_id, vouch.from, claimer));

// Slash via expire_vouch (unclaimed, past deadline):
env.events().publish(
    (symbol_short!("vouch"), symbol_short!("slashed")),
    (vouch_id, vouch.from, vouch.stake));

// Late claim (past deadline): slash event emitted BEFORE claimed event.
env.events().publish(
    (symbol_short!("vouch"), symbol_short!("slashed")),
    (vouch_id, vouch.from, vouch.stake));
env.events().publish(
    (symbol_short!("vouch"), symbol_short!("claimed")),
    (vouch_id, vouch.from, claimer));
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

### `quest` / `att_bind` (Quest Attester Bound)

The admin bound a quest to one attester key with `set_quest_attester(quest_id, key)`.
From then on `award_quest` accepts only that key's signature for the quest, and the
global `AttesterKey` allowlist no longer applies to it. Rebinding emits this again with
the new key. Monitoring should alert on it: it changes who can mint Earned XP.

| Field | Type | Description |
|-------|------|-------------|
| **topics[0]** | `Symbol("quest")` | Event discriminator |
| **topics[1]** | `Symbol("att_bind")` | Sub-type |

**Data tuple**:

| Index | Type | Description |
|-------|------|-------------|
| 0 | `u32` | `quest_id` |
| 1 | `BytesN<32>` | `key` — the ed25519 attester public key now bound to the quest |

### `quest` / `att_clear` (Quest Attester Cleared)

The admin removed a quest's bound key with `clear_quest_attester(quest_id)`; the quest
falls back to the global allowlist. Clearing a quest with no binding is a no-op and emits
nothing.

| Field | Type | Description |
|-------|------|-------------|
| **topics[0]** | `Symbol("quest")` | Event discriminator |
| **topics[1]** | `Symbol("att_clear")` | Sub-type |

**Data tuple**:

| Index | Type | Description |
|-------|------|-------------|
| 0 | `u32` | `quest_id` |
| 1 | `BytesN<32>` | `key` — the key that was bound until now |

**Contract source**: `quest_registry/src/lib.rs` → `fn set_quest_attester()` / `fn clear_quest_attester()`

```rust
// Bind:
env.events().publish(
    (symbol_short!("quest"), symbol_short!("att_bind")), (quest_id, key));

// Clear:
env.events().publish(
    (symbol_short!("quest"), symbol_short!("att_clear")), (quest_id, old));
```

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

### `att_key` / `budget` (Attester Budget Set)

The admin set an attester key's daily Earned-XP budget with
`set_attester_budget(key, budget)`; `0` removes the budget (unlimited). See
[`AttesterUsage`](#attesterusage-get_attester_usage).

| Field | Type | Description |
|-------|------|-------------|
| **topics[0]** | `Symbol("att_key")` | Event discriminator |
| **topics[1]** | `Symbol("budget")` | Sub-type |

**Data tuple**:

| Index | Type | Description |
|-------|------|-------------|
| 0 | `BytesN<32>` | `key` — the ed25519 attester public key |
| 1 | `u64` | `budget` — Earned XP the key may award per UTC day (`0` = unlimited) |

### `att_key` / `near_cap` (Attester Budget 80%)

An award took a budgeted key's usage for the day from under 80% of its budget to 80% or
more. Only the award that crosses the line emits it (so once per key per day, unless the
budget is raised above the usage again), letting monitoring alert before awards start
reverting with `AttesterBudgetExceeded` (#7). Keys without a budget never emit it.

| Field | Type | Description |
|-------|------|-------------|
| **topics[0]** | `Symbol("att_key")` | Event discriminator |
| **topics[1]** | `Symbol("near_cap")` | Sub-type |

**Data tuple**:

| Index | Type | Description |
|-------|------|-------------|
| 0 | `BytesN<32>` | `key` — the attester public key |
| 1 | `u64` | `used` — Earned XP the key has awarded today, including this award |
| 2 | `u64` | `budget` — the key's daily budget |

**Contract source**: `quest_registry/src/lib.rs` → `fn set_attester_budget()` / `fn spend_attester_budget()`

```rust
// Budget set:
env.events().publish(
    (symbol_short!("att_key"), symbol_short!("budget")), (key, budget));

// 80% reached:
env.events().publish(
    (symbol_short!("att_key"), symbol_short!("near_cap")), (key.clone(), now, budget));
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
Either way the handle no longer resolves and enters a 30-day cooldown
(`HANDLE_COOLDOWN_SECS`): until `until` only this wallet may claim it again, and
`claim()` by anyone else reverts with `HandleCoolingDown` (#9). From `until` on,
anyone may claim it.

| Field | Type | Description |
|-------|------|-------------|
| **topics[0]** | `Symbol("handle")` | Event discriminator |
| **topics[1]** | `Symbol("released")` | Sub-type |

**Data tuple**:

| Index | Type | Description |
|-------|------|-------------|
| 0 | `Address` | `caller` — the wallet that held the handle |
| 1 | `Symbol` | `handle` — the freed handle |
| 2 | `u64` | `until` — ledger timestamp (unix seconds) the cooldown ends at |

Index 2 was appended when handle cooldowns landed; readers that only look at
indexes 0–1 are unaffected. A registry deployed before then emits two fields and
has no cooldown.

### `handle` / `moved`

A handle moves from one wallet to another in a single call (`transfer_handle()`),
signed by both. It is never free in between, so no `released` or `claimed` is
emitted for it and it starts no cooldown. When `from` had a profile, `meta` / `cleared` for `from` and
`meta` / `set` for `to` follow in the same transaction: the profile moves with
the handle.

| Field | Type | Description |
|-------|------|-------------|
| **topics[0]** | `Symbol("handle")` | Event discriminator |
| **topics[1]** | `Symbol("moved")` | Sub-type |

**Data tuple**:

| Index | Type | Description |
|-------|------|-------------|
| 0 | `Address` | `from` — the wallet that held the handle (now holds none) |
| 1 | `Address` | `to` — the wallet that holds it now |
| 2 | `Symbol` | `handle` — the moved handle |

`transfer_handle(from, to)` needs `from`'s and `to`'s authorization for that exact
call, so a handle can't be pushed onto an address that didn't accept it. It
reverts with `NoHandle` (#4) when `from` holds no handle and `AlreadyHasHandle`
(#10) when `to` already holds one (`to == from` included). Social and Earned XP
stay with `from`: they live in the Reputation contract, keyed by address.

An indexer keyed by handle stays in sync by applying all three sub-types in event
order: `claimed` sets `handle → caller` (ending any cooldown on it), `released`
deletes `handle` and marks it reserved for `caller` until `until`, `moved` sets
`handle → to`. One keyed by address maps `to → handle` and drops `from` on
`moved`. The one gap is `admin_release()` (see the note below); the `cooldown`
read view is always current.

**Contract source**: `registry/src/lib.rs` → `fn claim()` / `fn release()` / `fn transfer_handle()`

```rust
// Rename (inside claim, before the claimed event):
env.events().publish(
    (symbol_short!("handle"), symbol_short!("released")),
    (caller.clone(), old, until));

// Claim:
env.events().publish(
    (symbol_short!("handle"), symbol_short!("claimed")),
    (caller, handle));

// Release:
env.events().publish(
    (symbol_short!("handle"), symbol_short!("released")),
    (caller.clone(), handle, until));

// Transfer:
env.events().publish(
    (symbol_short!("handle"), symbol_short!("moved")),
    (from.clone(), to.clone(), handle));
```

> **Note**: `admin_release()` does **not** emit a `handle` event (admin-only
> operation that cleans up state silently). It does emit `meta` / `cleared` when
> the holder had a profile. It frees the handle outright: it starts no cooldown,
> and silently ends one the handle is already in.

### `meta` / `set`

A handle holder publishes its profile face and bio (`set_meta()`), replacing any
earlier ones. Only an address that holds a handle can set one; a rename keeps it.
Also emitted for `to` by `transfer_handle()` when the profile moves with the
handle (right after `meta` / `cleared` for `from`). The stored shape is
[`ProfileMeta`](#profilemeta-get_meta).

| Field | Type | Description |
|-------|------|-------------|
| **topics[0]** | `Symbol("meta")` | Event discriminator |
| **topics[1]** | `Symbol("set")` | Sub-type |

**Data tuple**:

| Index | Type | Description |
|-------|------|-------------|
| 0 | `Address` | `caller` — the handle holder (`to` for a transfer) |
| 1 | `u64` | `avatar` — the packed face (layout under `ProfileMeta`) |
| 2 | `String` | `bio` — plain text, may be empty |

### `meta` / `cleared`

An address's profile is deleted because it gave up its handle: `release()`
(right after `handle` / `released`), `admin_release()`, or `transfer_handle()`
(right after `handle` / `moved`, followed by `meta` / `set` for the new wallet).
Emitted only when there was a profile to delete. Meta is keyed by address, so
whoever claims a freed handle next starts with none.

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

// Cleared (from release / admin_release / transfer_handle):
env.events().publish(
    (symbol_short!("meta"), symbol_short!("cleared")), addr);

// Moved with a transfer (after cleared for `from`):
env.events().publish(
    (symbol_short!("meta"), symbol_short!("set")),
    (to, meta.avatar, meta.bio));
```

---

## 4. Gate Contract

### `gate` / `created`

An access gate is defined or replaced by the admin, with `create_gate` (one rule) or
`create_gate_rules` (a composite gate). Both emit the same event. For an id that already
exists it marks a new definition: the gate's version (`get_gate_version`) goes up by one
and unlocks made under the previous definition stop counting.

| Field | Type | Description |
|-------|------|-------------|
| **topics[0]** | `Symbol("gate")` | Event discriminator |
| **topics[1]** | `Symbol("created")` | Sub-type |

**Data**:

| Type | Description |
|------|-------------|
| `u32` | `id` — the gate ID |

### `unlocked`

A user claims a gate they pass, recording on-chain proof of unlock. The proof holds for the
definition the gate had at that moment: a later `gate`/`created` for the same `id`
supersedes it (the user must `unlock` again), and it doesn't count while the gate is
inactive. See `UnlockRecord` below for the stored record.

| Field | Type | Description |
|-------|------|-------------|
| **topics[0]** | `Symbol("unlocked")` | Event discriminator |
| **topics[1]** | `Address` | `caller` — the user who unlocked |

**Data**:

| Type | Description |
|------|-------------|
| `u32` | `id` — the gate ID |

**Contract source**: `gate/src/lib.rs` → `fn put_gate()` (via `create_gate()` / `create_gate_rules()`) / `fn unlock()`

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

> **Invariants (#144)**: every `tipped` event moves value. `tip` reverts with
> `InvalidAmount` (#8) for an `amount ≤ 0` and with `SelfTip` (#20) when `from == to`, so
> `amount > 0` and `topics[1] != topics[2]` always hold. Before that rule the SAC accepted a
> zero amount and a self-transfer, and a wallet could mint unlimited no-value `tipped`
> events for the price of a fee — enough to fake "received a spend" in the feed and an
> indexer, which is the Green belt's D7 de-risk metric. A `tipped` event from a contract
> deployed before this rule is not re-validated; `amount > 0` and distinct wallets are the
> normal case and only a deliberate abuse looks different. `SelfTip` (#20) sits above the
> SAC's own 1–13 error range so a code can never be confused with the token contract's.

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

### `rwd_strk` (Reward Streak Requirement Set)

An admin requires a live weekly quest streak of at least `weeks` to claim a reward, on
top of its Earned-XP threshold, or removes the requirement with `0`. `claim_reward` then
reads the claimer's `quest_registry.get_streak` (the QuestRegistry set by
`set_quest_registry`) and reverts with `StreakTooShort` (#18) when `weeks` is below the
minimum. `get_streak` reads a lapsed run as `0` weeks (see [`Streak`](#streak)), so a stale
stored count never passes. Rewards without a minimum are unchanged and make no
QuestRegistry call. A non-zero minimum reverts with `QuestRegistryNotSet` (#19) until
`set_quest_registry` has run; the minimum lives under its own key, so stored `RewardEntry`
rows keep their shape.

| Field | Type | Description |
|-------|------|-------------|
| **topics[0]** | `Symbol("rwd_strk")` | Event discriminator |
| **topics[1]** | `u32` | `reward_id` — the reward row ID |

**Data**:

| Type | Description |
|------|-------------|
| `u32` | `weeks` — the live streak now required (`0` = none) |

**Contract source**: `rewards/src/lib.rs` → `fn tip()` / `fn add_reward()` / `fn set_reward_supply()` / `fn set_reward_min_streak()` / `fn claim_reward()`

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

// Reward streak requirement set:
env.events().publish(
    (symbol_short!("rwd_strk"), reward_id), weeks);

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
| `quest` | `created`, `awarded`, `att_bind`, `att_clear` | QuestRegistry | [↑](#2-questregistry-contract) |
| `streak` | *(none)* | QuestRegistry | [↑](#streak-weekly-retention) |
| `att_key` | `budget`, `near_cap` | QuestRegistry | [↑](#att_key--budget-attester-budget-set) |
| `handle` | `claimed`, `released`, `moved` | Registry | [↑](#3-registry-contract-handles) |
| `meta` | `set`, `cleared` | Registry | [↑](#meta--set) |
| `gate` | `created` | Gate | [↑](#4-gate-contract) |
| `unlocked` | *(none)* | Gate | [↑](#unlocked) |
| `tipped` | *(none)* | Rewards | [↑](#tipped) |
| `rwd_set` | *(none)* | Rewards | [↑](#rwd_set-reward-registeredupdated) |
| `rwd_cap` | *(none)* | Rewards | [↑](#rwd_cap-reward-supply-set) |
| `rwd_strk` | *(none)* | Rewards | [↑](#rwd_strk-reward-streak-requirement-set) |
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
    pub claim_hash: BytesN<32>,  // sha256 of the claim secret; all zeros on a claim-key card
    pub note: String,            // free-text note from the voucher, <= 240 BYTES of UTF-8
    pub claimed: bool,
    pub claimer: Option<Address>,
    pub created: u64,            // ledger timestamp
    pub stake: u64,              // escrowed Social XP
    pub slashed: bool,
}
```

`mint_vouch_signed(from, claim_key, note)`, `mint_vouch(from, claim_hash, note)` and every
card of `mint_vouches` revert with `NoteTooLong` (#12) when `note` is over 240 bytes (not characters: `ş` is 2 bytes, most emoji 4). That is the web app's
60-character limit at UTF-8's worst case, so a note typed there always fits. Vouches
minted before the cap keep their note as stored.

**Enumerating every vouch** (no events needed). Ids are sequential from `1` and never
reused; the highest minted id is `DataKey::VouchSeq` (a `u64` in instance storage, absent
until the first mint), and each half-card is the persistent entry `DataKey::Vouch(id)`.
Read one with `get_vouch(id)`, or read many straight from storage with RPC
`getLedgerEntries` (keys `Vec[Symbol("VouchSeq")]` in the contract instance and
`Vec[Symbol("Vouch"), U64(id)]`) — the `/stats` claim funnel does this
(`apps/web/src/lib/vouch-funnel.ts`), so these two keys are part of the read surface. A
`Vouch` entry's TTL is extended only at mint (to ~150 days), so an old one can be archived
and missing from `getLedgerEntries`; count it as unread, not as absent.

This shape is **frozen** for the same reason as `Profile` below: the funnel and generated
bindings decode exactly these nine fields. A card's claim key is therefore not a field but
its own entry (next section).

### Claim keys (`mint_vouch_signed` / `claim_vouch_signed` / `get_claim_key`)

A claim-secret card (`mint_vouch` / `claim_vouch`) is front-runnable: the secret is a plain
`claim_vouch` argument, so it is public from the claim's simulation onward, and anyone can
resubmit it with their own address first (issue #121). Current cards bind the claim to one
address instead:

1. **Mint.** The voucher's browser draws a fresh 32-byte ed25519 seed and calls
   `mint_vouch_signed(from, claim_key, note)` with its public key. The key is stored as the
   persistent entry `DataKey::ClaimPubkey(id)` (storage key
   `Vec[Symbol("ClaimPubkey"), U64(id)]`, TTL bumped with the `Vouch` at mint), the card's
   `claim_hash` is 32 zero bytes, and the event is the usual `vouch` / `minted`. Stake,
   daily cap and note cap are the same as `mint_vouch` (the daily cap counts every mint
   entrypoint). `mint_vouches` mints several such cards at once (next section).
2. **Share.** The link is `/claim/<id>#k=<seed as 64 hex chars>`. The seed rides in the URL
   fragment, which browsers never send to a server; the app keeps a local copy for re-sharing.
3. **Claim.** The claimer's browser signs the claim message below with the seed and calls
   `claim_vouch_signed(claimer, vouch_id, sig)`. The contract requires `claimer`'s auth and
   verifies `sig` (64 bytes, plain ed25519 over the message bytes, no pre-hash) against the
   stored key. The seed never leaves the browser.

**Claim message** — the XDR encoding of this `ScVal::Vec`:

| Index | ScVal | Value |
|-------|-------|-------|
| 0 | `Symbol` | `"alvinmunk_vouch_claim"` — domain tag (`CLAIM_DOMAIN`) |
| 1 | `Bytes` (32) | network id = `sha256(network passphrase)`, as the ledger reports it |
| 2 | `Address` | the Reputation contract being called |
| 3 | `U64` | `vouch_id` |
| 4 | `Address` | `claimer` (a `G…` account or a `C…` passkey smart wallet) |

Each element closes one replay: a signature seen in a pending claim is useless for another
claimer (index 4), another card, even one minted with the same key (3), another deployment
(2), or another network (1), and the tag keeps it from matching any other protocol's message.
Test vector (vouch `7` on testnet, contract `C…` = 32 × `0x11`, claimer `G…` = 32 × `0x22`):

```
000000100000000100000005                                                  vec of 5
0000000f00000015616c76696e6d756e6b5f766f7563685f636c61696d000000          Symbol
0000000d00000020cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472  network id
00000012000000011111111111111111111111111111111111111111111111111111111111111111  contract
000000050000000000000007                                                  u64 7
0000001200000000000000002222222222222222222222222222222222222222222222222222222222222222  claimer
```

The contract test `claim_message_matches_the_documented_bytes` and the web test in
`apps/web/src/lib/reputation.test.ts` both pin these bytes. **Build the message yourself**
(`claimMessage` in `apps/web/src/lib/reputation.ts`); never sign bytes an RPC node hands
back, since a dishonest node could return the message for its own address.

**Errors.** A signature that does not verify (wrong key, wrong claimer, card, contract or
network) traps in the host with `Error(Crypto, InvalidInput)`, not a contract code; a
cross-contract `try_call` sees it as `Error(Context, InvalidAction)`. Calling the wrong
entrypoint for a card reverts with `WrongClaimMethod` (#13): `claim_vouch_signed` on a
claim-hash card, or `claim_vouch` on a claim-key card. The other claim errors are as
before (`VouchNotFound` #4, `AlreadyClaimed` #5, `SelfVouch` #6).

**Telling cards apart.** `get_claim_key(vouch_id) -> Option<BytesN<32>>` returns the stored
key, or `None` for a claim-hash card (and an unknown id). The key is public; only the seed
in the link can sign.

**Legacy cards.** Cards minted before this upgrade keep their shape and still claim with
`claim_vouch` and their `#s=` (or older `?s=`) link, so none are stranded; they stay
front-runnable until claimed or expired. `mint_vouch` still works for integrations but
mints the same front-runnable kind; the web app only calls `mint_vouch_signed`. Upgrade
the contract before shipping a web build that calls it.

### Batch mint (`mint_vouches`)

`mint_vouches(from, claim_keys: Vec<BytesN<32>>, notes: Vec<String>) -> Vec<u64>` lets a
cohort leader mint several claim-key cards under **one** `from.require_auth()` (one wallet
prompt). Card `i` is bound to `claim_keys[i]` with note `notes[i]`; the ids come back in
the same order and are consecutive (nothing else can mint inside the same invocation).

Each card goes through exactly the path of a separate `mint_vouch_signed(from, claim_keys[i],
notes[i])` call: the note cap, one slot of the voucher's `MAX_VOUCH_PER_DAY` (20 per UTC day,
shared with single mints), the starter grant (once), one `VOUCH_STAKE` escrow, the stored
`Vouch` and `ClaimPubkey` entries with the same TTLs, and its own `social` debit and
`vouch` / `minted` events. Each card claims on its own with `claim_vouch_signed` and the
seed in its own link, so an indexer or the feed cannot tell a batch from single mints.

| Error | Code | When |
|-------|------|------|
| `LengthMismatch` | #14 | `claim_keys` and `notes` differ in length |
| `BadBatchSize` | #15 | no cards, or more than `MAX_BATCH_VOUCH` (10) |
| `NoteTooLong` / `DailyCapReached` / `InsufficientStake` | #12 / #9 / #11 | any one card fails its single-mint check |

Any failure reverts the **whole** batch — no card is minted, no stake escrowed, no daily
slot used, no event emitted. So 19 mints earlier in the day plus a batch of 2 reverts with
`DailyCapReached` rather than minting one card, and the starter 20 Social XP covers a batch
of four, not five. A full batch of ten 240-byte notes writes 24 ledger entries (two per
card, plus the day's count, the balance, the contract instance and the auth nonce) and
~3 KB of events, far inside the per-transaction limits. `mint_vouches` is new in this upgrade:
a deployment that predates it has no such function, so upgrade the contract before
shipping a web build that calls it. The web app calls it from the "Several people" mode
of the vouch composer (`mintVouches` in `apps/web/src/lib/reputation.ts`).

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
a claim (`claim_vouch_signed` or `claim_vouch`) increments only on a **fresh first pair** —
the same `Seen(from, claimer)` guard that gates the claim XP. Repeat vouches between the same two people, self-vouches
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

A claim queues one entry per fresh first pair while the claimer is unverified. The
claimer's first Earned credit (`award_xp`) pays every entry out as a `social` event for
its voucher and removes the queue, so the view is empty from then on — as it is for any
address with nothing queued. Bonuses for an already-verified claimer are paid at claim
time and never queued. At most `MAX_PENDING` (64) entries; bonuses past the cap are
dropped. Keyed by claimer only: "what am I owed" means reading `get_pending` for each
person you vouched and keeping the entries whose `voucher` is you.

### Handle lookups (`resolve` / `reverse` / `reverse_many`)

`resolve(handle) -> Option<Address>` and `reverse(addr) -> Option<Symbol>` read the two
directions of the handle map (`DataKey::Fwd(handle)` / `DataKey::Rev(addr)`), `None`
when the handle is free or the address holds none.

`reverse_many(addrs: Vec<Address>) -> Vec<Option<Symbol>>` is `reverse` for a whole list
in one call, so a leaderboard or feed labels N rows in one read: one entry per input
address, in input order (a repeated address repeats its answer), `None` where an address
holds no handle. It takes at most 50 addresses (`REVERSE_MANY_CAP`) and reverts with
`TooMany` (#8) past that. A full batch reads 52 ledger entries (50 `Rev` keys, the
instance and the code), far inside the per-transaction limits (400 footprint entries and
200 disk reads on testnet and mainnet, checked 2026-09-29) even when every entry is
archived. Callers chunk longer lists (`reverseHandles` in `apps/web/src/lib/registry.ts`).

All three are pure reads: any caller, no auth, no writes, no TTL extension. A registry
deployed before `reverse_many` has no such function (`Error(WasmVm, MissingValue)`,
"non-existent contract function"), so fall back to one `reverse` per address.

### Handle cooldown (`cooldown`)

`cooldown(handle) -> Option<CooldownInfo>` says why a free handle can't be claimed yet:
it was released or renamed away less than 30 days (`HANDLE_COOLDOWN_SECS`) ago.

```rust
pub struct CooldownInfo {
    pub prev_owner: Address,  // the wallet that freed it; it may reclaim it any time
    pub until: u64,           // ledger timestamp (unix seconds) anyone may claim it from
}
```

`None` when the handle is held, was never freed, its cooldown has passed, or
`admin_release` lifted it. While it is `Some`, `claim(handle)` by any address other
than `prev_owner` reverts with `HandleCoolingDown` (#9). The window is checked against
ledger time only, and the entry lives in temporary storage (about 60 days of ledgers)
so it outlives `until` and then deletes itself. Pure read: any caller, no writes, no
TTL extension. A registry deployed before cooldowns has no such function, so treat a
failed call as "no cooldown".

### `ProfileMeta` (`get_meta`)

`get_meta(addr) -> Option<ProfileMeta>` returns the profile `addr` published with
`set_meta` or received along with a handle from `transfer_handle`
(`DataKey::Meta(addr)`), or `None` if it has none or has since given up its handle.
A registry deployed before `set_meta` has no `get_meta`, so treat a failed call as
"no profile" and show the default face.

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

### Quest completion (`is_completed` / `get_completed`)

`is_completed(quest_id, who) -> bool` reads the replay guard `award_quest` sets, the
persistent entry `DataKey::Claimed(quest_id, who)`: `true` once `who` has been awarded the
quest, and from then on another award for the pair reverts with `AlreadyClaimed` (#5). An
unknown quest, or an award that reverted, reads as `false`.

`get_completed(who, ids: Vec<u32>) -> Vec<bool>` is the batched form for one wallet: one
flag per id, in input order, duplicates repeated. Each id is one persistent read, so keep a
call to the few quests a page shows (the web app asks for its three). Both are pure reads
that any caller can make, and they don't extend the entry's TTL.

A contract deployed before these views has neither; treat a failed call as "unknown". The
web app then shows every quest as available, and `/api/attest` goes on to verify the
evidence as before, since the on-chain guard still refuses a second award. With the views,
`/api/attest` answers `409` for a completed quest before it verifies any evidence.

### Quest attester scope (`get_quest_attester`)

`get_quest_attester(quest_id) -> Option<BytesN<32>>` returns the ed25519 key bound to a
quest, or `None` when the quest uses the global allowlist. Admin functions:

| Function | Effect |
|----------|--------|
| `set_quest_attester(quest_id, key)` | Bind the quest to `key`, replacing any previous key. Reverts with `QuestNotFound` (#4) for an unknown quest. Emits `quest` / `att_bind`. |
| `clear_quest_attester(quest_id)` | Remove the binding. Emits `quest` / `att_clear` when one existed. |

`award_quest` then authorizes the signing key like this:

- **Bound quest:** only the bound key. Any other key, including a globally allowlisted
  one, reverts with `NotAuthorized` (#3).
- **Unbound quest:** any key in the global allowlist (`add_attester_key`), as before.
  Quests that were never bound behave exactly as they did before this view existed.

A bound key does not need to be in the global allowlist, and a partner's key must not be
added there: the allowlist grants every unbound quest. `remove_attester_key` only edits
the allowlist, so to revoke a bound key call `clear_quest_attester` (or rebind the quest)
too. A contract deployed before this view has no `get_quest_attester`.

### Quest award payload (`quest_payload` / `award_quest`)

`award_quest(attester, sig, quest_id, recipient, expires_at)` credits a quest only with an
ed25519 signature (64 bytes, plain ed25519 over the payload bytes, no pre-hash) from a key
the quest accepts (see [Quest attester scope](#quest-attester-scope-get_quest_attester)),
plus `recipient`'s own auth. `quest_payload(quest_id, recipient, expires_at) -> Bytes`
returns the bytes `award_quest` rebuilds, for checking an off-chain build against a
deployment.

**Payload** — the XDR encoding of this `ScVal::Vec`:

| Index | ScVal | Value |
|-------|-------|-------|
| 0 | `Symbol` | `"alvinmunk_award_quest_v1"` — domain tag (`AWARD_DOMAIN`) |
| 1 | `Bytes` (32) | network id = `sha256(network passphrase)`, as the ledger reports it |
| 2 | `Address` | the QuestRegistry contract being called |
| 3 | `U32` | `quest_id` |
| 4 | `Address` | `recipient` (a `G…` account or a `C…` passkey smart wallet) |
| 5 | `U64` | `expires_at` — unix seconds, the last ledger timestamp the signature is accepted at |

Each element closes one replay: the signature is useless on another network (index 1),
against another deployment (2), for another quest (3) or wallet (4), or after its expiry
(5), and the tag names the entrypoint and payload version, so it never matches another
protocol's message or a later payload format (which must take a new tag). Test vector
(quest `3` on testnet, contract `C…` = 32 × `0x11`, recipient `G…` = 32 × `0x22`,
`expires_at` = `1790813400`, 2026-10-01 00:10:00 UTC):

```
000000100000000100000006                                                  vec of 6
0000000f00000018616c76696e6d756e6b5f61776172645f71756573745f7631          Symbol
0000000d00000020cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472  network id
00000012000000011111111111111111111111111111111111111111111111111111111111111111  contract
0000000300000003                                                          u32 3
0000001200000000000000002222222222222222222222222222222222222222222222222222222222222222  recipient
00000005000000006abda4d8                                                  u64 1790813400
```

For a `C…` recipient (32 × `0x33`) index 4 is
`00000012000000013333333333333333333333333333333333333333333333333333333333333333`.
The contract test `quest_payload_matches_the_documented_bytes` and the web test in
`apps/web/src/lib/attest.test.ts` both pin these bytes. **Build the payload yourself**
(`questPayload` in `apps/web/src/lib/attest.ts`); never sign bytes an RPC node hands back,
since a dishonest node could return the payload for its own address.

**Expiry.** `/api/attest` signs with `expires_at` = its clock + 600 s (`QUEST_SIG_TTL_SECS`)
and returns `{ ok, attester, sig, expiresAt, recipient, questId }`; `attester` is the raw
public key in hex, `sig` is base64. The client passes `expiresAt` back as the fifth
`award_quest` argument. The ledger timestamp trails wall-clock time by up to one ledger
close, so the window is the attester's clock skew plus that, not exact. At
`timestamp == expires_at` the award still goes through; from the next second it reverts
with `SignatureExpired` (#8), and the user asks for a fresh signature.

**Errors**, in the order `award_quest` checks them: `SignatureExpired` (#8), then
`NotAuthorized` (#3) for a key the quest does not accept, then the signature. A signature
that does not verify (wrong key, or any payload field changed, `expires_at` included)
traps in the host with `Error(Crypto, InvalidInput)`, not a contract code. Then come
`recipient.require_auth()`, `QuestNotFound` (#4), `QuestInactive` (#6), `AlreadyClaimed`
(#5) and `AttesterBudgetExceeded` (#7). A rejected award records no claim.

**Migration.** Before issue #142 the payload was `[quest_id, recipient, contract]` (a vec of
3) and `award_quest` took four arguments. Signatures over that payload never verify on the
upgraded contract, so grants issued but not redeemed before the upgrade are void. Upgrade
the contract first, then deploy the web app, whose attester and `award_quest` call both
need the new code.

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

### `AttesterUsage` (`get_attester_usage`)

`get_attester_usage(key) -> AttesterUsage` reports an attester key's daily Earned-XP
budget and today's usage. The admin sets the budget with `set_attester_budget(key,
budget)` (`0` = unlimited, the default for every key, so keys added before budgets existed
are unlimited without a migration).

```rust
pub struct AttesterUsage {
    pub budget: u64, // Earned XP the key may award per UTC day; 0 = unlimited
    pub used: u64,   // Earned XP it awarded during `day` while a budget was set
    pub day: u64,    // the current budget day: timestamp / 86_400
}
```

Budget days are UTC calendar days (00:00:00 to 23:59:59), so the budget resets at
`(day + 1) * 86_400`. `award_quest` adds the quest's XP to the key's usage for the day and
reverts with `AttesterBudgetExceeded` (#7) if that would exceed the budget; an award that
exactly reaches it goes through. The check runs after the existing ones, so a call that
failed with #3–#6 before still does. Usage is only counted while a key has a budget: a
budget set mid-day counts from the next award, and an unlimited key's awards add nothing.
The budget belongs to the key, not to its allowlist entry or quest bindings: it covers
every quest the key awards (quests bound to it with `set_quest_attester` included),
survives `remove_attester_key`, and applies again if the key is re-added. A contract deployed before
this view has no `get_attester_usage`.

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
joined with them and with its streak requirement (`get_reward_min_streak(id)`, also a
view). `max_claims == 0` means unlimited; `min_streak == 0` means no streak is required.
`min_streak` was appended when streak-gated rewards landed, so a contract deployed before
them returns rows without it; read a missing field as `0`.

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
    pub min_streak: u32,
}
```

### Reward status per wallet (`get_rewards_for`)

```rust
pub struct RewardStatus {
    pub entry: RewardInfo, // the `get_rewards` row
    pub claimed: bool,     // `is_claimed(entry.id, who)`
    pub eligible: bool,    // reason == 0
    pub reason: u32,       // the Error code `claim_reward` would revert with; 0 = none
}

pub fn get_rewards_for(who: Address) -> (Vec<RewardStatus>, i128)
```

One simulation for a wallet's whole reward table: every row of `get_rewards` (inactive
ones included, in the same order) with `who`'s status, and the treasury budget left
today in stroops — `get_daily_cap() - get_daily_paid()`, floored at `0`, or `-1` when no
daily cap is set. `reason` runs `claim_reward`'s checks in its order without the
transfer, so it is the first error the claim would revert with: `Paused` (#5), `Frozen`
(#10), `NotFunded` (#12), `RewardInactive` (#7), `AlreadyClaimed` (#4), `RewardExhausted`
(#13), `BelowThreshold` (#3), `QuestRegistryNotSet` (#19), `StreakTooShort` (#18), then
`DailyCapExceeded` (#9). The first three are per wallet and so the same on every row. The
Earned-XP and streak cross-reads run at most once per call. The view is read-only and
takes no auth. A contract deployed before this view has no `get_rewards_for`.

### Daily cap (`get_daily_cap` / `get_daily_paid`)

Both return `i128` USDC stroops. `get_daily_cap()` is the treasury's max payout per UTC
day, `0` = unlimited; `get_daily_paid()` is what claims have paid so far in the current
UTC day (`timestamp / 86_400`). `set_daily_cap` emits no event. It reverts with
`InvalidAmount` (#8) for a negative cap, which would otherwise lift the limit instead of
tightening it (`set_paused(true)` is the way to stop every payout), and with
`CapBelowActiveReward` (#17) for a positive cap below an active row's `amount`. A negative
cap stored by a contract deployed before that rule reads as `0`, which is how the payout
checks always treated it.

### Tip validation (`validate_tip`, in `tip`)

`tip(from, to, amount)` takes no view and emits no event of its own, but the reverts are
part of the `tipped` contract above: `InvalidAmount` (#8) for `amount ≤ 0` and `SelfTip`
(#20) for `from == to`. Both are checked before the SAC transfer and before the event, so a
rejected tip moves nothing and mints nothing. `tip` also requires `from.require_auth()`, is
gated on `Paused` (#5) and on the sender not being `Frozen` (#10), and never touches the
treasury — the daily cap counts claims only, since a tip is sender-funded.

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

For a composite gate, `track`/`min` hold its **first** rule only. `check` and `unlock`
evaluate the whole rule set, so read `get_gate_rules` before describing what a gate
requires.

### Composite gates (`get_gate_rules`)

```rust
pub struct Rule {
    pub track: u32, // 0 = Social, 1 = Earned
    pub min: u64,
}

pub enum RuleMode {
    AllOf = 0, // every rule must pass
    AnyOf = 1, // at least one rule must pass
}

pub struct GateRules {
    pub rules: Vec<Rule>,
    pub mode: RuleMode, // encoded as a u32
}
```

`create_gate_rules(id, rules, mode, label)` stores the set under its own key next to the
`Gate`, which it writes active with the first rule's `track`/`min`. It reverts with
`EmptyRules` (#8) for no rules, `TooManyRules` (#7) for more than `MAX_RULES` (4), and
`BadTrack` (#6) for a track other than 0 or 1. Replacing a composite gate with
`create_gate` drops its rule set. Replacing a gate either way starts a new definition, so
its existing unlocks stop counting (see `UnlockRecord`).

`get_gate_rules(id) -> Option<GateRules>` returns `None` for an unknown gate. A gate
created by `create_gate`, or before composite gates existed, has no stored set and reads
as one `AllOf` rule built from its `Gate` fields. `check`/`unlock` read each reputation
track at most once per call, however many rules name it. A contract deployed before
composite gates has no `get_gate_rules` or `create_gate_rules`; its gates keep working
unchanged after an upgrade.

### `UnlockRecord` (`get_unlock` / `is_unlocked` / `get_gate_version`)

```rust
pub struct UnlockRecord {
    pub version: u32, // the gate's version when it was unlocked
    pub ledger: u32,  // ledger sequence of the unlock
}
```

`unlock` stores this under `Unlocked(addr, id)`; unlocking again replaces it.
`get_gate_version(id) -> u32` counts the gate's redefinitions: `0` for a gate never
replaced (and for an unknown id), `+1` on every `create_gate` / `create_gate_rules` for an
existing id — including one that keeps the same rules. `set_gate_active` is not a
redefinition and leaves the version alone.

`is_unlocked(addr, id) -> bool` is true only while the gate is active **and** the stored
record's `version` equals `get_gate_version(id)`, so an unlock earned under a weaker rule,
or on another track, no longer reads as an unlock of the current gate. Disabling a gate
hides its unlocks; re-enabling it without a redefinition brings them back.
`get_unlock(addr, id) -> Option<UnlockRecord>` returns the latest record whether or not it
still counts (`None` if `addr` never unlocked `id`).

Before these records existed, `Unlocked` held a bare `true`. After an upgrade such an entry
reads as `{ version: 0, ledger: 0 }`: it keeps counting until the gate's first
redefinition, and the next `unlock` replaces it with a record. A contract deployed before
this change has no `get_unlock` or `get_gate_version`.

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
  // handle, meta, gate, unlocked, streak, rwd_set, rwd_cap, rwd_strk, attester are not yet mirrored
} as const;
```

### Reading view structs (`Attestation`, `Vouch`, `Profile`)

`Vouch` and `Profile` mirror the structs above field for field, every `u64` a
`bigint` (what `scValToNative` hands back), and ship with `decodeVouch` /
`decodeProfile`. A named-field `#[contracttype]` struct travels as an
`ScVal::Map` keyed by field name, which `scValToNative` turns into a plain
object: `Option<T>` is the value or `null` (`ScVal::Void`), `BytesN<32>` a
32-byte buffer. The decoders take that object and accept exactly the fields in
`VOUCH_FIELDS` / `PROFILE_FIELDS`, so a field added, dropped or renamed throws
instead of reading as `undefined`. `get_vouch` for an id never minted decodes
to `null`. `Attestation` has no decoder: its `value` (an `i128`) is a `bigint`,
its `timestamp` a `number` of unix seconds.

`contracts/reputation/testdata/read_views.json` holds real `get_vouch` /
`get_profile` return values (the XDR of each `ScVal`, hex). The contract test
`read_view_fixtures_match_the_contract` writes it from real calls and fails
when it is stale (rerun with `UPDATE_READ_VIEWS=1`);
`packages/shared/src/read-views.test.ts` decodes it through the mirrors and
checks their field lists against `contracts/reputation/src/lib.rs`, and
`apps/web/src/lib/read-views.test.ts` checks that the `@alvinmunk/sdk` views
the app reads through decode it the same way. A drift on either side fails a
test.

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

