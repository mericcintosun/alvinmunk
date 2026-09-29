#![cfg(test)]
//! Integration tests for the Rewards -> Reputation CROSS-CONTRACT read
//! (`claim_reward` gates USDC payout on `get_earned`) + the USDC SAC transfer +
//! the on-chain reward registry (caller can never dictate the payout amount), the
//! Rewards -> QuestRegistry `get_streak` read behind streak-gated rewards, and the
//! `tip` shape checks that keep every `tipped` event moving value (#144).
extern crate std;
use super::*;
use alvinmunk_quest_registry::{QuestRegistryContract, QuestRegistryContractClient};
use alvinmunk_reputation::{ReputationContract, ReputationContractClient};
use ed25519_dalek::{Signer, SigningKey};
use soroban_sdk::{
    testutils::{
        storage::{Persistent as _, Temporary as _},
        Address as _, Events as _, Ledger as _,
    },
    token, Env, FromVal, IntoVal, TryFromVal,
};

struct Fixture<'a> {
    env: Env,
    rep: ReputationContractClient<'a>,
    rewards: RewardsContractClient<'a>,
    quest: QuestRegistryContractClient<'a>,
    quest_id: Address,
    usdc: Address,
    rewards_id: Address,
    attester: Address,
    attester_sk: SigningKey,
    attester_pub: BytesN<32>,
}

fn signing_key(seed: u8) -> SigningKey {
    SigningKey::from_bytes(&[seed; 32])
}

fn setup() -> Fixture<'static> {
    setup_in(Env::default())
}

fn setup_in(env: Env) -> Fixture<'static> {
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let attester = Address::generate(&env);
    let attester_sk = signing_key(7);
    let attester_pub = BytesN::from_array(&env, &attester_sk.verifying_key().to_bytes());

    let rep_id = env.register(ReputationContract, ());
    let rep = ReputationContractClient::new(&env, &rep_id);
    rep.init(&admin);
    rep.add_attester(&attester);

    let quest_id = env.register(QuestRegistryContract, ());
    let quest = QuestRegistryContractClient::new(&env, &quest_id);
    quest.init(&admin, &rep_id);
    quest.add_attester_key(&attester_pub);
    rep.add_attester(&quest_id);

    // USDC Stellar Asset Contract (test SAC).
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let usdc = sac.address();

    let rewards_id = env.register(RewardsContract, ());
    let rewards = RewardsContractClient::new(&env, &rewards_id);
    // Not wired to the QuestRegistry: like a deployed contract upgraded before
    // `set_quest_registry` runs. Streak tests wire it with `streak_setup()`.
    rewards.init(&admin, &usdc, &rep_id);

    // Fund the rewards treasury with USDC.
    token::StellarAssetClient::new(&env, &usdc).mint(&rewards_id, &1_000);

    Fixture {
        env,
        rep,
        rewards,
        quest,
        quest_id,
        usdc,
        rewards_id,
        attester,
        attester_sk,
        attester_pub,
    }
}

/// Award `quest_id` the way the off-chain attester does: an ed25519 signature over the
/// QuestRegistry's payload, valid for 10 minutes. Advances the recipient's weekly streak.
fn award_quest(f: &Fixture, quest_id: u32, recipient: &Address) {
    let expires_at = f.env.ledger().timestamp() + 600;
    let payload = f.quest.quest_payload(&quest_id, recipient, &expires_at);
    let msg: std::vec::Vec<u8> = payload.iter().collect();
    let sig = BytesN::from_array(&f.env, &f.attester_sk.sign(&msg).to_bytes());
    f.quest
        .award_quest(&f.attester_pub, &sig, &quest_id, recipient, &expires_at);
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
        threshold in 1u64..200, extra in 0u64..300, amount in 1i128..=1000
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
            let a = (*a).min(cap); // an amount above the cap is now rejected at registration
            f.rewards.add_reward(&id, &1u64, &a);
            let user = Address::generate(&f.env);
            f.rep.award_xp(&f.attester, &user, &2u32, &1u64); // clear the threshold
            if f.rewards.try_claim_reward(&user, &id).is_ok() {
                paid += a;
            }
            prop_assert!(paid <= cap);
        }
    }

    /// Invariant (#145): `set_daily_cap` accepts exactly the caps >= 0, and the view then
    /// reads back what was accepted; a rejected cap leaves the previous one in place.
    #[test]
    fn set_daily_cap_accepts_only_non_negative_caps(cap in any::<i128>()) {
        let f = setup();
        f.rewards.set_daily_cap(&7i128);
        let res = f.rewards.try_set_daily_cap(&cap);
        if cap < 0 {
            prop_assert_eq!(res, Err(Ok(contract_err(Error::InvalidAmount))));
            prop_assert_eq!(f.rewards.get_daily_cap(), 7);
        } else {
            prop_assert_eq!(res, Ok(Ok(())));
            prop_assert_eq!(f.rewards.get_daily_cap(), cap);
        }
    }

    /// Invariant (#146): `add_reward` only accepts rows that can pay out. It refuses a zero
    /// threshold and, while a cap is set, an amount above it; anything it accepts pays its
    /// stored amount to a wallet that clears the threshold.
    #[test]
    fn every_accepted_reward_can_pay_out(
        cap in prop_oneof![Just(0i128), 1i128..=1000],
        threshold in 0u64..20,
        amount in 1i128..=1000
    ) {
        let f = setup();
        f.rewards.set_daily_cap(&cap);
        let res = f.rewards.try_add_reward(&1u32, &threshold, &amount);
        if threshold == 0 {
            prop_assert_eq!(res, Err(Ok(contract_err(Error::InvalidThreshold))));
        } else if cap > 0 && amount > cap {
            prop_assert_eq!(res, Err(Ok(contract_err(Error::AmountExceedsCap))));
        } else {
            prop_assert_eq!(res, Ok(Ok(())));
            let user = earner(&f, threshold);
            f.rewards.claim_reward(&user, &1u32);
            prop_assert_eq!(token::TokenClient::new(&f.env, &f.usdc).balance(&user), amount);
        }
    }

    /// Invariant (#157): `get_rewards_for` predicts `claim_reward`. For any combination of
    /// the gates, the claim reverts with exactly the view's `reason`, or pays out when the
    /// view calls the row eligible.
    #[test]
    fn get_rewards_for_agrees_with_claim_reward(
        paused in any::<bool>(),
        frozen in any::<bool>(),
        funding in 0u8..3, // 0 = not required, 1 = required + unfunded, 2 = required + funded
        active in any::<bool>(),
        pre_claimed in any::<bool>(),
        exhausted in any::<bool>(),
        xp_short in any::<bool>(),
        cap_tight in any::<bool>(),
    ) {
        let f = setup();
        f.rewards.add_reward(&1u32, &30u64, &50i128);
        let user = earner(&f, if xp_short { 29 } else { 30 });
        let claimed = pre_claimed && !xp_short;
        let mut claims = 0u32;
        if claimed {
            f.rewards.claim_reward(&user, &1u32);
            claims += 1;
        }
        if exhausted {
            let other = earner(&f, 30);
            f.rewards.claim_reward(&other, &1u32);
            f.rewards.set_reward_supply(&1u32, &(claims + 1));
        }
        if cap_tight {
            f.rewards.add_reward(&2u32, &1u64, &50i128);
            let filler = earner(&f, 1);
            f.rewards.claim_reward(&filler, &2u32);
            f.rewards.set_daily_cap(&(f.rewards.get_daily_paid() + 10));
        }
        if !active {
            f.rewards.set_reward_active(&1u32, &false);
        }
        if funding > 0 {
            f.rewards.set_require_funding(&true);
            f.rewards.set_funded(&user, &(funding == 2));
        }
        f.rewards.set_frozen(&user, &frozen);
        f.rewards.set_paused(&paused);

        let s = status_of(&f, &user, 1);
        prop_assert_eq!(s.claimed, claimed);
        prop_assert_eq!(s.eligible, s.reason == 0);
        let res = f.rewards.try_claim_reward(&user, &1u32);
        if s.reason == 0 {
            prop_assert_eq!(res, Ok(Ok(())));
        } else {
            prop_assert_eq!(res, Err(Ok(soroban_sdk::Error::from_contract_error(s.reason))));
        }
    }

    /// Invariant (#144): `tip` moves value or it fails. For ANY amount and any
    /// sender/receiver pair it is accepted exactly when `amount > 0` and the two wallets
    /// differ, and on success the receiver is credited exactly `amount` — so every
    /// `tipped` event is proof that a real spend was received, never a zero-amount or
    /// self-minted one. `from` is funded with 1_000, so an amount above that fails in the
    /// SAC (the pre-existing insufficient-balance path), not in the new checks.
    #[test]
    fn tip_only_moves_value(amount in any::<i128>(), same_wallet in any::<bool>()) {
        let f = setup();
        let from = Address::generate(&f.env);
        let to = Address::generate(&f.env);
        fund(&f, &from, 1_000);
        let other = if same_wallet { from.clone() } else { to.clone() };

        let res = f.rewards.try_tip(&from, &other, &amount);
        let refused = res.is_err();
        // Read the events NOW: the balance reads in the success branch would clear them.
        let events = tipped(&f);
        if amount <= 0 {
            prop_assert_eq!(res, Err(Ok(contract_err(Error::InvalidAmount))));
        } else if same_wallet {
            prop_assert_eq!(res, Err(Ok(contract_err(Error::SelfTip))));
        } else if amount > 1_000 {
            prop_assert!(res.is_err()); // the SAC's insufficient balance
        } else {
            prop_assert_eq!(res, Ok(Ok(())));
            let tok = token::TokenClient::new(&f.env, &f.usdc);
            prop_assert_eq!(tok.balance(&to), amount);
            prop_assert_eq!(tok.balance(&from), 1_000 - amount);
            prop_assert_eq!(events.len(), 1);
        }
        if refused {
            prop_assert!(events.is_empty()); // a refused tip never mints the event
        }
    }
}

