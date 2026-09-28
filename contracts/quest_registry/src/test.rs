#![cfg(test)]
//! Integration tests for the QuestRegistry -> Reputation CROSS-CONTRACT path plus the
//! attester ed25519 SIGNATURE gate (`award_quest` verifies a signed payload, not an
//! on-chain attester auth) and the on-chain `recipient.require_auth()` ownership proof.
extern crate std;
use super::*;
use alvinmunk_reputation::{ReputationContract, ReputationContractClient};
use ed25519_dalek::{Signer, SigningKey};
use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    BytesN, Env,
};

struct Fixture<'a> {
    env: Env,
    rep: ReputationContractClient<'a>,
    quest: QuestRegistryContractClient<'a>,
    attester_sk: SigningKey,
    attester_pub: BytesN<32>,
}

fn signing_key(seed: u8) -> SigningKey {
    SigningKey::from_bytes(&[seed; 32])
}

fn setup() -> Fixture<'static> {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let attester_sk = signing_key(7);
    let attester_pub = BytesN::from_array(&env, &attester_sk.verifying_key().to_bytes());

    let rep_id = env.register(ReputationContract, ());
    let rep = ReputationContractClient::new(&env, &rep_id);
    rep.init(&admin);

    let quest_id = env.register(QuestRegistryContract, ());
    let quest = QuestRegistryContractClient::new(&env, &quest_id);
    quest.init(&admin, &rep_id);

    // Wire: the QuestRegistry CONTRACT is an allowlisted attester in Reputation (for the
    // award_xp cross-call); the off-chain attester ed25519 PUBKEY is allowlisted here.
    rep.add_attester(&quest_id);
    quest.add_attester_key(&attester_pub);

    Fixture {
        env,
        rep,
        quest,
        attester_sk,
        attester_pub,
    }
}

/// Sign the contract's canonical payload with `sk` and award the quest.
fn award(f: &Fixture, sk: &SigningKey, quest_id: u32, recipient: &Address) {
    let pubkey = BytesN::from_array(&f.env, &sk.verifying_key().to_bytes());
    let payload = f.quest.quest_payload(&quest_id, recipient);
    let msg: std::vec::Vec<u8> = payload.iter().collect();
    let sig = BytesN::from_array(&f.env, &sk.sign(&msg).to_bytes());
    f.quest.award_quest(&pubkey, &sig, &quest_id, recipient);
}

#[test]
fn award_quest_cross_calls_reputation_and_credits_earned() {
    let f = setup();
    let user = Address::generate(&f.env);

    f.quest.create_quest(&1u32, &2u32, &50u64); // quest 1, schema 2, 50 xp
    award(&f, &f.attester_sk, 1, &user);

    // The cross-contract award_xp landed on the EARNED track only.
    assert_eq!(f.rep.get_earned(&user), 50);
    assert_eq!(f.rep.get_score(&user), 0);
    assert!(f.rep.get_attestation(&user, &2).is_some());
}

#[test]
#[should_panic]
fn award_quest_replay_reverts() {
    let f = setup();
    let user = Address::generate(&f.env);
    f.quest.create_quest(&1u32, &2u32, &50u64);
    award(&f, &f.attester_sk, 1, &user);
    award(&f, &f.attester_sk, 1, &user); // panics: AlreadyClaimed (replay guard)
}

#[test]
#[should_panic]
fn award_quest_non_allowlisted_attester_reverts() {
    let f = setup();
    let user = Address::generate(&f.env);
    f.quest.create_quest(&1u32, &2u32, &50u64);
    let imposter = signing_key(99); // valid signature, but pubkey not allowlisted
    award(&f, &imposter, 1, &user); // panics: NotAuthorized
}

#[test]
#[should_panic]
fn award_quest_forged_signature_reverts() {
    let f = setup();
    let user = Address::generate(&f.env);
    f.quest.create_quest(&1u32, &2u32, &50u64);
    // Allowlisted pubkey, but the signature is from a DIFFERENT key — ed25519_verify panics.
    let wrong = signing_key(8);
    let payload = f.quest.quest_payload(&1u32, &user);
    let msg: std::vec::Vec<u8> = payload.iter().collect();
    let sig = BytesN::from_array(&f.env, &wrong.sign(&msg).to_bytes());
    f.quest.award_quest(&f.attester_pub, &sig, &1u32, &user);
}

#[test]
#[should_panic]
fn award_unknown_quest_reverts() {
    let f = setup();
    let user = Address::generate(&f.env);
    award(&f, &f.attester_sk, 99, &user); // panics: QuestNotFound
}

#[test]
#[should_panic]
fn award_inactive_quest_reverts() {
    let f = setup();
    let user = Address::generate(&f.env);
    f.quest.create_quest(&1u32, &2u32, &50u64);
    f.quest.set_quest_active(&1u32, &false);
    award(&f, &f.attester_sk, 1, &user); // panics: QuestInactive
}

