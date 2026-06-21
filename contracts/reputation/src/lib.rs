#![no_std]
//! Reputation — the consumer brain of Stellar Passport.
//!
//! Two-track model (belts/08-anti-sybil): Social XP (from vouches, non-cashable) and
//! Earned XP (from attester-verified quests, the only track Rewards reads). Async
//! "half-card" vouches use a CLAIM-SECRET so you can vouch someone who has NOT
//! onboarded yet — the recipient binds their own address at claim time.
//!
//! Anti-sybil on-chain: claim-secret + first-pair-only + per-day cap + asymmetric
//! reward (claimer earns more than voucher). XP-stake/slash, 2nd-order voucher bonus,
//! and off-chain ring detection are layered in later belts.
//!
//! SCF door (00-strategy §4): the Earned path emits a canonical `att_set` event from
//! day one; `get_attestation`/`get_score`/`get_earned` are pure read adapters.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    Bytes, BytesN, Env, String, Symbol,
};

const BUMP_THRESHOLD: u32 = 17_280; // ~1 day (ledgers)
const BUMP_EXTEND: u32 = 518_400; // ~30 days
const DAY_SECS: u64 = 86_400;
const MAX_VOUCH_PER_DAY: u32 = 20;
const XP_CLAIMER: u64 = 10; // asymmetric: the claimer earns more than the voucher
const XP_VOUCHER: u64 = 5;

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
    BadSecret = 8,
    DailyCapReached = 9,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Attester(Address),        // allowlist flag (bool)
    Social(Address),          // u64 — fun/leaderboard, from vouches (NEVER cashable)
    Earned(Address),          // u64 — USDC-eligible, from verified quests only
    Seen(Address, Address),   // first-pair-only guard: (from, claimer) -> bool
    DailyCount(Address, u64), // (from, day) -> u32  (per-day vouch cap)
    VouchSeq,
    Vouch(u64),
    Attestation(Address, u32), // (addr, schema_id) -> Attestation
}

/// Async half-card vouch. `from` mints it bound to `claim_hash = sha256(secret)`.
/// The recipient (unknown at mint time) claims by presenting the secret.
#[contracttype]
#[derive(Clone)]
pub struct Vouch {
    pub id: u64,
    pub from: Address,
    pub claim_hash: BytesN<32>,
    pub note: String,
    pub claimed: bool,
    pub claimer: Option<Address>,
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

    // --- Async vouch (cold-start fix via claim-secret) ---

    /// `from` mints a half-card bound to `claim_hash` (= sha256 of a secret held in
    /// the share link). Returns the vouch id. Per-day cap applies.
    pub fn mint_vouch(env: Env, from: Address, claim_hash: BytesN<32>, note: String) -> u64 {
        from.require_auth();

        // Per-day cap (temporary storage auto-GCs old days).
        let day = env.ledger().timestamp() / DAY_SECS;
        let dkey = DataKey::DailyCount(from.clone(), day);
        let used: u32 = env.storage().temporary().get(&dkey).unwrap_or(0);
        if used >= MAX_VOUCH_PER_DAY {
            panic_with_error!(&env, Error::DailyCapReached);
        }
        env.storage().temporary().set(&dkey, &(used + 1));
        env.storage()
            .temporary()
            .extend_ttl(&dkey, BUMP_THRESHOLD, BUMP_THRESHOLD * 2);

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
            claim_hash,
            note,
            claimed: false,
            claimer: None,
            created: env.ledger().timestamp(),
        };
        env.storage().persistent().set(&DataKey::Vouch(id), &vouch);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Vouch(id), BUMP_THRESHOLD, BUMP_EXTEND);

        env.events().publish(
            (symbol_short!("vouch"), symbol_short!("minted")),
            (id, from),
        );
        id
    }

    /// `claimer` claims by presenting `secret` (sha256(secret) must equal claim_hash).
    /// Both sides earn SOCIAL XP (asymmetric), first-pair-only on (from, claimer).
    pub fn claim_vouch(env: Env, claimer: Address, vouch_id: u64, secret: Bytes) {
        claimer.require_auth();
        let mut vouch: Vouch = env
            .storage()
            .persistent()
            .get(&DataKey::Vouch(vouch_id))
            .unwrap_or_else(|| panic_with_error!(&env, Error::VouchNotFound));

        if vouch.claimed {
            panic_with_error!(&env, Error::AlreadyClaimed);
        }
        let computed: BytesN<32> = env.crypto().sha256(&secret).to_bytes();
        if computed != vouch.claim_hash {
            panic_with_error!(&env, Error::BadSecret);
        }
        if claimer == vouch.from {
            panic_with_error!(&env, Error::SelfVouch);
        }

        vouch.claimed = true;
        vouch.claimer = Some(claimer.clone());
        env.storage()
            .persistent()
            .set(&DataKey::Vouch(vouch_id), &vouch);

        // first-pair-only guard (kills back-and-forth pump)
        let pair = DataKey::Seen(vouch.from.clone(), claimer.clone());
        let fresh = !env.storage().persistent().get(&pair).unwrap_or(false);
        if fresh {
            env.storage().persistent().set(&pair, &true);
            env.storage()
                .persistent()
                .extend_ttl(&pair, BUMP_THRESHOLD, BUMP_EXTEND);
            // SOCIAL XP only — vouches never touch the cashable (Earned) track.
            Self::add_social(&env, &vouch.from, XP_VOUCHER);
            Self::add_social(&env, &claimer, XP_CLAIMER);
        }

        env.events().publish(
            (symbol_short!("vouch"), symbol_short!("claimed")),
            (vouch_id, vouch.from, claimer),
        );
    }

    // --- Attester-issued XP (verifiable quests) ---

    /// Allowlisted attester (or the QuestRegistry contract) credits the EARNED
    /// (cashable) track, writes the canonical attestation, emits `att_set`.
    pub fn award_xp(env: Env, attester: Address, to: Address, schema_id: u32, amount: u64) {
        attester.require_auth();
        if !Self::is_attester(env.clone(), attester.clone()) {
            panic_with_error!(&env, Error::NotAuthorized);
        }
        Self::add_earned(&env, &attester, &to, schema_id, amount);
    }

    // --- Read views (pure) ---

    /// Social score — leaderboard / fun. NOT cashable.
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