/// Release build of this contract, committed so the upgrade path can be tested without a
/// wasm build step in CI. Refresh with `make upgrade-fixtures` after changing the contract.
const REWARDS_WASM: &[u8] = include_bytes!("../testdata/alvinmunk_rewards.wasm");

#[test]
fn upgrade_to_identical_wasm_preserves_reward_table_and_treasury() {
    let f = setup();
    f.rewards.add_reward(&1u32, &30u64, &50i128);
    f.rewards.add_reward(&2u32, &30u64, &50i128);
    f.rewards.set_quest_registry(&f.quest_id);
    f.rewards.set_reward_min_streak(&2u32, &2u32);

    let hash = f.env.deployer().upload_contract_wasm(REWARDS_WASM);
    f.rewards.upgrade(&hash);

    let r = f.rewards.get_reward(&1u32).unwrap();
    assert_eq!((r.threshold, r.amount, r.active), (30, 50, true));
    assert_eq!(f.rewards.get_quest_registry(), Some(f.quest_id.clone()));
    assert_eq!(f.rewards.get_reward_min_streak(&2u32), 2);

    // The upgraded contract still pays the stored amount from the same treasury.
    let user = Address::generate(&f.env);
    f.rep.award_xp(&f.attester, &user, &2u32, &30u64);
    f.rewards.claim_reward(&user, &1u32);
    let token_c = token::TokenClient::new(&f.env, &f.usdc);
    assert_eq!(token_c.balance(&user), 50);
    assert_eq!(token_c.balance(&f.rewards_id), 950);
    let (rows, remaining) = f.rewards.get_rewards_for(&user);
    assert_eq!((rows.len(), remaining), (2, -1));
    assert!(rows.get(0).unwrap().claimed);
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn non_admin_upgrade_reverts() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let usdc = Address::generate(&env);
    let rep = Address::generate(&env);
    let id = env.register(RewardsContract, ());
    let client = RewardsContractClient::new(&env, &id);
    client.init(&admin, &usdc, &rep);
    let hash = soroban_sdk::BytesN::from_array(&env, &[1; 32]);
    client.upgrade(&hash);
}

/// The host error a `panic_with_error!(Error::X)` surfaces as through a `try_` call.
fn contract_err(e: Error) -> soroban_sdk::Error {
    soroban_sdk::Error::from_contract_error(e as u32)
}

/// A wallet with enough Earned XP to clear `threshold`.
fn earner(f: &Fixture, xp: u64) -> Address {
    let user = Address::generate(&f.env);
    f.rep.award_xp(&f.attester, &user, &2u32, &xp);
    user
}

#[test]
fn capped_reward_pays_the_last_claim_and_rejects_the_next() {
    let f = setup();
    f.rewards.add_reward(&1u32, &30u64, &50i128);
    f.rewards.set_reward_supply(&1u32, &2u32);

    let (a, b, c) = (earner(&f, 30), earner(&f, 30), earner(&f, 30));
    f.rewards.claim_reward(&a, &1u32);
    f.rewards.claim_reward(&b, &1u32); // the last one the pool pays

    let stats = f.rewards.get_reward_stats(&1u32);
    assert_eq!((stats.max_claims, stats.claims), (2, 2));
    assert_eq!(
        f.rewards.try_claim_reward(&c, &1u32),
        Err(Ok(contract_err(Error::RewardExhausted)))
    );
    let token_c = token::TokenClient::new(&f.env, &f.usdc);
    assert_eq!(token_c.balance(&c), 0);
    assert_eq!(token_c.balance(&f.rewards_id), 900);
}

#[test]
fn uncapped_reward_counts_claims_without_a_limit() {
    let f = setup();
    f.rewards.add_reward(&1u32, &30u64, &10i128);
    for _ in 0..5 {
        let u = earner(&f, 30);
        f.rewards.claim_reward(&u, &1u32);
    }
    let stats = f.rewards.get_reward_stats(&1u32);
    assert_eq!((stats.max_claims, stats.claims), (0, 5));
}

