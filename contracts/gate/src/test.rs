#![cfg(test)]
//! Integration tests: Gate cross-reads the Reputation contract's Social/Earned tracks.
extern crate std;
use super::*;
use alvinmunk_reputation::{ReputationContract, ReputationContractClient};
use soroban_sdk::{
    testutils::{storage::Persistent as _, Address as _, Events as _, Ledger as _},
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

    let rep_id = env.register(ReputationContract, (&admin,));
    let rep = ReputationContractClient::new(&env, &rep_id);
    rep.add_attester(&attester);

    let gate_id = env.register(GateContract, (&admin, &rep_id));
    let gate = GateContractClient::new(&env, &gate_id);

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
    let id = env.register(GateContract, (&admin, &rep));
    let client = GateContractClient::new(&env, &id);
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

// --- Composite gates ---

fn rule(track: u32, min: u64) -> Rule {
    Rule { track, min }
}

fn rule_set(f: &Fixture, rules: &[Rule]) -> Vec<Rule> {
    let mut out = Vec::new(&f.env);
    for r in rules {
        out.push_back(r.clone());
    }
    out
}

/// Gate `id` = `rules` combined by `mode`.
fn composite(f: &Fixture, id: u32, rules: &[Rule], mode: RuleMode, label: &str) {
    f.gate.create_gate_rules(
        &id,
        &rule_set(f, rules),
        &mode,
        &String::from_str(&f.env, label),
    );
}

/// `user` claims one vouch from each of `n` fresh vouchers: Social = 20 starter + 10 per
/// claim. `award_xp` only ever credits Earned, so this is the way to raise Social.
fn earn_social(f: &Fixture, user: &Address, n: u8) {
    for i in 0..n {
        let voucher = Address::generate(&f.env);
        let secret = Bytes::from_array(&f.env, &[i; 32]);
        let hash = f.env.crypto().sha256(&secret).to_bytes();
        let id = f
            .rep
            .mint_vouch(&voucher, &hash, &String::from_str(&f.env, "ty"));
        f.rep.claim_vouch(user, &id, &secret);
    }
}

fn earn(f: &Fixture, user: &Address, amount: u64) {
    f.rep.award_xp(&f.attester, user, &2u32, &amount);
}

/// The bounty-board rule from the issue: Social ≥ 20 AND Earned ≥ 30.
#[test]
fn all_of_needs_every_rule() {
    let f = setup();
    composite(
        &f,
        10,
        &[rule(TRACK_SOCIAL, 20), rule(TRACK_EARNED, 30)],
        RuleMode::AllOf,
        "Bounty board",
    );
    let social_only = Address::generate(&f.env);
    let earned_only = Address::generate(&f.env);
    let both = Address::generate(&f.env);
    earn_social(&f, &social_only, 1); // Social 30, Earned 0
    earn(&f, &earned_only, 30); // Social 0, Earned 30
    earn_social(&f, &both, 1);
    earn(&f, &both, 30);
    assert_eq!(f.rep.get_score(&social_only), 30);
    assert_eq!(f.rep.get_earned(&earned_only), 30);

    assert!(!f.gate.check(&Address::generate(&f.env), &10u32));
    assert!(!f.gate.check(&social_only, &10u32));
    assert!(!f.gate.check(&earned_only, &10u32));
    assert!(f.gate.check(&both, &10u32));

    for user in [&social_only, &earned_only] {
        assert_eq!(
            f.gate.try_unlock(user, &10u32),
            Err(Ok(Error::BelowThreshold.into()))
        );
        assert!(!f.gate.is_unlocked(user, &10u32));
    }
    f.gate.unlock(&both, &10u32);
    assert!(f.gate.is_unlocked(&both, &10u32));
}

#[test]
fn any_of_needs_one_rule() {
    let f = setup();
    composite(
        &f,
        20,
        &[rule(TRACK_SOCIAL, 50), rule(TRACK_EARNED, 10)],
        RuleMode::AnyOf,
        "Perk",
    );
    let nobody = Address::generate(&f.env);
    let low_social = Address::generate(&f.env);
    let social = Address::generate(&f.env);
    let earned = Address::generate(&f.env);
    earn_social(&f, &low_social, 1); // 30 < 50
    earn(&f, &low_social, 9); // 9 < 10
    earn_social(&f, &social, 3); // 50
    earn(&f, &earned, 10);

    assert!(!f.gate.check(&nobody, &20u32));
    assert!(!f.gate.check(&low_social, &20u32));
    assert!(f.gate.check(&social, &20u32));
    assert!(f.gate.check(&earned, &20u32));

    assert_eq!(
        f.gate.try_unlock(&low_social, &20u32),
        Err(Ok(Error::BelowThreshold.into()))
    );
    f.gate.unlock(&social, &20u32);
    f.gate.unlock(&earned, &20u32);
    assert!(f.gate.is_unlocked(&social, &20u32));
    assert!(f.gate.is_unlocked(&earned, &20u32));
}

#[test]
fn all_of_rules_on_one_track_all_apply() {
    let f = setup();
    composite(
        &f,
        1,
        &[rule(TRACK_EARNED, 10), rule(TRACK_EARNED, 40)],
        RuleMode::AllOf,
        "x",
    );
    let user = Address::generate(&f.env);
    earn(&f, &user, 30);
    assert!(!f.gate.check(&user, &1u32)); // 30 passes the first rule, not the second
    earn(&f, &user, 10);
    assert!(f.gate.check(&user, &1u32));
}

#[test]
fn single_rule_shorthand_stores_no_rule_set() {
    let f = setup();
    f.gate.create_gate(
        &30u32,
        &TRACK_EARNED,
        &20u64,
        &String::from_str(&f.env, "Shorthand"),
    );
    // Same storage as before composite gates existed: only the `Gate`.
    let stored = f.env.as_contract(&f.gate.address, || {
        f.env.storage().persistent().has(&DataKey::GateRules(30))
    });
    assert!(!stored);
    assert_eq!(
        f.gate.get_gate_rules(&30u32),
        Some(GateRules {
            rules: rule_set(&f, &[rule(TRACK_EARNED, 20)]),
            mode: RuleMode::AllOf,
        })
    );

    let user = Address::generate(&f.env);
    earn(&f, &user, 19);
    assert!(!f.gate.check(&user, &30u32));
    earn(&f, &user, 1);
    assert!(f.gate.check(&user, &30u32));
}

#[test]
fn composite_gate_reads_back_whole_rule_set() {
    let f = setup();
    let rules = [rule(TRACK_SOCIAL, 20), rule(TRACK_EARNED, 30)];
    composite(&f, 40, &rules, RuleMode::AnyOf, "Read back");
    assert_eq!(
        f.gate.get_gate_rules(&40u32),
        Some(GateRules {
            rules: rule_set(&f, &rules),
            mode: RuleMode::AnyOf,
        })
    );
    // `Gate` keeps its shape: the first rule stands in for `track`/`min`.
    let g = f.gate.get_gate(&40u32).unwrap();
    assert_eq!(
        (g.id, g.track, g.min, g.active),
        (40, TRACK_SOCIAL, 20, true)
    );
    assert_eq!(g.label, String::from_str(&f.env, "Read back"));
    assert_eq!(f.gate.get_gates().len(), 1);
    assert_eq!(f.gate.get_gate_rules(&99u32), None);
}

#[test]
fn create_gate_rules_announces_the_gate() {
    let f = setup();
    composite(&f, 7, &[rule(TRACK_SOCIAL, 1)], RuleMode::AllOf, "x");
    assert_eq!(
        f.env.events().all(),
        soroban_sdk::vec![
            &f.env,
            (
                f.gate.address.clone(),
                (symbol_short!("gate"), symbol_short!("created")).into_val(&f.env),
                7u32.into_val(&f.env),
            )
        ]
    );
}

#[test]
fn create_gate_rules_bounds_and_validates_the_set() {
    let f = setup();
    let label = String::from_str(&f.env, "x");
    let mode = RuleMode::AllOf;
    let try_create = |rules: &[Rule]| {
        f.gate
            .try_create_gate_rules(&1u32, &rule_set(&f, rules), &mode, &label)
    };

    assert_eq!(try_create(&[]), Err(Ok(Error::EmptyRules.into())));
    let five = [
        rule(TRACK_SOCIAL, 1),
        rule(TRACK_EARNED, 1),
        rule(TRACK_SOCIAL, 2),
        rule(TRACK_EARNED, 2),
        rule(TRACK_SOCIAL, 3),
    ];
    assert_eq!(try_create(&five), Err(Ok(Error::TooManyRules.into())));
    assert_eq!(
        try_create(&[rule(TRACK_SOCIAL, 1), rule(2, 1)]),
        Err(Ok(Error::BadTrack.into()))
    );
    // Nothing is stored by a rejected call.
    assert!(f.gate.get_gate(&1u32).is_none());
    assert_eq!(f.gate.get_gates().len(), 0);

    // MAX_RULES itself is allowed.
    assert_eq!(five.len() as u32, MAX_RULES + 1);
    try_create(&five[..MAX_RULES as usize]).unwrap().unwrap();
    assert_eq!(f.gate.get_gate_rules(&1u32).unwrap().rules.len(), MAX_RULES);
}

#[test]
fn replacing_a_gate_switches_between_single_and_composite() {
    let f = setup();
    let user = Address::generate(&f.env);
    earn_social(&f, &user, 1); // Social 30, Earned 0
    f.gate.create_gate(
        &60u32,
        &TRACK_SOCIAL,
        &5u64,
        &String::from_str(&f.env, "Before"),
    );
    assert!(f.gate.check(&user, &60u32));
    f.gate.unlock(&user, &60u32);

    // Single → composite: a stricter Earned rule now also applies.
    composite(
        &f,
        60,
        &[rule(TRACK_SOCIAL, 5), rule(TRACK_EARNED, 50)],
        RuleMode::AllOf,
        "After",
    );
    assert!(!f.gate.check(&user, &60u32));
    assert!(!f.gate.is_unlocked(&user, &60u32)); // unlocked the old definition, not this one
    assert_eq!(f.gate.get_gates().len(), 1); // same id, listed once
    assert_eq!(
        f.gate.get_gate(&60u32).unwrap().label,
        String::from_str(&f.env, "After")
    );

    // Composite → single: the old rule set is dropped, not left to override the gate.
    f.gate.create_gate(
        &60u32,
        &TRACK_SOCIAL,
        &25u64,
        &String::from_str(&f.env, "Again"),
    );
    assert!(f.gate.check(&user, &60u32));
    assert_eq!(
        f.gate.get_gate_rules(&60u32).unwrap().rules,
        rule_set(&f, &[rule(TRACK_SOCIAL, 25)])
    );
    assert_eq!(f.gate.get_gates().len(), 1);
}

#[test]
fn inactive_composite_gate_is_closed() {
    let f = setup();
    let user = Address::generate(&f.env);
    earn(&f, &user, 10);
    composite(
        &f,
        3,
        &[rule(TRACK_SOCIAL, 50), rule(TRACK_EARNED, 10)],
        RuleMode::AnyOf,
        "x",
    );
    f.gate.set_gate_active(&3u32, &false);
    assert!(!f.gate.check(&user, &3u32));
    assert_eq!(
        f.gate.try_unlock(&user, &3u32),
        Err(Ok(Error::GateInactive.into()))
    );

    // Re-enabling keeps the composite rules.
    f.gate.set_gate_active(&3u32, &true);
    assert!(f.gate.check(&user, &3u32));
    assert_eq!(f.gate.get_gate_rules(&3u32).unwrap().mode, RuleMode::AnyOf);
}

/// Stand-in for Reputation that counts the score reads the gate makes.
mod counting_rep {
    use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env};

    #[contract]
    pub struct CountingRep;

    #[contractimpl]
    impl CountingRep {
        pub fn get_score(env: Env, _addr: Address) -> u64 {
            Self::count(&env);
            100
        }
        pub fn get_earned(env: Env, _addr: Address) -> u64 {
            Self::count(&env);
            100
        }
        pub fn reads(env: Env) -> u32 {
            env.storage()
                .instance()
                .get(&symbol_short!("reads"))
                .unwrap_or(0)
        }
    }

    impl CountingRep {
        fn count(env: &Env) {
            let n = Self::reads(env.clone()) + 1;
            env.storage().instance().set(&symbol_short!("reads"), &n);
        }
    }
}

