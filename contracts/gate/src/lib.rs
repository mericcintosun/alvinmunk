#![no_std]
//! Gate — reputation as a CAPABILITY (not just a number on a leaderboard).
//!
//! An admin defines GATES (a reputation track + a threshold). `check` cross-reads the
//! Reputation contract to see if an address passes; `unlock` records that they did (a
//! consumer "you unlocked X" + an on-chain proof any app can read). So Social XP (clout)
//! and Earned XP (verified) become ACCESS — bounty boards, perks, allowlists — and the
//! whole thing is COMPOSABLE: any contract or app can `check(addr, gate)` in one call.
//!
//! Standalone (it never touches Reputation's storage), so adding it needs no redeploy of
//! the existing contracts.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    BytesN, Env, IntoVal, String, Symbol, Vec,
};

const BUMP_THRESHOLD: u32 = 17_280; // ~1 day
const BUMP_EXTEND: u32 = 518_400; // ~30 days

pub const TRACK_SOCIAL: u32 = 0; // clout (vouches)
pub const TRACK_EARNED: u32 = 1; // cashable (verified quests)

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
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Reputation,
    Gate(u32),
    GateIds,
    Unlocked(Address, u32), // (addr, gate_id) -> bool
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

    /// The COMPOSABLE read — does `addr` pass `id`? Cross-reads Reputation. Any
    /// contract/app can call this to reputation-gate a feature in one call. Pure read.
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
        Self::track_score(&env, &addr, g.track) >= g.min
    }

    /// `caller` claims a gate they pass — records an on-chain proof + a consumer unlock.
    pub fn unlock(env: Env, caller: Address, id: u32) {
        caller.require_auth();
        let g = Self::gate(&env, id);
        if !g.active {
            panic_with_error!(&env, Error::GateInactive);
        }
        if Self::track_score(&env, &caller, g.track) < g.min {
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
