#![no_std]
//! Rewards — the spend sink that makes reputation MATTER (00-strategy §2/§5).
//!
//! - `tip`: direct USDC (SAC) transfer wallet->wallet + a `tipped` event for the feed.
//!   Ship this FIRST (Green retention de-risk) — measure D7 return of spend RECEIVERS.
//!   Every tip moves value: `amount > 0` and sender != receiver, so a `tipped` event is
//!   always evidence that somebody received a real spend.
//! - `add_reward` / `claim_reward`: the on-chain rank->reward unlock TABLE. The admin
//!   registers each reward (Earned-XP threshold + USDC amount); a user claims by id and
//!   the contract pays the STORED amount. The caller can NEVER dictate the payout, so the
//!   treasury is not drainable (belts/08: bound the payout path).
//!
//! Safety: Earned-XP gate (keystone) + admin-set per-reward amount + replay guard +
//! pausable emergency stop. A `tip` never touches the treasury (the sender funds it), but
//! it is bounded the same way: it must move real value between two different wallets.

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
    InvalidThreshold = 15, // zero threshold bypasses the Earned-XP gate
    AmountExceedsCap = 16, // payout above the daily cap can never be claimed
    CapBelowActiveReward = 17, // new cap would strand an active reward
    StreakTooShort = 18, // live weekly quest streak below the reward's minimum
    QuestRegistryNotSet = 19, // a streak gate needs `set_quest_registry` first
    SelfTip = 20,   // `tip` sender == receiver: a `tipped` event that moves no value
}

/// `quest_registry::Streak`, decoded from the cross-contract `get_streak` read (the field
/// names and types must match). Only `weeks` gates a claim.
#[contracttype]
#[derive(Clone)]
pub struct Streak {
    pub weeks: u32,
    pub last_week: u64,
    pub best: u32,
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
    pub min_streak: u32, // live weekly quest streak required; 0 = none
}

/// One reward row plus one wallet's claim status, as returned by `get_rewards_for`.
/// `reason` is the `Error` code `claim_reward` would revert with right now (`0` = none),
/// so `eligible == (reason == 0)`.
#[contracttype]
#[derive(Clone)]
pub struct RewardStatus {
    pub entry: RewardInfo,
    pub claimed: bool,
    pub eligible: bool,
    pub reason: u32,
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
    QuestRegistry,               // QuestRegistry address, read for streak-gated rewards
    RewardStreak(u32),           // u32 — min live weekly streak for a reward (absent = none)
}

#[contract]
pub struct RewardsContract;