#[test]
fn check_reads_each_track_once() {
    let env = Env::default();
    env.mock_all_auths();
    let rep_id = env.register(counting_rep::CountingRep, ());
    let rep = counting_rep::CountingRepClient::new(&env, &rep_id);
    let gate = GateContractClient::new(
        &env,
        &env.register(GateContract, (&Address::generate(&env), &rep_id)),
    );
    let mut rules = Vec::new(&env);
    for r in [
        rule(TRACK_SOCIAL, 10),
        rule(TRACK_EARNED, 10),
        rule(TRACK_SOCIAL, 20),
        rule(TRACK_EARNED, 20),
    ] {
        rules.push_back(r);
    }
    gate.create_gate_rules(
        &1u32,
        &rules,
        &RuleMode::AllOf,
        &String::from_str(&env, "x"),
    );

    let user = Address::generate(&env);
    assert!(gate.check(&user, &1u32));
    assert_eq!(rep.reads(), 2); // four rules, two tracks
    gate.unlock(&user, &1u32);
    assert_eq!(rep.reads(), 4);
}

#[test]
fn writes_extend_composite_rules_to_bump_extend() {
    for ttls in [TESTNET_TTLS, MAINNET_TTLS] {
        let f = setup_with_ttls(ttls);
        composite(
            &f,
            1,
            &[rule(TRACK_SOCIAL, 1), rule(TRACK_EARNED, 1)],
            RuleMode::AnyOf,
            "a",
        );
        for key in [DataKey::Gate(1), DataKey::GateRules(1), DataKey::GateIds] {
            assert_eq!(ttl(&f, &key), BUMP_EXTEND);
        }

        // Days later, toggling the gate tops its rules up with it.
        f.env
            .ledger()
            .with_mut(|l| l.sequence_number += DAY_LEDGERS * 3);
        f.gate.set_gate_active(&1u32, &false);
        assert_eq!(ttl(&f, &DataKey::Gate(1)), BUMP_EXTEND);
        assert_eq!(ttl(&f, &DataKey::GateRules(1)), BUMP_EXTEND);
    }
}

