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
    testutils::{
        storage::{Persistent as _, Temporary as _},
        Address as _, Events as _, Ledger as _,
    },
    vec, BytesN, Env, TryFromVal,
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

    let rep_id = env.register(ReputationContract, (&admin,));
    let rep = ReputationContractClient::new(&env, &rep_id);

    let quest_id = env.register(QuestRegistryContract, (&admin, &rep_id));
    let quest = QuestRegistryContractClient::new(&env, &quest_id);

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

/// How long the attester's signatures stay valid (apps/web/src/lib/attest.ts QUEST_SIG_TTL_SECS).
const SIG_TTL: u64 = 600;

/// Sign the contract's canonical payload with `sk` and award the quest, with the attester's
/// usual expiry (`SIG_TTL` from now).
fn award(f: &Fixture, sk: &SigningKey, quest_id: u32, recipient: &Address) {
    try_award(f, sk, quest_id, recipient).unwrap();
}

/// `award`, but returning the contract error instead of panicking.
fn try_award(
    f: &Fixture,
    sk: &SigningKey,
    quest_id: u32,
    recipient: &Address,
) -> Result<(), Error> {
    let expires_at = f.env.ledger().timestamp() + SIG_TTL;
    try_award_until(f, sk, quest_id, recipient, expires_at)
}

/// `try_award` with a signature over the view's payload for `expires_at`.
fn try_award_until(
    f: &Fixture,
    sk: &SigningKey,
    quest_id: u32,
    recipient: &Address,
    expires_at: u64,
) -> Result<(), Error> {
    let payload = f.quest.quest_payload(&quest_id, recipient, &expires_at);
    let sig = sign(&f.env, sk, &payload);
    submit(f, sk, &sig, quest_id, recipient, expires_at)
}

/// Submit `award_quest` with a given signature, returning the contract error if any.
fn submit(
    f: &Fixture,
    sk: &SigningKey,
    sig: &BytesN<64>,
    quest_id: u32,
    recipient: &Address,
    expires_at: u64,
) -> Result<(), Error> {
    match f
        .quest
        .try_award_quest(&pub_key(f, sk), sig, &quest_id, recipient, &expires_at)
    {
        Ok(_) => Ok(()),
        Err(Ok(e)) => Err(Error::try_from(e).expect("a QuestRegistry error")),
        Err(Err(e)) => panic!("award_quest invoke error: {e:?}"),
    }
}

fn sign(env: &Env, sk: &SigningKey, message: &Bytes) -> BytesN<64> {
    let msg: std::vec::Vec<u8> = message.iter().collect();
    BytesN::from_array(env, &sk.sign(&msg).to_bytes())
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
    let expires_at = f.env.ledger().timestamp() + SIG_TTL;
    let payload = f.quest.quest_payload(&1u32, &user, &expires_at);
    let sig = sign(&f.env, &wrong, &payload);
    f.quest
        .award_quest(&f.attester_pub, &sig, &1u32, &user, &expires_at);
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

// --- Signature expiry and payload binding (issue #142) ---

/// Run an award that must fail signature verification. `ed25519_verify` traps with
/// Error(Crypto, InvalidInput); a `try_` call would narrow that (like any host error) to
/// Error(Context, InvalidAction), which cannot tell a bad signature from other traps.
fn assert_bad_signature(award: impl FnOnce()) {
    let payload = std::panic::catch_unwind(std::panic::AssertUnwindSafe(award))
        .expect_err("the award must be rejected");
    let msg = payload
        .downcast_ref::<std::string::String>()
        .map(|s| s.as_str())
        .or_else(|| payload.downcast_ref::<&str>().copied())
        .unwrap_or_default();
    assert!(
        msg.contains("Error(Crypto, InvalidInput)"),
        "not a signature failure: {msg}"
    );
}

/// The award payload exactly as docs/ON_CHAIN_EVENTS.md specifies it, built here rather
/// than through the contract so these tests pin the format instead of echoing it.
fn award_payload(
    env: &Env,
    tag: &str,
    network: &BytesN<32>,
    contract: &Address,
    quest_id: u32,
    recipient: &Address,
    expires_at: u64,
) -> Bytes {
    let parts: Vec<Val> = vec![
        env,
        Symbol::new(env, tag).into_val(env),
        network.into_val(env),
        contract.into_val(env),
        quest_id.into_val(env),
        recipient.into_val(env),
        expires_at.into_val(env),
    ];
    parts.to_xdr(env)
}

const TESTNET_ID: &str = "cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472";
const MAINNET_ID: &str = "7ac33997544e3175d266bd022439b22cdb16508c01163f26e5cb2a3e1045a979";

fn network_id(env: &Env, hex: &str) -> BytesN<32> {
    let mut id = [0u8; 32];
    for (i, b) in id.iter_mut().enumerate() {
        *b = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).unwrap();
    }
    BytesN::from_array(env, &id)
}

/// `setup()` on testnet: the ledger reports testnet's network id.
fn setup_testnet() -> Fixture<'static> {
    let f = setup();
    f.env
        .ledger()
        .set_network_id(network_id(&f.env, TESTNET_ID).to_array());
    f
}

fn to_hex(bytes: &Bytes) -> std::string::String {
    bytes.iter().map(|b| std::format!("{b:02x}")).collect()
}

#[test]
fn a_signature_is_valid_through_its_expiry_and_not_a_second_later() {
    let f = setup();
    f.quest.create_quest(&1u32, &2u32, &50u64);
    let (early, late) = (Address::generate(&f.env), Address::generate(&f.env));
    let expires_at = THU_2026_10_01 + SIG_TTL;

    // Signed at issue time, redeemed in the last second of its window: accepted.
    set_time(&f, THU_2026_10_01);
    let sig = sign(
        &f.env,
        &f.attester_sk,
        &f.quest.quest_payload(&1u32, &early, &expires_at),
    );
    set_time(&f, expires_at);
    submit(&f, &f.attester_sk, &sig, 1, &early, expires_at).unwrap();
    assert_eq!(f.rep.get_earned(&early), 50);

    // The same kind of grant one second after its expiry: SignatureExpired (#8), nothing
    // credited and no claim recorded, so a fresh signature still goes through.
    set_time(&f, THU_2026_10_01);
    let sig = sign(
        &f.env,
        &f.attester_sk,
        &f.quest.quest_payload(&1u32, &late, &expires_at),
    );
    set_time(&f, expires_at + 1);
    assert_eq!(
        submit(&f, &f.attester_sk, &sig, 1, &late, expires_at),
        Err(Error::SignatureExpired)
    );
    assert_eq!(f.rep.get_earned(&late), 0);
    try_award(&f, &f.attester_sk, 1, &late).unwrap();
    assert_eq!(f.rep.get_earned(&late), 50);
}

