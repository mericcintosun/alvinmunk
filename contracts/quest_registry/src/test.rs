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
    testutils::{storage::Persistent as _, Address as _, Events as _, Ledger as _},
    vec, BytesN, Env,
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
    setup_in(Env::default())
}

fn setup_in(env: Env) -> Fixture<'static> {
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

/// `award`, but returning the contract error instead of panicking.
fn try_award(
    f: &Fixture,
    sk: &SigningKey,
    quest_id: u32,
    recipient: &Address,
) -> Result<(), Error> {
    let pubkey = pub_key(f, sk);
    let payload = f.quest.quest_payload(&quest_id, recipient);
    let msg: std::vec::Vec<u8> = payload.iter().collect();
    let sig = BytesN::from_array(&f.env, &sk.sign(&msg).to_bytes());
    match f.quest.try_award_quest(&pubkey, &sig, &quest_id, recipient) {
        Ok(_) => Ok(()),
        Err(Ok(e)) => Err(Error::try_from(e).expect("a QuestRegistry error")),
        Err(Err(e)) => panic!("award_quest invoke error: {e:?}"),
    }
}

fn pub_key(f: &Fixture, sk: &SigningKey) -> BytesN<32> {
    BytesN::from_array(&f.env, &sk.verifying_key().to_bytes())
}

fn set_time(f: &Fixture, timestamp: u64) {
    f.env.ledger().with_mut(|l| l.timestamp = timestamp);
}