#[test]
fn upgrade_to_identical_wasm_preserves_composite_gates() {
    let f = setup();
    let rules = [rule(TRACK_SOCIAL, 20), rule(TRACK_EARNED, 30)];
    composite(&f, 1, &rules, RuleMode::AllOf, "a");
    f.gate
        .create_gate(&2u32, &TRACK_EARNED, &30u64, &String::from_str(&f.env, "b"));
    let user = Address::generate(&f.env);
    earn(&f, &user, 30);

    let hash = f.env.deployer().upload_contract_wasm(GATE_WASM);
    f.gate.upgrade(&hash);

    assert_eq!(
        f.gate.get_gate_rules(&1u32),
        Some(GateRules {
            rules: rule_set(&f, &rules),
            mode: RuleMode::AllOf,
        })
    );
    assert!(!f.gate.check(&user, &1u32)); // Social 0 < 20
    assert!(f.gate.check(&user, &2u32));
    earn_social(&f, &user, 1);
    assert!(f.gate.check(&user, &1u32));
}

// --- Unlocks are tied to the gate definition they passed (#149) ---

fn label(f: &Fixture, s: &str) -> String {
    String::from_str(&f.env, s)
}

/// Write a pre-#149 unlock (a bare `true`) straight into storage, as a deployed contract
/// holds it before the upgrade.
fn legacy_unlock(f: &Fixture, user: &Address, id: u32) {
    f.env.as_contract(&f.gate.address, || {
        f.env
            .storage()
            .persistent()
            .set(&DataKey::Unlocked(user.clone(), id), &true)
    });
}

