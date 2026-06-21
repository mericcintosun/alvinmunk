#![no_std]
//! Reputation — the consumer brain of Stellar Passport.
//!
//! Holds non-transferable XP (no transfer fn => SBT semantics), profiles, async
//! "half-card" vouches (cold-start fix, see belts/00-strategy §3), and allowlisted
//! attester-issued attestations.
//!
//! SCF door (00-strategy §4): every score-affecting mutation emits the canonical
//! `attestation_set` event so an off-chain primitive can be exposed later WITHOUT
//! migration. The `get_attestation` / `get_score` read-views are pure (read-only
//! adapter, never a second write path).

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    Env, String, Symbol,
};

// TTL bump windows for persistent storage (ledgers). Tune per belt (Green §storage).
const BUMP_THRESHOLD: u32 = 17_280; // ~1 day
const BUMP_EXTEND: u32 = 518_400; // ~30 days

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    NotAuthorized = 3,
    VouchNotFound = 4,
    AlreadyClaimed = 5,
    SelfVouch = 6,
    Overflow = 7,
    WrongRecipient = 8,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Attester(Address), // allowlist flag (bool)
    // Two-track model (belts/08-anti-sybil keystone): Social is NEVER cashable;
    // Earned (attester-verified) is the ONLY track Rewards reads.
    Social(Address),           // u64 — fun/leaderboard, from vouches
    Earned(Address),           // u64 — USDC-eligible, from verified quests only
    Seen(Address, Address),    // first-pair-only guard: (from,to) -> bool
    VouchSeq,                  // u64 counter
    Vouch(u64),                // Vouch
    Attestation(Address, u32), // (addr, schema_id) -> Attestation
}

/// Async half-card vouch. `from` mints it AT `to`; score is only granted on claim.
#[contracttype]
#[derive(Clone)]
pub struct Vouch {
    pub id: u64,
    pub from: Address,
    pub to: Address,
    pub note: String,
    pub claimed: bool,
    pub created: u64,
}

/// Canonical attestation record — the fundable primitive's read shape (00-strategy §4).
#[contracttype]
#[derive(Clone)]
pub struct Attestation {
    pub issuer: Address,
    pub value: i128,
    pub timestamp: u64,
    pub revoked: bool,
}

#[contract]
pub struct ReputationContract;

#[contractimpl]
impl ReputationContract {
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    // --- Attester allowlist (admin-gated) ---

