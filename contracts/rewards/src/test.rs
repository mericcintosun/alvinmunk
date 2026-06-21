#![cfg(test)]
//! Integration tests for the Rewards -> Reputation CROSS-CONTRACT read
//! (`claim_reward` gates USDC payout on `get_earned`) + the USDC SAC transfer.
use super::*;
use passport_reputation::{ReputationContract, ReputationContractClient};
use soroban_sdk::{testutils::Address as _, token, Env};

struct Fixture<'a> {
    env: Env,
    rep: ReputationContractClient<'a>,
    rewards: RewardsContractClient<'a>,
    usdc: Address,
    rewards_id: Address,
    attester: Address,
}

fn setup() -> Fixture<'static> {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let attester = Address::generate(&env);

    let rep_id = env.register(ReputationContract, ());
    let rep = ReputationContractClient::new(&env, &rep_id);
    rep.init(&admin);
    rep.add_attester(&attester);

    // USDC Stellar Asset Contract (test SAC).
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let usdc = sac.address();

    let rewards_id = env.register(RewardsContract, ());
    let rewards = RewardsContractClient::new(&env, &rewards_id);
    rewards.init(&admin, &usdc, &rep_id);

    // Fund the rewards treasury with USDC.
    token::StellarAssetClient::new(&env, &usdc).mint(&rewards_id, &1_000);

    Fixture {
        env,
        rep,
        rewards,
        usdc,
        rewards_id,
        attester,
    }
}

#[test]
fn claim_reward_reads_earned_and_pays_usdc() {
    let f = setup();
    let user = Address::generate(&f.env);

    // User earns 100 Earned XP via the attester (the cashable track).
    f.rep.award_xp(&f.attester, &user, &2u32, &100u64);

    // threshold 50 <= 100 earned -> pays 200 USDC from treasury.
    f.rewards.claim_reward(&user, &1u32, &50u64, &200i128);

    let token_c = token::TokenClient::new(&f.env, &f.usdc);
    assert_eq!(token_c.balance(&user), 200);
    assert_eq!(token_c.balance(&f.rewards_id), 800);
}

#[test]
#[should_panic]
fn claim_below_threshold_reverts() {
    let f = setup();
    let user = Address::generate(&f.env); // 0 earned
    f.rewards.claim_reward(&user, &1u32, &50u64, &200i128); // panics: BelowThreshold
}

#[test]
#[should_panic]
fn social_xp_does_not_unlock_treasury() {
    let f = setup();
    let alice = Address::generate(&f.env);
    let bob = Address::generate(&f.env);
    // Bob earns SOCIAL XP from a vouch (non-cashable).
    let secret = soroban_sdk::Bytes::from_array(&f.env, &[3u8; 32]);
    let hash = f.env.crypto().sha256(&secret).to_bytes();
    let id = f
        .rep
        .mint_vouch(&alice, &hash, &soroban_sdk::String::from_str(&f.env, "ty"));
    f.rep.claim_vouch(&bob, &id, &secret);
    assert_eq!(f.rep.get_score(&bob), 10); // has Social XP
                                           // ...but Social XP must NOT open the treasury (keystone). threshold 5 > earned 0.
    f.rewards.claim_reward(&bob, &1u32, &5u64, &100i128); // panics: BelowThreshold
}

#[test]
#[should_panic]
fn double_claim_reverts() {
    let f = setup();
    let user = Address::generate(&f.env);
    f.rep.award_xp(&f.attester, &user, &2u32, &100u64);
    f.rewards.claim_reward(&user, &1u32, &50u64, &100i128);
    f.rewards.claim_reward(&user, &1u32, &50u64, &100i128); // panics: AlreadyClaimed
}
