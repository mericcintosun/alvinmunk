#![cfg(test)]
//! Integration tests: Gate cross-reads the Reputation contract's Social/Earned tracks.
use super::*;
use alvinmunk_reputation::{ReputationContract, ReputationContractClient};
use soroban_sdk::{
    testutils::{storage::Persistent as _, Address as _, Ledger as _},
    Address, Bytes, Env, String,
};

struct Fixture<'a> {
    env: Env,
    rep: ReputationContractClient<'a>,
    gate: GateContractClient<'a>,
    attester: Address,
}

fn setup() -> Fixture<'static> {
    setup_in(Env::default())
}

fn setup_in(env: Env) -> Fixture<'static> {
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

/// Release build of this contract, committed so the upgrade path can be tested without a
/// wasm build step in CI. Refresh with `make upgrade-fixtures` after changing the contract.
const GATE_WASM: &[u8] = include_bytes!("../testdata/alvinmunk_gate.wasm");

#[test]
fn upgrade_to_identical_wasm_preserves_gates() {
    let f = setup();
    f.gate
        .create_gate(&1u32, &TRACK_SOCIAL, &5u64, &String::from_str(&f.env, "a"));

    let hash = f.env.deployer().upload_contract_wasm(GATE_WASM);
    f.gate.upgrade(&hash);

    // Calls now run the uploaded wasm against the storage written before the upgrade.
    let g = f.gate.get_gate(&1u32).unwrap();
    assert_eq!((g.track, g.min, g.active), (TRACK_SOCIAL, 5, true));
    assert_eq!(g.label, String::from_str(&f.env, "a"));
    assert_eq!(f.gate.get_gates().len(), 1);
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn non_admin_upgrade_reverts() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let rep = Address::generate(&env);
    let id = env.register(GateContract, ());
    let client = GateContractClient::new(&env, &id);
    client.init(&admin, &rep);
    let hash = soroban_sdk::BytesN::from_array(&env, &[1; 32]);
    client.upgrade(&hash);
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
    f.env.as_contract(&f.gate.address, || {
        f.env.storage().persistent().get_ttl(key)
    })
}

#[test]
fn writes_extend_gate_entries_to_bump_extend() {
    for ttls in [TESTNET_TTLS, MAINNET_TTLS] {
        let f = setup_with_ttls(ttls);
        let user = Address::generate(&f.env);
        f.gate
            .create_gate(&1u32, &TRACK_EARNED, &30u64, &String::from_str(&f.env, "a"));
        f.rep.award_xp(&f.attester, &user, &2u32, &50u64);
        f.gate.unlock(&user, &1u32);
        for key in [
            DataKey::Gate(1),
            DataKey::GateIds,
            DataKey::Unlocked(user.clone(), 1),
        ] {
            assert_eq!(ttl(&f, &key), BUMP_EXTEND);
        }

        // Days later, an admin edit tops the gate back up.
        f.env
            .ledger()
            .with_mut(|l| l.sequence_number += DAY_LEDGERS * 3);
        f.gate.set_gate_active(&1u32, &false);
        assert_eq!(ttl(&f, &DataKey::Gate(1)), BUMP_EXTEND);
    }
}
