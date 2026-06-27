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

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    BytesN, Env, Symbol,
};

const BUMP_THRESHOLD: u32 = 17_280; // ~1 day (ledgers)
const BUMP_EXTEND: u32 = 2_592_000; // ~150 days — handles should be sticky

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    HandleTaken = 3,
    NoHandle = 4,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Fwd(Symbol),  // handle -> Address
    Rev(Address), // Address -> handle (one handle per address)
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
    /// handle, this RENAMES (frees the old one). Reverts if the handle is held by
    /// someone else. Idempotent if `caller` re-claims the same handle.
    pub fn claim(env: Env, caller: Address, handle: Symbol) {
        caller.require_auth();

        let fkey = DataKey::Fwd(handle.clone());
        if let Some(owner) = env.storage().persistent().get::<DataKey, Address>(&fkey) {
            if owner != caller {
                panic_with_error!(&env, Error::HandleTaken);
            }
        }

        // rename: free the caller's previous handle (if any, and different)
        let rkey = DataKey::Rev(caller.clone());
        if let Some(old) = env.storage().persistent().get::<DataKey, Symbol>(&rkey) {
            if old != handle {
                env.storage().persistent().remove(&DataKey::Fwd(old));
            }
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
        let h = env
            .storage()
            .persistent()
            .get(&DataKey::Fwd(handle.clone()));
        if h.is_some() {
            Self::bump(&env, &DataKey::Fwd(handle));
        }
        h
    }

    /// address -> handle (label addresses in the feed / leaderboard / profile).
    pub fn reverse(env: Env, addr: Address) -> Option<Symbol> {
        env.storage().persistent().get(&DataKey::Rev(addr))
    }

    /// Release the caller's own handle (frees it for re-claim).
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
            (caller, handle),
        );
    }

    /// Admin force-release a handle (squatting / abuse). Admin-gated.
    pub fn admin_release(env: Env, handle: Symbol) {
        Self::admin(&env).require_auth();
        let fkey = DataKey::Fwd(handle);
        if let Some(owner) = env.storage().persistent().get::<DataKey, Address>(&fkey) {
            env.storage().persistent().remove(&DataKey::Rev(owner));
            env.storage().persistent().remove(&fkey);
        }
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
}

#[cfg(test)]
mod test;
