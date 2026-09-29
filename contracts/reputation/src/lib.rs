#![no_std]
//! Reputation — the consumer brain of Stellar Passport.
//!
//! Two-track model (belts/08-anti-sybil): Social XP (from vouches, non-cashable) and
//! Earned XP (from attester-verified quests, the only track Rewards reads). Async
//! "half-card" vouches carry a CLAIM KEY in the share link so you can vouch someone who
//! has NOT onboarded yet — the recipient binds their own address at claim time by
//! signing it with that key (`claim_vouch_signed`). Cards minted before the key existed
//! claim with a plain secret (`claim_vouch`).
//!
//! Anti-sybil on-chain (belts/08 §1, full vouch economics):
//!   - claim key + first-pair-only + per-day cap.
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
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short,
    xdr::ToXdr, Address, Bytes, BytesN, Env, IntoVal, String, Symbol, Val, Vec,
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
const MAX_VOUCH_PER_DAY: u32 = 20;
// Longest vouch note, in UTF-8 BYTES (`String::len` counts bytes, not characters). 240 is
// the web app's 60-character limit at UTF-8's worst case of 4 bytes per character, so any
// note it lets through fits. Mirrored by `VOUCH_NOTE_MAX_BYTES` in apps/web/src/lib/reputation.ts.
const MAX_NOTE_BYTES: u32 = 240;

const STARTER_SOCIAL: u64 = 20; // every new wallet's starter Social XP (funds first stakes)
const VOUCH_STAKE: u64 = 5; // Social XP escrowed per mint; refunded on a timely claim, else slashed
const XP_CLAIMER: u64 = 10; // claimer's Social XP on a fresh (first-pair) claim
const BONUS_VOUCHER: u64 = 5; // voucher's 2nd-order bonus, released once the claimer verifies
const VOUCH_TTL_SECS: u64 = 604_800; // 7 days — claim within this window to refund the stake
const MAX_PENDING: u32 = 64; // cap on pending 2nd-order bonuses per claimer (bounds the flush loop)

// Most half-cards one `mint_vouches` call mints. Each card writes its `Vouch` and
// `ClaimPubkey` entries and emits two events, so a full batch stays far inside the
// per-transaction limits (testnet and mainnet, checked 2026-09-29: 200 written entries,
// 132,096 write bytes, 16,384 event bytes). Mirrored by `VOUCH_BATCH_MAX` in
// apps/web/src/lib/reputation.ts.
const MAX_BATCH_VOUCH: u32 = 10;

// Domain tag, first element of every signed claim message (see `claim_message`). It keeps a
// claim signature from ever doubling as a valid signature over another protocol's message.
const CLAIM_DOMAIN: &str = "alvinmunk_vouch_claim";

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
    NoteTooLong = 12,
    /// The card needs the other claim entrypoint: `claim_vouch_signed` for a card minted
    /// with a claim key, `claim_vouch` for one minted with a claim hash.
    WrongClaimMethod = 13,
    /// `mint_vouches` got a different number of claim keys and notes.
    LengthMismatch = 14,
    /// `mint_vouches` got no cards, or more than `MAX_BATCH_VOUCH`.
    BadBatchSize = 15,
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
    VouchedBy(Address),        // u32 — distinct people who vouched for this address
    Backed(Address),           // u32 — distinct people this address vouched for
    ClaimPubkey(u64),          // vouch id -> ed25519 claim key (mint_vouch_signed / mint_vouches)
}

/// Async half-card vouch. `mint_vouch_signed` binds it to an ed25519 claim key (stored
/// beside it under `DataKey::ClaimPubkey`, `claim_hash` all zeros); the legacy `mint_vouch`
/// binds it to `claim_hash = sha256(secret)`. The recipient (unknown at mint time) claims
/// with a signature from the key, or by presenting the secret. `stake` is the voucher's
/// escrowed Social XP — refunded on a claim within `VOUCH_TTL_SECS`, otherwise slashed
/// (`expire_vouch`). The shape is frozen: deployed half-cards decode exactly these fields.
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