#[test]
fn an_unredeemed_signature_does_not_outlive_its_expiry() {
    // The issue's repro: signed at ledger time 0, submitted a year later.
    let f = setup();
    f.quest.create_quest(&1u32, &2u32, &50u64);
    let user = Address::generate(&f.env);
    set_time(&f, 0);
    let sig = sign(
        &f.env,
        &f.attester_sk,
        &f.quest.quest_payload(&1u32, &user, &SIG_TTL),
    );
    set_time(&f, 365 * DAY);
    assert_eq!(
        submit(&f, &f.attester_sk, &sig, 1, &user, SIG_TTL),
        Err(Error::SignatureExpired)
    );
    // Expiry is checked first: even a key that has since lost the quest gets #8.
    f.quest.remove_attester_key(&f.attester_pub);
    assert_eq!(
        submit(&f, &f.attester_sk, &sig, 1, &user, SIG_TTL),
        Err(Error::SignatureExpired)
    );
}

#[test]
fn a_tampered_expiry_fails_signature_verification() {
    let f = setup();
    f.quest.create_quest(&1u32, &2u32, &50u64);
    let user = Address::generate(&f.env);
    set_time(&f, THU_2026_10_01);
    let signed_until = THU_2026_10_01 + SIG_TTL;
    let sig = sign(
        &f.env,
        &f.attester_sk,
        &f.quest.quest_payload(&1u32, &user, &signed_until),
    );

    // Stretching the window (or shrinking it) changes the payload the contract rebuilds.
    for tampered in [signed_until + 365 * DAY, signed_until - 1, u64::MAX] {
        assert_bad_signature(|| {
            f.quest
                .award_quest(&f.attester_pub, &sig, &1u32, &user, &tampered)
        });
    }
    // Past the real expiry, a stretched one still does not verify.
    set_time(&f, signed_until + 1);
    assert_bad_signature(|| {
        f.quest
            .award_quest(&f.attester_pub, &sig, &1u32, &user, &(signed_until + DAY))
    });
    assert_eq!(f.rep.get_earned(&user), 0);
}

/// Quest 3's award payload on testnet from contract `C` = 32 × 0x11, valid through
/// 2026-10-01 00:10:00 UTC, for a classic recipient (G… = 32 × 0x22) and a passkey smart
/// wallet (C… = 32 × 0x33). apps/web/src/lib/attest.test.ts pins the attester's
/// `questPayload` to the same bytes, and docs/ON_CHAIN_EVENTS.md documents them.
const AWARD_PAYLOAD_HEAD: &str = concat!(
    "000000100000000100000006", // vec of 6
    "0000000f00000018616c76696e6d756e6b5f61776172645f71756573745f7631", // Symbol("alvinmunk_award_quest_v1")
    "0000000d00000020cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472", // BytesN<32> network id
    "00000012000000011111111111111111111111111111111111111111111111111111111111111111", // Address, contract
    "0000000300000003", // u32 quest id
);
const AWARD_RECIPIENT_G: &str =
    "0000001200000000000000002222222222222222222222222222222222222222222222222222222222222222"; // Address, account (ed25519)
const AWARD_RECIPIENT_C: &str =
    "00000012000000013333333333333333333333333333333333333333333333333333333333333333"; // Address, contract
const AWARD_EXPIRES_AT: &str = "00000005000000006abda4d8"; // u64 expires_at = 1_790_813_400

#[test]
fn quest_payload_matches_the_documented_bytes() {
    let env = Env::default();
    let testnet = network_id(&env, TESTNET_ID);
    env.ledger().set_network_id(testnet.to_array());
    let contract = Address::from_str(
        &env,
        "CAIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRDB3V",
    );
    env.register_at(
        &contract,
        QuestRegistryContract,
        (Address::generate(&env), Address::generate(&env)),
    );
    let client = QuestRegistryContractClient::new(&env, &contract);
    let classic = Address::from_str(
        &env,
        "GARCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCFRVX",
    );
    let passkey = Address::from_str(
        &env,
        "CAZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGGJH",
    );
    let expires_at = THU_2026_10_01 + SIG_TTL;
    assert_eq!(expires_at, 1_790_813_400);

    for (recipient, tail) in [(classic, AWARD_RECIPIENT_G), (passkey, AWARD_RECIPIENT_C)] {
        let expected = std::format!("{AWARD_PAYLOAD_HEAD}{tail}{AWARD_EXPIRES_AT}");
        // The view returns exactly the bytes `award_quest` verifies...
        let internal = env.as_contract(&contract, || {
            QuestRegistryContract::payload(&env, 3, &recipient, expires_at)
        });
        let view = client.quest_payload(&3u32, &recipient, &expires_at);
        assert_eq!(view, internal);
        // ...which are the documented ones.
        assert_eq!(to_hex(&view), expected);
        assert_eq!(
            view,
            award_payload(
                &env,
                AWARD_DOMAIN,
                &testnet,
                &contract,
                3,
                &recipient,
                expires_at
            )
        );
    }
}