#[test]
fn get_rewards_reports_supply_and_claims() {
    let f = setup();
    f.rewards.add_reward(&1u32, &30u64, &50i128);
    f.rewards.add_reward(&2u32, &60u64, &100i128);
    f.rewards.set_reward_supply(&1u32, &3u32);
    let u = earner(&f, 30);
    f.rewards.claim_reward(&u, &1u32);

    let rows = f.rewards.get_rewards();
    let r1 = rows.get(0).unwrap();
    assert_eq!((r1.id, r1.max_claims, r1.claims), (1, 3, 1));
    let r2 = rows.get(1).unwrap();
    assert_eq!((r2.id, r2.max_claims, r2.claims), (2, 0, 0));
}

#[test]
fn supply_cannot_drop_below_claims_already_paid() {
    let f = setup();
    f.rewards.add_reward(&1u32, &30u64, &50i128);
    for _ in 0..2 {
        let u = earner(&f, 30);
        f.rewards.claim_reward(&u, &1u32);
    }
    assert_eq!(
        f.rewards.try_set_reward_supply(&1u32, &1u32),
        Err(Ok(contract_err(Error::InvalidSupply)))
    );
    // Capping at exactly the paid count closes the pool; 0 reopens it.
    f.rewards.set_reward_supply(&1u32, &2u32);
    let late = earner(&f, 30);
    assert_eq!(
        f.rewards.try_claim_reward(&late, &1u32),
        Err(Ok(contract_err(Error::RewardExhausted)))
    );
    f.rewards.set_reward_supply(&1u32, &0u32);
    f.rewards.claim_reward(&late, &1u32);
    assert_eq!(f.rewards.get_reward_stats(&1u32).claims, 3);
}

#[test]
fn supply_for_an_unknown_reward_reverts() {
    let f = setup();
    assert_eq!(
        f.rewards.try_set_reward_supply(&9u32, &5u32),
        Err(Ok(contract_err(Error::RewardNotFound)))
    );
}

// --- Streak-gated rewards (#294): Rewards -> QuestRegistry `get_streak` ---

const WEEK: u64 = 604_800;

/// `setup()` with the rewards contract wired to the QuestRegistry and quests 1-4 (10 XP
/// each), so a wallet's streak comes from real `award_quest` calls.
fn streak_setup() -> Fixture<'static> {
    let f = setup();
    f.rewards.set_quest_registry(&f.quest_id);
    for id in 1..=4u32 {
        f.quest.create_quest(&id, &2u32, &10u64);
    }
    f
}

fn at_week(f: &Fixture, week: u64) {
    f.env.ledger().with_mut(|l| l.timestamp = week * WEEK);
}

/// A wallet that completes one quest in each of `weeks` (quest ids 1.. in order).
fn streaker(f: &Fixture, weeks: &[u64]) -> Address {
    let user = Address::generate(&f.env);
    for (i, w) in weeks.iter().enumerate() {
        at_week(f, *w);
        award_quest(f, i as u32 + 1, &user);
    }
    user
}

#[test]
fn streak_gated_reward_pays_a_live_streak_at_the_minimum() {
    let f = streak_setup();
    f.rewards.add_reward(&1u32, &20u64, &200i128);
    f.rewards.set_reward_min_streak(&1u32, &2u32);
    let user = streaker(&f, &[0, 1]); // 20 Earned XP, 2-week streak

    // Week 2, nothing completed yet this week: the run is still live.
    at_week(&f, 2);
    assert_eq!(f.quest.get_streak(&user).weeks, 2);
    f.rewards.claim_reward(&user, &1u32);

    let token_c = token::TokenClient::new(&f.env, &f.usdc);
    assert_eq!(token_c.balance(&user), 200);
    assert!(f.rewards.is_claimed(&1u32, &user));
}

#[test]
fn streak_gated_reward_rejects_a_streak_below_the_minimum() {
    let f = streak_setup();
    f.rewards.add_reward(&1u32, &20u64, &200i128);
    f.rewards.set_reward_min_streak(&1u32, &3u32);
    let user = streaker(&f, &[0, 1]); // clears the XP threshold, streak 2 < 3

    assert_eq!(
        f.rewards.try_claim_reward(&user, &1u32),
        Err(Ok(contract_err(Error::StreakTooShort)))
    );
    let token_c = token::TokenClient::new(&f.env, &f.usdc);
    assert_eq!(token_c.balance(&user), 0);
    assert!(!f.rewards.is_claimed(&1u32, &user));
    assert_eq!(f.rewards.get_reward_stats(&1u32).claims, 0);
    assert_eq!(f.rewards.get_daily_paid(), 0);

    // One more consecutive week reaches the minimum.
    at_week(&f, 2);
    award_quest(&f, 3, &user);
    f.rewards.claim_reward(&user, &1u32);
    assert_eq!(token_c.balance(&user), 200);
}

/// The stored run keeps `weeks = 3` until the next award; `get_streak` reads it as 0 once
/// a full week is skipped, and so does the gate.
#[test]
fn streak_gated_reward_rejects_a_lapsed_streak_with_stale_weeks() {
    let f = streak_setup();
    f.rewards.add_reward(&1u32, &20u64, &200i128);
    f.rewards.set_reward_min_streak(&1u32, &2u32);
    let user = streaker(&f, &[0, 1, 2]); // 3-week run, last completion in week 2

    at_week(&f, 4); // week 3 skipped
    let stored: Streak = f.env.as_contract(&f.quest_id, || {
        f.env
            .storage()
            .persistent()
            .get(&alvinmunk_quest_registry::DataKey::Streak(user.clone()))
            .unwrap()
    });
    assert_eq!((stored.weeks, stored.last_week), (3, 2)); // stale in storage
    let live = f.quest.get_streak(&user);
    assert_eq!((live.weeks, live.best), (0, 3));
    assert_eq!(
        f.rewards.try_claim_reward(&user, &1u32),
        Err(Ok(contract_err(Error::StreakTooShort)))
    );

    // A new run starts at 1 and has to be rebuilt to the minimum.
    award_quest(&f, 4, &user);
    assert_eq!(
        f.rewards.try_claim_reward(&user, &1u32),
        Err(Ok(contract_err(Error::StreakTooShort)))
    );
}

/// Rewards without a minimum are unchanged: no streak needed and no QuestRegistry call, so
/// they keep paying on a contract that was never wired to it.
#[test]
fn reward_without_streak_requirement_is_unchanged() {
    let f = setup(); // no set_quest_registry
    assert_eq!(f.rewards.get_quest_registry(), None);
    f.rewards.add_reward(&1u32, &50u64, &200i128);
    let user = earner(&f, 50); // Earned XP only, no streak

    f.rewards.claim_reward(&user, &1u32);
    let token_c = token::TokenClient::new(&f.env, &f.usdc);
    assert_eq!(token_c.balance(&user), 200);
    assert_eq!(f.rewards.get_reward_min_streak(&1u32), 0);
    assert_eq!(f.rewards.get_rewards().get(0).unwrap().min_streak, 0);
}

