#![no_std]
//! Reputation — the consumer brain of Stellar Passport.
//!
//! Two-track model (belts/08-anti-sybil): Social XP (from vouches, non-cashable) and
//! Earned XP (from attester-verified quests, the only track Rewards reads). Async
//! "half-card" vouches use a CLAIM-SECRET so you can vouch someone who has NOT
//! onboarded yet — the recipient binds their own address at claim time.
//!
//! Anti-sybil on-chain (belts/08 §1, full vouch economics):
//!   - claim-secret + first-pair-only + per-day cap.
//!   - STARTER Social XP for every new wallet (so the first vouch feels free).
//!   - XP-STAKE/SLASH: minting escrows Social XP from the voucher; refunded if the
//!     half-card is claimed within 7 days, otherwise slashed. Stops spray-vouching.
//!   - ASYMMETRIC 2nd-ORDER bonus: the claimer earns Social XP on claim, but the
//!     voucher's bonus only unlocks once the claimer later does a VERIFIED (Earned)
//!     action — a second-degree gate that breaks pure-ring auto-confirm.
//!
//! Off-chain ring detection is layered in later belts.
//!
//! SCF door (00-strategy §4): the Earned path emits a canonical `att_set` event from
//! day one; `get_attestation`/`get_score`/`get_earned` are pure read adapters.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    Bytes, BytesN, Env, String, Symbol, Vec,
};

const BUMP_THRESHOLD: u32 = 17_280; // ~1 day (ledgers)
const BUMP_EXTEND: u32 = 518_400; // ~30 days
const DAY_SECS: u64 = 86_400;
const MAX_VOUCH_PER_DAY: u32 = 20;

const STARTER_SOCIAL: u64 = 20; // every new wallet's starter Social XP (funds first stakes)
const VOUCH_STAKE: u64 = 5; // Social XP escrowed per mint; refunded on a timely claim, else slashed
const XP_CLAIMER: u64 = 10; // claimer's Social XP on a fresh (first-pair) claim
const BONUS_VOUCHER: u64 = 5; // voucher's 2nd-order bonus, released once the claimer verifies
const VOUCH_TTL_SECS: u64 = 604_800; // 7 days — claim within this window to refund the stake
const MAX_PENDING: u32 = 64; // cap on pending 2nd-order bonuses per claimer (bounds the flush loop)

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
    NotExpired = 10,
    InsufficientStake = 11,
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
    Started(Address),          // got the starter Social XP (bool)
    Verified(Address),         // did ≥1 Earned action -> releases pending voucher bonuses (bool)
    Pending(Address),          // claimer -> Vec<PendingBonus> (2nd-order voucher bonuses owed)
}

/// Async half-card vouch. `from` mints it bound to `claim_hash = sha256(secret)`.
/// The recipient (unknown at mint time) claims by presenting the secret. `stake` is
/// the voucher's escrowed Social XP — refunded on a claim within `VOUCH_TTL_SECS`,
/// otherwise slashed (`expire_vouch`).
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
    pub stake: u64,
    pub slashed: bool,
}

/// A voucher's 2nd-order bonus, owed once the claimer performs a verified action.
#[contracttype]
#[derive(Clone)]
pub struct PendingBonus {
    pub voucher: Address,
    pub amount: u64,
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
    /// the share link). Escrows `VOUCH_STAKE` Social XP from `from` (refunded on a
    /// timely claim, else slashed). New wallets get `STARTER_SOCIAL` first so the
    /// first vouch is free. Per-day cap applies. Returns the vouch id.
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

