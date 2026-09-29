#![no_std]
//! Gate — reputation as a CAPABILITY (not just a number on a leaderboard).
//!
//! An admin defines GATES (a reputation track + a threshold). `check` cross-reads the
//! Reputation contract to see if an address passes; `unlock` records that they did (a
//! consumer "you unlocked X" + an on-chain proof any app can read). So Social XP (clout)
//! and Earned XP (verified) become ACCESS — bounty boards, perks, allowlists — and the
//! whole thing is COMPOSABLE: any contract or app can `check(addr, gate)` in one call.
//!
//! Composite gates: `create_gate_rules` attaches a `GateRules` set (up to `MAX_RULES`
//! track thresholds, all-of or any-of) under the same gate id. `create_gate` stays the
//! single-rule shorthand and stores only the `Gate`, so gates created before composite
//! rules existed need no migration.
//!
//! Unlocks are tied to the definition they passed (#149): replacing an existing gate with
//! `create_gate` or `create_gate_rules` bumps its `GateVersion`, and `is_unlocked` only
//! counts an `UnlockRecord` made under the current version, while the gate is active.
//!
//! Standalone (it never touches Reputation's storage), so adding it needs no redeploy of
//! the existing contracts.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    BytesN, Env, IntoVal, String, Symbol, TryFromVal, Val, Vec,
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

/// Most rules one gate may hold. Bounds the loop in `check`/`unlock`; the cross-contract
/// reads are bounded anyway at one per track.
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

/// How a gate combines its rules. Encoded as a `u32`: 0 = all-of, 1 = any-of.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum RuleMode {
    AllOf = 0, // every rule must pass
    AnyOf = 1, // at least one rule must pass
}

/// One condition: at least `min` reputation on `track`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Rule {
    pub track: u32, // 0 = Social, 1 = Earned
    pub min: u64,
}

/// A gate's full policy. Stored under its own key (`DataKey::GateRules`) so the `Gate`
/// struct keeps its shape; a gate without one is the single rule `Gate { track, min }`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
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
    Unlocked(Address, u32), // (addr, gate_id) -> UnlockRecord (a bare `true` before #149)
    GateRules(u32),         // gate_id -> GateRules (composite gates only)
    GateVersion(u32),       // gate_id -> u32, bumped on every redefinition (absent = 0)
}

/// What `unlock` stores under `Unlocked(addr, id)`: the gate definition that was passed
/// and when. An unlock recorded before these records existed was a bare `true`; it reads
/// as `{ version: 0, ledger: 0 }`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UnlockRecord {
    /// `GateVersion(id)` at unlock time. `is_unlocked` requires it to still be current.
    pub version: u32,
    /// Ledger sequence of the unlock (0 = recorded before unlock records existed).
    pub ledger: u32,
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

/// One gate as `addr` sees it, as returned by `get_status`: `passes` is `check(addr, id)`
/// and `unlocked` is `is_unlocked(addr, id)`, both read from the same ledger.
#[contracttype]
#[derive(Clone)]
pub struct GateStatus {
    pub gate: Gate,
    pub passes: bool,
    pub unlocked: bool,
}