#[test]
fn raising_the_threshold_invalidates_old_unlocks() {
    let f = setup();
    let user = Address::generate(&f.env);
    earn(&f, &user, 30);
    f.gate
        .create_gate(&1u32, &TRACK_EARNED, &30u64, &label(&f, "Bounty"));
    f.gate.unlock(&user, &1u32);
    assert!(f.gate.is_unlocked(&user, &1u32));
    assert_eq!(f.gate.get_gate_version(&1u32), 0);

    f.gate
        .create_gate(&1u32, &TRACK_EARNED, &1000u64, &label(&f, "Bounty"));
    assert_eq!(f.gate.get_gate_version(&1u32), 1);
    assert!(!f.gate.check(&user, &1u32));
    assert!(!f.gate.is_unlocked(&user, &1u32)); // passed the weaker rule, not this one
                                                // The record still says which definition it passed.
    assert_eq!(f.gate.get_unlock(&user, &1u32).unwrap().version, 0);

    // Clearing the new bar and unlocking again re-qualifies under version 1.
    earn(&f, &user, 970);
    f.gate.unlock(&user, &1u32);
    assert!(f.gate.is_unlocked(&user, &1u32));
    assert_eq!(f.gate.get_unlock(&user, &1u32).unwrap().version, 1);
}

#[test]
fn changing_the_track_invalidates_old_unlocks() {
    let f = setup();
    let user = Address::generate(&f.env);
    earn_social(&f, &user, 2); // Social 50, Earned 0
    f.gate
        .create_gate(&2u32, &TRACK_SOCIAL, &40u64, &label(&f, "Circle"));
    f.gate.unlock(&user, &2u32);
    assert!(f.gate.is_unlocked(&user, &2u32));

    // The same threshold on the Earned track: a clout unlock must not read as verified.
    f.gate
        .create_gate(&2u32, &TRACK_EARNED, &40u64, &label(&f, "Circle"));
    assert!(!f.gate.check(&user, &2u32));
    assert!(!f.gate.is_unlocked(&user, &2u32));
}