#[test]
fn a_signature_is_bound_to_its_network_contract_and_domain_tag() {
    let f = setup_testnet();
    f.quest.create_quest(&1u32, &2u32, &50u64);
    let user = Address::generate(&f.env);
    let expires_at = f.env.ledger().timestamp() + SIG_TTL;
    let testnet = network_id(&f.env, TESTNET_ID);
    let mainnet = network_id(&f.env, MAINNET_ID);
    let here = f.quest.address.clone();
    let elsewhere = Address::generate(&f.env);
    let bad = |payload: Bytes| {
        let sig = sign(&f.env, &f.attester_sk, &payload);
        assert_bad_signature(|| {
            f.quest
                .award_quest(&f.attester_pub, &sig, &1u32, &user, &expires_at)
        });
    };

    // Signed for mainnet, submitted on testnet.
    bad(award_payload(
        &f.env,
        AWARD_DOMAIN,
        &mainnet,
        &here,
        1,
        &user,
        expires_at,
    ));
    // Signed for another deployment.
    bad(award_payload(
        &f.env,
        AWARD_DOMAIN,
        &testnet,
        &elsewhere,
        1,
        &user,
        expires_at,
    ));
    // Another quest, or another recipient.
    bad(award_payload(
        &f.env,
        AWARD_DOMAIN,
        &testnet,
        &here,
        2,
        &user,
        expires_at,
    ));
    let other = Address::generate(&f.env);
    bad(award_payload(
        &f.env,
        AWARD_DOMAIN,
        &testnet,
        &here,
        1,
        &other,
        expires_at,
    ));
    // Right fields under another tag, e.g. a future payload version.
    bad(award_payload(
        &f.env,
        "alvinmunk_award_quest_v2",
        &testnet,
        &here,
        1,
        &user,
        expires_at,
    ));

    // The testnet payload for this contract awards.
    let right = award_payload(&f.env, AWARD_DOMAIN, &testnet, &here, 1, &user, expires_at);
    assert_eq!(right, f.quest.quest_payload(&1u32, &user, &expires_at));
    submit(
        &f,
        &f.attester_sk,
        &sign(&f.env, &f.attester_sk, &right),
        1,
        &user,
        expires_at,
    )
    .unwrap();
    assert_eq!(f.rep.get_earned(&user), 50);
}

