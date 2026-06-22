#![no_std]
//! Rewards — the spend sink that makes reputation MATTER (00-strategy §2/§5).
//!
//! - `tip`: direct USDC (SAC) transfer wallet->wallet + a `tipped` event for the feed.
//!   Ship this FIRST (Green retention de-risk) — measure D7 return of spend RECEIVERS.
//! - `add_reward` / `claim_reward`: the on-chain rank->reward unlock TABLE. The admin
//!   registers each reward (Earned-XP threshold + USDC amount); a user claims by id and
//!   the contract pays the STORED amount. The caller can NEVER dictate the payout, so the
//!   treasury is not drainable (belts/08: bound the payout path).
//!
//! Safety: Earned-XP gate (keystone) + admin-set per-reward amount + replay guard +
//! pausable emergency stop.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    Address, Env, Symbol, Vec,
};

// ~30 / ~60 days of ledgers (5s) — keep registered rewards + claim guards alive.
const BUMP_THRESHOLD: u32 = 518_400;
const BUMP_EXTEND: u32 = 1_036_800;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    BelowThreshold = 3,
    AlreadyClaimed = 4,
    Paused = 5,
    RewardNotFound = 6,
    RewardInactive = 7,
    InvalidAmount = 8,
}

/// One row of the rank->reward unlock table.
#[contracttype]
#[derive(Clone)]
pub struct RewardEntry {
    pub id: u32,
    pub threshold: u64, // Earned XP required to unlock
    pub amount: i128,   // USDC stroops paid from the treasury
    pub active: bool,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Usdc,                        // SAC address (USDC)
    Reputation,                  // Reputation contract address
    Paused,                      // bool (circuit breaker)
    RewardClaimed(u32, Address), // replay guard
    Reward(u32),                 // RewardEntry (admin-registered)
    RewardIds,                   // Vec<u32> — enumerable table for the UI
}

#[contract]
pub struct RewardsContract;

#[contractimpl]
impl RewardsContract {
    pub fn init(env: Env, admin: Address, usdc: Address, reputation: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Usdc, &usdc);
        env.storage()
            .instance()
            .set(&DataKey::Reputation, &reputation);
        env.storage().instance().set(&DataKey::Paused, &false);
    }

    /// Direct USDC tip. `from` pays `to`; mints a social "thank-you" event.
    pub fn tip(env: Env, from: Address, to: Address, amount: i128) {
        Self::not_paused(&env);
        from.require_auth();
        let usdc: Address = env.storage().instance().get(&DataKey::Usdc).unwrap();
        token::Client::new(&env, &usdc).transfer(&from, &to, &amount);
        env.events()
            .publish((symbol_short!("tipped"), from, to), amount);
    }

    // --- Rank -> reward unlock table (admin-registered) ---

    /// Register or update a reward. Admin-only. `amount` is the STORED payout — claimers
    /// can never set it, so the treasury can't be drained via an attacker-chosen amount.
    pub fn add_reward(env: Env, reward_id: u32, threshold: u64, amount: i128) {
        Self::admin(&env).require_auth();
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let is_new = !env.storage().persistent().has(&DataKey::Reward(reward_id));
        let entry = RewardEntry {
            id: reward_id,
            threshold,
            amount,
            active: true,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Reward(reward_id), &entry);
        env.storage().persistent().extend_ttl(
            &DataKey::Reward(reward_id),
            BUMP_THRESHOLD,
            BUMP_EXTEND,
        );

        if is_new {
            let mut ids: Vec<u32> = env
                .storage()
                .persistent()
                .get(&DataKey::RewardIds)
                .unwrap_or_else(|| Vec::new(&env));
            ids.push_back(reward_id);
            env.storage().persistent().set(&DataKey::RewardIds, &ids);
            env.storage()
                .persistent()
                .extend_ttl(&DataKey::RewardIds, BUMP_THRESHOLD, BUMP_EXTEND);
        }
        env.events()
            .publish((symbol_short!("rwd_set"), reward_id), (threshold, amount));
    }

    /// Enable/disable a reward without removing it from the table. Admin-only.
    pub fn set_reward_active(env: Env, reward_id: u32, active: bool) {
        Self::admin(&env).require_auth();
        let mut entry: RewardEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Reward(reward_id))
            .unwrap_or_else(|| panic_with_error!(&env, Error::RewardNotFound));
        entry.active = active;
        env.storage()
            .persistent()
            .set(&DataKey::Reward(reward_id), &entry);
        env.storage().persistent().extend_ttl(
            &DataKey::Reward(reward_id),
            BUMP_THRESHOLD,
            BUMP_EXTEND,
        );
    }

    pub fn get_reward(env: Env, reward_id: u32) -> Option<RewardEntry> {
        env.storage().persistent().get(&DataKey::Reward(reward_id))
    }

    /// The full unlock table, for the UI.
    pub fn get_rewards(env: Env) -> Vec<RewardEntry> {
        let ids: Vec<u32> = env
            .storage()
            .persistent()
            .get(&DataKey::RewardIds)
            .unwrap_or_else(|| Vec::new(&env));
        let mut out = Vec::new(&env);
        for id in ids.iter() {
            if let Some(e) = env
                .storage()
                .persistent()
                .get::<DataKey, RewardEntry>(&DataKey::Reward(id))
            {
                out.push_back(e);
            }
        }
        out
    }

    pub fn is_claimed(env: Env, reward_id: u32, who: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::RewardClaimed(reward_id, who))
            .unwrap_or(false)
    }

    /// Claim a registered reward. Gated on the EARNED track only (keystone); the payout
    /// is the admin-stored amount; one claim per (reward, wallet).
    pub fn claim_reward(env: Env, to: Address, reward_id: u32) {
        Self::not_paused(&env);
        to.require_auth();

        let entry: RewardEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Reward(reward_id))
            .unwrap_or_else(|| panic_with_error!(&env, Error::RewardNotFound));
        if !entry.active {
            panic_with_error!(&env, Error::RewardInactive);
        }

        let key = DataKey::RewardClaimed(reward_id, to.clone());
        if env.storage().persistent().get(&key).unwrap_or(false) {
            panic_with_error!(&env, Error::AlreadyClaimed);
        }

        // Cross-contract read of the EARNED track ONLY (belts/08-anti-sybil keystone):
        // social/vouch XP is NEVER cashable; the treasury is reachable only via
        // attester-verified quest XP.
        let reputation: Address = env.storage().instance().get(&DataKey::Reputation).unwrap();
        let func: Symbol = Symbol::new(&env, "get_earned"); // >9 chars => not symbol_short
        let args = soroban_sdk::vec![&env, to.to_val()];
        let score: u64 = env.invoke_contract(&reputation, &func, args);
        if score < entry.threshold {
            panic_with_error!(&env, Error::BelowThreshold);
        }

        env.storage().persistent().set(&key, &true);
        env.storage()
            .persistent()
            .extend_ttl(&key, BUMP_THRESHOLD, BUMP_EXTEND);

        let usdc: Address = env.storage().instance().get(&DataKey::Usdc).unwrap();
        let treasury = env.current_contract_address();
        token::Client::new(&env, &usdc).transfer(&treasury, &to, &entry.amount);

        env.events()
            .publish((symbol_short!("reward"), to), (reward_id, entry.amount));
    }

    // --- Admin / circuit breaker ---

    pub fn set_paused(env: Env, paused: bool) {
        Self::admin(&env).require_auth();
        env.storage().instance().set(&DataKey::Paused, &paused);
    }

    fn not_paused(env: &Env) {
        let paused: bool = env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);
        if paused {
            panic_with_error!(env, Error::Paused);
        }
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
