#![no_std]
//! QuestRegistry — verifiable quests with allowlisted attesters + replay guard.
//!
//! `award_quest` is the oracle bridge (00-strategy §4): an off-chain attester
//! verifies a real action (merged GitHub PR, referral wallet did a real tx),
//! then calls here. We check the allowlist + replay set, then cross-call
//! Reputation.award_xp. NO decentralized oracle.
//!
//! Attester scope: a quest bound to a key (`set_quest_attester`) accepts only that key,
//! so a partner's quest key can't mint Earned XP on any other quest. Unbound quests accept
//! any key in the global allowlist (`add_attester_key`), which is for in-house keys only.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short,
    xdr::ToXdr, Address, Bytes, BytesN, Env, IntoVal, Symbol, Val, Vec,
};

// TTLs in ledgers (5s). `extend_ttl(key, threshold, extend_to)` does nothing unless the
// entry's TTL is at or below `threshold`, and then sets it to `extend_to`. New persistent
// entries start at the network's min_persistent_ttl (120,960 on testnet, 2,073,600 on
// mainnet), so the threshold sits one day under the target: the bump after a write lifts
// the entry to BUMP_EXTEND unless it already ran within the last day. BUMP_EXTEND must stay
// above mainnet's minimum and below max_entry_ttl (3,110,400).
const DAY_LEDGERS: u32 = 17_280; // ~1 day
const BUMP_EXTEND: u32 = 2_592_000; // ~150 days
const BUMP_THRESHOLD: u32 = BUMP_EXTEND - DAY_LEDGERS;
const WEEK_SECS: u64 = 604_800; // weekly retention loop (Green belt)

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    NotAuthorized = 3,
    QuestNotFound = 4,
    AlreadyClaimed = 5,
    QuestInactive = 6,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Reputation,              // Address of the Reputation contract
    Attester(Address),       // legacy address allowlist flag (kept for back-compat)
    AttesterKey(BytesN<32>), // ed25519 pubkey allowlist — the signature-verified attester
    Quest(u32),              // QuestConfig
    Claimed(u32, Address),   // replay guard: (quest_id, recipient) -> bool
    Streak(Address),         // weekly retention streak per player
    QuestAttester(u32),      // quest_id -> BytesN<32>: the only key that may award it
}

#[contracttype]
#[derive(Clone)]
pub struct QuestConfig {
    pub id: u32,
    pub schema_id: u32, // forwarded to Reputation as the attestation schema
    pub xp: u64,
    pub active: bool,
}

/// Weekly retention streak (Green belt). `weeks` = current consecutive-week run;
/// `last_week` = the epoch (timestamp / WEEK_SECS) of the most recent completion;
/// `best` = the all-time high (a rank input that survives a miss). Storage keeps `weeks`
/// until the next award; `get_streak` reports a lapsed run as 0.
#[contracttype]
#[derive(Clone)]
pub struct Streak {
    pub weeks: u32,
    pub last_week: u64,
    pub best: u32,
}

#[contract]
pub struct QuestRegistryContract;