#[test]
fn signatures_over_the_old_payload_no_longer_verify() {
    // Before #142 the attester signed `[quest_id, recipient, contract]` with no expiry, so
    // any such signature issued but never redeemed is void once this code is deployed.
    let f = setup();
    f.quest.create_quest(&1u32, &2u32, &50u64);
    let user = Address::generate(&f.env);
    let legacy: Vec<Val> = vec![
        &f.env,
        1u32.into_val(&f.env),
        user.clone().into_val(&f.env),
        f.quest.address.clone().into_val(&f.env),
    ];
    let sig = sign(&f.env, &f.attester_sk, &legacy.to_xdr(&f.env));
    for expires_at in [0, f.env.ledger().timestamp() + SIG_TTL, u64::MAX] {
        assert_bad_signature(|| {
            f.quest
                .award_quest(&f.attester_pub, &sig, &1u32, &user, &expires_at)
        });
    }
    assert_eq!(f.rep.get_earned(&user), 0);
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

// --- Completion views (issue #156) ---

#[test]
fn is_completed_reads_the_replay_guard() {
    let f = setup();
    let (user, other) = (Address::generate(&f.env), Address::generate(&f.env));
    f.quest.create_quest(&1u32, &2u32, &50u64);
    f.quest.create_quest(&2u32, &2u32, &50u64);
    assert!(!f.quest.is_completed(&1u32, &user));

    award(&f, &f.attester_sk, 1, &user);
    assert!(f.quest.is_completed(&1u32, &user));
    // Per quest and per wallet; an unknown quest reads as not completed.
    assert!(!f.quest.is_completed(&2u32, &user));
    assert!(!f.quest.is_completed(&1u32, &other));
    assert!(!f.quest.is_completed(&99u32, &user));
    // `true` is exactly the state in which another award is refused.
    assert_eq!(
        try_award(&f, &f.attester_sk, 1, &user),
        Err(Error::AlreadyClaimed)
    );
}

#[test]
fn a_rejected_award_does_not_read_as_completed() {
    let f = setup();
    let user = Address::generate(&f.env);
    f.quest.create_quest(&1u32, &2u32, &50u64);
    f.quest.set_quest_active(&1u32, &false);
    assert_eq!(
        try_award(&f, &f.attester_sk, 1, &user),
        Err(Error::QuestInactive)
    );
    assert_eq!(
        try_award(&f, &signing_key(99), 1, &user),
        Err(Error::NotAuthorized)
    );
    assert!(!f.quest.is_completed(&1u32, &user));
}

#[test]
fn get_completed_answers_each_id_in_input_order() {
    let f = setup();
    let (user, other) = (Address::generate(&f.env), Address::generate(&f.env));
    for id in 1..=3u32 {
        f.quest.create_quest(&id, &2u32, &50u64);
    }
    award(&f, &f.attester_sk, 1, &user);
    award(&f, &f.attester_sk, 3, &user);
    award(&f, &f.attester_sk, 2, &other);

    let ids = vec![&f.env, 3u32, 2, 1, 99, 3];
    let flags = f.quest.get_completed(&user, &ids);
    assert_eq!(flags, vec![&f.env, true, false, true, false, true]);
    assert_eq!(
        f.quest.get_completed(&other, &ids),
        vec![&f.env, false, true, false, false, false]
    );
    for (i, id) in ids.iter().enumerate() {
        assert_eq!(
            flags.get_unchecked(i as u32),
            f.quest.is_completed(&id, &user)
        );
    }
    assert_eq!(f.quest.get_completed(&user, &vec![&f.env]), vec![&f.env]);
}

#[test]
fn completion_reads_do_not_extend_the_replay_guard() {
    let f = setup_with_ttls(TESTNET_TTLS);
    let user = Address::generate(&f.env);
    f.quest.create_quest(&1u32, &2u32, &50u64);
    award(&f, &f.attester_sk, 1, &user);
    let key = DataKey::Claimed(1, user.clone());
    f.env
        .ledger()
        .with_mut(|l| l.sequence_number += DAY_LEDGERS * 3);
    let before = ttl(&f, &key);
    assert!(f.quest.is_completed(&1u32, &user));
    assert_eq!(
        f.quest.get_completed(&user, &vec![&f.env, 1u32]),
        vec![&f.env, true]
    );
    assert_eq!(ttl(&f, &key), before);
}

/// Release build of this contract, committed so the upgrade path can be tested without a
/// wasm build step in CI. Refresh with `make upgrade-fixtures` after changing the contract.
const QUEST_WASM: &[u8] = include_bytes!("../testdata/alvinmunk_quest_registry.wasm");

#[test]
fn upgrade_to_identical_wasm_preserves_quests_and_attester_keys() {
    let f = setup();
    for id in 1..=3u32 {
        f.quest.create_quest(&id, &2u32, &50u64);
    }
    let partner = signing_key(42);
    f.quest.set_quest_attester(&2u32, &pub_key(&f, &partner));
    f.quest.set_attester_budget(&f.attester_pub, &60u64);
    let early = Address::generate(&f.env);
    award(&f, &f.attester_sk, 3, &early);

    let hash = f.env.deployer().upload_contract_wasm(QUEST_WASM);
    f.quest.upgrade(&hash);

    // The completion views read replay guards written before the upgrade.
    assert!(f.quest.is_completed(&3u32, &early));
    assert_eq!(
        f.quest.get_completed(&early, &vec![&f.env, 1u32, 3]),
        vec![&f.env, false, true]
    );

    // The budget and today's usage survived: 50 of 60 is spent, so a 50 XP award reverts.
    let user = Address::generate(&f.env);
    assert_eq!(f.quest.get_attester_usage(&f.attester_pub).used, 50);
    assert_eq!(
        try_award(&f, &f.attester_sk, 1, &user),
        Err(Error::AttesterBudgetExceeded)
    );
    // The quest config and the allowlisted attester key survived: the upgraded contract
    // still verifies the signed payload and credits Earned XP through Reputation.
    f.quest.set_attester_budget(&f.attester_pub, &0u64);
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
    let id = env.register(QuestRegistryContract, (&admin, &rep));
    let client = QuestRegistryContractClient::new(&env, &id);
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

        f.quest.set_attester_budget(&f.attester_pub, &1_000u64);
        assert_eq!(
            ttl(&f, &DataKey::AttesterBudget(f.attester_pub.clone())),
            BUMP_EXTEND
        );

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
    let id = env.register(
        QuestRegistryContract,
        (&Address::generate(&env), &Address::generate(&env)),
    );
    let client = QuestRegistryContractClient::new(&env, &id);
    client.set_quest_attester(&1u32, &BytesN::from_array(&env, &[1; 32]));
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn non_admin_clear_quest_attester_reverts() {
    let env = Env::default();
    let id = env.register(
        QuestRegistryContract,
        (&Address::generate(&env), &Address::generate(&env)),
    );
    let client = QuestRegistryContractClient::new(&env, &id);
    client.clear_quest_attester(&1u32);
}

// --- Daily attester budget ---

const DAY: u64 = 86_400;

/// Quests 1-6 worth `xps[i]` XP each, and the in-house key capped at `budget` a day.
fn setup_budget(budget: u64, xps: &[u64]) -> Fixture<'static> {
    let f = setup();
    for (i, xp) in xps.iter().enumerate() {
        f.quest.create_quest(&(i as u32 + 1), &2u32, xp);
    }
    f.quest.set_attester_budget(&f.attester_pub, &budget);
    f
}

/// The `att_key/<kind>` events the last invocation emitted, as (key, a, b).
fn att_key_events(f: &Fixture, kind: &str) -> std::vec::Vec<(BytesN<32>, u64, u64)> {
    let env = &f.env;
    let want = soroban_sdk::vec![
        env,
        symbol_short!("att_key").into_val(env),
        Symbol::new(env, kind).into_val(env),
    ];
    let mut out = std::vec::Vec::new();
    for (contract, topics, data) in env.events().all().iter() {
        if contract != f.quest.address || topics != want {
            continue;
        }
        if kind == "budget" {
            let (key, budget) = <(BytesN<32>, u64)>::try_from_val(env, &data).unwrap();
            out.push((key, budget, 0));
        } else {
            out.push(<(BytesN<32>, u64, u64)>::try_from_val(env, &data).unwrap());
        }
    }
    out
}

fn usage_entry(f: &Fixture, day: u64) -> Option<u64> {
    f.env.as_contract(&f.quest.address, || {
        f.env
            .storage()
            .temporary()
            .get(&DataKey::AttesterUsed(f.attester_pub.clone(), day))
    })
}

#[test]
fn error_codes_are_append_only() {
    assert_eq!(Error::NotInitialized as u32, 1);
    assert_eq!(Error::AlreadyInitialized as u32, 2);
    assert_eq!(Error::NotAuthorized as u32, 3);
    assert_eq!(Error::QuestNotFound as u32, 4);
    assert_eq!(Error::AlreadyClaimed as u32, 5);
    assert_eq!(Error::QuestInactive as u32, 6);
    assert_eq!(Error::AttesterBudgetExceeded as u32, 7);
    assert_eq!(Error::SignatureExpired as u32, 8);
    assert_eq!(Error::InvalidPeriod as u32, 9);
}

#[test]
fn unbudgeted_key_is_unlimited_and_untracked() {
    let f = setup();
    let user = Address::generate(&f.env);
    for id in 1..=5u32 {
        f.quest.create_quest(&id, &2u32, &1_000_000u64);
        award(&f, &f.attester_sk, id, &user);
        assert!(att_key_events(&f, "near_cap").is_empty());
    }
    assert_eq!(f.rep.get_earned(&user), 5_000_000);
    assert_eq!(
        f.quest.get_attester_usage(&f.attester_pub),
        AttesterUsage {
            budget: 0,
            used: 0,
            day: 0
        }
    );
    // No usage counter is written for a key without a budget.
    assert_eq!(usage_entry(&f, 0), None);
}

#[test]
fn awards_within_budget_then_reject_past_it() {
    let f = setup_budget(100, &[30, 50, 20, 10, 1]);
    let (a, b) = (Address::generate(&f.env), Address::generate(&f.env));
    award(&f, &f.attester_sk, 1, &a);
    award(&f, &f.attester_sk, 2, &a);
    award(&f, &f.attester_sk, 3, &b); // exactly the budget
    assert_eq!(f.quest.get_attester_usage(&f.attester_pub).used, 100);

    assert_eq!(
        try_award(&f, &f.attester_sk, 4, &a),
        Err(Error::AttesterBudgetExceeded)
    );
    assert_eq!(
        try_award(&f, &f.attester_sk, 5, &b),
        Err(Error::AttesterBudgetExceeded)
    );
    assert_eq!(f.rep.get_earned(&a), 80);
    assert_eq!(f.rep.get_earned(&b), 20);
    assert_eq!(
        f.quest.get_attester_usage(&f.attester_pub),
        AttesterUsage {
            budget: 100,
            used: 100,
            day: 0
        }
    );
}

#[test]
fn a_single_award_larger_than_the_budget_reverts() {
    let f = setup_budget(40, &[50]);
    let user = Address::generate(&f.env);
    assert_eq!(
        try_award(&f, &f.attester_sk, 1, &user),
        Err(Error::AttesterBudgetExceeded)
    );
    assert_eq!(f.rep.get_earned(&user), 0);
    assert_eq!(f.quest.get_attester_usage(&f.attester_pub).used, 0);
}

#[test]
fn budget_resets_at_utc_midnight() {
    let f = setup_budget(100, &[100, 50, 50]);
    let (a, b) = (Address::generate(&f.env), Address::generate(&f.env));
    let day = 20_000u64; // 2024-10-04
    set_time(&f, day * DAY);
    award(&f, &f.attester_sk, 1, &a);

    // Still the same day at 23:59:59 — the budget is spent.
    set_time(&f, day * DAY + DAY - 1);
    assert_eq!(
        try_award(&f, &f.attester_sk, 2, &b),
        Err(Error::AttesterBudgetExceeded)
    );

    // 00:00:00 the next day: a fresh budget, counted under the new day.
    set_time(&f, (day + 1) * DAY);
    award(&f, &f.attester_sk, 2, &b);
    assert_eq!(
        f.quest.get_attester_usage(&f.attester_pub),
        AttesterUsage {
            budget: 100,
            used: 50,
            day: day + 1
        }
    );
    // The rejected award claimed nothing, so it went through today.
    assert_eq!(f.rep.get_earned(&b), 50);
    award(&f, &f.attester_sk, 3, &a);
    assert_eq!(f.quest.get_attester_usage(&f.attester_pub).used, 100);
    assert_eq!(usage_entry(&f, day), Some(100));
}

#[test]
fn near_cap_fires_once_when_usage_reaches_80_percent() {
    let f = setup_budget(100, &[40, 39, 1, 10, 10]);
    let user = Address::generate(&f.env);
    let key = f.attester_pub.clone();

    award(&f, &f.attester_sk, 1, &user); // 40%
    assert!(att_key_events(&f, "near_cap").is_empty());
    award(&f, &f.attester_sk, 2, &user); // 79%
    assert!(att_key_events(&f, "near_cap").is_empty());
    award(&f, &f.attester_sk, 3, &user); // 80%: crosses
    assert_eq!(att_key_events(&f, "near_cap"), [(key.clone(), 80, 100)]);
    award(&f, &f.attester_sk, 4, &user); // 90%: already past
    assert!(att_key_events(&f, "near_cap").is_empty());

    // A new day starts below the threshold again.
    set_time(&f, DAY);
    f.quest.create_quest(&7u32, &2u32, &85u64);
    award(&f, &f.attester_sk, 7, &user);
    assert_eq!(att_key_events(&f, "near_cap"), [(key, 85, 100)]);
}

#[test]
fn set_attester_budget_announces_and_zero_removes_the_cap() {
    let f = setup_budget(10, &[50]);
    assert_eq!(
        att_key_events(&f, "budget"),
        [(f.attester_pub.clone(), 10, 0)]
    );
    let user = Address::generate(&f.env);
    assert_eq!(
        try_award(&f, &f.attester_sk, 1, &user),
        Err(Error::AttesterBudgetExceeded)
    );

    f.quest.set_attester_budget(&f.attester_pub, &0u64);
    assert_eq!(
        att_key_events(&f, "budget"),
        [(f.attester_pub.clone(), 0, 0)]
    );
    assert_eq!(f.quest.get_attester_usage(&f.attester_pub).budget, 0);
    f.env.as_contract(&f.quest.address, || {
        assert!(!f
            .env
            .storage()
            .persistent()
            .has(&DataKey::AttesterBudget(f.attester_pub.clone())));
    });
    award(&f, &f.attester_sk, 1, &user);
    assert_eq!(f.rep.get_earned(&user), 50);
}

#[test]
fn budgets_are_per_key() {
    let f = setup_budget(50, &[50, 50]);
    let second = signing_key(8);
    f.quest.add_attester_key(&pub_key(&f, &second));
    let (a, b) = (Address::generate(&f.env), Address::generate(&f.env));
    award(&f, &f.attester_sk, 1, &a);
    assert_eq!(
        try_award(&f, &f.attester_sk, 2, &a),
        Err(Error::AttesterBudgetExceeded)
    );
    // The unbudgeted second key is unaffected by the first key's exhausted budget.
    award(&f, &second, 1, &b);
    award(&f, &second, 2, &b);
    assert_eq!(f.rep.get_earned(&b), 100);
    assert_eq!(f.quest.get_attester_usage(&pub_key(&f, &second)).used, 0);
}

#[test]
fn existing_errors_keep_precedence_over_the_budget() {
    let f = setup_budget(50, &[50, 10]);
    let user = Address::generate(&f.env);
    award(&f, &f.attester_sk, 1, &user);
    // An exhausted key replaying a claim still gets AlreadyClaimed (#5).
    assert_eq!(
        try_award(&f, &f.attester_sk, 1, &user),
        Err(Error::AlreadyClaimed)
    );
    f.quest.set_quest_active(&2u32, &false);
    assert_eq!(
        try_award(&f, &f.attester_sk, 2, &user),
        Err(Error::QuestInactive)
    );

    // A budget alone authorizes nothing: an un-allowlisted key is still NotAuthorized (#3),
    // and a removed key's budget comes back with it.
    let outsider = signing_key(9);
    f.quest
        .set_attester_budget(&pub_key(&f, &outsider), &1_000u64);
    assert_eq!(
        try_award(&f, &outsider, 1, &Address::generate(&f.env)),
        Err(Error::NotAuthorized)
    );
    f.quest.remove_attester_key(&f.attester_pub);
    f.quest.add_attester_key(&f.attester_pub);
    f.quest.set_quest_active(&2u32, &true);
    assert_eq!(
        try_award(&f, &f.attester_sk, 2, &user),
        Err(Error::AttesterBudgetExceeded)
    );
}

#[test]
fn usage_outlives_testnets_short_temporary_ttl() {
    let f = setup_with_ttls(TESTNET_TTLS);
    f.quest.create_quest(&1u32, &2u32, &60u64);
    f.quest.create_quest(&2u32, &2u32, &60u64);
    f.quest.set_attester_budget(&f.attester_pub, &100u64);
    let day = f.env.ledger().timestamp() / DAY;
    award(&f, &f.attester_sk, 1, &Address::generate(&f.env));
    let used_key = DataKey::AttesterUsed(f.attester_pub.clone(), day);
    let entry_ttl = f.env.as_contract(&f.quest.address, || {
        f.env.storage().temporary().get_ttl(&used_key)
    });
    assert_eq!(entry_ttl, USAGE_TTL);

    // ~23h later (well past the 720-ledger minimum), the day's usage still counts.
    f.env.ledger().with_mut(|l| {
        l.sequence_number += DAY_LEDGERS - 720;
        l.timestamp += DAY - 3_600;
    });
    assert_eq!(
        try_award(&f, &f.attester_sk, 2, &Address::generate(&f.env)),
        Err(Error::AttesterBudgetExceeded)
    );
}

#[test]
fn a_quest_bound_key_is_budgeted_too() {
    let f = setup_budget(0, &[50, 50]);
    let partner = signing_key(42);
    f.quest.set_quest_attester(&1u32, &pub_key(&f, &partner));
    f.quest.set_quest_attester(&2u32, &pub_key(&f, &partner));
    f.quest.set_attester_budget(&pub_key(&f, &partner), &50u64);
    let user = Address::generate(&f.env);
    award(&f, &partner, 1, &user);
    // The partner's budget is spent, and the scope still keeps the global key out.
    assert_eq!(
        try_award(&f, &partner, 2, &user),
        Err(Error::AttesterBudgetExceeded)
    );
    assert_eq!(
        try_award(&f, &f.attester_sk, 2, &user),
        Err(Error::NotAuthorized)
    );
    assert_eq!(
        f.quest.get_attester_usage(&pub_key(&f, &partner)),
        AttesterUsage {
            budget: 50,
            used: 50,
            day: 0
        }
    );
    // The global key's own (unset) budget is untouched.
    assert_eq!(f.quest.get_attester_usage(&f.attester_pub).used, 0);
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn non_admin_set_attester_budget_reverts() {
    let env = Env::default();
    let id = env.register(
        QuestRegistryContract,
        (&Address::generate(&env), &Address::generate(&env)),
    );
    let client = QuestRegistryContractClient::new(&env, &id);
    client.set_attester_budget(&BytesN::from_array(&env, &[1; 32]), &100u64);
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(24))]

    /// Invariant: within one day, an award goes through exactly when it fits in what is
    /// left of the budget, so the XP a key mints never exceeds it.
    #[test]
    fn budget_never_overspends(budget in 1u64..500, xps in prop::collection::vec(0u64..200, 1..12)) {
        let f = setup();
        f.quest.set_attester_budget(&f.attester_pub, &budget);
        let user = Address::generate(&f.env);
        let mut used = 0u64;
        for (i, &xp) in xps.iter().enumerate() {
            let quest_id = i as u32 + 1;
            f.quest.create_quest(&quest_id, &2u32, &xp);
            let fits = used + xp <= budget;
            let res = try_award(&f, &f.attester_sk, quest_id, &user);
            if fits {
                prop_assert_eq!(res, Ok(()));
                used += xp;
            } else {
                prop_assert_eq!(res, Err(Error::AttesterBudgetExceeded));
            }
        }
        prop_assert_eq!(f.quest.get_attester_usage(&f.attester_pub).used, used);
        prop_assert_eq!(f.rep.get_earned(&user), used);
        prop_assert!(used <= budget);
    }
}