/// A gated and an ungated reward side by side: the gate only applies to its own row.
#[test]
fn a_streak_gate_applies_only_to_its_reward() {
    let f = streak_setup();
    f.rewards.add_reward(&1u32, &10u64, &100i128);
    f.rewards.add_reward(&2u32, &10u64, &100i128);
    f.rewards.set_reward_min_streak(&2u32, &2u32);
    let user = streaker(&f, &[0]); // streak 1

    f.rewards.claim_reward(&user, &1u32);
    assert_eq!(
        f.rewards.try_claim_reward(&user, &2u32),
        Err(Ok(contract_err(Error::StreakTooShort)))
    );
}

#[test]
fn a_streak_does_not_replace_the_earned_xp_threshold() {
    let f = streak_setup();
    f.rewards.add_reward(&1u32, &100u64, &100i128);
    f.rewards.set_reward_min_streak(&1u32, &1u32);
    let user = streaker(&f, &[0, 1]); // streak 2 but only 20 Earned XP
    assert_eq!(
        f.rewards.try_claim_reward(&user, &1u32),
        Err(Ok(contract_err(Error::BelowThreshold)))
    );
}

#[test]
fn get_rewards_reports_min_streak() {
    let f = streak_setup();
    f.rewards.add_reward(&1u32, &30u64, &50i128);
    f.rewards.add_reward(&2u32, &60u64, &100i128);
    f.rewards.set_reward_min_streak(&1u32, &4u32);

    let rows = f.rewards.get_rewards();
    let r1 = rows.get(0).unwrap();
    assert_eq!((r1.id, r1.min_streak), (1, 4));
    let r2 = rows.get(1).unwrap();
    assert_eq!((r2.id, r2.min_streak), (2, 0));
    // The stored row keeps its shape; the minimum lives under its own key.
    assert_eq!(row(&f, 1), Some((30, 50, true)));
}

#[test]
fn set_reward_min_streak_zero_clears_the_gate() {
    let f = streak_setup();
    f.rewards.add_reward(&1u32, &10u64, &50i128);
    f.rewards.set_reward_min_streak(&1u32, &3u32);
    assert_eq!(f.rewards.get_reward_min_streak(&1u32), 3);
    let user = streaker(&f, &[0]);
    assert_eq!(
        f.rewards.try_claim_reward(&user, &1u32),
        Err(Ok(contract_err(Error::StreakTooShort)))
    );

    f.rewards.set_reward_min_streak(&1u32, &0u32);
    assert_eq!(f.rewards.get_reward_min_streak(&1u32), 0);
    let removed = f.env.as_contract(&f.rewards_id, || {
        f.env.storage().persistent().has(&DataKey::RewardStreak(1))
    });
    assert!(!removed);
    f.rewards.claim_reward(&user, &1u32);
}

// --- get_rewards_for: one-call reward status view per wallet (#157) ---

/// `who`'s row for reward `id` in `get_rewards_for`.
fn status_of(f: &Fixture, who: &Address, id: u32) -> RewardStatus {
    let (rows, _) = f.rewards.get_rewards_for(who);
    rows.iter().find(|r| r.entry.id == id).unwrap()
}

/// The view's `reason` for `id` is `expected`, and `claim_reward` agrees: it reverts with
/// exactly that error, or pays out when the view calls the row claimable.
fn assert_reason(f: &Fixture, who: &Address, id: u32, expected: Option<Error>) {
    let s = status_of(f, who, id);
    assert_eq!(s.reason, expected.map_or(0, |e| e as u32));
    assert_eq!(s.eligible, expected.is_none());
    let res = f.rewards.try_claim_reward(who, &id);
    match expected {
        Some(e) => assert_eq!(res, Err(Ok(contract_err(e)))),
        None => assert_eq!(res, Ok(Ok(()))),
    }
}

#[test]
fn get_rewards_for_reports_every_row_with_claimed_and_eligible() {
    let f = setup();
    f.rewards.add_reward(&1u32, &30u64, &50i128);
    f.rewards.add_reward(&2u32, &60u64, &100i128);
    f.rewards.add_reward(&3u32, &10u64, &20i128);
    f.rewards.set_reward_supply(&2u32, &5u32);
    f.rewards.set_reward_active(&3u32, &false);
    let user = earner(&f, 60);
    f.rewards.claim_reward(&user, &1u32);

    let (rows, remaining) = f.rewards.get_rewards_for(&user);
    assert_eq!(remaining, -1); // no daily cap

    // Every row of the table, inactive ones included, in `get_rewards` order.
    let ids: std::vec::Vec<u32> = rows.iter().map(|r| r.entry.id).collect();
    assert_eq!(ids, [1, 2, 3]);

    let r1 = rows.get(0).unwrap();
    assert!(r1.claimed && !r1.eligible);
    assert_eq!(r1.reason, Error::AlreadyClaimed as u32);
    assert_eq!(r1.entry.claims, 1);

    let r2 = rows.get(1).unwrap();
    assert!(!r2.claimed && r2.eligible);
    assert_eq!(r2.reason, 0);
    assert_eq!(
        (r2.entry.threshold, r2.entry.amount, r2.entry.max_claims),
        (60, 100, 5)
    );

    let r3 = rows.get(2).unwrap();
    assert!(!r3.entry.active && !r3.eligible);
    assert_eq!(r3.reason, Error::RewardInactive as u32);

    // Another wallet sees its own claim state against the same table.
    let other = earner(&f, 60);
    assert!(!status_of(&f, &other, 1).claimed);
    assert!(status_of(&f, &other, 1).eligible);
}

#[test]
fn get_rewards_for_with_no_rewards_is_empty_and_unlimited() {
    let f = setup();
    let user = Address::generate(&f.env);
    let (rows, remaining) = f.rewards.get_rewards_for(&user);
    assert_eq!((rows.len(), remaining), (0, -1));
}

#[test]
fn get_rewards_for_returns_the_remaining_daily_budget() {
    let f = setup();
    f.rewards.add_reward(&1u32, &30u64, &200i128);
    f.rewards.add_reward(&2u32, &30u64, &400i128);
    f.rewards.add_reward(&3u32, &30u64, &300i128);
    f.rewards.set_daily_cap(&500i128);
    let user = earner(&f, 30);

    let (_, remaining) = f.rewards.get_rewards_for(&user);
    assert_eq!(remaining, 500);

    f.rewards.claim_reward(&user, &1u32);
    let (_, remaining) = f.rewards.get_rewards_for(&user);
    assert_eq!(remaining, 300);
    // 400 no longer fits today; 300 still does, exactly.
    assert_reason(&f, &user, 2, Some(Error::DailyCapExceeded));
    assert_eq!(status_of(&f, &user, 3).reason, 0);

    // A new UTC day resets the budget.
    f.env.ledger().with_mut(|l| l.timestamp += DAY_SECS);
    let (_, remaining) = f.rewards.get_rewards_for(&user);
    assert_eq!(remaining, 500);
    assert_reason(&f, &user, 2, None);
}