/// `[Social, Earned]` scores read so far in one call: `passes` fills a slot the first time
/// a rule on that track is evaluated, and every later rule and gate reuses it.
type Scores = [Option<u64>; 2];

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

    /// Admin defines/updates a single-rule gate. `track` must be Social(0) or Earned(1).
    /// Replacing a composite gate this way drops its rule set. Replacing any existing gate
    /// starts a new definition: unlocks made under the old one stop counting.
    pub fn create_gate(env: Env, id: u32, track: u32, min: u64, label: String) {
        Self::admin(&env).require_auth();
        if track != TRACK_SOCIAL && track != TRACK_EARNED {
            panic_with_error!(&env, Error::BadTrack);
        }
        env.storage().persistent().remove(&DataKey::GateRules(id));
        Self::put_gate(&env, id, track, min, label);
    }

    /// Admin defines/updates a composite gate: 1..=`MAX_RULES` rules (else `EmptyRules` /
    /// `TooManyRules`), each on Social(0) or Earned(1) (else `BadTrack`), combined by
    /// `mode`. Like `create_gate` it saves the gate active, and replacing an existing gate
    /// starts a new definition that unlocks made under the old one don't count for. The
    /// stored `Gate` carries the first rule's `track`/`min` so `get_gate`/`get_gates` keep
    /// their shape; `get_gate_rules` returns the whole set.
    pub fn create_gate_rules(env: Env, id: u32, rules: Vec<Rule>, mode: RuleMode, label: String) {
        Self::admin(&env).require_auth();
        let first = rules
            .first()
            .unwrap_or_else(|| panic_with_error!(&env, Error::EmptyRules));
        if rules.len() > MAX_RULES {
            panic_with_error!(&env, Error::TooManyRules);
        }
        for rule in rules.iter() {
            if rule.track != TRACK_SOCIAL && rule.track != TRACK_EARNED {
                panic_with_error!(&env, Error::BadTrack);
            }
        }
        let key = DataKey::GateRules(id);
        env.storage()
            .persistent()
            .set(&key, &GateRules { rules, mode });
        Self::bump(&env, &key);
        Self::put_gate(&env, id, first.track, first.min, label);
    }

    /// Pause or resume a gate without redefining it: while inactive nobody can unlock it and
    /// `is_unlocked` reads false; re-enabling brings back the unlocks of the same version.
    pub fn set_gate_active(env: Env, id: u32, active: bool) {
        Self::admin(&env).require_auth();
        let mut g = Self::gate(&env, id);
        g.active = active;
        env.storage().persistent().set(&DataKey::Gate(id), &g);
        Self::bump(&env, &DataKey::Gate(id));
        // A composite gate's rules and its version must live as long as the gate itself.
        for key in [DataKey::GateRules(id), DataKey::GateVersion(id)] {
            if env.storage().persistent().has(&key) {
                Self::bump(&env, &key);
            }
        }
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

    /// Every gate (inactive ones included, in `get_gates` order) with whether `addr` passes
    /// it and holds a current unlock of it — the whole perks screen in one simulation.
    /// Reputation is read at most once per track for the call, and not at all for a track
    /// no active gate uses.
    pub fn get_status(env: Env, addr: Address) -> Vec<GateStatus> {
        let mut scores: Scores = [None, None];
        let mut out = Vec::new(&env);
        for gate in Self::get_gates(env.clone()).iter() {
            let passes = gate.active && Self::passes(&env, &addr, &gate, &mut scores);
            let unlocked = Self::unlocked(&env, addr.clone(), &gate);
            out.push_back(GateStatus {
                gate,
                passes,
                unlocked,
            });
        }
        out
    }

    /// `check(addr, id)` for each of `ids`, in order: `false` for an unknown or inactive
    /// gate. Reputation is read at most once per track for the whole call.
    pub fn check_many(env: Env, addr: Address, ids: Vec<u32>) -> Vec<bool> {
        let mut scores: Scores = [None, None];
        let mut out = Vec::new(&env);
        for id in ids.iter() {
            let passes = match env
                .storage()
                .persistent()
                .get::<DataKey, Gate>(&DataKey::Gate(id))
            {
                Some(g) if g.active => Self::passes(&env, &addr, &g, &mut scores),
                _ => false,
            };
            out.push_back(passes);
        }
        out
    }

    /// How many times gate `id` has been redefined (0 for a gate never replaced, or an
    /// unknown one). An `UnlockRecord` counts only while its `version` equals this.
    pub fn get_gate_version(env: Env, id: u32) -> u32 {
        Self::version(&env, id)
    }

    /// The rules gate `id` evaluates, or `None` for an unknown gate. A single-rule gate
    /// (`create_gate`, or any gate created before composite rules) reads as one all-of rule.
    pub fn get_gate_rules(env: Env, id: u32) -> Option<GateRules> {
        let g: Gate = env.storage().persistent().get(&DataKey::Gate(id))?;
        Some(Self::rules(&env, &g))
    }

    /// The COMPOSABLE read — does `addr` pass `id`? Cross-reads Reputation (at most once
    /// per track, however many rules the gate has). Any contract/app can call this to
    /// reputation-gate a feature in one call. Pure read.
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
        Self::passes(&env, &addr, &g, &mut [None, None])
    }

    /// `caller` claims a gate they pass — records an on-chain proof + a consumer unlock,
    /// stamped with the gate's current version and ledger. Unlocking again replaces the
    /// record, which is how a wallet re-qualifies after the gate is redefined.
    pub fn unlock(env: Env, caller: Address, id: u32) {
        caller.require_auth();
        let g = Self::gate(&env, id);
        if !g.active {
            panic_with_error!(&env, Error::GateInactive);
        }
        if !Self::passes(&env, &caller, &g, &mut [None, None]) {
            panic_with_error!(&env, Error::BelowThreshold);
        }
        let record = UnlockRecord {
            version: Self::version(&env, id),
            ledger: env.ledger().sequence(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::Unlocked(caller.clone(), id), &record);
        Self::bump(&env, &DataKey::Unlocked(caller.clone(), id));
        env.events()
            .publish((symbol_short!("unlocked"), caller), id);
    }

    /// Does `addr` hold an unlock of gate `id` as it is defined NOW? True only for an unlock
    /// made under the current version (not before a redefinition) while the gate is active.
    /// An unlock recorded before versioning counts as version 0: valid until the gate's
    /// first redefinition after the upgrade.
    pub fn is_unlocked(env: Env, addr: Address, id: u32) -> bool {
        env.storage()
            .persistent()
            .get::<DataKey, Gate>(&DataKey::Gate(id))
            .is_some_and(|g| Self::unlocked(&env, addr, &g))
    }

    /// `addr`'s latest unlock of gate `id` — which definition (`version`) it passed and at
    /// which ledger — or `None` if it never unlocked it. Returned even when it no longer
    /// counts; compare `version` with `get_gate_version`, or call `is_unlocked`.
    pub fn get_unlock(env: Env, addr: Address, id: u32) -> Option<UnlockRecord> {
        Self::unlock_record(&env, addr, id)
    }

    // --- internal ---

    /// `is_unlocked` for a gate already read: active, and unlocked under its current version.
    fn unlocked(env: &Env, addr: Address, g: &Gate) -> bool {
        g.active
            && Self::unlock_record(env, addr, g.id)
                .is_some_and(|r| r.version == Self::version(env, g.id))
    }

    fn version(env: &Env, id: u32) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::GateVersion(id))
            .unwrap_or(0)
    }

    /// The stored unlock, reading a pre-#149 bare `true` as version 0 at ledger 0.
    fn unlock_record(env: &Env, addr: Address, id: u32) -> Option<UnlockRecord> {
        let raw: Val = env
            .storage()
            .persistent()
            .get(&DataKey::Unlocked(addr, id))?;
        if let Ok(legacy) = bool::try_from_val(env, &raw) {
            return legacy.then_some(UnlockRecord {
                version: 0,
                ledger: 0,
            });
        }
        UnlockRecord::try_from_val(env, &raw).ok()
    }

    fn gate(env: &Env, id: u32) -> Gate {
        env.storage()
            .persistent()
            .get(&DataKey::Gate(id))
            .unwrap_or_else(|| panic_with_error!(env, Error::GateNotFound))
    }

    /// Write gate `id` (active), list it once in `GateIds`, emit `gate`/`created`. Replacing
    /// an existing gate bumps `GateVersion(id)`, so unlocks of the old definition go stale.
    fn put_gate(env: &Env, id: u32, track: u32, min: u64, label: String) {
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
        Self::bump(env, &DataKey::Gate(id));
        if existed {
            let key = DataKey::GateVersion(id);
            env.storage()
                .persistent()
                .set(&key, &(Self::version(env, id) + 1));
            Self::bump(env, &key);
        } else {
            // A new gate is version 0, which is what an absent `GateVersion` reads as.
            let mut ids: Vec<u32> = env
                .storage()
                .persistent()
                .get(&DataKey::GateIds)
                .unwrap_or_else(|| Vec::new(env));
            ids.push_back(id);
            env.storage().persistent().set(&DataKey::GateIds, &ids);
            Self::bump(env, &DataKey::GateIds);
        }
        env.events()
            .publish((symbol_short!("gate"), symbol_short!("created")), id);
    }

    /// `g`'s stored rule set, or its own `(track, min)` as a one-rule all-of set.
    fn rules(env: &Env, g: &Gate) -> GateRules {
        env.storage()
            .persistent()
            .get(&DataKey::GateRules(g.id))
            .unwrap_or_else(|| GateRules {
                rules: soroban_sdk::vec![
                    env,
                    Rule {
                        track: g.track,
                        min: g.min,
                    }
                ],
                mode: RuleMode::AllOf,
            })
    }

    /// Does `addr` pass `g`'s rules? Reads each track from Reputation at most once per
    /// `scores` cache, which a batch view shares across gates.
    fn passes(env: &Env, addr: &Address, g: &Gate, scores: &mut Scores) -> bool {
        let set = Self::rules(env, g);
        let mut ok = |rule: Rule| {
            let slot = &mut scores[usize::from(rule.track == TRACK_EARNED)];
            *slot.get_or_insert_with(|| Self::track_score(env, addr, rule.track)) >= rule.min
        };
        match set.mode {
            RuleMode::AllOf => set.rules.iter().all(&mut ok),
            RuleMode::AnyOf => set.rules.iter().any(&mut ok),
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
