#![cfg(test)]
//! Integration tests for the Rewards -> Reputation CROSS-CONTRACT read
//! (`claim_reward` gates USDC payout on `get_earned`) + the USDC SAC transfer +
//! the on-chain reward registry (caller can never dictate the payout amount).
use super::*;
use alvinmunk_reputation::{ReputationContract, ReputationContractClient};
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
fn claim_reward_reads_earned_and_pays_stored_amount() {
    let f = setup();
    let user = Address::generate(&f.env);

    // Admin registers reward #1: needs 50 Earned XP, pays 200 USDC from treasury.
    f.rewards.add_reward(&1u32, &50u64, &200i128);

    // User earns 100 Earned XP via the attester (the cashable track).
    f.rep.award_xp(&f.attester, &user, &2u32, &100u64);

    f.rewards.claim_reward(&user, &1u32);

    let token_c = token::TokenClient::new(&f.env, &f.usdc);
    assert_eq!(token_c.balance(&user), 200);
    assert_eq!(token_c.balance(&f.rewards_id), 800);
    assert!(f.rewards.is_claimed(&1u32, &user));
}

#[test]
fn get_rewards_lists_the_table() {
    let f = setup();
    f.rewards.add_reward(&1u32, &30u64, &50i128);
    f.rewards.add_reward(&2u32, &60u64, &100i128);
    f.rewards.add_reward(&1u32, &40u64, &75i128); // update — no duplicate row

    let table = f.rewards.get_rewards();
    assert_eq!(table.len(), 2);
    let first = table.get(0).unwrap();
    assert_eq!(first.id, 1);
    assert_eq!(first.threshold, 40); // reflects the update
    assert_eq!(first.amount, 75);
    assert!(first.active);
}

#[test]
#[should_panic]
fn claim_unregistered_reward_reverts() {
    let f = setup();
    let user = Address::generate(&f.env);
    f.rep.award_xp(&f.attester, &user, &2u32, &100u64);
    // No add_reward — there is no caller-supplied amount to exploit, and an unknown
    // reward id cannot be claimed. (panics: RewardNotFound)
    f.rewards.claim_reward(&user, &999u32);
}

#[test]
#[should_panic]
fn claim_inactive_reward_reverts() {
    let f = setup();
    let user = Address::generate(&f.env);
    f.rep.award_xp(&f.attester, &user, &2u32, &100u64);
    f.rewards.add_reward(&1u32, &50u64, &200i128);
    f.rewards.set_reward_active(&1u32, &false);
    f.rewards.claim_reward(&user, &1u32); // panics: RewardInactive
}

#[test]
#[should_panic]
fn claim_below_threshold_reverts() {
    let f = setup();
    let user = Address::generate(&f.env); // 0 earned
    f.rewards.add_reward(&1u32, &50u64, &200i128);
    f.rewards.claim_reward(&user, &1u32); // panics: BelowThreshold
}

#[test]
#[should_panic]
fn social_xp_does_not_unlock_treasury() {
    let f = setup();
    let alice = Address::generate(&f.env);
    let bob = Address::generate(&f.env);
    f.rewards.add_reward(&1u32, &5u64, &100i128);
    // Bob earns SOCIAL XP from a vouch (non-cashable).
    let secret = soroban_sdk::Bytes::from_array(&f.env, &[3u8; 32]);
    let hash = f.env.crypto().sha256(&secret).to_bytes();
    let id = f
        .rep
        .mint_vouch(&alice, &hash, &soroban_sdk::String::from_str(&f.env, "ty"));
    f.rep.claim_vouch(&bob, &id, &secret);
    // starter Social XP (20) + first-pair claim XP (10) = 30 — all SOCIAL, non-cashable.
    assert_eq!(f.rep.get_score(&bob), 30); // has Social XP
                                           // ...but Social XP must NOT open the treasury (keystone). threshold 5 > earned 0.
    f.rewards.claim_reward(&bob, &1u32); // panics: BelowThreshold
}

#[test]
#[should_panic]
fn double_claim_reverts() {
    let f = setup();
    let user = Address::generate(&f.env);
    f.rewards.add_reward(&1u32, &50u64, &100i128);
    f.rep.award_xp(&f.attester, &user, &2u32, &100u64);
    f.rewards.claim_reward(&user, &1u32);
    f.rewards.claim_reward(&user, &1u32); // panics: AlreadyClaimed
}