#[test]
fn get_rewards_for_reports_a_spent_budget_as_zero() {
    let f = setup();
    f.rewards.add_reward(&1u32, &30u64, &500i128);
    f.rewards.add_reward(&2u32, &30u64, &10i128);
    f.rewards.set_daily_cap(&500i128);
    let user = earner(&f, 30);
    f.rewards.claim_reward(&user, &1u32);

    let (_, remaining) = f.rewards.get_rewards_for(&user);
    assert_eq!(remaining, 0);
    assert_reason(&f, &user, 2, Some(Error::DailyCapExceeded));
}

#[test]
fn get_rewards_for_reports_paused() {
    let f = setup();
    f.rewards.add_reward(&1u32, &30u64, &50i128);
    let user = earner(&f, 30);
    f.rewards.set_paused(&true);
    assert_reason(&f, &user, 1, Some(Error::Paused));
}

#[test]
fn get_rewards_for_reports_frozen_on_every_row() {
    let f = setup();
    f.rewards.add_reward(&1u32, &30u64, &50i128);
    f.rewards.add_reward(&2u32, &10u64, &50i128);
    let user = earner(&f, 30);
    f.rewards.set_frozen(&user, &true);

    let (rows, _) = f.rewards.get_rewards_for(&user);
    let frozen = Error::Frozen as u32;
    assert!(rows.iter().all(|r| r.reason == frozen && !r.eligible));
    assert_reason(&f, &user, 1, Some(Error::Frozen));
}

#[test]
fn get_rewards_for_reports_unfunded_only_while_funding_is_required() {
    let f = setup();
    f.rewards.add_reward(&1u32, &30u64, &50i128);
    let user = earner(&f, 30);
    f.rewards.set_require_funding(&true);
    assert_reason(&f, &user, 1, Some(Error::NotFunded));

    f.rewards.set_funded(&user, &true);
    assert_reason(&f, &user, 1, None);
}

#[test]
fn get_rewards_for_reports_inactive() {
    let f = setup();
    f.rewards.add_reward(&1u32, &30u64, &50i128);
    f.rewards.set_reward_active(&1u32, &false);
    let user = earner(&f, 30);
    assert_reason(&f, &user, 1, Some(Error::RewardInactive));
}

#[test]
fn get_rewards_for_reports_below_threshold() {
    let f = setup();
    f.rewards.add_reward(&1u32, &50u64, &50i128);
    let user = earner(&f, 49);
    assert_reason(&f, &user, 1, Some(Error::BelowThreshold));
}

#[test]
fn get_rewards_for_reports_an_exhausted_pool() {
    let f = setup();
    f.rewards.add_reward(&1u32, &30u64, &50i128);
    f.rewards.set_reward_supply(&1u32, &1u32);
    let first = earner(&f, 30);
    f.rewards.claim_reward(&first, &1u32);

    let late = earner(&f, 30);
    assert_reason(&f, &late, 1, Some(Error::RewardExhausted));
}

#[test]
fn get_rewards_for_reports_the_first_failing_check_in_claim_order() {
    let f = setup();
    f.rewards.add_reward(&1u32, &30u64, &50i128);
    f.rewards.set_reward_supply(&1u32, &1u32);
    let user = earner(&f, 30);
    f.rewards.claim_reward(&user, &1u32); // claimed, and the pool is now used up
    f.rewards.set_reward_active(&1u32, &false);
    f.rewards.set_require_funding(&true);
    f.rewards.set_frozen(&user, &true);
    f.rewards.set_paused(&true);

    assert_reason(&f, &user, 1, Some(Error::Paused));
    f.rewards.set_paused(&false);
    assert_reason(&f, &user, 1, Some(Error::Frozen));
    f.rewards.set_frozen(&user, &false);
    assert_reason(&f, &user, 1, Some(Error::NotFunded));
    f.rewards.set_funded(&user, &true);
    assert_reason(&f, &user, 1, Some(Error::RewardInactive));
    f.rewards.set_reward_active(&1u32, &true);
    assert_reason(&f, &user, 1, Some(Error::AlreadyClaimed));

    // A wallet that hasn't claimed hits the used-up pool before the XP read.
    let newcomer = earner(&f, 10);
    f.rewards.set_funded(&newcomer, &true);
    assert_reason(&f, &newcomer, 1, Some(Error::RewardExhausted));
    f.rewards.set_reward_supply(&1u32, &0u32);
    assert_reason(&f, &newcomer, 1, Some(Error::BelowThreshold));
}

#[test]
fn get_rewards_for_reports_a_short_streak_until_it_is_met() {
    let f = streak_setup();
    f.rewards.add_reward(&1u32, &10u64, &100i128);
    f.rewards.set_reward_min_streak(&1u32, &3u32);
    // The Earned-XP threshold is checked before the streak.
    let newcomer = Address::generate(&f.env);
    assert_reason(&f, &newcomer, 1, Some(Error::BelowThreshold));

    let user = streaker(&f, &[0, 1]); // streak 2 < 3
    assert_reason(&f, &user, 1, Some(Error::StreakTooShort));

    at_week(&f, 2);
    award_quest(&f, 3, &user);
    assert_reason(&f, &user, 1, None);
}

#[test]
fn get_rewards_for_reports_a_streak_gate_without_a_quest_registry() {
    let f = streak_setup();
    f.rewards.add_reward(&1u32, &10u64, &100i128);
    f.rewards.set_reward_min_streak(&1u32, &1u32);
    let user = streaker(&f, &[0]);
    // No entrypoint unsets the registry; drop it from storage to cover the claim-path error.
    f.env.as_contract(&f.rewards_id, || {
        f.env.storage().instance().remove(&DataKey::QuestRegistry)
    });
    assert_reason(&f, &user, 1, Some(Error::QuestRegistryNotSet));
}

#[test]
fn set_reward_min_streak_emits_rwd_strk() {
    let f = streak_setup();
    f.rewards.add_reward(&1u32, &10u64, &50i128);
    f.rewards.set_reward_min_streak(&1u32, &3u32);
    let events = f.env.events().all();
    let (contract, topics, data) = events.last().unwrap();
    assert_eq!(contract, f.rewards_id);
    assert_eq!(
        topics,
        soroban_sdk::vec![
            &f.env,
            symbol_short!("rwd_strk").into_val(&f.env),
            1u32.into_val(&f.env)
        ]
    );
    assert_eq!(u32::from_val(&f.env, &data), 3);
}

#[test]
fn set_reward_min_streak_needs_the_quest_registry() {
    let f = setup(); // not wired
    f.rewards.add_reward(&1u32, &10u64, &50i128);
    assert_eq!(
        f.rewards.try_set_reward_min_streak(&1u32, &2u32),
        Err(Ok(contract_err(Error::QuestRegistryNotSet)))
    );
    assert_eq!(f.rewards.get_reward_min_streak(&1u32), 0);
    // Clearing a gate never needs it.
    assert_eq!(
        f.rewards.try_set_reward_min_streak(&1u32, &0u32),
        Ok(Ok(()))
    );

    f.rewards.set_quest_registry(&f.quest_id);
    assert_eq!(f.rewards.get_quest_registry(), Some(f.quest_id.clone()));
    assert_eq!(
        f.rewards.try_set_reward_min_streak(&1u32, &2u32),
        Ok(Ok(()))
    );
}