#[test]
fn weekly_streak_increments_then_resets_on_a_gap() {
    let f = setup();
    let user = Address::generate(&f.env);
    f.quest.create_quest(&1u32, &2u32, &10u64);
    f.quest.create_quest(&2u32, &2u32, &10u64);
    f.quest.create_quest(&3u32, &2u32, &10u64);

    // Week 0: first completion -> streak 1.
    f.env.ledger().with_mut(|l| l.timestamp = 0);
    award(&f, &f.attester_sk, 1, &user);
    assert_eq!(f.quest.get_streak(&user).weeks, 1);

    // Week 1 (consecutive) -> streak 2.
    f.env.ledger().with_mut(|l| l.timestamp = WEEK_SECS);
    award(&f, &f.attester_sk, 2, &user);
    let s = f.quest.get_streak(&user);
    assert_eq!(s.weeks, 2);
    assert_eq!(s.best, 2);

    // Week 3 (skipped week 2) -> reset to 1, but best stays 2.
    f.env.ledger().with_mut(|l| l.timestamp = WEEK_SECS * 3);
    award(&f, &f.attester_sk, 3, &user);
    let s = f.quest.get_streak(&user);
    assert_eq!(s.weeks, 1);
    assert_eq!(s.best, 2);
}

#[test]
fn same_week_completions_do_not_double_count_streak() {
    let f = setup();
    let user = Address::generate(&f.env);
    f.quest.create_quest(&1u32, &2u32, &10u64);
    f.quest.create_quest(&2u32, &2u32, &10u64);
    f.env.ledger().with_mut(|l| l.timestamp = WEEK_SECS * 5);
    award(&f, &f.attester_sk, 1, &user);
    award(&f, &f.attester_sk, 2, &user); // same week
    assert_eq!(f.quest.get_streak(&user).weeks, 1);
}

proptest! {
    // Each case runs up to 50 signed awards in a fresh env, so keep the case count modest.
    #![proptest_config(ProptestConfig::with_cases(32))]

    /// Invariant: for any sorted sequence of completion weeks (duplicates allowed), the
    /// on-chain streak matches a reference model exactly — same week = no change, the
    /// next week = +1, any gap = reset to 1 — and `best` is the running maximum.
    #[test]
    fn weekly_streak_matches_reference_model(mut weeks in prop::collection::vec(0u64..1000, 1..50)) {
        let f = setup();
        let user = Address::generate(&f.env);
        weeks.sort_unstable();

        let mut run = 0u32;
        let mut best = 0u32;
        let mut prev: Option<u64> = None;

        for (i, &w) in weeks.iter().enumerate() {
            // A fresh quest per completion: the replay guard is keyed per (quest, recipient).
            let quest_id = (i as u32) + 1;
            f.quest.create_quest(&quest_id, &2u32, &10u64);
            f.env.ledger().with_mut(|l| l.timestamp = w * super::WEEK_SECS);
            award(&f, &f.attester_sk, quest_id, &user);

            run = match prev {
                Some(p) if p == w => run,
                Some(p) if p + 1 == w => run + 1,
                _ => 1,
            };
            best = best.max(run);
            prev = Some(w);

            let s = f.quest.get_streak(&user);
            prop_assert_eq!(s.weeks, run);
            prop_assert_eq!(s.best, best);
            prop_assert!(s.best >= s.weeks);
        }
    }
}

/// Release build of this contract, committed so the upgrade path can be tested without a
/// wasm build step in CI. Refresh with `make upgrade-fixtures` after changing the contract.
const QUEST_WASM: &[u8] = include_bytes!("../testdata/alvinmunk_quest_registry.wasm");

#[test]
fn upgrade_to_identical_wasm_preserves_quests_and_attester_keys() {
    let f = setup();
    f.quest.create_quest(&1u32, &2u32, &50u64);

    let hash = f.env.deployer().upload_contract_wasm(QUEST_WASM);
    f.quest.upgrade(&hash);

    // The quest config and the allowlisted attester key survived: the upgraded contract
    // still verifies the signed payload and credits Earned XP through Reputation.
    let user = Address::generate(&f.env);
    award(&f, &f.attester_sk, 1, &user);
    assert_eq!(f.rep.get_earned(&user), 50);
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn non_admin_upgrade_reverts() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let rep = Address::generate(&env);
    let id = env.register(QuestRegistryContract, ());
    let client = QuestRegistryContractClient::new(&env, &id);
    client.init(&admin, &rep);
    let hash = soroban_sdk::BytesN::from_array(&env, &[1; 32]);
    client.upgrade(&hash);
}