#[contractimpl]
impl RewardsContract {
    /// Deploy-time setup (#127): `stellar contract deploy … -- --admin <ADDR> --usdc <SAC> --reputation <C…>` runs this inside
    /// the deploy transaction, so nobody can claim the admin between deploy and setup —
    /// there is no `init` to front-run. `upgrade` never runs a constructor: a contract
    /// deployed before this change was set up by its old `init` and keeps that state.
    pub fn __constructor(env: Env, admin: Address, usdc: Address, reputation: Address) {
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
    ///
    /// Every tip moves value: the amount must be positive and the receiver must be a
    /// DIFFERENT wallet (`validate_tip`, #144). The SAC's own check only rejects a
    /// NEGATIVE amount, so `0` and `from == to` used to go through — a wallet holding no
    /// USDC could tip 0 anyone, and a self-transfer left the balance unchanged, both still
    /// minting a `tipped` event. `tipped` is a frozen canonical event (shared
    /// EVENTS.TIPPED) read by the feed and the indexer, and it is the proof that somebody
    /// *received* a spend — the Green belt's D7 de-risk metric — so a no-value tip is
    /// refused here rather than left for every consumer to filter.
    pub fn tip(env: Env, from: Address, to: Address, amount: i128) {
        Self::not_paused(&env);
        from.require_auth();
        Self::require_unfrozen(&env, &from);
        Self::validate_tip(&env, &from, &to, amount);
        let usdc: Address = env.storage().instance().get(&DataKey::Usdc).unwrap();
        token::Client::new(&env, &usdc).transfer(&from, &to, &amount);
        env.events()
            .publish((symbol_short!("tipped"), from, to), amount);
    }

    // --- Rank -> reward unlock table (admin-registered) ---

    /// Register or update a reward. Admin-only. `amount` is the STORED payout — claimers
    /// can never set it, so the treasury can't be drained via an attacker-chosen amount.
    /// Rejects `threshold == 0` (it would bypass the Earned-XP gate) and, when a daily cap
    /// is set, an `amount` above it (such a reward could never be claimed). The treasury
    /// balance is not checked: it moves with funding and claims, so a reward can be
    /// registered before the treasury is funded.
    pub fn add_reward(env: Env, reward_id: u32, threshold: u64, amount: i128) {
        Self::admin(&env).require_auth();
        Self::validate_reward(&env, threshold, amount);
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

    /// Enable/disable a reward without removing it from the table. Admin-only. Enabling
    /// re-checks the amount against the current daily cap (`AmountExceedsCap`).
    pub fn set_reward_active(env: Env, reward_id: u32, active: bool) {
        Self::admin(&env).require_auth();
        let mut entry: RewardEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Reward(reward_id))
            .unwrap_or_else(|| panic_with_error!(&env, Error::RewardNotFound));
        if active {
            Self::assert_amount_within_cap(&env, entry.amount);
        }
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

    /// Point the rewards contract at the QuestRegistry whose `get_streak` gates
    /// streak-gated rewards. Admin-only. The constructor doesn't take it (it keeps the
    /// arguments the old `init` had, so the deploy scripts wire every contract the same
    /// way), so a deploy or upgrade calls this once; it can be re-pointed after a
    /// QuestRegistry redeploy.
    pub fn set_quest_registry(env: Env, quest_registry: Address) {
        Self::admin(&env).require_auth();
        env.storage()
            .instance()
            .set(&DataKey::QuestRegistry, &quest_registry);
    }

    pub fn get_quest_registry(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::QuestRegistry)
    }

    /// Require a live weekly quest streak of at least `weeks` to claim a reward, on top of
    /// its Earned-XP threshold; `0` removes the requirement. Admin-only. Kept under its own
    /// key so stored `Reward(id)` entries keep their shape. A non-zero minimum needs the
    /// QuestRegistry set first (`QuestRegistryNotSet`).
    pub fn set_reward_min_streak(env: Env, reward_id: u32, weeks: u32) {
        Self::admin(&env).require_auth();
        if !env.storage().persistent().has(&DataKey::Reward(reward_id)) {
            panic_with_error!(&env, Error::RewardNotFound);
        }
        let key = DataKey::RewardStreak(reward_id);
        if weeks == 0 {
            env.storage().persistent().remove(&key);
        } else {
            Self::quest_registry(&env);
            env.storage().persistent().set(&key, &weeks);
            env.storage()
                .persistent()
                .extend_ttl(&key, BUMP_THRESHOLD, BUMP_EXTEND);
        }
        env.events()
            .publish((symbol_short!("rwd_strk"), reward_id), weeks);
    }

    /// The live weekly streak a reward requires (0 = none).
    pub fn get_reward_min_streak(env: Env, reward_id: u32) -> u32 {
        Self::min_streak(&env, reward_id)
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
                let min_streak = Self::min_streak(&env, id);
                out.push_back(RewardInfo {
                    id: e.id,
                    threshold: e.threshold,
                    amount: e.amount,
                    active: e.active,
                    max_claims: stats.max_claims,
                    claims: stats.claims,
                    min_streak,
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

    /// One-call reward status view for a wallet: every row of `get_rewards` with
    /// `claimed`, `eligible` and the `reason` it can't be claimed, plus today's remaining
    /// treasury budget in stroops (`-1` = no daily cap).
    ///
    /// `reason` runs `claim_reward`'s checks in the same order without the transfer, so it
    /// is the first error the claim would revert with: `Paused`, `Frozen`, `NotFunded`,
    /// `RewardInactive`, `AlreadyClaimed`, `RewardExhausted`, `BelowThreshold`,
    /// `QuestRegistryNotSet`, `StreakTooShort`, then `DailyCapExceeded`. The Earned-XP and
    /// streak cross-reads run at most once per call, and only when a row gets that far.
    pub fn get_rewards_for(env: Env, who: Address) -> (Vec<RewardStatus>, i128) {
        let cap = Self::daily_cap(&env);
        let paid = Self::get_daily_paid(env.clone());
        let remaining = if cap > 0 { (cap - paid).max(0) } else { -1 };

        // The wallet-wide gates `claim_reward` checks first block every row alike.
        let unfunded =
            Self::get_require_funding(env.clone()) && !Self::is_funded(env.clone(), who.clone());
        let blocked = if Self::is_paused(&env) {
            Some(Error::Paused)
        } else if Self::is_frozen(env.clone(), who.clone()) {
            Some(Error::Frozen)
        } else if unfunded {
            Some(Error::NotFunded)
        } else {
            None
        };

        let mut score: Option<u64> = None;
        let mut weeks: Option<u32> = None;
        let mut out = Vec::new(&env);
        for entry in Self::get_rewards(env.clone()).iter() {
            let claimed = Self::is_claimed(env.clone(), entry.id, who.clone());
            let reason = if let Some(e) = blocked {
                Some(e)
            } else if !entry.active {
                Some(Error::RewardInactive)
            } else if claimed {
                Some(Error::AlreadyClaimed)
            } else if entry.max_claims > 0 && entry.claims >= entry.max_claims {
                Some(Error::RewardExhausted)
            } else if *score.get_or_insert_with(|| Self::earned(&env, &who)) < entry.threshold {
                Some(Error::BelowThreshold)
            } else if let Some(e) = Self::streak_block(&env, &who, entry.min_streak, &mut weeks) {
                Some(e)
            } else {
                Self::daily_block(cap, paid, entry.amount)
            };
            out.push_back(RewardStatus {
                entry,
                claimed,
                eligible: reason.is_none(),
                reason: reason.map_or(0, |e| e as u32),
            });
        }
        (out, remaining)
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
        if Self::earned(&env, &to) < entry.threshold {
            panic_with_error!(&env, Error::BelowThreshold);
        }

        // Streak-gated rewards (#294): cross-read the claimer's weekly quest streak. The
        // streak only grows through attester-verified quests, so this stays on the Earned
        // side of the two-track split. `get_streak` already reads a lapsed run as 0 weeks
        // (the stored `weeks` is only reset by the next award), so a stale streak fails here.
        // Rewards without a minimum make no QuestRegistry call.
        let min_streak = Self::min_streak(&env, reward_id);
        if min_streak > 0 {
            let quest_registry = Self::quest_registry(&env);
            if Self::streak_weeks(&env, &quest_registry, &to) < min_streak {
                panic_with_error!(&env, Error::StreakTooShort);
            }
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

    /// Set the max treasury payout per UTC day, in USDC stroops. Admin-only.
    ///
    /// - `0` means **unlimited** (no per-day ceiling). To block every payout, use
    ///   `set_paused(true)`.
    /// - A negative cap is rejected (`InvalidAmount`): `charge_daily` only enforces a
    ///   positive cap, so a negative one would silently lift the limit instead of
    ///   tightening it.
    /// - A positive cap below an active reward's amount is rejected
    ///   (`CapBelowActiveReward`): lower or deactivate that reward first. `0` is always
    ///   accepted.
    pub fn set_daily_cap(env: Env, cap: i128) {
        Self::admin(&env).require_auth();
        if cap < 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        Self::assert_cap_covers_active_rewards(&env, cap);
        env.storage().instance().set(&DataKey::DailyCap, &cap);
    }

    /// The daily payout cap in USDC stroops; `0` = unlimited. Never negative.
    pub fn get_daily_cap(env: Env) -> i128 {
        Self::daily_cap(&env)
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

    /// Reject a tip that would move no value, BEFORE the SAC call and before the event
    /// (nothing is written either way — a revert rolls the whole invocation back).
    ///
    /// - `amount <= 0` → `InvalidAmount`. The SAC's own `check_nonnegative_amount` rejects
    ///   only a NEGATIVE amount, so `0` used to go through: a wallet with no USDC at all
    ///   could "tip" anyone for the price of a fee and the receiver would count as having
    ///   received a spend.
    /// - `from == to` → `SelfTip`. The SAC moves the balance to itself, so the transfer
    ///   succeeds and the balance is unchanged, while one wallet can "receive" any number
    ///   of tips from itself.
    ///
    /// Both inflate exactly what `tipped` is evidence of, so they are refused on-chain:
    /// an emitted `tipped` always means USDC moved from `from` to a DIFFERENT `to`. The
    /// amount is checked first — the web app's `validateTip` orders it the same way.
    fn validate_tip(env: &Env, from: &Address, to: &Address, amount: i128) {
        if amount <= 0 {
            panic_with_error!(env, Error::InvalidAmount);
        }
        if from == to {
            panic_with_error!(env, Error::SelfTip);
        }
    }

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

    fn min_streak(env: &Env, reward_id: u32) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::RewardStreak(reward_id))
            .unwrap_or(0)
    }

    fn quest_registry(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::QuestRegistry)
            .unwrap_or_else(|| panic_with_error!(env, Error::QuestRegistryNotSet))
    }

    fn save_stats(env: &Env, reward_id: u32, stats: &RewardStats) {
        let key = DataKey::RewardStats(reward_id);
        env.storage().persistent().set(&key, stats);
        env.storage()
            .persistent()
            .extend_ttl(&key, BUMP_THRESHOLD, BUMP_EXTEND);
    }

    fn is_paused(env: &Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    fn not_paused(env: &Env) {
        if Self::is_paused(env) {
            panic_with_error!(env, Error::Paused);
        }
    }

    /// Cross-contract read of `who`'s EARNED track (the only cashable one).
    fn earned(env: &Env, who: &Address) -> u64 {
        let reputation: Address = env.storage().instance().get(&DataKey::Reputation).unwrap();
        let func: Symbol = Symbol::new(env, "get_earned"); // >9 chars => not symbol_short
        env.invoke_contract(&reputation, &func, soroban_sdk::vec![env, who.to_val()])
    }

    /// Cross-contract read of `who`'s live weekly quest streak.
    fn streak_weeks(env: &Env, quest_registry: &Address, who: &Address) -> u32 {
        let func = Symbol::new(env, "get_streak"); // >9 chars => not symbol_short
        let streak: Streak =
            env.invoke_contract(quest_registry, &func, soroban_sdk::vec![env, who.to_val()]);
        streak.weeks
    }

    /// The error `claim_reward`'s streak gate would raise for a `min_streak` (0 = none).
    /// The live streak is read once per call and kept in `weeks`.
    fn streak_block(
        env: &Env,
        who: &Address,
        min_streak: u32,
        weeks: &mut Option<u32>,
    ) -> Option<Error> {
        if min_streak == 0 {
            return None;
        }
        let Some(quest_registry) = env.storage().instance().get(&DataKey::QuestRegistry) else {
            return Some(Error::QuestRegistryNotSet);
        };
        if *weeks.get_or_insert_with(|| Self::streak_weeks(env, &quest_registry, who)) < min_streak
        {
            Some(Error::StreakTooShort)
        } else {
            None
        }
    }

    /// The error `charge_daily` would raise for one more payout of `amount` today.
    fn daily_block(cap: i128, paid: i128, amount: i128) -> Option<Error> {
        match paid.checked_add(amount) {
            None => Some(Error::Overflow),
            Some(next) if cap > 0 && next > cap => Some(Error::DailyCapExceeded),
            Some(_) => None,
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

    /// Reject reward rows that could never pay out or that bypass the Earned-XP gate.
    fn validate_reward(env: &Env, threshold: u64, amount: i128) {
        if amount <= 0 {
            panic_with_error!(env, Error::InvalidAmount);
        }
        if threshold == 0 {
            panic_with_error!(env, Error::InvalidThreshold);
        }
        Self::assert_amount_within_cap(env, amount);
    }

    /// The stored daily cap; `0` (unset) = unlimited. `set_daily_cap` rejects a negative
    /// cap, but one stored before that rule reads as `0` here: it never limited anything,
    /// and the views should not show it as a restriction.
    fn daily_cap(env: &Env) -> i128 {
        let cap: i128 = env
            .storage()
            .instance()
            .get(&DataKey::DailyCap)
            .unwrap_or(0);
        cap.max(0)
    }

    /// A payout larger than the daily cap can never be claimed: `charge_daily` refuses any
    /// single claim above it. So while a cap is set (> 0) every ACTIVE reward must pay at
    /// most the cap. `add_reward` and re-enabling check the row against the current cap,
    /// and `set_daily_cap` checks a new cap against the active rows. Inactive rows may
    /// exceed it until they are re-enabled. A cap of 0 is unlimited.
    fn assert_amount_within_cap(env: &Env, amount: i128) {
        let cap = Self::daily_cap(env);
        if cap > 0 && amount > cap {
            panic_with_error!(env, Error::AmountExceedsCap);
        }
    }

    /// A positive cap must cover every active reward's amount (0 = unlimited).
    fn assert_cap_covers_active_rewards(env: &Env, cap: i128) {
        if cap <= 0 {
            return;
        }
        let ids: Vec<u32> = env
            .storage()
            .persistent()
            .get(&DataKey::RewardIds)
            .unwrap_or_else(|| Vec::new(env));
        for id in ids.iter() {
            let entry: Option<RewardEntry> = env.storage().persistent().get(&DataKey::Reward(id));
            if let Some(e) = entry {
                if e.active && e.amount > cap {
                    panic_with_error!(env, Error::CapBelowActiveReward);
                }
            }
        }
    }

    /// Accumulate today's treasury outflow and enforce the daily cap (0 = unlimited).
    fn charge_daily(env: &Env, amount: i128) {
        let cap = Self::daily_cap(env);
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