#[test]
fn a_disabled_gate_reports_no_unlock_until_it_is_re_enabled() {
    let f = setup();
    let user = Address::generate(&f.env);
    earn(&f, &user, 50);
    f.gate
        .create_gate(&3u32, &TRACK_EARNED, &30u64, &label(&f, "Perk"));
    f.gate.unlock(&user, &3u32);
    let record = f.gate.get_unlock(&user, &3u32).unwrap();

    f.gate.set_gate_active(&3u32, &false);
    assert!(!f.gate.check(&user, &3u32));
    assert!(!f.gate.is_unlocked(&user, &3u32)); // a disabled gate grants nothing
    assert_eq!(f.gate.get_unlock(&user, &3u32), Some(record.clone())); // history kept

    // Pausing is not a redefinition: re-enabling brings the same unlock back.
    f.gate.set_gate_active(&3u32, &true);
    assert_eq!(f.gate.get_gate_version(&3u32), 0);
    assert!(f.gate.is_unlocked(&user, &3u32));
    assert_eq!(f.gate.get_unlock(&user, &3u32), Some(record));
}

#[test]
fn every_redefinition_path_bumps_the_version() {
    let f = setup();
    let user = Address::generate(&f.env);
    earn(&f, &user, 50);
    earn_social(&f, &user, 1);

    composite(
        &f,
        4,
        &[rule(TRACK_SOCIAL, 10), rule(TRACK_EARNED, 10)],
        RuleMode::AllOf,
        "a",
    );
    assert_eq!(f.gate.get_gate_version(&4u32), 0); // a new composite gate starts at 0
    f.gate.unlock(&user, &4u32);
    assert!(f.gate.is_unlocked(&user, &4u32));

    // Composite -> composite, even one the wallet still passes.
    composite(
        &f,
        4,
        &[rule(TRACK_SOCIAL, 10), rule(TRACK_EARNED, 20)],
        RuleMode::AllOf,
        "a",
    );
    assert_eq!(f.gate.get_gate_version(&4u32), 1);
    assert!(f.gate.check(&user, &4u32));
    assert!(!f.gate.is_unlocked(&user, &4u32));
    f.gate.unlock(&user, &4u32);

    // Composite -> single, then single -> composite.
    f.gate
        .create_gate(&4u32, &TRACK_EARNED, &10u64, &label(&f, "a"));
    assert_eq!(f.gate.get_gate_version(&4u32), 2);
    assert!(!f.gate.is_unlocked(&user, &4u32));
    composite(&f, 4, &[rule(TRACK_EARNED, 10)], RuleMode::AnyOf, "a");
    assert_eq!(f.gate.get_gate_version(&4u32), 3);
    assert!(!f.gate.is_unlocked(&user, &4u32));

    // Other gates keep their own version.
    f.gate
        .create_gate(&5u32, &TRACK_EARNED, &10u64, &label(&f, "b"));
    assert_eq!(f.gate.get_gate_version(&5u32), 0);
    assert_eq!(f.gate.get_gate_version(&99u32), 0); // unknown gate
}

#[test]
fn a_rejected_redefinition_keeps_the_version_and_unlocks() {
    let f = setup();
    let user = Address::generate(&f.env);
    earn(&f, &user, 50);
    f.gate
        .create_gate(&1u32, &TRACK_EARNED, &30u64, &label(&f, "x"));
    f.gate.unlock(&user, &1u32);

    let bad_track = f
        .gate
        .try_create_gate(&1u32, &9u32, &30u64, &label(&f, "x"));
    assert_eq!(bad_track, Err(Ok(Error::BadTrack.into())));
    let empty =
        f.gate
            .try_create_gate_rules(&1u32, &Vec::new(&f.env), &RuleMode::AllOf, &label(&f, "x"));
    assert_eq!(empty, Err(Ok(Error::EmptyRules.into())));

    assert_eq!(f.gate.get_gate_version(&1u32), 0);
    assert!(f.gate.is_unlocked(&user, &1u32));
}

#[test]
fn the_unlock_record_names_its_version_and_ledger() {
    let f = setup();
    let user = Address::generate(&f.env);
    earn(&f, &user, 50);
    f.gate
        .create_gate(&1u32, &TRACK_EARNED, &30u64, &label(&f, "x"));
    assert_eq!(f.gate.get_unlock(&user, &1u32), None);
    assert!(!f.gate.is_unlocked(&user, &99u32)); // unknown gate

    f.env.ledger().with_mut(|l| l.sequence_number = 1_234);
    f.gate.unlock(&user, &1u32);
    assert_eq!(
        f.gate.get_unlock(&user, &1u32),
        Some(UnlockRecord {
            version: 0,
            ledger: 1_234
        })
    );

    f.gate
        .create_gate(&1u32, &TRACK_EARNED, &30u64, &label(&f, "x"));
    f.env.ledger().with_mut(|l| l.sequence_number = 2_345);
    f.gate.unlock(&user, &1u32);
    assert_eq!(
        f.gate.get_unlock(&user, &1u32),
        Some(UnlockRecord {
            version: 1,
            ledger: 2_345
        })
    );
}

