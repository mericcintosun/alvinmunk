#![no_std]
//! Registry — on-chain username/handle ↔ address mapping for Stellar Passport.
//!
//! Identity is its own primitive (decoupled from `reputation`, which other apps read
//! separately). Permissionless first-come `claim`, reverse lookup, rename, and release.
//! Handles are normalized/validated OFF-CHAIN (lowercase, `[a-z0-9_]`, 3–20 chars); the
//! contract only enforces UNIQUENESS. A `Symbol` is the cheap interned key for a handle.
//!
//! Why on-chain: it turns `/u/<handle>` into a public, shareable profile for ANY wallet
//! (the off-chain/local handle could only resolve for the logged-in user) — the
//! multiplier on every shared link.
//!
//! A handle holder can also publish a profile face and a short bio (`set_meta`), keyed by
//! ADDRESS, so a freed handle never carries its previous owner's profile to the next one.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    BytesN, Env, String, Symbol, Vec,
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

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    HandleTaken = 3,
    NoHandle = 4,
    BioTooLong = 5,
    BadBio = 6,
    BadAvatar = 7,
    TooMany = 8,
    SelfInvite = 9,
    AlreadyInvited = 10,
}

/// Bio limit in UTF-8 BYTES (what `String::len` counts), not characters: 80 ASCII
/// characters, fewer when they are multi-byte.
const BIO_MAX_BYTES: u32 = 80;

/// Most addresses `reverse_many` takes in one call. Each is one persistent read, so a call's
/// footprint is up to this many `Rev` keys plus the instance and code: far inside the
/// per-transaction limits (testnet and mainnet, checked 2026-09-29: 400 footprint entries,
/// 200 disk reads), even when every entry is archived and read from disk. Mirrored in
/// apps/web/src/lib/registry.ts and scripts/list-handles.mjs, which chunk longer lists.
const REVERSE_MANY_CAP: u32 = 50;

// Avatar packing — one byte per field, so the u64 reads as hex. Mirrors `encodeAvatar` in
// apps/web/src/lib/avatar.ts; the counts are the portrait assets the app ships (`FACE_IDS`,
// `KIT_COUNTS`) and must move with them. Every other byte is zero.
//   byte 7: kind — 0 = face, 1 = kit
//   face:   byte 0 = face number, 1..=FACE_COUNT
//   kit:    bytes 5..0 = skin, hair, eyes, mouth, acc, bg — 1-based indexes into each
//           kit folder; acc and bg may be 0 (none)
const AVATAR_FACE: u64 = 0;
const AVATAR_KIT: u64 = 1;
const FACE_COUNT: u64 = 5;
const KIT_SKIN: u64 = 6;
const KIT_HAIR: u64 = 10;
const KIT_EYES: u64 = 10;
const KIT_MOUTH: u64 = 9;
const KIT_ACC: u64 = 13;
const KIT_BG: u64 = 5;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Fwd(Symbol),        // handle -> Address
    Rev(Address),       // Address -> handle (one handle per address)
    Meta(Address),      // Address -> ProfileMeta (only while the address holds a handle)
    InvitedBy(Address), // Address -> who invited them (one-shot, never rewritten)
}

/// A handle holder's public profile. `avatar` is the packed face (layout above); `bio` is
/// plain text, at most `BIO_MAX_BYTES` bytes of UTF-8 with no control characters.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProfileMeta {
    pub avatar: u64,
    pub bio: String,
}

#[contract]
pub struct RegistryContract;