#[test]
fn set_reward_min_streak_unknown_reward_reverts() {
    let f = streak_setup();
    assert_eq!(
        f.rewards.try_set_reward_min_streak(&99u32, &3u32),
        Err(Ok(contract_err(Error::RewardNotFound)))
    );
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn non_admin_cannot_set_quest_registry() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let id = env.register(RewardsContract, ());
    let client = RewardsContractClient::new(&env, &id);
    client.init(&admin, &Address::generate(&env), &Address::generate(&env));
    client.set_quest_registry(&Address::generate(&env));
}

// --- tip validation (#144): every `tipped` event must move value ---

/// Mint `amount` USDC to `who`, so a rejected tip can only be this contract's own check
/// and never the SAC's "insufficient balance".
fn fund(f: &Fixture, who: &Address, amount: i128) {
    token::StellarAssetClient::new(&f.env, &f.usdc).mint(who, &amount);
}

/// The `tipped` events recorded by the LAST top-level call, as (from, to, amount).
///
/// The test env's event buffer is reset by every top-level invocation — a read clears
/// it too — so this has to be read straight after the call under test, BEFORE any
/// balance/`is_claimed`-style read that would wipe the very events being asserted.
fn tipped(f: &Fixture) -> std::vec::Vec<(Address, Address, i128)> {
    f.env
        .events()
        .all()
        .into_iter()
        .filter(|(_, topics, _)| {
            topics.len() == 3
                && topics.get(0).map(|v| Symbol::try_from_val(&f.env, &v))
                    == Some(Ok(symbol_short!("tipped")))
        })
        .map(|(_, topics, data)| {
            (
                Address::from_val(&f.env, &topics.get(1).unwrap()),
                Address::from_val(&f.env, &topics.get(2).unwrap()),
                i128::from_val(&f.env, &data),
            )
        })
        .collect()
}

/// Balances of every wallet a tip test uses, read after {@link tipped}.
fn balances(f: &Fixture, addrs: &[&Address]) -> std::vec::Vec<i128> {
    let tok = token::TokenClient::new(&f.env, &f.usdc);
    addrs.iter().map(|a| tok.balance(a)).collect()
}

/// The baseline the rejected cases below are measured against: a real tip debits the
/// sender, credits the receiver, and emits exactly one `tipped` naming both.
#[test]
fn tip_moves_usdc_and_emits_tipped() {
    let f = setup();
    let alice = Address::generate(&f.env);
    let bob = Address::generate(&f.env);
    fund(&f, &alice, 1_000);

    f.rewards.tip(&alice, &bob, &250i128);
    let events = tipped(&f); // read first: the balance reads below clear the buffer

    assert_eq!(events, std::vec![(alice.clone(), bob.clone(), 250i128)]);
    assert_eq!(balances(&f, &[&alice, &bob]), std::vec![750, 250]);
}

/// The smallest tip that moves anything still goes through: 1 stroop is positive.
#[test]
fn tip_accepts_the_smallest_positive_amount() {
    let f = setup();
    let alice = Address::generate(&f.env);
    let bob = Address::generate(&f.env);
    fund(&f, &alice, 1_000);

    f.rewards.tip(&alice, &bob, &1i128);
    let events = tipped(&f);

    assert_eq!(events, std::vec![(alice.clone(), bob.clone(), 1i128)]);
    assert_eq!(balances(&f, &[&alice, &bob]), std::vec![999, 1]);
}

/// #144: `tip(a, b, 0)` used to succeed from a wallet holding no USDC at all and still
/// emit `tipped`. `alice` is funded so the SAC cannot be the thing that fails — the
/// contract's own check has to be.
#[test]
fn tip_rejects_a_zero_amount_from_a_funded_wallet() {
    let f = setup();
    let alice = Address::generate(&f.env);
    let bob = Address::generate(&f.env);
    fund(&f, &alice, 1_000);

    let res = f.rewards.try_tip(&alice, &bob, &0i128);
    let events = tipped(&f);

    assert_eq!(res, Err(Ok(contract_err(Error::InvalidAmount))));
    assert!(events.is_empty());
    assert_eq!(balances(&f, &[&alice, &bob]), std::vec![1_000, 0]);
}

/// The original repro, unfunded: an empty wallet could "tip" anyone for the price of a
/// fee. Funded or not, the zero amount is refused before the SAC is ever called.
#[test]
fn tip_rejects_a_zero_amount_from_an_unfunded_wallet() {
    let f = setup();
    let alice = Address::generate(&f.env);
    let bob = Address::generate(&f.env);

    let res = f.rewards.try_tip(&alice, &bob, &0i128);
    let events = tipped(&f);

    assert_eq!(res, Err(Ok(contract_err(Error::InvalidAmount))));
    assert!(events.is_empty());
    assert_eq!(balances(&f, &[&alice, &bob]), std::vec![0, 0]);
}

/// The SAC's own `check_nonnegative_amount` already refused a negative tip; this pins
/// the same typed error for the whole non-positive range, including `i128::MIN`.
#[test]
fn tip_rejects_a_negative_amount() {
    let f = setup();
    let alice = Address::generate(&f.env);
    let bob = Address::generate(&f.env);
    fund(&f, &alice, 1_000);

    for bad in [-1i128, -1_000, i128::MIN] {
        let res = f.rewards.try_tip(&alice, &bob, &bad);
        let events = tipped(&f);
        assert_eq!(
            res,
            Err(Ok(contract_err(Error::InvalidAmount))),
            "amount = {bad}"
        );
        assert!(events.is_empty(), "amount = {bad}");
    }
    assert_eq!(balances(&f, &[&alice, &bob]), std::vec![1_000, 0]);
}

/// #144: `tip(a, a, 50)` used to succeed — the SAC moves the balance to itself, so the
/// balance was unchanged while a `tipped` event claimed a spend had been received.
#[test]
fn tip_rejects_a_self_tip() {
    let f = setup();
    let alice = Address::generate(&f.env);
    fund(&f, &alice, 1_000);

    let res = f.rewards.try_tip(&alice, &alice, &50i128);
    let events = tipped(&f);

    assert_eq!(res, Err(Ok(contract_err(Error::SelfTip))));
    assert!(events.is_empty());
    assert_eq!(balances(&f, &[&alice]), std::vec![1_000]); // unchanged
}

/// A self-tip the sender can't afford is still `SelfTip` (the funding gap is a
/// pre-existing SAC path) — the new check is what refuses the shape, not the balance.
#[test]
fn a_self_tip_is_refused_before_the_balance_is_consulted() {
    let f = setup();
    let pauper = Address::generate(&f.env); // holds no USDC at all

    let res = f.rewards.try_tip(&pauper, &pauper, &50i128);
    let events = tipped(&f);

    assert_eq!(res, Err(Ok(contract_err(Error::SelfTip))));
    assert!(events.is_empty());
}