#[test]
fn an_unlock_stored_before_versioning_counts_until_the_next_redefinition() {
    let f = setup();
    let user = Address::generate(&f.env);
    f.gate
        .create_gate(&1u32, &TRACK_EARNED, &30u64, &label(&f, "x"));
    legacy_unlock(&f, &user, 1);

    assert!(f.gate.is_unlocked(&user, &1u32));
    assert_eq!(
        f.gate.get_unlock(&user, &1u32),
        Some(UnlockRecord {
            version: 0,
            ledger: 0
        })
    );

    f.gate
        .create_gate(&1u32, &TRACK_EARNED, &30u64, &label(&f, "x"));
    assert!(!f.gate.is_unlocked(&user, &1u32));
    assert_eq!(f.gate.get_unlock(&user, &1u32).unwrap().version, 0);

    // Unlocking again replaces the bare flag with a record.
    earn(&f, &user, 30);
    f.gate.unlock(&user, &1u32);
    assert!(f.gate.is_unlocked(&user, &1u32));
    assert_eq!(f.gate.get_unlock(&user, &1u32).unwrap().version, 1);
}

#[test]
fn upgrading_keeps_legacy_and_versioned_unlocks() {
    let f = setup();
    let (old, new) = (Address::generate(&f.env), Address::generate(&f.env));
    earn(&f, &new, 30);
    f.gate
        .create_gate(&1u32, &TRACK_EARNED, &30u64, &label(&f, "a"));
    f.gate
        .create_gate(&2u32, &TRACK_EARNED, &30u64, &label(&f, "b"));
    f.gate
        .create_gate(&2u32, &TRACK_EARNED, &30u64, &label(&f, "b2"));
    legacy_unlock(&f, &old, 1);
    f.gate.unlock(&new, &2u32);

    let hash = f.env.deployer().upload_contract_wasm(GATE_WASM);
    f.gate.upgrade(&hash);

    assert!(f.gate.is_unlocked(&old, &1u32));
    assert!(f.gate.is_unlocked(&new, &2u32));
    assert_eq!(f.gate.get_gate_version(&2u32), 1);
    assert_eq!(f.gate.get_unlock(&new, &2u32).unwrap().version, 1);
    f.gate
        .create_gate(&1u32, &TRACK_EARNED, &30u64, &label(&f, "a"));
    assert!(!f.gate.is_unlocked(&old, &1u32));
}

#[test]
fn the_gate_version_lives_as_long_as_the_gate() {
    for ttls in [TESTNET_TTLS, MAINNET_TTLS] {
        let f = setup_with_ttls(ttls);
        f.gate
            .create_gate(&1u32, &TRACK_EARNED, &30u64, &label(&f, "a"));
        f.gate
            .create_gate(&1u32, &TRACK_EARNED, &40u64, &label(&f, "a"));
        assert_eq!(ttl(&f, &DataKey::GateVersion(1)), BUMP_EXTEND);

        // Days later, toggling the gate tops its version up with it.
        f.env
            .ledger()
            .with_mut(|l| l.sequence_number += DAY_LEDGERS * 3);
        f.gate.set_gate_active(&1u32, &false);
        assert_eq!(ttl(&f, &DataKey::Gate(1)), BUMP_EXTEND);
        assert_eq!(ttl(&f, &DataKey::GateVersion(1)), BUMP_EXTEND);
    }
}

// --- Batch views: `get_status` / `check_many` (#158) ---

fn ids(f: &Fixture, ids: &[u32]) -> Vec<u32> {
    let mut v = Vec::new(&f.env);
    for id in ids {
        v.push_back(*id);
    }
    v
}

/// (id, passes, unlocked) for every row of `get_status(addr)`.
fn status(f: &Fixture, addr: &Address) -> std::vec::Vec<(u32, bool, bool)> {
    f.gate
        .get_status(addr)
        .iter()
        .map(|s| (s.gate.id, s.passes, s.unlocked))
        .collect()
}

/// A gate wired to the read-counting Reputation stand-in (every score reads as 100).
fn counting_setup(
    env: &Env,
) -> (
    GateContractClient<'static>,
    counting_rep::CountingRepClient<'static>,
) {
    env.mock_all_auths();
    let rep_id = env.register(counting_rep::CountingRep, ());
    let rep = counting_rep::CountingRepClient::new(env, &rep_id);
    let gate = GateContractClient::new(
        env,
        &env.register(GateContract, (&Address::generate(env), &rep_id)),
    );
    (gate, rep)
}