// --- Repeatable quests: a per-period replay window (#154) ---

const WEEK: u64 = 604_800;

/// Quest `id` (50 Earned XP) repeatable weekly.
fn weekly(f: &Fixture, id: u32) {
    f.quest.create_quest(&id, &2u32, &50u64);
    f.quest.set_quest_period(&id, &WEEK);
}

/// A repeatable quest's payload as docs/ON_CHAIN_EVENTS.md specifies it (see `award_payload`).
#[allow(clippy::too_many_arguments)]
fn award_payload_v2(
    env: &Env,
    network: &BytesN<32>,
    contract: &Address,
    quest_id: u32,
    recipient: &Address,
    period: u64,
    epoch: u64,
    expires_at: u64,
) -> Bytes {
    let parts: Vec<Val> = vec![
        env,
        Symbol::new(env, "alvinmunk_award_quest_v2").into_val(env),
        network.into_val(env),
        contract.into_val(env),
        quest_id.into_val(env),
        recipient.into_val(env),
        period.into_val(env),
        epoch.into_val(env),
        expires_at.into_val(env),
    ];
    parts.to_xdr(env)
}

fn completed_in(f: &Fixture, who: &Address, ids: &[u32]) -> std::vec::Vec<bool> {
    let mut v = Vec::new(&f.env);
    for id in ids {
        v.push_back(*id);
    }
    f.quest.get_completed(who, &v).iter().collect()
}