        // Starter Social XP (once), then escrow the stake.
        Self::grant_starter(&env, &from);
        let bal: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::Social(from.clone()))
            .unwrap_or(0);
        if bal < VOUCH_STAKE {
            panic_with_error!(&env, Error::InsufficientStake);
        }
        Self::sub_social(&env, &from, VOUCH_STAKE);

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
            stake: VOUCH_STAKE,
            slashed: false,
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
    /// The claimer earns SOCIAL XP (first-pair-only), the voucher's stake is refunded
    /// (if the claim is within `VOUCH_TTL_SECS`), and the voucher's 2nd-order bonus is
    /// released now if the claimer is already verified — otherwise it is queued until
    /// the claimer performs a verified (Earned) action. Vouches never touch Earned.
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

        // Starter Social XP for the claimer (once), before crediting claim XP.
        Self::grant_starter(&env, &claimer);

        vouch.claimed = true;
        vouch.claimer = Some(claimer.clone());
        env.storage()
            .persistent()
            .set(&DataKey::Vouch(vouch_id), &vouch);

        // Refund the voucher's stake on a timely claim (else it stays slashed).
        let now = env.ledger().timestamp();
        if !vouch.slashed && now <= vouch.created + VOUCH_TTL_SECS {
            Self::add_social(&env, &vouch.from, vouch.stake);
        }

        // first-pair-only guard (kills back-and-forth pump)
        let pair = DataKey::Seen(vouch.from.clone(), claimer.clone());
        let fresh = !env.storage().persistent().get(&pair).unwrap_or(false);
        if fresh {
            env.storage().persistent().set(&pair, &true);
            env.storage()
                .persistent()
                .extend_ttl(&pair, BUMP_THRESHOLD, BUMP_EXTEND);
            // SOCIAL XP only — vouches never touch the cashable (Earned) track.
            Self::add_social(&env, &claimer, XP_CLAIMER);
            // 2nd-order bonus: pay the voucher now if the claimer already verified;
            // otherwise queue it until the claimer performs a verified action.
            let verified: bool = env
                .storage()
                .persistent()
                .get(&DataKey::Verified(claimer.clone()))
                .unwrap_or(false);
            if verified {
                Self::add_social(&env, &vouch.from, BONUS_VOUCHER);
            } else {
                Self::queue_bonus(&env, &claimer, &vouch.from, BONUS_VOUCHER);
            }
        }

        env.events().publish(
            (symbol_short!("vouch"), symbol_short!("claimed")),
            (vouch_id, vouch.from, claimer),
        );
    }

    /// Slash an unclaimed half-card after its 7-day window (the staked Social XP was
    /// deducted at mint and is not refunded). Callable by anyone — a cheap keeper job.
    /// Idempotent; a still-claimable (late) claim earns no refund either way.
    pub fn expire_vouch(env: Env, vouch_id: u64) {
        let mut vouch: Vouch = env
            .storage()
            .persistent()
            .get(&DataKey::Vouch(vouch_id))
            .unwrap_or_else(|| panic_with_error!(&env, Error::VouchNotFound));
        if vouch.claimed {
            panic_with_error!(&env, Error::AlreadyClaimed);
        }
        if vouch.slashed {
            return; // already slashed — idempotent
        }
        if env.ledger().timestamp() <= vouch.created + VOUCH_TTL_SECS {
            panic_with_error!(&env, Error::NotExpired);
        }
        vouch.slashed = true;
        env.storage()
            .persistent()
            .set(&DataKey::Vouch(vouch_id), &vouch);
        env.events().publish(
            (symbol_short!("vouch"), symbol_short!("slashed")),
            (vouch_id, vouch.from, vouch.stake),
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

    /// A half-card by id — for the claim preview and the expiry keeper.
    pub fn get_vouch(env: Env, vouch_id: u64) -> Option<Vouch> {
        env.storage().persistent().get(&DataKey::Vouch(vouch_id))
    }

    /// True once `addr` has performed a verified (Earned) action — this is the gate
    /// that releases pending 2nd-order voucher bonuses.
    pub fn is_verified(env: Env, addr: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Verified(addr))
            .unwrap_or(false)
    }

    // --- internal ---

    fn admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
    }

    /// Grant the starter Social XP once. SILENT (no `social` event) so brand-new
    /// wallets don't clutter the event-sourced leaderboard until they actually act;
    /// the first real `social` event carries the correct cumulative total.
    fn grant_starter(env: &Env, who: &Address) {
        let started = DataKey::Started(who.clone());
        if env.storage().persistent().get(&started).unwrap_or(false) {
            return;
        }
        env.storage().persistent().set(&started, &true);
        env.storage()
            .persistent()
            .extend_ttl(&started, BUMP_THRESHOLD, BUMP_EXTEND);

        let key = DataKey::Social(who.clone());
        let cur: u64 = env.storage().persistent().get(&key).unwrap_or(0);
        let next = cur
            .checked_add(STARTER_SOCIAL)
            .unwrap_or_else(|| panic_with_error!(env, Error::Overflow));
        env.storage().persistent().set(&key, &next);
        env.storage()
            .persistent()
            .extend_ttl(&key, BUMP_THRESHOLD, BUMP_EXTEND);
    }

    /// Queue a 2nd-order voucher bonus, released when `claimer` first verifies.
    /// Bounded by `MAX_PENDING` so the release loop can never grow unbounded.
    fn queue_bonus(env: &Env, claimer: &Address, voucher: &Address, amount: u64) {
        let key = DataKey::Pending(claimer.clone());
        let mut pend: Vec<PendingBonus> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        if pend.len() >= MAX_PENDING {
            return; // ring-spam guard — drop bonuses past the cap
        }
        pend.push_back(PendingBonus {
            voucher: voucher.clone(),
            amount,
        });
        env.storage().persistent().set(&key, &pend);
        env.storage()
            .persistent()
            .extend_ttl(&key, BUMP_THRESHOLD, BUMP_EXTEND);
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

    /// Deduct Social XP (stake escrow). Callers ensure the balance covers `amount`.
    fn sub_social(env: &Env, from: &Address, amount: u64) {
        let key = DataKey::Social(from.clone());
        let cur: u64 = env.storage().persistent().get(&key).unwrap_or(0);
        let next = cur
            .checked_sub(amount)
            .unwrap_or_else(|| panic_with_error!(env, Error::Overflow));
        env.storage().persistent().set(&key, &next);
        env.storage()
            .persistent()
            .extend_ttl(&key, BUMP_THRESHOLD, BUMP_EXTEND);
        env.events()
            .publish((symbol_short!("social"), from.clone()), (amount, next));
    }

    /// Earned XP — verified quests. Writes the canonical attestation + `att_set` event.
    /// On the claimer's FIRST Earned credit, releases any pending 2nd-order voucher
    /// bonuses (the second-degree gate that proves the vouched-for person is real).
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

        // 2nd-order gate: the first time `to` earns verified XP, release queued
        // voucher bonuses (once). Later vouches to an already-verified claimer pay
        // their voucher immediately (see claim_vouch).
        let vkey = DataKey::Verified(to.clone());
        if !env.storage().persistent().get(&vkey).unwrap_or(false) {
            env.storage().persistent().set(&vkey, &true);
            env.storage()
                .persistent()
                .extend_ttl(&vkey, BUMP_THRESHOLD, BUMP_EXTEND);
            let pkey = DataKey::Pending(to.clone());
            if let Some(pend) = env
                .storage()
                .persistent()
                .get::<DataKey, Vec<PendingBonus>>(&pkey)
            {
                for p in pend.iter() {
                    Self::add_social(env, &p.voucher, p.amount);
                }
                env.storage().persistent().remove(&pkey);
            }
        }
    }
}

#[cfg(test)]
mod test;
