#![no_std]
//! Gate — reputation as a CAPABILITY (not just a number on a leaderboard).
//!
//! An admin defines GATES (a reputation track + a threshold). `check` cross-reads the
//! Reputation contract to see if an address passes; `unlock` records that they did (a
//! consumer "you unlocked X" + an on-chain proof any app can read). So Social XP (clout)
//! and Earned XP (verified) become ACCESS — bounty boards, perks, allowlists — and the
//! whole thing is COMPOSABLE: any contract or app can `check(addr, gate)` in one call.
//!
//! Composite rules: `create_gate_rules` stores a `GateRules` (up to `MAX_RULES` Rule
//! entries, evaluated as `all-of` or `any-of`). `create_gate` remains the single-rule
//! shorthand and needs no migration — existing `Gate` entries work unchanged.
//!
//! Standalone (it never touches Reputation's storage), so adding it needs no redeploy of
//! the existing contracts.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    BytesN, Env, IntoVal, String, Symbol, Vec,
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

pub const TRACK_SOCIAL: u32 = 0; // clout (vouches)
pub const TRACK_EARNED: u32 = 1; // cashable (verified quests)

/// Maximum number of rules in a `GateRules` set. Bounding this caps the number of
/// cross-contract reads (one per distinct track) per `check`/`unlock` call.
pub const MAX_RULES: u32 = 4;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    GateNotFound = 3,
    GateInactive = 4,
    BelowThreshold = 5,
    BadTrack = 6,
    TooManyRules = 7,
    EmptyRules = 8,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum RuleMode {
    /// Every rule must be satisfied.
    AllOf = 0,
    /// At least one rule must be satisfied.
    AnyOf = 1,
}

/// A single track threshold inside a composite rule set.
#[contracttype]
#[derive(Clone)]
pub struct Rule {
    pub track: u32, // 0 = Social, 1 = Earned
    pub min: u64,
}

/// A composite set of rules attached to a gate.
/// Stored separately from `Gate` so existing `Gate` entries need no migration.
#[contracttype]
#[derive(Clone)]
pub struct GateRules {
    pub rules: Vec<Rule>,
    pub mode: RuleMode,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Reputation,
    Gate(u32),
    GateIds,
    GateRules(u32),               // composite rule set for gate id
    Unlocked(Address, u32),       // (addr, gate_id) -> bool
}

/// An access gate: `min` of `track` reputation unlocks it.
#[contracttype]
#[derive(Clone)]
pub struct Gate {
    pub id: u32,
    pub track: u32, // 0 = Social, 1 = Earned
    pub min: u64,
    pub label: String,
    pub active: bool,
}

#[contract]
pub struct GateContract;

#[contractimpl]
impl GateContract {
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

    /// Admin defines/updates a gate. `track` must be Social(0) or Earned(1).
    /// Single-rule shorthand: internally stores a `GateRules` with `AllOf` + one `Rule`,
    /// so `check`/`unlock` evaluate it through the same code path.
    pub fn create_gate(env: Env, id: u32, track: u32, min: u64, label: String) {
        Self::admin(&env).require_auth();
        if track != TRACK_SOCIAL && track != TRACK_EARNED {
            panic_with_error!(&env, Error::BadTrack);
        }
        let existed = env
            .storage()
            .persistent()
            .get::<DataKey, Gate>(&DataKey::Gate(id))
            .is_some();
        let gate = Gate {
            id,
            track,
            min,
            label,
            active: true,
        };
        env.storage().persistent().set(&DataKey::Gate(id), &gate);
        Self::bump(&env, &DataKey::Gate(id));

        // Keep the GateRules entry in sync so check/unlock always have one source of truth.
        let mut rules = Vec::new(&env);
        rules.push_back(Rule { track, min });
        let gate_rules = GateRules {
            rules,
            mode: RuleMode::AllOf,
        };
        env.storage()
            .persistent()
            .set(&DataKey::GateRules(id), &gate_rules);
        Self::bump(&env, &DataKey::GateRules(id));

        if !existed {
            let mut ids: Vec<u32> = env
                .storage()
                .persistent()
                .get(&DataKey::GateIds)
                .unwrap_or_else(|| Vec::new(&env));
            ids.push_back(id);
            env.storage().persistent().set(&DataKey::GateIds, &ids);
            Self::bump(&env, &DataKey::GateIds);
        }
        env.events()
            .publish((symbol_short!("gate"), symbol_short!("created")), id);
    }

    /// Admin defines a gate with a composite rule set (up to MAX_RULES rules, all-of or
    /// any-of). If a `Gate` entry for `id` already exists its metadata (label, active) is
    /// preserved; only the rule set is replaced.
    pub fn create_gate_rules(
        env: Env,
        id: u32,
        rules: Vec<Rule>,
        mode: RuleMode,
        label: String,
    ) {
        Self::admin(&env).require_auth();
        if rules.is_empty() {
            panic_with_error!(&env, Error::EmptyRules);
        }
        if rules.len() > MAX_RULES {
            panic_with_error!(&env, Error::TooManyRules);
        }
        // Validate every rule's track.
        for rule in rules.iter() {
            if rule.track != TRACK_SOCIAL && rule.track != TRACK_EARNED {
                panic_with_error!(&env, Error::BadTrack);
            }
        }

        let existed = env
            .storage()
            .persistent()
            .get::<DataKey, Gate>(&DataKey::Gate(id))
            .is_some();

        // Store a placeholder Gate so set_gate_active / get_gate still work.
        // Use the first rule's (track, min) as the canonical single-rule view; the full
        // policy lives in GateRules.
        let first = rules.get(0).unwrap();
        let gate = Gate {
            id,
            track: first.track,
            min: first.min,
            label,
            active: true,
        };
        env.storage().persistent().set(&DataKey::Gate(id), &gate);
        Self::bump(&env, &DataKey::Gate(id));

        let gate_rules = GateRules { rules, mode };
        env.storage()
            .persistent()
            .set(&DataKey::GateRules(id), &gate_rules);
        Self::bump(&env, &DataKey::GateRules(id));

        if !existed {
            let mut ids: Vec<u32> = env
                .storage()
                .persistent()
                .get(&DataKey::GateIds)
                .unwrap_or_else(|| Vec::new(&env));
            ids.push_back(id);
            env.storage().persistent().set(&DataKey::GateIds, &ids);
            Self::bump(&env, &DataKey::GateIds);
        }
        env.events()
            .publish((symbol_short!("gate"), symbol_short!("created")), id);
    }

