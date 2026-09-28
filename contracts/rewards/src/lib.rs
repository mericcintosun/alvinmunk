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
    Address, BytesN, Env, Symbol, Vec,
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
const DAY_SECS: u64 = 86_400;

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
    DailyCapExceeded = 9, // global treasury circuit breaker (belts/08)
    Frozen = 10,          // ring/cluster-flagged account (Blue anti-abuse hook)
    Overflow = 11,
    NotFunded = 12, // proof-of-funding gate (belts/08): no external value received
    RewardExhausted = 13, // the reward's fixed supply (`max_claims`) is used up
    InvalidSupply = 14, // a supply cap below the claims already paid
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

/// Supply counters for one reward, kept under their own key so existing `Reward(id)`
/// entries stay readable. `max_claims == 0` means unlimited.
#[contracttype]
#[derive(Clone)]
pub struct RewardStats {
    pub max_claims: u32,
    pub claims: u32,
}

/// A reward row plus its supply counters, as returned by `get_rewards`.
#[contracttype]
#[derive(Clone)]
pub struct RewardInfo {
    pub id: u32,
    pub threshold: u64,
    pub amount: i128,
    pub active: bool,
    pub max_claims: u32, // 0 = unlimited
    pub claims: u32,
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
    DailyCap,                    // i128 — max treasury payout per UTC day (0 = unlimited)
    DailyPaid(u64),              // (day) -> i128 paid so far (temporary, auto-GCs)
    Frozen(Address),             // bool — ring/cluster-flagged; blocked from payout/tip
    RequireFunding,              // bool — enforce proof-of-funding on claim (off on testnet)
    Funded(Address),             // bool — verified to have received external value (belts/08)
    RewardStats(u32),            // RewardStats — supply cap + running claim count
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

    /// Admin-gated WASM upgrade — same contract instance + storage, new code. Lets us
    /// iterate/season without a new address or state migration (mainnet de-risk).
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        Self::admin(&env).require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    /// Direct USDC tip. `from` pays `to`; mints a social "thank-you" event.
    pub fn tip(env: Env, from: Address, to: Address, amount: i128) {
        Self::not_paused(&env);
        from.require_auth();
        Self::require_unfrozen(&env, &from);
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

    /// Cap how many wallets can claim a reward (a fixed-size bounty pool), so a
    /// campaign's total spend is known up front: `max_claims × amount`. `0` removes the
    /// cap. Admin-only; the cap can't be set below the claims already paid.
    pub fn set_reward_supply(env: Env, reward_id: u32, max_claims: u32) {
        Self::admin(&env).require_auth();
        if !env.storage().persistent().has(&DataKey::Reward(reward_id)) {
            panic_with_error!(&env, Error::RewardNotFound);
        }
        let mut stats = Self::stats(&env, reward_id);
        if max_claims != 0 && max_claims < stats.claims {
            panic_with_error!(&env, Error::InvalidSupply);
        }
        stats.max_claims = max_claims;
        Self::save_stats(&env, reward_id, &stats);
        env.events()
            .publish((symbol_short!("rwd_cap"), reward_id), max_claims);
    }

    /// Supply cap and claims paid so far for one reward (zeros if never claimed or capped).
    pub fn get_reward_stats(env: Env, reward_id: u32) -> RewardStats {
        Self::stats(&env, reward_id)
    }

    pub fn get_reward(env: Env, reward_id: u32) -> Option<RewardEntry> {
        env.storage().persistent().get(&DataKey::Reward(reward_id))
    }

    /// The full unlock table with supply counters, for the UI.
    pub fn get_rewards(env: Env) -> Vec<RewardInfo> {
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
                let stats = Self::stats(&env, id);
                out.push_back(RewardInfo {
                    id: e.id,
                    threshold: e.threshold,
                    amount: e.amount,
                    active: e.active,
                    max_claims: stats.max_claims,
                    claims: stats.claims,
                });
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
        Self::require_unfrozen(&env, &to);
        Self::require_funded(&env, &to);

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

        // Fixed-size pools: stop paying once the supply is used up.
        let mut stats = Self::stats(&env, reward_id);
        if stats.max_claims > 0 && stats.claims >= stats.max_claims {
            panic_with_error!(&env, Error::RewardExhausted);
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

        // Global treasury circuit breaker (belts/08): bound total daily payout so even
        // sybil-farmed Earned XP or a compromised attester can't drain more than the cap.
        Self::charge_daily(&env, entry.amount);

        env.storage().persistent().set(&key, &true);
        env.storage()
            .persistent()
            .extend_ttl(&key, BUMP_THRESHOLD, BUMP_EXTEND);
        stats.claims = stats
            .claims
            .checked_add(1)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Overflow));
        Self::save_stats(&env, reward_id, &stats);

        let usdc: Address = env.storage().instance().get(&DataKey::Usdc).unwrap();
        let treasury = env.current_contract_address();
        token::Client::new(&env, &usdc).transfer(&treasury, &to, &entry.amount);

        // The running claim count lets an indexer show "N of M claimed" without aggregating.
        env.events().publish(
            (symbol_short!("reward"), to),
            (reward_id, entry.amount, stats.claims),
        );
    }

    // --- Admin / circuit breaker ---