#[test]
fn a_weekly_quest_pays_once_per_week() {
    let f = setup();
    weekly(&f, 1);
    let user = Address::generate(&f.env);

    set_time(&f, THU_2026_10_01);
    award(&f, &f.attester_sk, 1, &user);
    assert_eq!(f.rep.get_earned(&user), 50);

    // Later the same week, a freshly signed award is still a replay.
    set_time(&f, THU_2026_10_01 + 6 * DAY);
    assert_eq!(
        try_award(&f, &f.attester_sk, 1, &user),
        Err(Error::AlreadyClaimed)
    );
    assert_eq!(f.rep.get_earned(&user), 50);

    // The next week opens it again, and the streak counts both weeks.
    set_time(&f, THU_2026_10_01 + WEEK);
    award(&f, &f.attester_sk, 1, &user);
    assert_eq!(f.rep.get_earned(&user), 100);
    assert_eq!(f.quest.get_streak(&user).weeks, 2);

    // Another wallet's week is its own.
    let other = Address::generate(&f.env);
    award(&f, &f.attester_sk, 1, &other);
    assert_eq!(f.rep.get_earned(&other), 50);
}

#[test]
fn a_one_shot_quest_still_pays_once_ever() {
    let f = setup();
    f.quest.create_quest(&1u32, &2u32, &50u64);
    let user = Address::generate(&f.env);
    set_time(&f, THU_2026_10_01);
    award(&f, &f.attester_sk, 1, &user);

    set_time(&f, THU_2026_10_01 + 5 * WEEK);
    assert_eq!(
        try_award(&f, &f.attester_sk, 1, &user),
        Err(Error::AlreadyClaimed)
    );
    assert!(f.quest.is_completed(&1u32, &user));
    assert_eq!(
        f.quest.get_quest_periods(&vec![&f.env, 1u32]),
        vec![&f.env, 0u64]
    );
    // Its guard is the original key; no per-period entry is written.
    let (legacy, per_period) = f.env.as_contract(&f.quest.address, || {
        let s = f.env.storage().persistent();
        (
            s.has(&DataKey::Claimed(1, user.clone())),
            s.has(&DataKey::ClaimedIn(1, user.clone(), THU_2026_10_01 / WEEK)),
        )
    });
    assert!(legacy && !per_period);
}

