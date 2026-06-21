#![cfg(test)]
//! Integration tests for the QuestRegistry -> Reputation CROSS-CONTRACT path
//! (the manual ScVal arg encoding in `award_quest` that was previously untested).
use super::*;
use passport_reputation::{ReputationContract, ReputationContractClient};
use soroban_sdk::{testutils::Address as _, Env};

struct Fixture<'a> {
    env: Env,
    rep: ReputationContractClient<'a>,
    quest: QuestRegistryContractClient<'a>,
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

    let quest_id = env.register(QuestRegistryContract, ());
    let quest = QuestRegistryContractClient::new(&env, &quest_id);
    quest.init(&admin, &rep_id);

    // Wire: the QuestRegistry CONTRACT is an allowlisted attester in Reputation;
    // the off-chain attester EOA is allowlisted in QuestRegistry.
    rep.add_attester(&quest_id);
    quest.add_attester(&attester);

    Fixture {
        env,
        rep,
        quest,
        attester,
    }
}

#[test]
fn award_quest_cross_calls_reputation_and_credits_earned() {
    let f = setup();
    let user = Address::generate(&f.env);

    f.quest.create_quest(&1u32, &2u32, &50u64); // quest 1, schema 2, 50 xp
    f.quest.award_quest(&f.attester, &1u32, &user);

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
    f.quest.award_quest(&f.attester, &1u32, &user);
    f.quest.award_quest(&f.attester, &1u32, &user); // panics: AlreadyClaimed (replay guard)
}

#[test]
#[should_panic]
fn award_quest_non_allowlisted_attester_reverts() {
    let f = setup();
    let user = Address::generate(&f.env);
    let imposter = Address::generate(&f.env);
    f.quest.create_quest(&1u32, &2u32, &50u64);
    f.quest.award_quest(&imposter, &1u32, &user); // panics: NotAuthorized
}

#[test]
#[should_panic]
fn award_unknown_quest_reverts() {
    let f = setup();
    let user = Address::generate(&f.env);
    f.quest.award_quest(&f.attester, &99u32, &user); // panics: QuestNotFound
}