    pub fn set_paused(env: Env, paused: bool) {
        Self::admin(&env).require_auth();
        env.storage().instance().set(&DataKey::Paused, &paused);
    }

    /// Set the max treasury payout per UTC day (0 = unlimited). Admin-only.
    pub fn set_daily_cap(env: Env, cap: i128) {
        Self::admin(&env).require_auth();
        env.storage().instance().set(&DataKey::DailyCap, &cap);
    }

    pub fn get_daily_cap(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::DailyCap)
            .unwrap_or(0)
    }

    pub fn get_daily_paid(env: Env) -> i128 {
        let day = env.ledger().timestamp() / DAY_SECS;
        env.storage()
            .temporary()
            .get(&DataKey::DailyPaid(day))
            .unwrap_or(0)
    }

    /// Flag/unflag a ring/cluster-detected account. Admin-only — the off-chain detector
    /// (Blue belt) computes the set; the contract enforces it on payout/tip.
    pub fn set_frozen(env: Env, who: Address, frozen: bool) {
        Self::admin(&env).require_auth();
        if frozen {
            env.storage()
                .persistent()
                .set(&DataKey::Frozen(who.clone()), &true);
            env.storage().persistent().extend_ttl(
                &DataKey::Frozen(who),
                BUMP_THRESHOLD,
                BUMP_EXTEND,
            );
        } else {
            env.storage().persistent().remove(&DataKey::Frozen(who));
        }
    }

    pub fn is_frozen(env: Env, who: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Frozen(who))
            .unwrap_or(false)
    }

    /// Toggle the proof-of-funding gate. Admin-only. OFF on testnet (so the demo claim
    /// works); ON for mainnet, where every claimer must first be proven funded.
    pub fn set_require_funding(env: Env, on: bool) {
        Self::admin(&env).require_auth();
        env.storage().instance().set(&DataKey::RequireFunding, &on);
    }

    pub fn get_require_funding(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::RequireFunding)
            .unwrap_or(false)
    }

    /// Mark/unmark an address as having received external value (belts/08 proof-of-funding).
    /// Admin-only — set by the off-chain funding verifier (a regulated anchor / SEP-24
    /// deposit signal on mainnet; an external-inbound-payment check on testnet).
    pub fn set_funded(env: Env, who: Address, funded: bool) {
        Self::admin(&env).require_auth();
        if funded {
            env.storage()
                .persistent()
                .set(&DataKey::Funded(who.clone()), &true);
            env.storage().persistent().extend_ttl(
                &DataKey::Funded(who),
                BUMP_THRESHOLD,
                BUMP_EXTEND,
            );
        } else {
            env.storage().persistent().remove(&DataKey::Funded(who));
        }
    }

    pub fn is_funded(env: Env, who: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Funded(who))
            .unwrap_or(false)
    }

    // --- internal ---

    /// Enforce proof-of-funding only when the gate is on (mainnet). The cheapest real
    /// uniqueness signal that isn't heavy KYC: a wallet must have received external value.
    fn require_funded(env: &Env, who: &Address) {
        let on: bool = env
            .storage()
            .instance()
            .get(&DataKey::RequireFunding)
            .unwrap_or(false);
        if on
            && !env
                .storage()
                .persistent()
                .get(&DataKey::Funded(who.clone()))
                .unwrap_or(false)
        {
            panic_with_error!(env, Error::NotFunded);
        }
    }

    fn stats(env: &Env, reward_id: u32) -> RewardStats {
        env.storage()
            .persistent()
            .get(&DataKey::RewardStats(reward_id))
            .unwrap_or(RewardStats {
                max_claims: 0,
                claims: 0,
            })
    }

    fn save_stats(env: &Env, reward_id: u32, stats: &RewardStats) {
        let key = DataKey::RewardStats(reward_id);
        env.storage().persistent().set(&key, stats);
        env.storage()
            .persistent()
            .extend_ttl(&key, BUMP_THRESHOLD, BUMP_EXTEND);
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

    fn require_unfrozen(env: &Env, who: &Address) {
        if env
            .storage()
            .persistent()
            .get(&DataKey::Frozen(who.clone()))
            .unwrap_or(false)
        {
            panic_with_error!(env, Error::Frozen);
        }
    }

    /// Accumulate today's treasury outflow and enforce the daily cap (0 = unlimited).
    fn charge_daily(env: &Env, amount: i128) {
        let cap: i128 = env
            .storage()
            .instance()
            .get(&DataKey::DailyCap)
            .unwrap_or(0);
        let day = env.ledger().timestamp() / DAY_SECS;
        let key = DataKey::DailyPaid(day);
        let paid: i128 = env.storage().temporary().get(&key).unwrap_or(0);
        let next = paid
            .checked_add(amount)
            .unwrap_or_else(|| panic_with_error!(env, Error::Overflow));
        if cap > 0 && next > cap {
            panic_with_error!(env, Error::DailyCapExceeded);
        }
        env.storage().temporary().set(&key, &next);
        // ~2 days outlives the UTC day it counts. Not BUMP_*: a temporary entry extended
        // past max_entry_ttl traps instead of clamping.
        env.storage()
            .temporary()
            .extend_ttl(&key, DAY_LEDGERS, DAY_LEDGERS * 2);
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