/// The last timestamp at which `v` still counts as claimed on time: a claim at or before it
/// refunds the stake, and `expire_vouch` can slash only after it. The one place both read the
/// deadline from, so they cannot drift apart. Saturating: a `created` within
/// `VOUCH_TTL_SECS` of `u64::MAX` pins the deadline at `u64::MAX` instead of overflowing.
fn claim_deadline(v: &Vouch) -> u64 {
    v.created.saturating_add(VOUCH_TTL_SECS)
}

/// A voucher's 2nd-order bonus, owed once the claimer performs a verified action.
#[contracttype]
#[derive(Clone)]
pub struct PendingBonus {
    pub voucher: Address,
    pub amount: u64,
}

/// Canonical attestation record — the fundable primitive's read shape (00-strategy §4).
/// One record per (subject, schema_id), updated by every award under that schema. The
/// shape is frozen: deployed entries and integrators decode exactly these four fields.
#[contracttype]
#[derive(Clone)]
pub struct Attestation {
    /// Attester of the most recent award (per-award issuers are in the `att_set` events).
    pub issuer: Address,
    /// Running total of every award under this schema — a u64 XP sum held in an i128.
    pub value: i128,
    /// Ledger timestamp of the most recent award.
    pub timestamp: u64,
    /// Always false: there is no revoke path yet.
    pub revoked: bool,
}

/// Aggregate read shape for get_profile — the single-round-trip replacement for
/// separately calling get_score + get_earned (+ is_verified) from anchors/apps.
#[contracttype]
#[derive(Clone)]
pub struct Profile {
    pub social: u64,
    pub earned: u64,
    pub verified: bool,
}

#[contract]
pub struct ReputationContract;