/// Both checks are in `tip` and the amount is read first, so a zero self-tip reports
/// `InvalidAmount` rather than `SelfTip`. The client-side check mirrors this order.
#[test]
fn a_zero_self_tip_reports_the_amount_first() {
    let f = setup();
    let alice = Address::generate(&f.env);
    fund(&f, &alice, 1_000);

    let res = f.rewards.try_tip(&alice, &alice, &0i128);
    let events = tipped(&f);

    assert_eq!(res, Err(Ok(contract_err(Error::InvalidAmount))));
    assert!(events.is_empty());
}

/// A refused tip changes nothing: the guard only blocks the no-value shapes, and a
/// real tip to a third wallet still works afterwards.
#[test]
fn a_refused_tip_leaves_the_next_real_tip_untouched() {
    let f = setup();
    let alice = Address::generate(&f.env);
    let bob = Address::generate(&f.env);
    let carol = Address::generate(&f.env);
    fund(&f, &alice, 1_000);

    let zero = f.rewards.try_tip(&alice, &bob, &0i128);
    assert!(tipped(&f).is_empty());
    let selfie = f.rewards.try_tip(&alice, &alice, &10i128);
    assert!(tipped(&f).is_empty());
    assert!(zero.is_err() && selfie.is_err());

    f.rewards.tip(&alice, &carol, &40i128);
    let events = tipped(&f);

    assert_eq!(events, std::vec![(alice.clone(), carol.clone(), 40i128)]);
    assert_eq!(balances(&f, &[&alice, &bob, &carol]), std::vec![960, 0, 40]);
}

/// A paused contract still reports `Paused` first, so the admin stop stays the clearest
/// error even for a tip shape that is also invalid.
#[test]
fn a_paused_contract_reports_paused_before_tip_validation() {
    let f = setup();
    let alice = Address::generate(&f.env);
    fund(&f, &alice, 1_000);
    f.rewards.set_paused(&true);

    let res = f.rewards.try_tip(&alice, &alice, &0i128);
    let events = tipped(&f);

    assert_eq!(res, Err(Ok(contract_err(Error::Paused))));
    assert!(events.is_empty());
}

// --- add_reward / set_daily_cap validation (#146) ---

fn row(f: &Fixture, id: u32) -> Option<(u64, i128, bool)> {
    f.rewards
        .get_reward(&id)
        .map(|r| (r.threshold, r.amount, r.active))
}

#[test]
fn add_reward_rejects_zero_threshold() {
    let f = setup();
    let res = f.rewards.try_add_reward(&1u32, &0u64, &50i128);
    assert_eq!(res, Err(Ok(contract_err(Error::InvalidThreshold))));
    assert_eq!(row(&f, 1), None);
    assert_eq!(f.rewards.get_rewards().len(), 0);
}

#[test]
fn add_reward_still_rejects_a_non_positive_amount() {
    let f = setup();
    for amount in [0i128, -1] {
        assert_eq!(
            f.rewards.try_add_reward(&1u32, &10u64, &amount),
            Err(Ok(contract_err(Error::InvalidAmount)))
        );
    }
}

#[test]
fn add_reward_rejects_amount_above_cap() {
    let f = setup();
    f.rewards.set_daily_cap(&100i128);
    let res = f.rewards.try_add_reward(&1u32, &10u64, &200i128);
    assert_eq!(res, Err(Ok(contract_err(Error::AmountExceedsCap))));
    assert_eq!(row(&f, 1), None);
}

#[test]
fn a_reward_equal_to_the_cap_registers_and_pays_out() {
    let f = setup();
    f.rewards.set_daily_cap(&100i128);
    assert_eq!(
        f.rewards.try_add_reward(&1u32, &10u64, &100i128),
        Ok(Ok(()))
    );
    let user = earner(&f, 10);
    f.rewards.claim_reward(&user, &1u32);
    let token_c = token::TokenClient::new(&f.env, &f.usdc);
    assert_eq!(token_c.balance(&user), 100);
}

#[test]
fn add_reward_ignores_cap_when_unlimited() {
    let f = setup(); // cap defaults to 0 = unlimited
    assert_eq!(
        f.rewards.try_add_reward(&1u32, &10u64, &1_000_000i128),
        Ok(Ok(()))
    );
    assert_eq!(row(&f, 1), Some((10, 1_000_000, true)));
}

#[test]
fn a_rejected_update_leaves_the_existing_row_intact() {
    let f = setup();
    f.rewards.add_reward(&1u32, &30u64, &50i128);
    f.rewards.set_daily_cap(&100i128);
    assert_eq!(
        f.rewards.try_add_reward(&1u32, &0u64, &50i128),
        Err(Ok(contract_err(Error::InvalidThreshold)))
    );
    assert_eq!(
        f.rewards.try_add_reward(&1u32, &30u64, &200i128),
        Err(Ok(contract_err(Error::AmountExceedsCap)))
    );
    assert_eq!(row(&f, 1), Some((30, 50, true)));
    assert_eq!(f.rewards.get_rewards().len(), 1);

    // The valid row still pays its stored amount.
    let user = earner(&f, 30);
    f.rewards.claim_reward(&user, &1u32);
    let token_c = token::TokenClient::new(&f.env, &f.usdc);
    assert_eq!(token_c.balance(&user), 50);
}

#[test]
fn set_daily_cap_rejects_cap_below_active_reward() {
    let f = setup();
    f.rewards.add_reward(&1u32, &10u64, &50i128);
    f.rewards.add_reward(&2u32, &10u64, &200i128);
    f.rewards.set_daily_cap(&500i128);
    let res = f.rewards.try_set_daily_cap(&199i128);
    assert_eq!(res, Err(Ok(contract_err(Error::CapBelowActiveReward))));
    assert_eq!(f.rewards.get_daily_cap(), 500); // unchanged
                                                // A cap equal to the largest active payout is fine.
    assert_eq!(f.rewards.try_set_daily_cap(&200i128), Ok(Ok(())));
    assert_eq!(f.rewards.get_daily_cap(), 200);
}

#[test]
fn set_daily_cap_ignores_inactive_rewards() {
    let f = setup();
    f.rewards.add_reward(&1u32, &10u64, &200i128);
    f.rewards.set_reward_active(&1u32, &false);
    assert_eq!(f.rewards.try_set_daily_cap(&100i128), Ok(Ok(())));
    assert_eq!(f.rewards.get_daily_cap(), 100);
}

#[test]
fn set_daily_cap_zero_is_always_allowed() {
    let f = setup();
    f.rewards.add_reward(&1u32, &10u64, &200i128);
    f.rewards.set_daily_cap(&200i128);
    assert_eq!(f.rewards.try_set_daily_cap(&0i128), Ok(Ok(())));
    assert_eq!(f.rewards.get_daily_cap(), 0);
}