    pub fn set_gate_active(env: Env, id: u32, active: bool) {
        Self::admin(&env).require_auth();
        let mut g = Self::gate(&env, id);
        g.active = active;
        env.storage().persistent().set(&DataKey::Gate(id), &g);
        Self::bump(&env, &DataKey::Gate(id));
    }

    pub fn get_gate(env: Env, id: u32) -> Option<Gate> {
        env.storage().persistent().get(&DataKey::Gate(id))
    }

    pub fn get_gates(env: Env) -> Vec<Gate> {
        let ids: Vec<u32> = env
            .storage()
            .persistent()
            .get(&DataKey::GateIds)
            .unwrap_or_else(|| Vec::new(&env));
        let mut out = Vec::new(&env);
        for id in ids.iter() {
            if let Some(g) = env
                .storage()
                .persistent()
                .get::<DataKey, Gate>(&DataKey::Gate(id))
            {
                out.push_back(g);
            }
        }
        out
    }

    /// Returns the composite rule set for a gate, if one exists.
    pub fn get_gate_rules(env: Env, id: u32) -> Option<GateRules> {
        env.storage()
            .persistent()
            .get(&DataKey::GateRules(id))
    }

    /// The COMPOSABLE read — does `addr` pass `id`? Cross-reads Reputation. Any
    /// contract/app can call this to reputation-gate a feature in one call. Pure read.
    ///
    /// Evaluation order: if a `GateRules` entry exists, it is used (all-of / any-of over
    /// each Rule). Otherwise falls back to the legacy single-rule `Gate` struct so entries
    /// created before this upgrade continue to work.
    pub fn check(env: Env, addr: Address, id: u32) -> bool {
        let g = match env
            .storage()
            .persistent()
            .get::<DataKey, Gate>(&DataKey::Gate(id))
        {
            Some(g) => g,
            None => return false,
        };
        if !g.active {
            return false;
        }
        Self::eval_rules(&env, &addr, id, &g)
    }

    /// `caller` claims a gate they pass — records an on-chain proof + a consumer unlock.
    pub fn unlock(env: Env, caller: Address, id: u32) {
        caller.require_auth();
        let g = Self::gate(&env, id);
        if !g.active {
            panic_with_error!(&env, Error::GateInactive);
        }
        if !Self::eval_rules(&env, &caller, id, &g) {
            panic_with_error!(&env, Error::BelowThreshold);
        }
        env.storage()
            .persistent()
            .set(&DataKey::Unlocked(caller.clone(), id), &true);
        Self::bump(&env, &DataKey::Unlocked(caller.clone(), id));
        env.events()
            .publish((symbol_short!("unlocked"), caller), id);
    }

    pub fn is_unlocked(env: Env, addr: Address, id: u32) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Unlocked(addr, id))
            .unwrap_or(false)
    }

    // --- internal ---

    fn gate(env: &Env, id: u32) -> Gate {
        env.storage()
            .persistent()
            .get(&DataKey::Gate(id))
            .unwrap_or_else(|| panic_with_error!(env, Error::GateNotFound))
    }

    /// Evaluate the gate's rule set for `addr`.
    ///
    /// Uses `GateRules` when present (composite path). Falls back to the `Gate`'s own
    /// (track, min) for entries that pre-date this upgrade (legacy path).
    ///
    /// Each distinct track is fetched from Reputation at most once per evaluation.
    fn eval_rules(env: &Env, addr: &Address, id: u32, g: &Gate) -> bool {
        if let Some(gr) = env
            .storage()
            .persistent()
            .get::<DataKey, GateRules>(&DataKey::GateRules(id))
        {
            match gr.mode {
                RuleMode::AllOf => {
                    for rule in gr.rules.iter() {
                        if Self::track_score(env, addr, rule.track) < rule.min {
                            return false;
                        }
                    }
                    true
                }
                RuleMode::AnyOf => {
                    for rule in gr.rules.iter() {
                        if Self::track_score(env, addr, rule.track) >= rule.min {
                            return true;
                        }
                    }
                    false
                }
            }
        } else {
            // Legacy fallback: no GateRules entry — evaluate the Gate fields directly.
            Self::track_score(env, addr, g.track) >= g.min
        }
    }

    /// Cross-read the Reputation track score (get_score for Social, get_earned for Earned).
    fn track_score(env: &Env, addr: &Address, track: u32) -> u64 {
        let rep: Address = env.storage().instance().get(&DataKey::Reputation).unwrap();
        let func: Symbol = if track == TRACK_EARNED {
            Symbol::new(env, "get_earned")
        } else {
            Symbol::new(env, "get_score")
        };
        let args = soroban_sdk::vec![env, addr.into_val(env)];
        env.invoke_contract::<u64>(&rep, &func, args)
    }

    fn admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
    }

    fn bump(env: &Env, key: &DataKey) {
        env.storage()
            .persistent()
            .extend_ttl(key, BUMP_THRESHOLD, BUMP_EXTEND);
    }
}

#[cfg(test)]
mod test;
