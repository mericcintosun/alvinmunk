#![no_std]
//! Rewards — the spend sink that makes reputation MATTER (00-strategy §2/§5).
//!
//! - `tip`: direct USDC (SAC) transfer wallet->wallet + a `tipped` event for the feed.
//!   Ship this FIRST (Green retention de-risk) — measure D7 return of spend RECEIVERS.
//! - `claim_reward`: XP-threshold-gated USDC payout from the treasury.
//!
//! Safety: per-claim cap + pausable emergency stop are added at Black belt (real money).

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    Address, Env, Symbol,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    BelowThreshold = 3,
    AlreadyClaimed = 4,
    Paused = 5,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Usdc,                        // SAC address (USDC)
    Reputation,                  // Reputation contract address
    Paused,                      // bool (Black belt circuit breaker)
    RewardClaimed(u32, Address), // replay guard
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

    /// XP-threshold-gated payout from this contract's USDC balance (treasury).
    pub fn claim_reward(env: Env, to: Address, reward_id: u32, threshold: u64, amount: i128) {
        Self::not_paused(&env);
        to.require_auth();

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
        if score < threshold {
            panic_with_error!(&env, Error::BelowThreshold);
        }

        env.storage().persistent().set(&key, &true);

        let usdc: Address = env.storage().instance().get(&DataKey::Usdc).unwrap();
        let treasury = env.current_contract_address();
        token::Client::new(&env, &usdc).transfer(&treasury, &to, &amount);

        env.events()
            .publish((symbol_short!("reward"), to), (reward_id, amount));
    }

    // --- Admin / circuit breaker (Black belt) ---

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