#[test]
#[should_panic]
fn daily_cap_blocks_over_limit_payout() {
    let f = setup();
    let user = Address::generate(&f.env);
    f.rewards.add_reward(&1u32, &50u64, &200i128);
    f.rewards.add_reward(&2u32, &50u64, &200i128);
    f.rewards.set_daily_cap(&250i128); // total/day
    f.rep.award_xp(&f.attester, &user, &2u32, &100u64);
    f.rewards.claim_reward(&user, &1u32); // 200 paid, within cap
    f.rewards.claim_reward(&user, &2u32); // 400 > 250 -> panics: DailyCapExceeded
}

#[test]
fn daily_cap_allows_within_limit_and_tracks_paid() {
    let f = setup();
    let user = Address::generate(&f.env);
    f.rewards.add_reward(&1u32, &50u64, &200i128);
    f.rewards.set_daily_cap(&500i128);
    f.rep.award_xp(&f.attester, &user, &2u32, &100u64);
    f.rewards.claim_reward(&user, &1u32);
    assert_eq!(f.rewards.get_daily_paid(), 200);
    assert_eq!(f.rewards.get_daily_cap(), 500);
}

#[test]
#[should_panic]
fn frozen_account_cannot_claim() {
    let f = setup();
    let user = Address::generate(&f.env);
    f.rewards.add_reward(&1u32, &50u64, &100i128);
    f.rep.award_xp(&f.attester, &user, &2u32, &100u64);
    f.rewards.set_frozen(&user, &true);
    f.rewards.claim_reward(&user, &1u32); // panics: Frozen
}

#[test]
#[should_panic]
fn frozen_account_cannot_tip() {
    let f = setup();
    let user = Address::generate(&f.env);
    let other = Address::generate(&f.env);
    f.rewards.set_frozen(&user, &true);
    f.rewards.tip(&user, &other, &10i128); // panics: Frozen
}

#[test]
#[should_panic]
fn proof_of_funding_blocks_unfunded_claim_when_enabled() {
    let f = setup();
    let user = Address::generate(&f.env);
    f.rewards.add_reward(&1u32, &50u64, &100i128);
    f.rep.award_xp(&f.attester, &user, &2u32, &100u64);
    f.rewards.set_require_funding(&true);
    f.rewards.claim_reward(&user, &1u32); // panics: NotFunded (received no external value)
}

#[test]
fn proof_of_funding_allows_funded_claim_and_is_off_by_default() {
    let f = setup();
    let user = Address::generate(&f.env);
    f.rewards.add_reward(&1u32, &50u64, &100i128);
    f.rep.award_xp(&f.attester, &user, &2u32, &100u64);
    assert!(!f.rewards.get_require_funding()); // default off (testnet demo works)

    f.rewards.set_require_funding(&true);
    f.rewards.set_funded(&user, &true); // verifier proved external value
    f.rewards.claim_reward(&user, &1u32);
    let token_c = token::TokenClient::new(&f.env, &f.usdc);
    assert_eq!(token_c.balance(&user), 100);
}

// --- Property/fuzz tests on the claim/cap math (Green-belt AC) ---
use proptest::prelude::*;

proptest! {
    #![proptest_config(ProptestConfig::with_cases(30))]

    /// Invariant: a claim pays EXACTLY the admin-registered amount and the treasury
    /// decreases by exactly that — the caller can never influence the payout, for any
    /// (threshold ≤ earned, amount). Treasury is funded with 1_000 in setup().
    #[test]
    fn claim_pays_exactly_registered_amount(
        threshold in 0u64..200, extra in 0u64..300, amount in 1i128..=1000
    ) {
        let f = setup();
        let user = Address::generate(&f.env);
        f.rewards.add_reward(&1u32, &threshold, &amount);
        f.rep.award_xp(&f.attester, &user, &2u32, &(threshold + extra));
        let tok = token::TokenClient::new(&f.env, &f.usdc);
        let before = tok.balance(&f.rewards_id);
        f.rewards.claim_reward(&user, &1u32);
        prop_assert_eq!(tok.balance(&user), amount);
        prop_assert_eq!(before - tok.balance(&f.rewards_id), amount);
    }

    /// Invariant: the daily payout cap is NEVER exceeded across an arbitrary claim
    /// sequence (the treasury circuit breaker holds under fuzzed inputs).
    #[test]
    fn daily_cap_is_never_exceeded(
        cap in 1i128..=1000, amounts in prop::collection::vec(1i128..=400, 1..6)
    ) {
        let f = setup();
        f.rewards.set_daily_cap(&cap);
        let mut paid = 0i128;
        for (i, a) in amounts.iter().enumerate() {
            let id = (i as u32) + 1;
            f.rewards.add_reward(&id, &0u64, a);
            let user = Address::generate(&f.env);
            if f.rewards.try_claim_reward(&user, &id).is_ok() {
                paid += *a;
            }
            prop_assert!(paid <= cap);
        }
    }
}