#[contractimpl]
impl RegistryContract {
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    /// Admin-gated WASM upgrade — same contract instance + storage, new code. Lets us
    /// iterate/season without a new address or state migration (mainnet de-risk).
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        Self::admin(&env).require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    /// Claim `handle` for `caller` (first-come). If `caller` already holds a different
    /// handle, this RENAMES: the old one is freed and `released` is published for it
    /// before `claimed`. Reverts if the handle is held by someone else. Re-claiming the
    /// handle `caller` already holds is a no-op (no writes, no event; TTLs are refreshed).
    /// Profile meta is keyed by address, so a rename keeps it.
    pub fn claim(env: Env, caller: Address, handle: Symbol) {
        caller.require_auth();

        let fkey = DataKey::Fwd(handle.clone());
        if let Some(owner) = env.storage().persistent().get::<DataKey, Address>(&fkey) {
            if owner != caller {
                panic_with_error!(&env, Error::HandleTaken);
            }
        }

        let rkey = DataKey::Rev(caller.clone());
        if let Some(old) = env.storage().persistent().get::<DataKey, Symbol>(&rkey) {
            if old == handle {
                // already held: nothing changed, so nothing to write or announce
                Self::bump(&env, &fkey);
                Self::bump(&env, &rkey);
                return;
            }
            // rename: free the previous handle and announce it, so handle-keyed
            // indexers drop `old -> caller` before someone else takes `old`
            env.storage()
                .persistent()
                .remove(&DataKey::Fwd(old.clone()));
            env.events().publish(
                (symbol_short!("handle"), symbol_short!("released")),
                (caller.clone(), old),
            );
        }

        env.storage().persistent().set(&fkey, &caller);
        env.storage().persistent().set(&rkey, &handle);
        Self::bump(&env, &fkey);
        Self::bump(&env, &rkey);

        env.events().publish(
            (symbol_short!("handle"), symbol_short!("claimed")),
            (caller, handle),
        );
    }

    /// handle -> address (the public `/u/<handle>` lookup; pure read, any caller).
    pub fn resolve(env: Env, handle: Symbol) -> Option<Address> {
        env.storage().persistent().get(&DataKey::Fwd(handle))
    }

    /// address -> handle (label addresses in the feed / leaderboard / profile).
    pub fn reverse(env: Env, addr: Address) -> Option<Symbol> {
        env.storage().persistent().get(&DataKey::Rev(addr))
    }

    /// Batched `reverse`: one handle per address, in input order, `None` where an address
    /// holds none (duplicates repeat). Lets a list view label N rows in one read. Pure read,
    /// any caller, no TTL bumps; reverts with `TooMany` past `REVERSE_MANY_CAP` addresses.
    pub fn reverse_many(env: Env, addrs: Vec<Address>) -> Vec<Option<Symbol>> {
        if addrs.len() > REVERSE_MANY_CAP {
            panic_with_error!(&env, Error::TooMany);
        }
        let mut out = Vec::new(&env);
        for addr in addrs.iter() {
            out.push_back(env.storage().persistent().get(&DataKey::Rev(addr)));
        }
        out
    }