#[test]
fn get_status_reports_every_gate_with_passes_and_unlocked() {
    let f = setup();
    let user = Address::generate(&f.env);
    earn(&f, &user, 40);
    earn_social(&f, &user, 1); // Social 30, Earned 40
    f.gate
        .create_gate(&1u32, &TRACK_EARNED, &30u64, &label(&f, "Bounty"));
    f.gate
        .create_gate(&2u32, &TRACK_SOCIAL, &50u64, &label(&f, "Circle"));
    composite(
        &f,
        3,
        &[rule(TRACK_SOCIAL, 50), rule(TRACK_EARNED, 40)],
        RuleMode::AnyOf,
        "Either",
    );
    f.gate
        .create_gate(&4u32, &TRACK_EARNED, &10u64, &label(&f, "Off"));
    f.gate.set_gate_active(&4u32, &false);
    f.gate.unlock(&user, &1u32);

    assert_eq!(
        status(&f, &user),
        [
            (1, true, true),   // passed and unlocked
            (2, false, false), // Social 30 < 50
            (3, true, false),  // any-of: the Earned rule passes
            (4, false, false), // inactive: listed, but never passes
        ]
    );
    let rows = f.gate.get_status(&user);
    let first = rows.get(0).unwrap().gate;
    assert_eq!(
        (first.track, first.min, first.label),
        (TRACK_EARNED, 30, label(&f, "Bounty"))
    );
    assert!(!rows.get(3).unwrap().gate.active);

    // Every row agrees with the single-gate reads.
    for s in rows.iter() {
        assert_eq!(s.passes, f.gate.check(&user, &s.gate.id));
        assert_eq!(s.unlocked, f.gate.is_unlocked(&user, &s.gate.id));
    }
}

#[test]
fn get_status_with_no_gates_is_empty() {
    let f = setup();
    assert_eq!(f.gate.get_status(&Address::generate(&f.env)).len(), 0);
}

#[test]
fn get_status_follows_disabling_and_redefining_a_gate() {
    let f = setup();
    let user = Address::generate(&f.env);
    earn(&f, &user, 50);
    f.gate
        .create_gate(&1u32, &TRACK_EARNED, &30u64, &label(&f, "Perk"));
    f.gate.unlock(&user, &1u32);
    assert_eq!(status(&f, &user), [(1, true, true)]);

    // Disabled: nothing passes and the unlock doesn't count, until it is re-enabled.
    f.gate.set_gate_active(&1u32, &false);
    assert_eq!(status(&f, &user), [(1, false, false)]);
    f.gate.set_gate_active(&1u32, &true);
    assert_eq!(status(&f, &user), [(1, true, true)]);

    // Redefined: the old unlock is stale even though the wallet still passes.
    f.gate
        .create_gate(&1u32, &TRACK_EARNED, &50u64, &label(&f, "Perk"));
    assert_eq!(status(&f, &user), [(1, true, false)]);
    f.gate.unlock(&user, &1u32);
    assert_eq!(status(&f, &user), [(1, true, true)]);
}

#[test]
fn get_status_counts_an_unlock_stored_before_versioning() {
    let f = setup();
    let user = Address::generate(&f.env);
    f.gate
        .create_gate(&1u32, &TRACK_EARNED, &30u64, &label(&f, "x"));
    legacy_unlock(&f, &user, 1);
    assert_eq!(status(&f, &user), [(1, false, true)]); // unlocked, below today's bar
}

#[test]
fn get_status_reads_each_track_once_for_all_gates() {
    let env = Env::default();
    let (gate, rep) = counting_setup(&env);
    for id in 1..=3u32 {
        gate.create_gate(
            &id,
            &TRACK_SOCIAL,
            &(id as u64),
            &String::from_str(&env, "s"),
        );
        gate.create_gate(
            &(id + 10),
            &TRACK_EARNED,
            &(id as u64),
            &String::from_str(&env, "e"),
        );
    }
    let mut rules = Vec::new(&env);
    rules.push_back(rule(TRACK_EARNED, 5));
    rules.push_back(rule(TRACK_SOCIAL, 5));
    gate.create_gate_rules(
        &20u32,
        &rules,
        &RuleMode::AllOf,
        &String::from_str(&env, "c"),
    );

    let user = Address::generate(&env);
    let rows = gate.get_status(&user);
    assert_eq!(rows.len(), 7);
    assert!(rows.iter().all(|s| s.passes));
    assert_eq!(rep.reads(), 2); // seven gates, two tracks
}