/// #145: `charge_daily` only enforces a positive cap, so a stored negative cap would lift
/// the limit instead of tightening it. `set_daily_cap` refuses one and keeps the old cap.
#[test]
fn set_daily_cap_rejects_a_negative_cap() {
    let f = setup();
    f.rewards.add_reward(&1u32, &10u64, &100i128);
    f.rewards.add_reward(&2u32, &10u64, &100i128);
    f.rewards.set_daily_cap(&150i128);
    for bad in [-1i128, -100, i128::MIN] {
        assert_eq!(
            f.rewards.try_set_daily_cap(&bad),
            Err(Ok(contract_err(Error::InvalidAmount))),
            "cap = {bad}"
        );
    }
    assert_eq!(f.rewards.get_daily_cap(), 150); // unchanged

    // The breaker still holds: 100 + 100 > 150.
    f.rewards.claim_reward(&earner(&f, 10), &1u32);
    assert_eq!(
        f.rewards.try_claim_reward(&earner(&f, 10), &2u32),
        Err(Ok(contract_err(Error::DailyCapExceeded)))
    );
    assert_eq!(f.rewards.get_daily_paid(), 100);
}

#[test]
fn set_daily_cap_rejects_a_negative_cap_when_unlimited() {
    let f = setup(); // no cap set = 0 = unlimited
    assert_eq!(
        f.rewards.try_set_daily_cap(&-1i128),
        Err(Ok(contract_err(Error::InvalidAmount)))
    );
    assert_eq!(f.rewards.get_daily_cap(), 0);
}

/// A negative cap written before #145 never limited anything; the view reads it as 0
/// (unlimited) rather than as a restriction, and the cap checks treat it the same way.
#[test]
fn a_negative_cap_stored_before_the_rule_reads_as_unlimited() {
    let f = setup();
    f.env.as_contract(&f.rewards_id, || {
        f.env.storage().instance().set(&DataKey::DailyCap, &-5i128)
    });
    assert_eq!(f.rewards.get_daily_cap(), 0);

    f.rewards.add_reward(&1u32, &10u64, &600i128);
    f.rewards.claim_reward(&earner(&f, 10), &1u32);
    assert_eq!(f.rewards.get_daily_paid(), 600);

    // Setting a real cap again works as usual.
    f.rewards.set_daily_cap(&600i128);
    assert_eq!(f.rewards.get_daily_cap(), 600);
}

#[test]
fn reactivating_a_reward_above_the_cap_is_rejected() {
    let f = setup();
    f.rewards.add_reward(&1u32, &10u64, &200i128);
    f.rewards.set_reward_active(&1u32, &false);
    f.rewards.set_daily_cap(&100i128); // allowed: the only oversized row is inactive
    let res = f.rewards.try_set_reward_active(&1u32, &true);
    assert_eq!(res, Err(Ok(contract_err(Error::AmountExceedsCap))));
    assert_eq!(row(&f, 1), Some((10, 200, false)));
    // Re-registering it within the cap is the way back.
    f.rewards.add_reward(&1u32, &10u64, &100i128);
    assert_eq!(row(&f, 1), Some((10, 100, true)));
}

#[test]
fn reactivating_a_reward_within_the_cap_is_allowed() {
    let f = setup();
    f.rewards.add_reward(&1u32, &10u64, &50i128);
    f.rewards.set_reward_active(&1u32, &false);
    f.rewards.set_daily_cap(&100i128);
    assert_eq!(f.rewards.try_set_reward_active(&1u32, &true), Ok(Ok(())));
    assert_eq!(row(&f, 1), Some((10, 50, true)));
}

// --- Storage TTLs ---

/// Live `state_archival` settings from `stellar network settings` (checked 2026-09-28):
/// (min_persistent_ttl, min_temporary_ttl, max_entry_ttl).
const TESTNET_TTLS: (u32, u32, u32) = (120_960, 720, 3_110_400);
const MAINNET_TTLS: (u32, u32, u32) = (2_073_600, 17_280, 3_110_400);

/// `setup()` on a ledger with the given network TTL limits, set before registration so the
/// instances get the same TTLs as on the network.
fn setup_with_ttls((min_persistent, min_temp, max_ttl): (u32, u32, u32)) -> Fixture<'static> {
    let env = Env::default();
    env.ledger().with_mut(|l| {
        l.sequence_number = 1_000;
        l.min_persistent_entry_ttl = min_persistent;
        l.min_temp_entry_ttl = min_temp;
        l.max_entry_ttl = max_ttl;
    });
    setup_in(env)
}

fn ttl(f: &Fixture, key: &DataKey) -> u32 {
    f.env
        .as_contract(&f.rewards_id, || f.env.storage().persistent().get_ttl(key))
}

#[test]
fn writes_extend_reward_entries_to_bump_extend() {
    for ttls in [TESTNET_TTLS, MAINNET_TTLS] {
        let f = setup_with_ttls(ttls);
        let user = earner(&f, 100);
        let flagged = Address::generate(&f.env);
        f.rewards.add_reward(&1u32, &50u64, &200i128);
        f.rewards.set_reward_supply(&1u32, &5u32);
        f.rewards.add_reward(&2u32, &50u64, &200i128);
        f.rewards.set_quest_registry(&f.quest_id);
        f.rewards.set_reward_min_streak(&2u32, &1u32);
        f.rewards.set_frozen(&flagged, &true);
        f.rewards.set_funded(&user, &true);
        f.rewards.claim_reward(&user, &1u32);

        for key in [
            DataKey::Reward(1),
            DataKey::RewardIds,
            DataKey::RewardStats(1),
            DataKey::RewardStreak(2),
            DataKey::RewardClaimed(1, user.clone()),
            DataKey::Frozen(flagged.clone()),
            DataKey::Funded(user.clone()),
        ] {
            assert_eq!(ttl(&f, &key), BUMP_EXTEND);
        }

        // Days later, an admin edit tops the reward row back up.
        f.env
            .ledger()
            .with_mut(|l| l.sequence_number += DAY_LEDGERS * 3);
        f.rewards.set_reward_active(&1u32, &true);
        assert_eq!(ttl(&f, &DataKey::Reward(1)), BUMP_EXTEND);
    }
}

/// The per-day payout counter is temporary and lives ~2 days, not the persistent target
/// (which is past max_entry_ttl when doubled, and would trap the claim).
#[test]
fn daily_paid_counter_lives_two_days() {
    for ttls in [TESTNET_TTLS, MAINNET_TTLS] {
        let f = setup_with_ttls(ttls);
        let user = earner(&f, 100);
        f.rewards.add_reward(&1u32, &50u64, &200i128);
        f.rewards.claim_reward(&user, &1u32);
        let paid_ttl = f.env.as_contract(&f.rewards_id, || {
            f.env.storage().temporary().get_ttl(&DataKey::DailyPaid(0))
        });
        assert_eq!(paid_ttl, DAY_LEDGERS * 2);
    }
}