    /// Release the caller's own handle (frees it for re-claim) and drop its profile meta.
    pub fn release(env: Env, caller: Address) {
        caller.require_auth();
        let rkey = DataKey::Rev(caller.clone());
        let handle: Symbol = env
            .storage()
            .persistent()
            .get(&rkey)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NoHandle));
        env.storage()
            .persistent()
            .remove(&DataKey::Fwd(handle.clone()));
        env.storage().persistent().remove(&rkey);
        env.events().publish(
            (symbol_short!("handle"), symbol_short!("released")),
            (caller.clone(), handle),
        );
        Self::clear_meta(&env, caller);
    }

    /// Admin force-release a handle (squatting / abuse), dropping the holder's profile
    /// meta with it. Admin-gated.
    pub fn admin_release(env: Env, handle: Symbol) {
        Self::admin(&env).require_auth();
        let fkey = DataKey::Fwd(handle);
        if let Some(owner) = env.storage().persistent().get::<DataKey, Address>(&fkey) {
            env.storage()
                .persistent()
                .remove(&DataKey::Rev(owner.clone()));
            env.storage().persistent().remove(&fkey);
            Self::clear_meta(&env, owner);
        }
    }

    /// Publish `caller`'s profile face and bio, replacing any earlier ones. `caller` must
    /// hold a handle. Reverts with `BadAvatar` unless `avatar` is a valid packing (layout
    /// above), `BioTooLong` past `BIO_MAX_BYTES` bytes, and `BadBio` unless `bio` is UTF-8
    /// without control characters (so it renders as one plain line). An empty bio is fine.
    /// Refreshes the handle's TTLs too, so a profile and its handle age together.
    pub fn set_meta(env: Env, caller: Address, avatar: u64, bio: String) {
        caller.require_auth();

        let rkey = DataKey::Rev(caller.clone());
        let handle: Symbol = env
            .storage()
            .persistent()
            .get(&rkey)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NoHandle));
        if !avatar_ok(avatar) {
            panic_with_error!(&env, Error::BadAvatar);
        }
        check_bio(&env, &bio);

        let mkey = DataKey::Meta(caller.clone());
        env.storage().persistent().set(
            &mkey,
            &ProfileMeta {
                avatar,
                bio: bio.clone(),
            },
        );
        Self::bump(&env, &mkey);
        Self::bump(&env, &rkey);
        Self::bump(&env, &DataKey::Fwd(handle));

        env.events().publish(
            (symbol_short!("meta"), symbol_short!("set")),
            (caller, avatar, bio),
        );
    }

    /// address -> published profile, `None` if it never set one or no longer holds a
    /// handle (pure read, any caller).
    pub fn get_meta(env: Env, addr: Address) -> Option<ProfileMeta> {
        env.storage().persistent().get(&DataKey::Meta(addr))
    }

    /// Bind, once and forever, that `caller` was invited by `inviter` — the recruiting link
    /// `/v/<handle>` finally lands on-chain. `caller` signs; `inviter` must hold a handle
    /// (`NoHandle`), `caller` cannot invite themself (`SelfInvite`), and an already-bound
    /// wallet reverts (`AlreadyInvited`): one inviter per invitee, set by the invitee only,
    /// so the invite graph can't be rewritten or forged. The invitee needs no handle of
    /// their own (a passkey smart wallet C… binds fine), and the binding survives renames
    /// and releases — it records what happened, not who currently holds which name.
    pub fn set_inviter(env: Env, caller: Address, inviter: Address) {
        caller.require_auth();
        if caller == inviter {
            panic_with_error!(&env, Error::SelfInvite);
        }
        let ikey = DataKey::InvitedBy(caller.clone());
        if env.storage().persistent().has(&ikey) {
            panic_with_error!(&env, Error::AlreadyInvited);
        }
        if !env
            .storage()
            .persistent()
            .has(&DataKey::Rev(inviter.clone()))
        {
            panic_with_error!(&env, Error::NoHandle);
        }
        env.storage().persistent().set(&ikey, &inviter);
        Self::bump(&env, &ikey);

        env.events().publish(
            (symbol_short!("invite"), symbol_short!("bound")),
            (caller, inviter),
        );
    }

    /// Who invited `addr` (the one-shot binding above), `None` while unbound. Pure read,
    /// any caller.
    pub fn invited_by(env: Env, addr: Address) -> Option<Address> {
        env.storage().persistent().get(&DataKey::InvitedBy(addr))
    }

    // --- internal ---

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

    /// Drop `addr`'s profile when it gives up its handle, announcing it if there was one.
    fn clear_meta(env: &Env, addr: Address) {
        let mkey = DataKey::Meta(addr.clone());
        if env.storage().persistent().has(&mkey) {
            env.storage().persistent().remove(&mkey);
            env.events()
                .publish((symbol_short!("meta"), symbol_short!("cleared")), addr);
        }
    }
}

/// Is `v` a face or kit packing whose indexes are all in range (layout above)?
fn avatar_ok(v: u64) -> bool {
    let byte = |i: u32| (v >> (8 * i)) & 0xff;
    match v >> 56 {
        AVATAR_FACE => v >> 8 == 0 && (1..=FACE_COUNT).contains(&byte(0)),
        AVATAR_KIT => {
            byte(6) == 0
                && (1..=KIT_SKIN).contains(&byte(5))
                && (1..=KIT_HAIR).contains(&byte(4))
                && (1..=KIT_EYES).contains(&byte(3))
                && (1..=KIT_MOUTH).contains(&byte(2))
                && byte(1) <= KIT_ACC
                && byte(0) <= KIT_BG
        }
        _ => false,
    }
}

/// Revert unless `bio` fits `BIO_MAX_BYTES` and is one line of plain UTF-8 text: no
/// control characters (C0, DEL, C1), line/paragraph separators, or bidi embedding,
/// override and isolate marks (which can reorder the text displayed around a bio).
fn check_bio(env: &Env, bio: &String) {
    let len = bio.len();
    if len > BIO_MAX_BYTES {
        panic_with_error!(env, Error::BioTooLong);
    }
    let mut buf = [0u8; BIO_MAX_BYTES as usize];
    let bytes = &mut buf[..len as usize];
    bio.copy_into_slice(bytes);
    let text =
        core::str::from_utf8(bytes).unwrap_or_else(|_| panic_with_error!(env, Error::BadBio));
    let banned = |c: char| {
        c.is_control()
            || matches!(c, '\u{2028}' | '\u{2029}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
    };
    if text.chars().any(banned) {
        panic_with_error!(env, Error::BadBio);
    }
}

#[cfg(test)]
mod test;
