#![no_std]
//! QuestRegistry — verifiable quests with allowlisted attesters + replay guard.
//!
//! `award_quest` is the oracle bridge (00-strategy §4): an off-chain attester
//! verifies a real action (merged GitHub PR, referral wallet did a real tx),
//! then calls here. We check the allowlist + replay set, then cross-call
//! Reputation.award_xp. NO decentralized oracle.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    Env, IntoVal, Symbol,
};

const BUMP_THRESHOLD: u32 = 17_280;
const BUMP_EXTEND: u32 = 518_400;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    NotAuthorized = 3,
    QuestNotFound = 4,
    AlreadyClaimed = 5,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Reputation,            // Address of the Reputation contract
    Attester(Address),     // allowlist flag
    Quest(u32),            // QuestConfig
    Claimed(u32, Address), // replay guard: (quest_id, recipient) -> bool
}

#[contracttype]
#[derive(Clone)]
pub struct QuestConfig {
    pub id: u32,
    pub schema_id: u32, // forwarded to Reputation as the attestation schema
    pub xp: u64,
    pub active: bool,
}

#[contract]
pub struct QuestRegistryContract;

#[contractimpl]
impl QuestRegistryContract {
    pub fn init(env: Env, admin: Address, reputation: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::Reputation, &reputation);
    }

    pub fn add_attester(env: Env, attester: Address) {
        Self::admin(&env).require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::Attester(attester), &true);
    }

    pub fn remove_attester(env: Env, attester: Address) {
        Self::admin(&env).require_auth();
        env.storage()
            .persistent()
            .remove(&DataKey::Attester(attester));
    }

    pub fn create_quest(env: Env, id: u32, schema_id: u32, xp: u64) {
        Self::admin(&env).require_auth();
        let q = QuestConfig {
            id,
            schema_id,
            xp,
            active: true,
        };
        env.storage().persistent().set(&DataKey::Quest(id), &q);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Quest(id), BUMP_THRESHOLD, BUMP_EXTEND);
        env.events()
            .publish((symbol_short!("quest"), symbol_short!("created")), id);
    }

    /// Allowlisted attester awards a verified quest to `recipient`. Replay-guarded.
    pub fn award_quest(env: Env, attester: Address, quest_id: u32, recipient: Address) {
        attester.require_auth();
        if !Self::is_attester(&env, &attester) {
            panic_with_error!(&env, Error::NotAuthorized);
        }

        let quest: QuestConfig = env
            .storage()
            .persistent()
            .get(&DataKey::Quest(quest_id))
            .unwrap_or_else(|| panic_with_error!(&env, Error::QuestNotFound));

        // Replay guard: check-and-set atomically.
        let claim_key = DataKey::Claimed(quest_id, recipient.clone());
        if env.storage().persistent().get(&claim_key).unwrap_or(false) {
            panic_with_error!(&env, Error::AlreadyClaimed);
        }
        env.storage().persistent().set(&claim_key, &true);
        env.storage()
            .persistent()
            .extend_ttl(&claim_key, BUMP_THRESHOLD, BUMP_EXTEND);

        // Cross-contract call -> Reputation.award_xp. This contract must itself be an
        // allowlisted attester in Reputation (set Reputation.add_attester(this_addr)).
        let reputation: Address = env.storage().instance().get(&DataKey::Reputation).unwrap();
        let func: Symbol = symbol_short!("award_xp");
        let args = soroban_sdk::vec![
            &env,
            env.current_contract_address().into_val(&env),
            recipient.into_val(&env),
            quest.schema_id.into_val(&env),
            quest.xp.into_val(&env),
        ];
        env.invoke_contract::<()>(&reputation, &func, args);

        env.events().publish(
            (symbol_short!("quest"), symbol_short!("awarded")),
            (quest_id, recipient),
        );
    }

    // private helper (refs) — NOT a contract export, so `&Env`/`&Address` are fine.
    fn is_attester(env: &Env, who: &Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Attester(who.clone()))
            .unwrap_or(false)
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