#[test]
fn get_status_skips_reputation_for_tracks_no_active_gate_uses() {
    let env = Env::default();
    let (gate, rep) = counting_setup(&env);
    gate.create_gate(&1u32, &TRACK_SOCIAL, &5u64, &String::from_str(&env, "s"));
    gate.create_gate(&2u32, &TRACK_EARNED, &5u64, &String::from_str(&env, "e"));
    gate.set_gate_active(&2u32, &false);

    let user = Address::generate(&env);
    gate.get_status(&user);
    assert_eq!(rep.reads(), 1); // only the active Social gate is evaluated

    gate.set_gate_active(&1u32, &false);
    gate.get_status(&user);
    assert_eq!(rep.reads(), 1); // nothing active: no cross-contract read at all
}

#[test]
fn check_many_matches_check_in_order() {
    let f = setup();
    let user = Address::generate(&f.env);
    earn(&f, &user, 30);
    f.gate
        .create_gate(&1u32, &TRACK_EARNED, &30u64, &label(&f, "a"));
    f.gate
        .create_gate(&2u32, &TRACK_SOCIAL, &10u64, &label(&f, "b"));
    f.gate
        .create_gate(&3u32, &TRACK_EARNED, &0u64, &label(&f, "c"));
    f.gate.set_gate_active(&3u32, &false);

    // Unknown (99) and inactive (3) gates read false; order and duplicates are kept.
    let asked = [2u32, 1, 99, 3, 1];
    let got = f.gate.check_many(&user, &ids(&f, &asked));
    let expected: std::vec::Vec<bool> = asked.iter().map(|id| f.gate.check(&user, id)).collect();
    assert_eq!(got.iter().collect::<std::vec::Vec<bool>>(), expected);
    assert_eq!(expected, [false, true, false, false, true]);
    assert_eq!(f.gate.check_many(&user, &ids(&f, &[])).len(), 0);
}

#[test]
fn check_many_reads_each_track_once() {
    let env = Env::default();
    let (gate, rep) = counting_setup(&env);
    for id in 1..=4u32 {
        let track = if id % 2 == 0 {
            TRACK_EARNED
        } else {
            TRACK_SOCIAL
        };
        gate.create_gate(&id, &track, &10u64, &String::from_str(&env, "x"));
    }
    let user = Address::generate(&env);
    let mut asked = Vec::new(&env);
    for id in [1u32, 2, 3, 4, 1, 42] {
        asked.push_back(id);
    }
    let got = gate.check_many(&user, &asked);
    assert_eq!(
        got.iter().collect::<std::vec::Vec<bool>>(),
        [true, true, true, true, true, false]
    );
    assert_eq!(rep.reads(), 2);
}

#[test]
fn upgrading_serves_the_batch_views() {
    let f = setup();
    let user = Address::generate(&f.env);
    earn(&f, &user, 30);
    f.gate
        .create_gate(&1u32, &TRACK_EARNED, &30u64, &label(&f, "a"));
    f.gate.unlock(&user, &1u32);

    let hash = f.env.deployer().upload_contract_wasm(GATE_WASM);
    f.gate.upgrade(&hash);

    assert_eq!(status(&f, &user), [(1, true, true)]);
    assert_eq!(
        f.gate
            .check_many(&user, &ids(&f, &[1]))
            .iter()
            .collect::<std::vec::Vec<bool>>(),
        [true]
    );
}

/// #127: the release build is set up by its constructor, inside the deploy — registering it
/// takes the constructor's arguments, it has no `init` left for anyone to call afterwards,
/// and `upgrade` asks the constructor's admin to sign.
#[test]
fn the_release_build_is_set_up_by_its_constructor() {
    use soroban_sdk::IntoVal as _;
    let env = Env::default();
    env.mock_all_auths();
    let admin = soroban_sdk::Address::generate(&env);
    let rep = soroban_sdk::Address::generate(&env);
    let id = env.register(GATE_WASM, (&admin, &rep));
    let init = soroban_sdk::Symbol::new(&env, "init");
    let impostor = soroban_sdk::Address::generate(&env);
    let call = soroban_sdk::vec![&env, impostor.into_val(&env)];
    assert!(env
        .try_invoke_contract::<(), soroban_sdk::Error>(&id, &init, call)
        .is_err());

    let hash = env.deployer().upload_contract_wasm(GATE_WASM);
    GateContractClient::new(&env, &id).upgrade(&hash);
    assert_eq!(env.auths()[0].0, admin);
}