/// The raw stored streak, bypassing the `get_streak` view.
fn stored_streak(f: &Fixture, player: &Address) -> Streak {
    f.env.as_contract(&f.quest.address, || {
        f.env
            .storage()
            .persistent()
            .get(&DataKey::Streak(player.clone()))
            .unwrap()
    })
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

/// Thursday 2026-10-01 00:00:00 UTC, a week boundary (1970-01-01 was a Thursday).
const THU_2026_10_01: u64 = 1_790_812_800;

#[test]
fn week_bounds_flip_at_thursday_midnight_utc() {
    let f = setup();

    // Week 0 starts at the epoch.
    set_time(&f, 0);
    assert_eq!(f.quest.get_week_bounds(), (0, WEEK_SECS - 1));

    // Wednesday 2026-09-30 23:59:59 UTC is the last second of week 2960.
    set_time(&f, THU_2026_10_01 - 1);
    assert_eq!(f.quest.get_week(), 2960);
    assert_eq!(
        f.quest.get_week_bounds(),
        (THU_2026_10_01 - WEEK_SECS, THU_2026_10_01 - 1)
    );

    // One second later, Thursday 00:00:00 UTC, week 2961 starts...
    set_time(&f, THU_2026_10_01);
    assert_eq!(f.quest.get_week(), 2961);
    let this_week = (THU_2026_10_01, THU_2026_10_01 + WEEK_SECS - 1);
    assert_eq!(f.quest.get_week_bounds(), this_week);

    // ...and runs through Wednesday 2026-10-07 23:59:59 UTC.
    set_time(&f, THU_2026_10_01 + WEEK_SECS - 1);
    assert_eq!(f.quest.get_week(), 2961);
    assert_eq!(f.quest.get_week_bounds(), this_week);
}

#[test]
fn completions_either_side_of_thursday_midnight_are_consecutive_weeks() {
    let f = setup();
    let user = Address::generate(&f.env);
    f.quest.create_quest(&1u32, &2u32, &10u64);
    f.quest.create_quest(&2u32, &2u32, &10u64);

    // One second apart, but Wednesday 23:59:59 and Thursday 00:00:00 UTC are two weeks.
    set_time(&f, THU_2026_10_01 - 1);
    award(&f, &f.attester_sk, 1, &user);
    set_time(&f, THU_2026_10_01);
    award(&f, &f.attester_sk, 2, &user);
    let s = f.quest.get_streak(&user);
    assert_eq!((s.weeks, s.last_week), (2, 2961));
}

#[test]
fn get_streak_view_normalizes_skipped_weeks() {
    let f = setup();
    let user = Address::generate(&f.env);
    f.quest.create_quest(&1u32, &2u32, &10u64);
    f.quest.create_quest(&2u32, &2u32, &10u64);

    // Completions in weeks 10 and 11.
    set_time(&f, WEEK_SECS * 10);
    award(&f, &f.attester_sk, 1, &user);
    set_time(&f, WEEK_SECS * 11);
    award(&f, &f.attester_sk, 2, &user);

    // Current week: the live count.
    let s = f.quest.get_streak(&user);
    assert_eq!((s.weeks, s.best, s.last_week), (2, 2, 11));

    // Week 12: the last completion was last week, so the run can still be extended.
    set_time(&f, WEEK_SECS * 12);
    assert_eq!(f.quest.get_streak(&user).weeks, 2);

    // Week 13: week 12 was skipped with no new award, so the run is dead; best is kept.
    set_time(&f, WEEK_SECS * 13);
    let s = f.quest.get_streak(&user);
    assert_eq!((s.weeks, s.best, s.last_week), (0, 2, 11));
}

#[test]
fn get_streak_lapses_exactly_at_the_week_boundary() {
    let f = setup();
    let user = Address::generate(&f.env);
    f.quest.create_quest(&1u32, &2u32, &10u64);

    // Complete in the last second of week 10.
    set_time(&f, WEEK_SECS * 11 - 1);
    award(&f, &f.attester_sk, 1, &user);

    // Live for the whole of week 11, first second to last.
    set_time(&f, WEEK_SECS * 11);
    assert_eq!(f.quest.get_streak(&user).weeks, 1);
    set_time(&f, WEEK_SECS * 12 - 1);
    assert_eq!(f.quest.get_streak(&user).weeks, 1);

    // Lapsed from the first second of week 12.
    set_time(&f, WEEK_SECS * 12);
    let s = f.quest.get_streak(&user);
    assert_eq!((s.weeks, s.best, s.last_week), (0, 1, 10));

    // The view did not rewrite storage.
    let stored = stored_streak(&f, &user);
    assert_eq!((stored.weeks, stored.best, stored.last_week), (1, 1, 10));
}

#[test]
fn get_streak_view_leaves_the_award_path_unchanged() {
    let f = setup();
    let user = Address::generate(&f.env);
    for id in 1..=4u32 {
        f.quest.create_quest(&id, &2u32, &10u64);
    }
    set_time(&f, WEEK_SECS * 10);
    award(&f, &f.attester_sk, 1, &user);
    set_time(&f, WEEK_SECS * 11);
    award(&f, &f.attester_sk, 2, &user);

    // Reading a lapsed run changes nothing on chain...
    set_time(&f, WEEK_SECS * 13);
    assert_eq!(f.quest.get_streak(&user).weeks, 0);
    let stored = stored_streak(&f, &user);
    assert_eq!((stored.weeks, stored.best, stored.last_week), (2, 2, 11));

    // ...so the award path still decides: a completion after the gap restarts at 1.
    award(&f, &f.attester_sk, 3, &user);
    let s = f.quest.get_streak(&user);
    assert_eq!((s.weeks, s.best, s.last_week), (1, 2, 13));

    // And a completion in the following week extends it as before.
    set_time(&f, WEEK_SECS * 14);
    award(&f, &f.attester_sk, 4, &user);
    let s = f.quest.get_streak(&user);
    assert_eq!((s.weeks, s.best, s.last_week), (2, 2, 14));
}

#[test]
fn get_streak_is_zero_for_a_player_who_never_completed() {
    let f = setup();
    set_time(&f, WEEK_SECS * 40);
    let s = f.quest.get_streak(&Address::generate(&f.env));
    assert_eq!((s.weeks, s.best, s.last_week), (0, 0, 0));
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

    /// Invariant: the week bounds are the WEEK_SECS-long, epoch-aligned window that holds
    /// the ledger time, and they agree with `get_week`.
    #[test]
    fn week_bounds_contain_the_ledger_time(timestamp in 0u64..4_000_000_000) {
        let f = setup();
        set_time(&f, timestamp);
        let (start, end) = f.quest.get_week_bounds();
        prop_assert!(start <= timestamp && timestamp <= end);
        prop_assert_eq!(end - start, super::WEEK_SECS - 1);
        prop_assert_eq!(start % super::WEEK_SECS, 0);
        prop_assert_eq!(start / super::WEEK_SECS, f.quest.get_week());
    }

    /// Invariant: with no new award, the view reports the run while the read falls in the
    /// completion week or the week after, and 0 from the next week on — at any second of
    /// either week. `best` and `last_week` always read as stored.
    #[test]
    fn streak_view_lapses_after_one_skipped_week(
        week in 0u64..1000,
        award_offset in 0u64..super::WEEK_SECS,
        weeks_later in 0u64..4,
        read_offset in 0u64..super::WEEK_SECS,
    ) {
        let f = setup();
        let user = Address::generate(&f.env);
        f.quest.create_quest(&1u32, &2u32, &10u64);
        set_time(&f, week * super::WEEK_SECS + award_offset);
        award(&f, &f.attester_sk, 1, &user);

        set_time(&f, (week + weeks_later) * super::WEEK_SECS + read_offset);
        let s = f.quest.get_streak(&user);
        prop_assert_eq!(s.weeks, if weeks_later <= 1 { 1 } else { 0 });
        prop_assert_eq!(s.best, 1);
        prop_assert_eq!(s.last_week, week);
    }
}

/// Release build of this contract, committed so the upgrade path can be tested without a
/// wasm build step in CI. Refresh with `make upgrade-fixtures` after changing the contract.
const QUEST_WASM: &[u8] = include_bytes!("../testdata/alvinmunk_quest_registry.wasm");

#[test]
fn upgrade_to_identical_wasm_preserves_quests_and_attester_keys() {
    let f = setup();
    f.quest.create_quest(&1u32, &2u32, &50u64);
    f.quest.create_quest(&2u32, &2u32, &50u64);
    let partner = signing_key(42);
    f.quest.set_quest_attester(&2u32, &pub_key(&f, &partner));

    let hash = f.env.deployer().upload_contract_wasm(QUEST_WASM);
    f.quest.upgrade(&hash);

    // The quest config and the allowlisted attester key survived: the upgraded contract
    // still verifies the signed payload and credits Earned XP through Reputation.
    let user = Address::generate(&f.env);
    award(&f, &f.attester_sk, 1, &user);
    assert_eq!(f.rep.get_earned(&user), 50);
    // So did the quest binding: quest 2 still takes only the partner key.
    assert_eq!(
        f.quest.get_quest_attester(&2u32),
        Some(pub_key(&f, &partner))
    );
    assert_eq!(
        try_award(&f, &f.attester_sk, 2, &user),
        Err(Error::NotAuthorized)
    );
    award(&f, &partner, 2, &user);
    assert_eq!(f.rep.get_earned(&user), 100);
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
    f.env.as_contract(&f.quest.address, || {
        f.env.storage().persistent().get_ttl(key)
    })
}

#[test]
fn writes_extend_quest_entries_to_bump_extend() {
    for ttls in [TESTNET_TTLS, MAINNET_TTLS] {
        let f = setup_with_ttls(ttls);
        let user = Address::generate(&f.env);
        f.quest.create_quest(&1u32, &2u32, &50u64);
        assert_eq!(ttl(&f, &DataKey::Quest(1)), BUMP_EXTEND);

        award(&f, &f.attester_sk, 1, &user);
        assert_eq!(ttl(&f, &DataKey::Claimed(1, user.clone())), BUMP_EXTEND);
        assert_eq!(ttl(&f, &DataKey::Streak(user.clone())), BUMP_EXTEND);

        f.quest.create_quest(&9u32, &2u32, &10u64);
        f.quest
            .set_quest_attester(&9u32, &pub_key(&f, &signing_key(42)));
        assert_eq!(ttl(&f, &DataKey::QuestAttester(9)), BUMP_EXTEND);

        // Days later, toggling the quest and a second award top their entries back up.
        f.env.ledger().with_mut(|l| {
            l.sequence_number += DAY_LEDGERS * 3;
            l.timestamp += WEEK_SECS;
        });
        f.quest.set_quest_active(&1u32, &true);
        f.quest.create_quest(&2u32, &2u32, &10u64);
        award(&f, &f.attester_sk, 2, &user);
        assert_eq!(ttl(&f, &DataKey::Quest(1)), BUMP_EXTEND);
        assert_eq!(ttl(&f, &DataKey::Streak(user.clone())), BUMP_EXTEND);
        // The first replay guard was not written again, so it kept ageing.
        assert_eq!(
            ttl(&f, &DataKey::Claimed(1, user)),
            BUMP_EXTEND - DAY_LEDGERS * 3
        );
    }
}

// --- Quest-scoped attester keys ---

/// Quests 1-3 (50 XP each); a partner key bound to quest 1 and another to quest 3. Quest 2
/// stays unbound. The in-house key (`f.attester_sk`) is the only globally allowlisted one.
fn setup_scoped() -> (Fixture<'static>, SigningKey, SigningKey) {
    let f = setup();
    for id in 1..=3u32 {
        f.quest.create_quest(&id, &2u32, &50u64);
    }
    let partner = signing_key(42);
    let other = signing_key(43);
    f.quest.set_quest_attester(&1u32, &pub_key(&f, &partner));
    f.quest.set_quest_attester(&3u32, &pub_key(&f, &other));
    (f, partner, other)
}

#[test]
fn scoped_key_awards_only_its_quest() {
    let (f, partner, _) = setup_scoped();
    let user = Address::generate(&f.env);
    assert_eq!(
        f.quest.get_quest_attester(&1u32),
        Some(pub_key(&f, &partner))
    );

    try_award(&f, &partner, 1, &user).unwrap();
    assert_eq!(f.rep.get_earned(&user), 50);

    // Neither an unbound quest nor one bound to another key accepts it (#3 NotAuthorized).
    assert_eq!(try_award(&f, &partner, 2, &user), Err(Error::NotAuthorized));
    assert_eq!(try_award(&f, &partner, 3, &user), Err(Error::NotAuthorized));
    assert_eq!(f.rep.get_earned(&user), 50);
    assert_eq!(Error::NotAuthorized as u32, 3);
}

#[test]
fn bound_quest_rejects_the_global_key() {
    let (f, partner, _) = setup_scoped();
    let user = Address::generate(&f.env);
    assert_eq!(
        try_award(&f, &f.attester_sk, 1, &user),
        Err(Error::NotAuthorized)
    );
    assert_eq!(f.rep.get_earned(&user), 0);
    // The rejected attempt recorded no claim: the bound key can still award the user.
    try_award(&f, &partner, 1, &user).unwrap();
    assert_eq!(f.rep.get_earned(&user), 50);
}

#[test]
fn unbound_quest_keeps_the_global_allowlist() {
    let (f, _, _) = setup_scoped();
    let user = Address::generate(&f.env);
    assert_eq!(f.quest.get_quest_attester(&2u32), None);
    try_award(&f, &f.attester_sk, 2, &user).unwrap();
    assert_eq!(f.rep.get_earned(&user), 50);
    // A key outside the allowlist is still refused there.
    assert_eq!(
        try_award(&f, &signing_key(99), 2, &Address::generate(&f.env)),
        Err(Error::NotAuthorized)
    );
}

#[test]
fn cleared_binding_falls_back_to_the_global_allowlist() {
    let (f, partner, _) = setup_scoped();
    let user = Address::generate(&f.env);
    f.quest.clear_quest_attester(&1u32);
    assert_eq!(
        f.env.events().all(),
        vec![
            &f.env,
            (
                f.quest.address.clone(),
                (symbol_short!("quest"), symbol_short!("att_clear")).into_val(&f.env),
                (1u32, pub_key(&f, &partner)).into_val(&f.env),
            )
        ]
    );
    assert_eq!(f.quest.get_quest_attester(&1u32), None);

    assert_eq!(try_award(&f, &partner, 1, &user), Err(Error::NotAuthorized));
    try_award(&f, &f.attester_sk, 1, &user).unwrap();
    assert_eq!(f.rep.get_earned(&user), 50);

    // Clearing again is a no-op that announces nothing.
    f.quest.clear_quest_attester(&1u32);
    assert_eq!(f.env.events().all(), vec![&f.env]);
}

#[test]
fn revoked_global_key_loses_unbound_quests_and_bindings_stay() {
    let (f, partner, _) = setup_scoped();
    f.quest.remove_attester_key(&f.attester_pub);

    let user = Address::generate(&f.env);
    assert_eq!(
        try_award(&f, &f.attester_sk, 2, &user),
        Err(Error::NotAuthorized)
    );
    assert_eq!(
        try_award(&f, &f.attester_sk, 1, &user),
        Err(Error::NotAuthorized)
    );
    // The partner binding does not depend on the global allowlist.
    try_award(&f, &partner, 1, &user).unwrap();
    assert_eq!(f.rep.get_earned(&user), 50);

    // Revoking a key from the allowlist leaves its quest bindings in place.
    f.quest.add_attester_key(&pub_key(&f, &partner));
    f.quest.remove_attester_key(&pub_key(&f, &partner));
    assert_eq!(
        f.quest.get_quest_attester(&1u32),
        Some(pub_key(&f, &partner))
    );
}

#[test]
fn rebinding_replaces_the_previous_key() {
    let (f, partner, other) = setup_scoped();
    f.quest.set_quest_attester(&1u32, &pub_key(&f, &other));
    assert_eq!(
        f.env.events().all(),
        vec![
            &f.env,
            (
                f.quest.address.clone(),
                (symbol_short!("quest"), symbol_short!("att_bind")).into_val(&f.env),
                (1u32, pub_key(&f, &other)).into_val(&f.env),
            )
        ]
    );
    let user = Address::generate(&f.env);
    assert_eq!(try_award(&f, &partner, 1, &user), Err(Error::NotAuthorized));
    try_award(&f, &other, 1, &user).unwrap();
    assert_eq!(f.rep.get_earned(&user), 50);
}

#[test]
fn binding_an_unknown_quest_reverts() {
    let f = setup();
    assert_eq!(
        f.quest
            .try_set_quest_attester(&7u32, &pub_key(&f, &signing_key(42))),
        Err(Ok(Error::QuestNotFound.into()))
    );
    assert_eq!(Error::QuestNotFound as u32, 4);
    assert_eq!(f.quest.get_quest_attester(&7u32), None);
}

#[test]
fn binding_keeps_the_replay_guard_and_inactive_check() {
    let (f, partner, _) = setup_scoped();
    let user = Address::generate(&f.env);
    try_award(&f, &partner, 1, &user).unwrap();
    assert_eq!(
        try_award(&f, &partner, 1, &user),
        Err(Error::AlreadyClaimed)
    );
    f.quest.set_quest_active(&1u32, &false);
    assert_eq!(
        try_award(&f, &partner, 1, &Address::generate(&f.env)),
        Err(Error::QuestInactive)
    );
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn non_admin_set_quest_attester_reverts() {
    let env = Env::default();
    let id = env.register(QuestRegistryContract, ());
    let client = QuestRegistryContractClient::new(&env, &id);
    client.init(&Address::generate(&env), &Address::generate(&env));
    client.set_quest_attester(&1u32, &BytesN::from_array(&env, &[1; 32]));
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn non_admin_clear_quest_attester_reverts() {
    let env = Env::default();
    let id = env.register(QuestRegistryContract, ());
    let client = QuestRegistryContractClient::new(&env, &id);
    client.init(&Address::generate(&env), &Address::generate(&env));
    client.clear_quest_attester(&1u32);
}