#[contractimpl]
impl QuestRegistryContract {
    pub fn init(env: Env, admin: Address, reputation: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::Reputation, &reputation);
    }

    /// Admin-gated WASM upgrade — same contract instance + storage, new code. Lets us
    /// iterate/season without a new address or state migration (mainnet de-risk).
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        Self::admin(&env).require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    pub fn add_attester(env: Env, attester: Address) {
        Self::admin(&env).require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::Attester(attester), &true);
    }

    pub fn remove_attester(env: Env, attester: Address) {
        Self::admin(&env).require_auth();
        env.storage()
            .persistent()
            .remove(&DataKey::Attester(attester));
    }

    /// Allowlist an attester by its ed25519 PUBLIC KEY (32 bytes). `award_quest` verifies
    /// a signature from this key instead of an on-chain `require_auth`, so the off-chain
    /// attester grants Earned XP with a single signature — no tx, no fee, no source account.
    pub fn add_attester_key(env: Env, key: BytesN<32>) {
        Self::admin(&env).require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::AttesterKey(key), &true);
    }

    /// Revoke a key from the global allowlist. Quest bindings are separate: a key bound to
    /// a quest keeps awarding it until `clear_quest_attester`.
    pub fn remove_attester_key(env: Env, key: BytesN<32>) {
        Self::admin(&env).require_auth();
        env.storage()
            .persistent()
            .remove(&DataKey::AttesterKey(key));
    }

    /// Bind `quest_id` to one attester key (admin). From then on only `key` can award that
    /// quest; the global allowlist no longer applies to it. The key need not (and, for a
    /// partner, must not) be in the global allowlist. Rebinding replaces the previous key.
    pub fn set_quest_attester(env: Env, quest_id: u32, key: BytesN<32>) {
        Self::admin(&env).require_auth();
        if !env.storage().persistent().has(&DataKey::Quest(quest_id)) {
            panic_with_error!(&env, Error::QuestNotFound);
        }
        let k = DataKey::QuestAttester(quest_id);
        env.storage().persistent().set(&k, &key);
        env.storage()
            .persistent()
            .extend_ttl(&k, BUMP_THRESHOLD, BUMP_EXTEND);
        env.events().publish(
            (symbol_short!("quest"), symbol_short!("att_bind")),
            (quest_id, key),
        );
    }

    /// Remove a quest's bound key (admin), so the quest falls back to the global allowlist.
    /// A no-op without an event when nothing is bound.
    pub fn clear_quest_attester(env: Env, quest_id: u32) {
        Self::admin(&env).require_auth();
        let k = DataKey::QuestAttester(quest_id);
        let old: Option<BytesN<32>> = env.storage().persistent().get(&k);
        if let Some(old) = old {
            env.storage().persistent().remove(&k);
            env.events().publish(
                (symbol_short!("quest"), symbol_short!("att_clear")),
                (quest_id, old),
            );
        }
    }

    /// The key bound to `quest_id`, or `None` when the quest uses the global allowlist.
    pub fn get_quest_attester(env: Env, quest_id: u32) -> Option<BytesN<32>> {
        env.storage()
            .persistent()
            .get(&DataKey::QuestAttester(quest_id))
    }

    pub fn create_quest(env: Env, id: u32, schema_id: u32, xp: u64) {
        Self::admin(&env).require_auth();
        let q = QuestConfig {
            id,
            schema_id,
            xp,
            active: true,
        };
        env.storage().persistent().set(&DataKey::Quest(id), &q);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Quest(id), BUMP_THRESHOLD, BUMP_EXTEND);
        env.events()
            .publish((symbol_short!("quest"), symbol_short!("created")), id);
    }

    /// Enable/disable a quest. Admin-only. A disabled quest can't be awarded.
    pub fn set_quest_active(env: Env, id: u32, active: bool) {
        Self::admin(&env).require_auth();
        let mut q: QuestConfig = env
            .storage()
            .persistent()
            .get(&DataKey::Quest(id))
            .unwrap_or_else(|| panic_with_error!(&env, Error::QuestNotFound));
        q.active = active;
        env.storage().persistent().set(&DataKey::Quest(id), &q);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Quest(id), BUMP_THRESHOLD, BUMP_EXTEND);
    }

    /// The canonical message an attester signs to authorize a quest award — exposed so the
    /// off-chain attester signs EXACTLY what the contract verifies (no byte-mismatch risk).
    pub fn quest_payload(env: Env, quest_id: u32, recipient: Address) -> Bytes {
        Self::payload(&env, quest_id, &recipient)
    }

    /// Award a verified quest to `recipient`. Replay-guarded. Dual authorization:
    ///   1. `attester` (an ed25519 PUBKEY) signs the canonical payload — it alone can mint
    ///      Earned XP (the anti-sybil keystone). A signature, not an on-chain tx, so the
    ///      serverless attester stays stateless. It must be the quest's bound key when the
    ///      quest has one, otherwise a key in the global allowlist.
    ///   2. `recipient.require_auth()` proves on-chain ownership of the credited wallet —
    ///      works uniformly for classic (G…) and passkey smart-account (C…) wallets.
    pub fn award_quest(
        env: Env,
        attester: BytesN<32>,
        sig: BytesN<64>,
        quest_id: u32,
        recipient: Address,
    ) {
        if !Self::attester_may_award(&env, &attester, quest_id) {
            panic_with_error!(&env, Error::NotAuthorized);
        }
        let message = Self::payload(&env, quest_id, &recipient);
        env.crypto().ed25519_verify(&attester, &message, &sig);
        recipient.require_auth();

        let quest: QuestConfig = env
            .storage()
            .persistent()
            .get(&DataKey::Quest(quest_id))
            .unwrap_or_else(|| panic_with_error!(&env, Error::QuestNotFound));
        if !quest.active {
            panic_with_error!(&env, Error::QuestInactive);
        }

        // Replay guard: check-and-set atomically.
        let claim_key = DataKey::Claimed(quest_id, recipient.clone());
        if env.storage().persistent().get(&claim_key).unwrap_or(false) {
            panic_with_error!(&env, Error::AlreadyClaimed);
        }
        env.storage().persistent().set(&claim_key, &true);
        env.storage()
            .persistent()
            .extend_ttl(&claim_key, BUMP_THRESHOLD, BUMP_EXTEND);

        // Weekly retention streak: completing any quest in a new consecutive week
        // extends the run; a skipped week resets it (the all-time best is kept).
        Self::bump_streak(&env, &recipient);

        // Cross-contract call -> Reputation.award_xp. This contract must itself be an
        // allowlisted attester in Reputation (set Reputation.add_attester(this_addr)).
        let reputation: Address = env.storage().instance().get(&DataKey::Reputation).unwrap();
        let func: Symbol = symbol_short!("award_xp");
        let args = soroban_sdk::vec![
            &env,
            env.current_contract_address().into_val(&env),
            recipient.into_val(&env),
            quest.schema_id.into_val(&env),
            quest.xp.into_val(&env),
        ];
        env.invoke_contract::<()>(&reputation, &func, args);

        env.events().publish(
            (symbol_short!("quest"), symbol_short!("awarded")),
            (quest_id, recipient),
        );
    }

    /// The current weekly epoch (timestamp / WEEK_SECS) — the UI's "this week". Weeks run
    /// Thursday 00:00:00 to Wednesday 23:59:59 UTC; `get_week_bounds` gives the timestamps.
    pub fn get_week(env: Env) -> u64 {
        Self::current_week(&env)
    }

    /// The current streak week as UTC unix timestamps `(start, end)`: `start` is its first
    /// second and `end` its last (inclusive), so the week resets at `end + 1`. The client
    /// counts down to that without re-deriving the week formula.
    pub fn get_week_bounds(env: Env) -> (u64, u64) {
        let start = Self::current_week(&env) * WEEK_SECS;
        (start, start.saturating_add(WEEK_SECS - 1))
    }

    /// A player's weekly streak (consecutive weeks with ≥1 completed quest), as of now.
    /// The stored run only changes on the next award, so a run whose last completion is
    /// older than last week reads as `weeks = 0` here — it can no longer be extended.
    /// `last_week` and `best` are returned as stored. Read-only: storage is not rewritten.
    pub fn get_streak(env: Env, player: Address) -> Streak {
        let mut s: Streak = env
            .storage()
            .persistent()
            .get(&DataKey::Streak(player))
            .unwrap_or(Streak {
                weeks: 0,
                last_week: 0,
                best: 0,
            });
        if s.weeks > 0 && s.last_week.saturating_add(1) < Self::current_week(&env) {
            s.weeks = 0;
        }
        s
    }

    // --- internal ---

    /// Canonical signing payload: XDR of [quest_id, recipient, this_contract]. Binding the
    /// contract address stops a signature being replayed against another deployment.
    fn payload(env: &Env, quest_id: u32, recipient: &Address) -> Bytes {
        let mut parts: Vec<Val> = Vec::new(env);
        parts.push_back(quest_id.into_val(env));
        parts.push_back(recipient.clone().into_val(env));
        parts.push_back(env.current_contract_address().into_val(env));
        parts.to_xdr(env)
    }

    /// A quest's bound key is its only attester; an unbound quest takes any globally
    /// allowlisted key.
    fn attester_may_award(env: &Env, attester: &BytesN<32>, quest_id: u32) -> bool {
        let bound: Option<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&DataKey::QuestAttester(quest_id));
        match bound {
            Some(key) => key == *attester,
            None => env
                .storage()
                .persistent()
                .get(&DataKey::AttesterKey(attester.clone()))
                .unwrap_or(false),
        }
    }

    /// Weeks are aligned on the Unix epoch, and 1970-01-01 was a Thursday, so every week
    /// runs Thursday 00:00:00 to Wednesday 23:59:59 UTC. Do not re-align this (e.g. to
    /// Monday): every stored `Streak.last_week` is an index in this epoch, so a new formula
    /// would break live streaks. A different alignment needs a versioned epoch and a
    /// migration.
    fn current_week(env: &Env) -> u64 {
        env.ledger().timestamp() / WEEK_SECS
    }

    /// Advance the recipient's weekly streak. Same week = no change; next consecutive
    /// week = +1; any gap = reset to 1. Tracks the all-time best.
    fn bump_streak(env: &Env, player: &Address) {
        let week = Self::current_week(env);
        let key = DataKey::Streak(player.clone());
        let mut s: Streak = env.storage().persistent().get(&key).unwrap_or(Streak {
            weeks: 0,
            last_week: 0,
            best: 0,
        });
        if s.weeks > 0 && s.last_week == week {
            // already counted this week — nothing to do.
        } else if s.weeks > 0 && s.last_week.saturating_add(1) == week {
            s.weeks = s.weeks.saturating_add(1);
            s.last_week = week;
        } else {
            s.weeks = 1;
            s.last_week = week;
        }
        if s.weeks > s.best {
            s.best = s.weeks;
        }
        env.storage().persistent().set(&key, &s);
        env.storage()
            .persistent()
            .extend_ttl(&key, BUMP_THRESHOLD, BUMP_EXTEND);
        env.events()
            .publish((symbol_short!("streak"), player.clone()), (s.weeks, s.best));
    }

    fn admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
    }
}

#[cfg(test)]
mod test;