    pub fn add_attester(env: Env, attester: Address) {
        Self::admin(&env).require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::Attester(attester.clone()), &true);
        env.events()
            .publish((symbol_short!("attester"), symbol_short!("add")), attester);
    }

    pub fn remove_attester(env: Env, attester: Address) {
        Self::admin(&env).require_auth();
        env.storage()
            .persistent()
            .remove(&DataKey::Attester(attester.clone()));
        env.events()
            .publish((symbol_short!("attester"), symbol_short!("rm")), attester);
    }

    pub fn is_attester(env: Env, who: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Attester(who))
            .unwrap_or(false)
    }

    // --- Async vouch (cold-start fix) ---

    /// `from` mints a half-card at `to`. Returns the vouch id used in the share link.
    /// Production note: for not-yet-onboarded recipients, the share link carries a
    /// claim-secret and `to` is bound at claim time. Skeleton uses an explicit `to`.
    pub fn mint_vouch(env: Env, from: Address, to: Address, note: String) -> u64 {
        from.require_auth();
        if from == to {
            panic_with_error!(&env, Error::SelfVouch);
        }
        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::VouchSeq)
            .unwrap_or(0)
            + 1;
        env.storage().instance().set(&DataKey::VouchSeq, &id);

        let vouch = Vouch {
            id,
            from: from.clone(),
            to: to.clone(),
            note,
            claimed: false,
            created: env.ledger().timestamp(),
        };
        env.storage().persistent().set(&DataKey::Vouch(id), &vouch);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Vouch(id), BUMP_THRESHOLD, BUMP_EXTEND);

        env.events().publish(
            (symbol_short!("vouch"), symbol_short!("minted")),
            (id, from, to),
        );
        id
    }

    /// `to` claims the half-card. Both sides earn SOCIAL XP (non-cashable).
    /// first-pair-only (belts/08-anti-sybil §1): a repeated (from,to) pair still
    /// mints the card (fun) but grants 0 XP — kills the back-and-forth pump.
    pub fn claim_vouch(env: Env, to: Address, vouch_id: u64) {
        to.require_auth();
        let mut vouch: Vouch = env
            .storage()
            .persistent()
            .get(&DataKey::Vouch(vouch_id))
            .unwrap_or_else(|| panic_with_error!(&env, Error::VouchNotFound));

        if vouch.claimed {
            panic_with_error!(&env, Error::AlreadyClaimed);
        }
        if vouch.to != to {
            panic_with_error!(&env, Error::WrongRecipient);
        }

        vouch.claimed = true;
        env.storage()
            .persistent()
            .set(&DataKey::Vouch(vouch_id), &vouch);

        // first-pair-only guard
        let pair = DataKey::Seen(vouch.from.clone(), vouch.to.clone());
        let fresh = !env.storage().persistent().get(&pair).unwrap_or(false);
        if fresh {
            env.storage().persistent().set(&pair, &true);
            env.storage()
                .persistent()
                .extend_ttl(&pair, BUMP_THRESHOLD, BUMP_EXTEND);
            // SOCIAL XP only — vouches never touch the cashable (Earned) track.
            Self::add_social(&env, &vouch.from, 10);
            Self::add_social(&env, &vouch.to, 10);
        }

        env.events().publish(
            (symbol_short!("vouch"), symbol_short!("claimed")),
            (vouch_id, vouch.from, vouch.to),
        );
    }

    // --- Attester-issued XP (verifiable quests) ---

    /// Called by an allowlisted attester (or the QuestRegistry contract address)
    /// after off-chain verification of a quest. Credits the EARNED (cashable) track,
    /// writes the canonical attestation, and emits `att_set`. `schema_id` namespaces it.
    pub fn award_xp(env: Env, attester: Address, to: Address, schema_id: u32, amount: u64) {
        attester.require_auth();
        if !Self::is_attester(env.clone(), attester.clone()) {
            panic_with_error!(&env, Error::NotAuthorized);
        }
        Self::add_earned(&env, &attester, &to, schema_id, amount);
    }

    // --- Read views (pure) ---

    /// Social score — leaderboard / fun. NOT cashable. (belts/08-anti-sybil keystone)
    pub fn get_score(env: Env, addr: Address) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::Social(addr))
            .unwrap_or(0)
    }

    /// Earned score — the ONLY track Rewards may gate USDC payouts on.
    pub fn get_earned(env: Env, addr: Address) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::Earned(addr))
            .unwrap_or(0)
    }

    /// The fundable primitive's read shape (00-strategy §4). Verified claims only.
    pub fn get_attestation(env: Env, addr: Address, schema_id: u32) -> Option<Attestation> {
        env.storage()
            .persistent()
            .get(&DataKey::Attestation(addr, schema_id))
    }

    // --- internal ---

    fn admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
    }

    /// Social XP — vouches only. No attestation (vouches are noise, not the primitive).
    fn add_social(env: &Env, to: &Address, amount: u64) {
        let key = DataKey::Social(to.clone());
        let cur: u64 = env.storage().persistent().get(&key).unwrap_or(0);
        let next = cur
            .checked_add(amount)
            .unwrap_or_else(|| panic_with_error!(env, Error::Overflow));
        env.storage().persistent().set(&key, &next);
        env.storage()
            .persistent()
            .extend_ttl(&key, BUMP_THRESHOLD, BUMP_EXTEND);
        env.events()
            .publish((symbol_short!("social"), to.clone()), (amount, next));
    }

    /// Earned XP — verified quests. Writes the canonical attestation + `att_set` event.
    fn add_earned(env: &Env, issuer: &Address, to: &Address, schema_id: u32, amount: u64) {
        let key = DataKey::Earned(to.clone());
        let cur: u64 = env.storage().persistent().get(&key).unwrap_or(0);
        let next = cur
            .checked_add(amount)
            .unwrap_or_else(|| panic_with_error!(env, Error::Overflow));
        env.storage().persistent().set(&key, &next);
        env.storage()
            .persistent()
            .extend_ttl(&key, BUMP_THRESHOLD, BUMP_EXTEND);

        let ts = env.ledger().timestamp();
        let att = Attestation {
            issuer: issuer.clone(),
            value: amount as i128,
            timestamp: ts,
            revoked: false,
        };
        let att_key = DataKey::Attestation(to.clone(), schema_id);
        env.storage().persistent().set(&att_key, &att);
        env.storage()
            .persistent()
            .extend_ttl(&att_key, BUMP_THRESHOLD, BUMP_EXTEND);

        // Canonical event (append-only; retroactively impossible — 00-strategy §4)
        const ATTESTATION_SET: Symbol = symbol_short!("att_set");
        env.events().publish(
            (ATTESTATION_SET, to.clone()),
            (issuer.clone(), schema_id, amount, ts),
        );
        env.events()
            .publish((symbol_short!("xp"), to.clone()), (amount, next));
    }
}

#[cfg(test)]
mod test;
