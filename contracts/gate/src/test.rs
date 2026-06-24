#![cfg(test)]
//! Integration tests: Gate cross-reads the Reputation contract's Social/Earned tracks.
use super::*;
use passport_reputation::{ReputationContract, ReputationContractClient};
use soroban_sdk::{testutils::Address as _, Address, Bytes, Env, String};

struct Fixture<'a> {
    env: Env,
    rep: ReputationContractClient<'a>,
    gate: GateContractClient<'a>,
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

    let gate_id = env.register(GateContract, ());
    let gate = GateContractClient::new(&env, &gate_id);
    gate.init(&admin, &rep_id);

    Fixture {
        env,
        rep,
        gate,
        attester,
    }
}

#[test]
fn earned_gate_check_and_unlock() {
    let f = setup();
    let user = Address::generate(&f.env);
    f.gate.create_gate(
        &1u32,
        &TRACK_EARNED,
        &30u64,
        &String::from_str(&f.env, "Bounty board"),
    );

    assert!(!f.gate.check(&user, &1u32)); // 0 earned
    f.rep.award_xp(&f.attester, &user, &2u32, &50u64); // earn 50
    assert!(f.gate.check(&user, &1u32)); // 50 ≥ 30

    assert!(!f.gate.is_unlocked(&user, &1u32));
    f.gate.unlock(&user, &1u32);
    assert!(f.gate.is_unlocked(&user, &1u32));
}

#[test]
#[should_panic]
fn unlock_below_threshold_reverts() {
    let f = setup();
    let user = Address::generate(&f.env);
    f.gate
        .create_gate(&1u32, &TRACK_EARNED, &30u64, &String::from_str(&f.env, "x"));
    f.gate.unlock(&user, &1u32); // 0 earned -> BelowThreshold
}

#[test]
fn social_and_earned_tracks_are_distinct() {
    let f = setup();
    let alice = Address::generate(&f.env);
    let bob = Address::generate(&f.env);
    // bob earns SOCIAL via a vouch claim (starter 20 + first-pair claim 10 = 30); earned stays 0.
    let secret = Bytes::from_array(&f.env, &[7u8; 32]);
    let hash = f.env.crypto().sha256(&secret).to_bytes();
    let id = f
        .rep
        .mint_vouch(&alice, &hash, &String::from_str(&f.env, "ty"));
    f.rep.claim_vouch(&bob, &id, &secret);

    f.gate.create_gate(
        &2u32,
        &TRACK_SOCIAL,
        &25u64,
        &String::from_str(&f.env, "Inner circle"),
    );
    f.gate.create_gate(
        &3u32,
        &TRACK_EARNED,
        &25u64,
        &String::from_str(&f.env, "Cash perk"),
    );

    assert!(f.gate.check(&bob, &2u32)); // social 30 ≥ 25
    assert!(!f.gate.check(&bob, &3u32)); // earned 0 < 25 — clout never opens a cash gate
}

#[test]
#[should_panic]
fn bad_track_reverts() {
    let f = setup();
    f.gate
        .create_gate(&1u32, &9u32, &10u64, &String::from_str(&f.env, "x")); // BadTrack
}

#[test]
fn inactive_gate_check_is_false() {
    let f = setup();
    let user = Address::generate(&f.env);
    f.gate
        .create_gate(&1u32, &TRACK_EARNED, &0u64, &String::from_str(&f.env, "x"));
    f.gate.set_gate_active(&1u32, &false);
    assert!(!f.gate.check(&user, &1u32));
}

#[test]
#[should_panic]
fn unlock_inactive_gate_reverts() {
    let f = setup();
    let user = Address::generate(&f.env);
    f.gate
        .create_gate(&1u32, &TRACK_EARNED, &0u64, &String::from_str(&f.env, "x"));
    f.gate.set_gate_active(&1u32, &false);
    f.gate.unlock(&user, &1u32); // GateInactive
}

#[test]
fn check_unknown_gate_is_false() {
    let f = setup();
    let user = Address::generate(&f.env);
    assert!(!f.gate.check(&user, &99u32));
}

#[test]
fn get_gates_lists_and_dedupes_updates() {
    let f = setup();
    f.gate
        .create_gate(&1u32, &TRACK_SOCIAL, &5u64, &String::from_str(&f.env, "a"));
    f.gate
        .create_gate(&2u32, &TRACK_EARNED, &30u64, &String::from_str(&f.env, "b"));
    f.gate.create_gate(
        &1u32,
        &TRACK_SOCIAL,
        &10u64,
        &String::from_str(&f.env, "a2"),
    ); // update — no dup
    let gs = f.gate.get_gates();
    assert_eq!(gs.len(), 2);
    assert_eq!(gs.get(0).unwrap().min, 10); // reflects the update
}