#[test]
fn a_signature_is_bound_to_the_period_it_was_issued_in() {
    let f = setup();
    weekly(&f, 1);
    let user = Address::generate(&f.env);

    // Signed in the last minute of the week, with an expiry that reaches into the next.
    set_time(&f, THU_2026_10_01 + WEEK - 60);
    let expires_at = THU_2026_10_01 + WEEK + SIG_TTL;
    let sig = sign(
        &f.env,
        &f.attester_sk,
        &f.quest.quest_payload(&1u32, &user, &expires_at),
    );

    // Redeemed after the rollover, it names the wrong period and no longer verifies.
    set_time(&f, THU_2026_10_01 + WEEK + 1);
    assert_bad_signature(|| {
        f.quest
            .award_quest(&f.attester_pub, &sig, &1u32, &user, &expires_at)
    });
    assert_eq!(f.rep.get_earned(&user), 0);

    // Before the rollover the same signature is accepted.
    set_time(&f, THU_2026_10_01 + WEEK - 1);
    f.quest
        .award_quest(&f.attester_pub, &sig, &1u32, &user, &expires_at);
    assert_eq!(f.rep.get_earned(&user), 50);
}

#[test]
fn one_shot_and_repeatable_payloads_do_not_cross() {
    let f = setup_testnet();
    weekly(&f, 1);
    f.quest.create_quest(&2u32, &2u32, &50u64);
    let user = Address::generate(&f.env);
    set_time(&f, THU_2026_10_01);
    let expires_at = THU_2026_10_01 + SIG_TTL;
    let testnet = network_id(&f.env, TESTNET_ID);
    let here = f.quest.address.clone();
    let epoch = THU_2026_10_01 / WEEK;
    let bad = |quest_id: u32, payload: Bytes| {
        let sig = sign(&f.env, &f.attester_sk, &payload);
        assert_bad_signature(|| {
            f.quest
                .award_quest(&f.attester_pub, &sig, &quest_id, &user, &expires_at)
        });
    };

    // A one-shot (v1) signature for the weekly quest, and a v2 one for the one-shot quest.
    bad(
        1,
        award_payload(&f.env, AWARD_DOMAIN, &testnet, &here, 1, &user, expires_at),
    );
    bad(
        2,
        award_payload_v2(&f.env, &testnet, &here, 2, &user, WEEK, epoch, expires_at),
    );
    // v2 with another period or epoch, or the v2 fields under the v1 tag.
    bad(
        1,
        award_payload_v2(
            &f.env,
            &testnet,
            &here,
            1,
            &user,
            2 * WEEK,
            epoch / 2,
            expires_at,
        ),
    );
    bad(
        1,
        award_payload_v2(
            &f.env,
            &testnet,
            &here,
            1,
            &user,
            WEEK,
            epoch + 1,
            expires_at,
        ),
    );
    // The documented v2 bytes are what the contract verifies.
    let good = award_payload_v2(&f.env, &testnet, &here, 1, &user, WEEK, epoch, expires_at);
    assert_eq!(f.quest.quest_payload(&1u32, &user, &expires_at), good);
    let sig = sign(&f.env, &f.attester_sk, &good);
    f.quest
        .award_quest(&f.attester_pub, &sig, &1u32, &user, &expires_at);
    assert_eq!(f.rep.get_earned(&user), 50);
}

/// Quest 3's weekly award payload on testnet from contract `C` = 32 × 0x11 for a classic
/// recipient (G… = 32 × 0x22), valid through 2026-10-01 00:10:00 UTC (week 2961).
/// apps/web/src/lib/attest.test.ts pins `questPayload` for a repeatable quest to the same
/// bytes, and docs/ON_CHAIN_EVENTS.md documents them.
const AWARD_V2_PAYLOAD: &str = concat!(
    "000000100000000100000008", // vec of 8
    "0000000f00000018616c76696e6d756e6b5f61776172645f71756573745f7632", // Symbol("alvinmunk_award_quest_v2")
    "0000000d00000020cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472", // BytesN<32> network id
    "00000012000000011111111111111111111111111111111111111111111111111111111111111111", // Address, contract
    "0000000300000003", // u32 quest id
    "0000001200000000000000002222222222222222222222222222222222222222222222222222222222222222", // Address, account
    "000000050000000000093a80", // u64 period_secs = 604_800
    "000000050000000000000b91", // u64 epoch = 2961
    "00000005000000006abda4d8", // u64 expires_at = 1_790_813_400
);