#[contractimpl]
impl ReputationContract {
    /// Deploy-time setup (#127): `stellar contract deploy … -- --admin <ADDR>` runs this inside
    /// the deploy transaction, so nobody can claim the admin between deploy and setup —
    /// there is no `init` to front-run. `upgrade` never runs a constructor: a contract
    /// deployed before this change was set up by its old `init` and keeps that state.
    pub fn __constructor(env: Env, admin: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    /// Admin-gated WASM upgrade — same contract instance + storage, new code. Lets us
    /// iterate/season without a new address or state migration (mainnet de-risk).
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        Self::admin(&env).require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
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

    // --- Async vouch (cold-start fix via a claim key in the share link) ---

    /// `from` mints a half-card bound to `claim_key`, the ed25519 public key of a seed held
    /// in the share link. Only a signature from that seed over `claim_message` claims it,
    /// and the message names the claimer, so a signature seen in flight is useless for any
    /// other address. Escrows `VOUCH_STAKE` Social XP from `from` (refunded on a timely
    /// claim, else slashed). New wallets get `STARTER_SOCIAL` first so the first vouch is
    /// free. Each voucher may mint `MAX_VOUCH_PER_DAY` per UTC calendar day
    /// (`timestamp / DAY_SECS`, counting every mint entrypoint), else `DailyCapReached`. The
    /// count resets at 00:00:00 UTC, not 24 hours after the first mint, so a full day's mints
    /// at 23:59:59 and another full day's a second later are both allowed. `note` is at most
    /// `MAX_NOTE_BYTES` bytes of UTF-8, else `NoteTooLong`: it is stored in the vouch, which
    /// every claim rewrites. Returns the id.
    pub fn mint_vouch_signed(env: Env, from: Address, claim_key: BytesN<32>, note: String) -> u64 {
        from.require_auth();
        Self::mint_keyed(&env, &from, claim_key, note)
    }

    /// Batch `mint_vouch_signed` for a cohort leader: `from` signs once and mints one
    /// half-card per `(claim_keys[i], notes[i])`, in order, returning the ids in the same
    /// order. Every card goes through exactly the path a separate `mint_vouch_signed` call
    /// takes — note cap, per-day cap, starter XP, one `VOUCH_STAKE` escrow, its stored
    /// `Vouch` and `ClaimPubkey`, and its own `social` debit and `("vouch","minted")` events —
    /// so indexers and the feed cannot tell a batch from N single mints. The two vectors
    /// must be the same length, else `LengthMismatch`, and hold 1..=`MAX_BATCH_VOUCH` cards,
    /// else `BadBatchSize`. Any card that fails (`NoteTooLong`, `DailyCapReached`,
    /// `InsufficientStake`) reverts the whole batch: nothing is minted or escrowed.
    pub fn mint_vouches(
        env: Env,
        from: Address,
        claim_keys: Vec<BytesN<32>>,
        notes: Vec<String>,
    ) -> Vec<u64> {
        from.require_auth();
        if claim_keys.len() != notes.len() {
            panic_with_error!(&env, Error::LengthMismatch);
        }
        if claim_keys.is_empty() || claim_keys.len() > MAX_BATCH_VOUCH {
            panic_with_error!(&env, Error::BadBatchSize);
        }
        let mut ids = Vec::new(&env);
        for (claim_key, note) in claim_keys.iter().zip(notes.iter()) {
            ids.push_back(Self::mint_keyed(&env, &from, claim_key, note));
        }
        ids
    }

    /// LEGACY: `from` mints a half-card bound to `claim_hash` (= sha256 of a secret held in
    /// the share link). Kept for integrations that still mint this way, but such a card is
    /// front-runnable: its secret is a plain `claim_vouch` argument, so anyone who sees the
    /// claim before it lands can replay the secret for their own address. New cards should
    /// use `mint_vouch_signed`. Same stake, cap and note rules.
    pub fn mint_vouch(env: Env, from: Address, claim_hash: BytesN<32>, note: String) -> u64 {
        from.require_auth();
        Self::mint(&env, &from, claim_hash, note)
    }

    /// `claimer` claims a card from `mint_vouch_signed` with `sig`, the claim key's ed25519
    /// signature over `claim_message(vouch_id, claimer)`. The message binds the network, this
    /// contract, the card and the claimer, so a signature copied from a pending claim cannot
    /// claim for anyone else, claim another card, or replay on another deployment or network.
    /// A bad signature traps (`Error(Crypto, InvalidInput)`); a card minted with a claim hash
    /// reverts with `WrongClaimMethod`. The claimer earns SOCIAL XP (first-pair-only), the
    /// voucher's stake is refunded (if the claim is within `VOUCH_TTL_SECS`), and the
    /// voucher's 2nd-order bonus is released now if the claimer is already verified —
    /// otherwise it is queued until the claimer performs a verified (Earned) action.
    /// Vouches never touch Earned. A fresh pair also moves both people counters.
    pub fn claim_vouch_signed(env: Env, claimer: Address, vouch_id: u64, sig: BytesN<64>) {
        claimer.require_auth();
        let vouch = Self::unclaimed_vouch(&env, vouch_id);
        let claim_key: BytesN<32> = env
            .storage()
            .persistent()
            .get(&DataKey::ClaimPubkey(vouch_id))
            .unwrap_or_else(|| panic_with_error!(&env, Error::WrongClaimMethod));
        let message = Self::claim_message(&env, vouch_id, &claimer);
        env.crypto().ed25519_verify(&claim_key, &message, &sig);
        Self::settle_claim(&env, vouch_id, vouch, claimer);
    }

    /// LEGACY: `claimer` claims a card from `mint_vouch` by presenting `secret` (sha256(secret)
    /// must equal claim_hash). A card from `mint_vouch_signed` reverts with `WrongClaimMethod`.
    /// Same rewards as `claim_vouch_signed`.
    pub fn claim_vouch(env: Env, claimer: Address, vouch_id: u64, secret: Bytes) {
        claimer.require_auth();
        let vouch = Self::unclaimed_vouch(&env, vouch_id);
        if env
            .storage()
            .persistent()
            .has(&DataKey::ClaimPubkey(vouch_id))
        {
            panic_with_error!(&env, Error::WrongClaimMethod);
        }
        let computed: BytesN<32> = env.crypto().sha256(&secret).to_bytes();
        if computed != vouch.claim_hash {
            panic_with_error!(&env, Error::BadSecret);
        }
        Self::settle_claim(&env, vouch_id, vouch, claimer);
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
        if env.ledger().timestamp() <= claim_deadline(&vouch) {
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

    /// `addr`'s standing under `schema_id`: `value` is the sum of every award under that
    /// schema, `issuer`/`timestamp` are the latest award's. Summed over all schemas the
    /// values equal `get_earned`, except where a record predates accumulation: it held
    /// only its last award then and counts on from there (see docs/ON_CHAIN_EVENTS.md).
    pub fn get_attestation(env: Env, addr: Address, schema_id: u32) -> Option<Attestation> {
        env.storage()
            .persistent()
            .get(&DataKey::Attestation(addr, schema_id))
    }

    /// The 2nd-order voucher bonuses queued on `claimer`: one entry per voucher whose
    /// first-pair claim is waiting on the claimer's first verified (Earned) action.
    /// Empty once the claimer verifies (the queue is paid out and removed) and for any
    /// address with nothing queued. At most `MAX_PENDING` entries.
    pub fn get_pending(env: Env, claimer: Address) -> Vec<PendingBonus> {
        env.storage()
            .persistent()
            .get(&DataKey::Pending(claimer))
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// A half-card by id — for the claim preview and the expiry keeper.
    pub fn get_vouch(env: Env, vouch_id: u64) -> Option<Vouch> {
        env.storage().persistent().get(&DataKey::Vouch(vouch_id))
    }

    /// The ed25519 claim key a half-card was minted with (`mint_vouch_signed`), or `None`
    /// for a card minted with a claim hash (`mint_vouch`) and for an unknown id. Tells a
    /// client which claim entrypoint a card needs; the key itself is public.
    pub fn get_claim_key(env: Env, vouch_id: u64) -> Option<BytesN<32>> {
        env.storage()
            .persistent()
            .get(&DataKey::ClaimPubkey(vouch_id))
    }

    /// True once `addr` has performed a verified (Earned) action — this is the gate
    /// that releases pending 2nd-order voucher bonuses.
    pub fn is_verified(env: Env, addr: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Verified(addr))
            .unwrap_or(false)
    }

    /// On-chain people counts for `addr`: `(vouched_by, backed)`.
    ///   - `vouched_by` — distinct people who vouched FOR `addr`
    ///   - `backed`     — distinct people `addr` has vouched for
    ///
    /// Both only move on a fresh first-pair claim, so repeat vouches between the same two
    /// people never inflate them. They start counting at the upgrade that introduced them
    /// and cannot be backfilled: a wallet whose vouches all predate it reads 0 here, so
    /// apps should fall back to the `vouch`/`claimed` event history for that case.
    ///
    /// Kept separate from `get_profile` on purpose — `Profile` is a frozen integration
    /// shape, and adding fields to it would break every caller that decodes it.
    pub fn get_counts(env: Env, addr: Address) -> (u32, u32) {
        let vouched_by: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::VouchedBy(addr.clone()))
            .unwrap_or(0);
        let backed: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::Backed(addr))
            .unwrap_or(0);
        (vouched_by, backed)
    }

    /// Aggregate profile view — social + earned + verified in ONE call. Purely
    /// composes the existing getters; no new storage, no new write path. Cuts
    /// get_profile-style callers from 2-3 round-trips down to 1.
    pub fn get_profile(env: Env, addr: Address) -> Profile {
        Profile {
            social: Self::get_score(env.clone(), addr.clone()),
            earned: Self::get_earned(env.clone(), addr.clone()),
            verified: Self::is_verified(env, addr),
        }
    }

    // --- internal ---

    /// One claim-key card, as `mint_vouch_signed` and each card of `mint_vouches` mint it:
    /// the shared `mint`, then the key it claims with. Callers have already checked `from`'s
    /// auth.
    fn mint_keyed(env: &Env, from: &Address, claim_key: BytesN<32>, note: String) -> u64 {
        // No hash secret: all zeros has no known sha256 preimage, and `claim_vouch` refuses
        // a keyed card before it even compares hashes.
        let id = Self::mint(env, from, BytesN::from_array(env, &[0; 32]), note);
        let key = DataKey::ClaimPubkey(id);
        env.storage().persistent().set(&key, &claim_key);
        env.storage()
            .persistent()
            .extend_ttl(&key, BUMP_THRESHOLD, BUMP_EXTEND);
        id
    }

    /// Shared body of every mint: note cap, per-day cap, starter XP, stake escrow, then the
    /// stored half-card and its `minted` event. Callers have already checked `from`'s auth.
    fn mint(env: &Env, from: &Address, claim_hash: BytesN<32>, note: String) -> u64 {
        if note.len() > MAX_NOTE_BYTES {
            panic_with_error!(env, Error::NoteTooLong);
        }

        // Per-day cap (temporary storage auto-GCs old days).
        let day = env.ledger().timestamp() / DAY_SECS;
        let dkey = DataKey::DailyCount(from.clone(), day);
        let used: u32 = env.storage().temporary().get(&dkey).unwrap_or(0);
        if used >= MAX_VOUCH_PER_DAY {
            panic_with_error!(env, Error::DailyCapReached);
        }
        env.storage()
            .temporary()
            .set(&dkey, &(used.saturating_add(1)));
        // ~2 days outlives the UTC day it counts. Not BUMP_*: a temporary entry extended
        // past max_entry_ttl traps instead of clamping.
        env.storage()
            .temporary()
            .extend_ttl(&dkey, DAY_LEDGERS, DAY_LEDGERS * 2);

        // Starter Social XP (once), then escrow the stake.
        Self::grant_starter(env, from);
        let bal: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::Social(from.clone()))
            .unwrap_or(0);
        if bal < VOUCH_STAKE {
            panic_with_error!(env, Error::InsufficientStake);
        }
        Self::sub_social(env, from, VOUCH_STAKE);

        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::VouchSeq)
            .unwrap_or(0u64)
            .saturating_add(1);
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
            (id, from.clone()),
        );
        id
    }

    /// The half-card `vouch_id`, reverting unless it exists and is still unclaimed.
    fn unclaimed_vouch(env: &Env, vouch_id: u64) -> Vouch {
        let vouch: Vouch = env
            .storage()
            .persistent()
            .get(&DataKey::Vouch(vouch_id))
            .unwrap_or_else(|| panic_with_error!(env, Error::VouchNotFound));
        if vouch.claimed {
            panic_with_error!(env, Error::AlreadyClaimed);
        }
        vouch
    }

    /// The bytes a claim key signs to claim `vouch_id` for `claimer`: the XDR of the ScVal
    /// vector `[Symbol(CLAIM_DOMAIN), network_id, this contract, vouch_id: u64, claimer]`.
    /// `network_id` is sha256 of the network passphrase. Mirrored by `claimMessage` in
    /// apps/web/src/lib/reputation.ts; the format is documented in docs/ON_CHAIN_EVENTS.md.
    fn claim_message(env: &Env, vouch_id: u64, claimer: &Address) -> Bytes {
        let mut parts: Vec<Val> = Vec::new(env);
        parts.push_back(Symbol::new(env, CLAIM_DOMAIN).into_val(env));
        parts.push_back(env.ledger().network_id().into_val(env));
        parts.push_back(env.current_contract_address().into_val(env));
        parts.push_back(vouch_id.into_val(env));
        parts.push_back(claimer.clone().into_val(env));
        parts.to_xdr(env)
    }

    /// Shared tail of both claim paths, once the claim is authenticated: binds `claimer`,
    /// refunds a timely stake (or sets slashed=true and emits `vouch`/`slashed` for a late
    /// claim), pays first-pair Social XP (the voucher's bonus now or queued) and moves the
    /// people counters, then emits `claimed`.
    fn settle_claim(env: &Env, vouch_id: u64, mut vouch: Vouch, claimer: Address) {
        if claimer == vouch.from {
            panic_with_error!(env, Error::SelfVouch);
        }

        // Starter Social XP for the claimer (once), before crediting claim XP.
        Self::grant_starter(env, &claimer);

        // Evaluate the deadline BEFORE persisting so the stored record is consistent.
        let now = env.ledger().timestamp();
        let timely = !vouch.slashed && now <= claim_deadline(&vouch);
        // A late claim slashes here, unless `expire_vouch` already did (and announced it).
        let slash_now = !timely && !vouch.slashed;
        if slash_now {
            vouch.slashed = true;
        }

        vouch.claimed = true;
        vouch.claimer = Some(claimer.clone());
        env.storage()
            .persistent()
            .set(&DataKey::Vouch(vouch_id), &vouch);

        if timely {
            // Timely claim: refund the escrowed stake.
            Self::add_social(env, &vouch.from, vouch.stake);
        } else if slash_now {
            // Late claim: emit vouch/slashed (same event as expire_vouch) BEFORE
            // vouch/claimed so both slash paths leave identical state and events.
            env.events().publish(
                (symbol_short!("vouch"), symbol_short!("slashed")),
                (vouch_id, vouch.from.clone(), vouch.stake),
            );
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
            Self::add_social(env, &claimer, XP_CLAIMER);
            // 2nd-order bonus: pay the voucher now if the claimer already verified;
            // otherwise queue it until the claimer performs a verified action.
            let verified: bool = env
                .storage()
                .persistent()
                .get(&DataKey::Verified(claimer.clone()))
                .unwrap_or(false);
            if verified {
                Self::add_social(env, &vouch.from, BONUS_VOUCHER);
            } else {
                Self::queue_bonus(env, &claimer, &vouch.from, BONUS_VOUCHER);
            }
            // On-chain people counters — increment only on a fresh first-pair claim so
            // repeat vouches and re-claims never inflate the counts.
            Self::inc_count(env, &DataKey::VouchedBy(claimer.clone()));
            Self::inc_count(env, &DataKey::Backed(vouch.from.clone()));
        }

        env.events().publish(
            (symbol_short!("vouch"), symbol_short!("claimed")),
            (vouch_id, vouch.from, claimer),
        );
    }

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

    /// Increment a u32 people-counter (VouchedBy or Backed) with saturation at u32::MAX.
    fn inc_count(env: &Env, key: &DataKey) {
        let cur: u32 = env.storage().persistent().get(key).unwrap_or(0);
        let next = cur.saturating_add(1);
        env.storage().persistent().set(key, &next);
        env.storage()
            .persistent()
            .extend_ttl(key, BUMP_THRESHOLD, BUMP_EXTEND);
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

        // The attestation accumulates per (subject, schema): `value` is the running total,
        // `issuer`/`timestamp` describe the latest award. The sum is checked in u64 so
        // `value` always fits the XP range the i128 field is read as.
        let ts = env.ledger().timestamp();
        let att_key = DataKey::Attestation(to.clone(), schema_id);
        let prev: u64 = match env.storage().persistent().get::<_, Attestation>(&att_key) {
            Some(att) => {
                u64::try_from(att.value).unwrap_or_else(|_| panic_with_error!(env, Error::Overflow))
            }
            None => 0,
        };
        let total = prev
            .checked_add(amount)
            .unwrap_or_else(|| panic_with_error!(env, Error::Overflow));
        let att = Attestation {
            issuer: issuer.clone(),
            value: i128::from(total),
            timestamp: ts,
            revoked: false,
        };
        env.storage().persistent().set(&att_key, &att);
        env.storage()
            .persistent()
            .extend_ttl(&att_key, BUMP_THRESHOLD, BUMP_EXTEND);

        // Canonical attestation event — the fundable primitive's stable, VERSIONED API
        // (00-strategy §4). `schema_version` is field 0 so any future B2B consumer reads the
        // version first and can evolve safely; v1 data = (issuer, schema_id, amount, ts).
        // `amount` stays this award's delta; the per-schema total is the stored record.
        const ATTESTATION_SET: Symbol = symbol_short!("att_set");
        const ATT_SCHEMA_VERSION: u32 = 1;
        env.events().publish(
            (ATTESTATION_SET, to.clone()),
            (ATT_SCHEMA_VERSION, issuer.clone(), schema_id, amount, ts),
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