#[test]
fn a_weekly_quest_payload_matches_the_documented_bytes() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger()
        .set_network_id(network_id(&env, TESTNET_ID).to_array());
    let contract = Address::from_str(
        &env,
        "CAIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRDB3V",
    );
    env.register_at(
        &contract,
        QuestRegistryContract,
        (Address::generate(&env), Address::generate(&env)),
    );
    let client = QuestRegistryContractClient::new(&env, &contract);
    client.create_quest(&3u32, &2u32, &50u64);
    client.set_quest_period(&3u32, &WEEK);
    let classic = Address::from_str(
        &env,
        "GARCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCFRVX",
    );
    env.ledger().with_mut(|l| l.timestamp = THU_2026_10_01);
    let expires_at = THU_2026_10_01 + SIG_TTL;
    let view = client.quest_payload(&3u32, &classic, &expires_at);
    assert_eq!(to_hex(&view), AWARD_V2_PAYLOAD);
}

#[test]
fn completion_views_follow_the_current_period() {
    let f = setup();
    weekly(&f, 1);
    f.quest.create_quest(&2u32, &2u32, &50u64);
    let user = Address::generate(&f.env);
    set_time(&f, THU_2026_10_01);
    award(&f, &f.attester_sk, 1, &user);
    award(&f, &f.attester_sk, 2, &user);
    assert_eq!(completed_in(&f, &user, &[1, 2]), [true, true]);

    // The weekly quest is open again next week; the one-shot stays done.
    set_time(&f, THU_2026_10_01 + WEEK);
    assert!(!f.quest.is_completed(&1u32, &user));
    assert_eq!(completed_in(&f, &user, &[1, 2, 99]), [false, true, false]);
    award(&f, &f.attester_sk, 1, &user);
    assert!(f.quest.is_completed(&1u32, &user));
}

#[test]
fn set_quest_period_validates_and_announces() {
    let f = setup();
    f.quest.create_quest(&1u32, &2u32, &50u64);
    assert_eq!(
        f.quest.try_set_quest_period(&7u32, &WEEK),
        Err(Ok(Error::QuestNotFound.into()))
    );
    assert_eq!(
        f.quest.try_set_quest_period(&1u32, &(DAY - 1)),
        Err(Ok(Error::InvalidPeriod.into()))
    );
    f.quest.set_quest_period(&1u32, &DAY); // a day is the shortest period
    assert_eq!(
        f.env.events().all(),
        vec![
            &f.env,
            (
                f.quest.address.clone(),
                (symbol_short!("quest"), symbol_short!("period")).into_val(&f.env),
                (1u32, DAY).into_val(&f.env),
            )
        ]
    );
    f.quest.set_quest_period(&1u32, &WEEK);
    assert_eq!(
        f.quest.get_quest_periods(&vec![&f.env, 1u32, 7]),
        vec![&f.env, WEEK, 0]
    );
    f.quest.set_quest_period(&1u32, &0u64); // back to one-shot
    assert_eq!(
        f.quest.get_quest_periods(&vec![&f.env, 1u32]),
        vec![&f.env, 0u64]
    );
    let stored = f.env.as_contract(&f.quest.address, || {
        f.env.storage().persistent().has(&DataKey::QuestPeriod(1))
    });
    assert!(!stored);
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn non_admin_set_quest_period_reverts() {
    let env = Env::default();
    let quest = QuestRegistryContractClient::new(
        &env,
        &env.register(
            QuestRegistryContract,
            (&Address::generate(&env), &Address::generate(&env)),
        ),
    );
    quest.set_quest_period(&1u32, &WEEK);
}

#[test]
fn back_to_one_shot_uses_the_once_ever_guard() {
    let f = setup();
    weekly(&f, 1);
    let user = Address::generate(&f.env);
    set_time(&f, THU_2026_10_01);
    award(&f, &f.attester_sk, 1, &user);

    // Weekly completions never wrote the one-shot guard: one more completion, then done.
    f.quest.set_quest_period(&1u32, &0u64);
    assert!(!f.quest.is_completed(&1u32, &user));
    award(&f, &f.attester_sk, 1, &user);
    set_time(&f, THU_2026_10_01 + WEEK);
    assert_eq!(
        try_award(&f, &f.attester_sk, 1, &user),
        Err(Error::AlreadyClaimed)
    );
    assert_eq!(f.rep.get_earned(&user), 100);
}

#[test]
fn a_period_guard_outlives_its_period() {
    for ttls in [TESTNET_TTLS, MAINNET_TTLS] {
        let f = setup_with_ttls(ttls);
        weekly(&f, 1);
        let user = Address::generate(&f.env);
        award(&f, &f.attester_sk, 1, &user);
        let epoch = f.env.ledger().timestamp() / WEEK;
        let left = ttl(&f, &DataKey::ClaimedIn(1, user.clone(), epoch));
        // Two weeks of 5s ledgers, or the network minimum (a new entry's TTL) when longer.
        assert_eq!(left, (2 * WEEK / 5).max(u64::from(ttls.0 - 1)) as u32);
        assert_eq!(ttl(&f, &DataKey::QuestPeriod(1)), BUMP_EXTEND);
    }
}

#[test]
fn upgrading_keeps_repeatable_quests() {
    let f = setup();
    weekly(&f, 1);
    let user = Address::generate(&f.env);
    set_time(&f, THU_2026_10_01);
    award(&f, &f.attester_sk, 1, &user);

    let hash = f.env.deployer().upload_contract_wasm(QUEST_WASM);
    f.quest.upgrade(&hash);

    assert_eq!(
        f.quest.get_quest_periods(&vec![&f.env, 1u32]),
        vec![&f.env, WEEK]
    );
    assert!(f.quest.is_completed(&1u32, &user));
    assert_eq!(
        try_award(&f, &f.attester_sk, 1, &user),
        Err(Error::AlreadyClaimed)
    );
    set_time(&f, THU_2026_10_01 + WEEK);
    award(&f, &f.attester_sk, 1, &user);
    assert_eq!(f.rep.get_earned(&user), 100);
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
    let id = env.register(QUEST_WASM, (&admin, &rep));
    let init = soroban_sdk::Symbol::new(&env, "init");
    let impostor = soroban_sdk::Address::generate(&env);
    let call = soroban_sdk::vec![&env, impostor.into_val(&env)];
    assert!(env
        .try_invoke_contract::<(), soroban_sdk::Error>(&id, &init, call)
        .is_err());

    let hash = env.deployer().upload_contract_wasm(QUEST_WASM);
    QuestRegistryContractClient::new(&env, &id).upgrade(&hash);
    assert_eq!(env.auths()[0].0, admin);
}
