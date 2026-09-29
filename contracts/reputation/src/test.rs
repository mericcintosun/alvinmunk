#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{
        storage::{Persistent as _, Temporary as _},
        Address as _, Ledger as _,
    },
    Bytes, BytesN, Env, String,
};

fn setup() -> (Env, ReputationContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let id = env.register(ReputationContract, ());
    let client = ReputationContractClient::new(&env, &id);
    client.init(&admin);
    (env, client, admin)
}

/// A secret + its sha256 hash, computed with the same env crypto the contract uses.
fn secret_and_hash(env: &Env, fill: u8) -> (Bytes, BytesN<32>) {
    let secret = Bytes::from_array(env, &[fill; 32]);
    let hash = env.crypto().sha256(&secret).to_bytes();
    (secret, hash)
}

/// Notes of exactly `MAX_NOTE_BYTES` UTF-8 bytes: ASCII, then 2-, 3- and 4-byte characters.
fn notes_at_cap() -> [std::string::String; 4] {
    [
        "a".repeat(240),
        "ş".repeat(120),
        "€".repeat(80),
        "💧".repeat(60),
    ]
}

#[test]
fn note_too_long_keeps_error_code_12() {
    // The web app maps #12 to its "note too long" copy; a renumber would break it.
    assert_eq!(Error::NoteTooLong as u32, 12);
    assert_eq!(MAX_NOTE_BYTES, 240);
}

#[test]
fn mint_vouch_accepts_note_at_240_utf8_bytes() {
    let (env, client, _admin) = setup();
    for (i, text) in notes_at_cap().iter().enumerate() {
        assert_eq!(text.len(), MAX_NOTE_BYTES as usize);
        let alice = Address::generate(&env);
        let (_secret, hash) = secret_and_hash(&env, i as u8 + 1);
        let note = String::from_str(&env, text);

        let id = client.mint_vouch(&alice, &hash, &note);

        let stored = client.get_vouch(&id).unwrap().note;
        assert_eq!(stored, note);
        assert_eq!(stored.len(), MAX_NOTE_BYTES);
    }
}

#[test]
fn mint_vouch_rejects_note_at_241_utf8_bytes() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let (_secret, hash) = secret_and_hash(&env, 2);
    // One byte over, whether the last byte comes from ASCII or from a multi-byte character,
    // then 61 four-byte characters (one past the web app's 60-character limit).
    let over = [
        "a".repeat(241),
        std::format!("{}é", "a".repeat(239)),
        std::format!("{}a", "ş".repeat(120)),
        std::format!("{}a", "💧".repeat(60)),
        "💧".repeat(61),
    ];
    for text in &over {
        assert!(text.len() > MAX_NOTE_BYTES as usize);
        assert_eq!(
            client.try_mint_vouch(&alice, &hash, &String::from_str(&env, text)),
            Err(Ok(soroban_sdk::Error::from_contract_error(12)))
        );
    }

    // Nothing was minted or escrowed: the next vouch is #1 and costs one stake.
    let id = client.mint_vouch(&alice, &hash, &String::from_str(&env, "ok"));
    assert_eq!(id, 1);
    assert_eq!(client.get_score(&alice), STARTER_SOCIAL - VOUCH_STAKE);
}

#[test]
fn max_length_note_still_claims() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let (secret, hash) = secret_and_hash(&env, 3);
    let note = String::from_str(&env, &"💧".repeat(60));
    let id = client.mint_vouch(&alice, &hash, &note);

    client.claim_vouch(&bob, &id, &secret);

    let v = client.get_vouch(&id).unwrap();
    assert!(v.claimed);
    assert_eq!(v.note, note);
}

#[test]
fn vouch_claim_secret_grants_asymmetric_social_xp() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let (secret, hash) = secret_and_hash(&env, 7);

    // Alice vouches WITHOUT knowing Bob's address (only the claim hash). Minting
    // grants her starter Social XP (20) and escrows the stake (5) -> 15.
    let id = client.mint_vouch(
        &alice,
        &hash,
        &String::from_str(&env, "unblocked me at 2am"),
    );
    assert_eq!(client.get_score(&alice), 15);
    assert_eq!(client.get_score(&bob), 0);

    // Bob binds his address at claim time by presenting the secret.
    client.claim_vouch(&bob, &id, &secret);

    // Alice's stake is refunded (timely claim) -> back to her starter 20; the 2nd-order
    // bonus is PENDING until Bob verifies. Bob: starter 20 + claim XP 10 = 30.
    // Asymmetric (claimer earns more), Social only, never Earned.
    assert_eq!(client.get_score(&alice), 20);
    assert_eq!(client.get_score(&bob), 30);
    assert_eq!(client.get_earned(&alice), 0);
    assert_eq!(client.get_earned(&bob), 0);
    assert!(client.get_attestation(&bob, &1).is_none());
}

#[test]
#[should_panic]
fn claim_with_wrong_secret_reverts() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let (_secret, hash) = secret_and_hash(&env, 7);
    let id = client.mint_vouch(&alice, &hash, &String::from_str(&env, "x"));
    let wrong = Bytes::from_array(&env, &[9u8; 32]);
    client.claim_vouch(&bob, &id, &wrong); // panics: BadSecret
}

#[test]
#[should_panic]
fn double_claim_reverts() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let (secret, hash) = secret_and_hash(&env, 7);
    let id = client.mint_vouch(&alice, &hash, &String::from_str(&env, "gg"));
    client.claim_vouch(&bob, &id, &secret);
    client.claim_vouch(&bob, &id, &secret); // panics: AlreadyClaimed
}

#[test]
#[should_panic]
fn self_vouch_reverts() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let (secret, hash) = secret_and_hash(&env, 7);
    let id = client.mint_vouch(&alice, &hash, &String::from_str(&env, "me"));
    client.claim_vouch(&alice, &id, &secret); // panics: SelfVouch
}

#[test]
fn repeated_pair_grants_no_more_social_xp() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    let (s1, h1) = secret_and_hash(&env, 1);
    let id1 = client.mint_vouch(&alice, &h1, &String::from_str(&env, "first"));
    client.claim_vouch(&bob, &id1, &s1);

    let (s2, h2) = secret_and_hash(&env, 2);
    let id2 = client.mint_vouch(&alice, &h2, &String::from_str(&env, "again"));
    client.claim_vouch(&bob, &id2, &s2);

    // first-pair-only: the repeated (alice->bob) pair grants 0 extra claim XP and no
    // extra bonus. The stake is still refunded on each timely claim, so Alice sits at
    // her starter 20 and Bob at starter 20 + the single first-pair claim XP 10 = 30.
    assert_eq!(client.get_score(&alice), 20);
    assert_eq!(client.get_score(&bob), 30);
}

#[test]
#[should_panic]
fn daily_cap_reverts_on_overuse() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    // 20 mints all succeed; claiming each refunds Alice's stake so she stays solvent.
    for i in 0..MAX_VOUCH_PER_DAY {
        let (s, h) = secret_and_hash(&env, i as u8);
        let id = client.mint_vouch(&alice, &h, &String::from_str(&env, "spam"));
        client.claim_vouch(&bob, &id, &s);
    }
    // the 21st mint in the same day exceeds the per-day cap.
    let (_s, h) = secret_and_hash(&env, 99);
    client.mint_vouch(&alice, &h, &String::from_str(&env, "spam")); // panics: DailyCapReached
}

#[test]
fn starter_social_granted_once() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // An untouched wallet has nothing.
    assert_eq!(client.get_score(&bob), 0);

    // First mint: starter 20 - stake 5 = 15.
    let (_s1, h1) = secret_and_hash(&env, 1);
    client.mint_vouch(&alice, &h1, &String::from_str(&env, "a"));
    assert_eq!(client.get_score(&alice), 15);

    // Second mint: starter is NOT re-granted -> 15 - 5 = 10.
    let (_s2, h2) = secret_and_hash(&env, 2);
    client.mint_vouch(&alice, &h2, &String::from_str(&env, "b"));
    assert_eq!(client.get_score(&alice), 10);
}

#[test]
fn stake_refunded_on_timely_claim() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let (s, h) = secret_and_hash(&env, 7);
    let id = client.mint_vouch(&alice, &h, &String::from_str(&env, "x"));
    assert_eq!(client.get_score(&alice), 15); // escrowed
    client.claim_vouch(&bob, &id, &s); // within the 7-day window
    assert_eq!(client.get_score(&alice), 20); // refunded
}

#[test]
fn stake_slashed_when_claimed_after_ttl() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let (s, h) = secret_and_hash(&env, 7);
    let id = client.mint_vouch(&alice, &h, &String::from_str(&env, "x"));
    // Jump past the 7-day window before claiming.
    env.ledger().with_mut(|l| l.timestamp = VOUCH_TTL_SECS + 1);
    client.claim_vouch(&bob, &id, &s);
    // No refund: Alice stays slashed at 15. Bob still gets the first-pair claim XP.
    assert_eq!(client.get_score(&alice), 15);
    assert_eq!(client.get_score(&bob), 30);
}

#[test]
fn expire_vouch_after_ttl_marks_slashed() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let (_s, h) = secret_and_hash(&env, 7);
    let id = client.mint_vouch(&alice, &h, &String::from_str(&env, "x"));
    env.ledger().with_mut(|l| l.timestamp = VOUCH_TTL_SECS + 1);
    client.expire_vouch(&id);
    let v = client.get_vouch(&id).unwrap();
    assert!(v.slashed);
    assert_eq!(client.get_score(&alice), 15); // staked XP stays slashed
}

#[test]
#[should_panic]
fn expire_vouch_before_ttl_reverts() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let (_s, h) = secret_and_hash(&env, 7);
    let id = client.mint_vouch(&alice, &h, &String::from_str(&env, "x"));
    client.expire_vouch(&id); // now=0 < TTL -> NotExpired
}

#[test]
fn second_order_bonus_unlocks_on_verified_action() {
    let (env, client, _admin) = setup();
    let attester = Address::generate(&env);
    client.add_attester(&attester);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    let (s, h) = secret_and_hash(&env, 7);
    let id = client.mint_vouch(&alice, &h, &String::from_str(&env, "x"));
    client.claim_vouch(&bob, &id, &s); // refund -> alice 20; bonus PENDING (bob unverified)
    assert_eq!(client.get_score(&alice), 20);
    assert!(!client.is_verified(&bob));

    // Bob does a verified quest -> his FIRST Earned action releases Alice's bonus.
    client.award_xp(&attester, &bob, &2u32, &50u64);
    assert!(client.is_verified(&bob));
    assert_eq!(client.get_score(&alice), 25); // +BONUS_VOUCHER
    assert_eq!(client.get_earned(&bob), 50);
}

#[test]
fn bonus_immediate_when_claimer_already_verified() {
    let (env, client, _admin) = setup();
    let attester = Address::generate(&env);
    client.add_attester(&attester);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // Bob verifies FIRST (no pending bonuses to release).
    client.award_xp(&attester, &bob, &2u32, &50u64);
    assert!(client.is_verified(&bob));

    // Now Alice vouches Bob -> the claim pays Alice's bonus immediately.
    let (s, h) = secret_and_hash(&env, 7);
    let id = client.mint_vouch(&alice, &h, &String::from_str(&env, "x"));
    client.claim_vouch(&bob, &id, &s); // refund 5 -> 20, + immediate bonus 5 -> 25
    assert_eq!(client.get_score(&alice), 25);
}

#[test]
#[should_panic]
fn insufficient_stake_reverts() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    // Starter 20 affords exactly 4 unclaimed stakes (4*5); the 5th has nothing left.
    for i in 0..4u8 {
        let (_s, h) = secret_and_hash(&env, i);
        client.mint_vouch(&alice, &h, &String::from_str(&env, "x"));
    }
    assert_eq!(client.get_score(&alice), 0);
    let (_s, h) = secret_and_hash(&env, 4);
    client.mint_vouch(&alice, &h, &String::from_str(&env, "x")); // panics: InsufficientStake
}

#[test]
fn attester_award_credits_earned_only() {
    let (env, client, _admin) = setup();
    let attester = Address::generate(&env);
    let user = Address::generate(&env);
    client.add_attester(&attester);
    client.award_xp(&attester, &user, &2u32, &50u64); // schema 2 = "quest"
    assert_eq!(client.get_earned(&user), 50);
    assert_eq!(client.get_score(&user), 0);
    let att = client.get_attestation(&user, &2).unwrap();
    assert_eq!(att.value, 50);
    assert!(!att.revoked);
}

#[test]
#[should_panic]
fn non_allowlisted_attester_reverts() {
    let (env, client, _admin) = setup();
    let imposter = Address::generate(&env);
    let user = Address::generate(&env);
    client.award_xp(&imposter, &user, &2u32, &50u64); // panics: NotAuthorized
}

#[test]
fn get_profile_matches_individual_getters_for_untouched_address() {
    let (env, client, _admin) = setup();
    let stranger = Address::generate(&env);
    let p = client.get_profile(&stranger);
    assert_eq!(p.social, client.get_score(&stranger));
    assert_eq!(p.earned, client.get_earned(&stranger));
    assert_eq!(p.verified, client.is_verified(&stranger));
    assert_eq!(p.social, 0);
    assert_eq!(p.earned, 0);
    assert!(!p.verified);
}

#[test]
fn get_profile_aggregates_across_social_and_earned_state_changes() {
    let (env, client, _admin) = setup();
    let attester = Address::generate(&env);
    client.add_attester(&attester);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // Vouch + claim: Social XP only, still unverified.
    let (secret, hash) = secret_and_hash(&env, 7);
    let id = client.mint_vouch(&alice, &hash, &String::from_str(&env, "hi"));
    client.claim_vouch(&bob, &id, &secret);

    let p1 = client.get_profile(&bob);
    assert_eq!(p1.social, 30);
    assert_eq!(p1.earned, 0);
    assert!(!p1.verified);

    // A verified quest flips earned + verified; profile must reflect both immediately.
    client.award_xp(&attester, &bob, &2u32, &50u64);
    let p2 = client.get_profile(&bob);
    assert_eq!(p2.social, client.get_score(&bob));
    assert_eq!(p2.earned, 50);
    assert!(p2.verified);
}

// --- Attestation accumulates per (subject, schema) (issue #123) ---

#[test]
fn awards_under_one_schema_accumulate_with_the_latest_issuer_and_time() {
    let (env, client, _admin) = setup();
    let first = Address::generate(&env);
    let second = Address::generate(&env);
    let user = Address::generate(&env);
    client.add_attester(&first);
    client.add_attester(&second);

    env.ledger().with_mut(|l| l.timestamp = 1_000);
    client.award_xp(&first, &user, &2u32, &50u64);
    let att = client.get_attestation(&user, &2).unwrap();
    assert_eq!((att.value, att.issuer, att.timestamp), (50, first, 1_000));

    // A second attester under the same schema adds to the total instead of replacing it;
    // issuer and timestamp move to the latest award.
    env.ledger().with_mut(|l| l.timestamp = 2_000);
    client.award_xp(&second, &user, &2u32, &7u64);
    let att = client.get_attestation(&user, &2).unwrap();
    assert_eq!((att.value, att.issuer, att.timestamp), (57, second, 2_000));
    assert!(!att.revoked);
    assert_eq!(client.get_earned(&user), 57);
}

#[test]
fn each_schema_and_subject_keeps_its_own_total() {
    let (env, client, _admin) = setup();
    let attester = Address::generate(&env);
    let user = Address::generate(&env);
    let other = Address::generate(&env);
    client.add_attester(&attester);

    client.award_xp(&attester, &user, &2u32, &50u64);
    client.award_xp(&attester, &user, &3u32, &10u64);
    client.award_xp(&attester, &user, &2u32, &25u64);
    client.award_xp(&attester, &user, &3u32, &4u64);
    client.award_xp(&attester, &other, &2u32, &5u64);

    assert_eq!(client.get_attestation(&user, &2).unwrap().value, 75);
    assert_eq!(client.get_attestation(&user, &3).unwrap().value, 14);
    assert!(client.get_attestation(&user, &1).is_none());
    assert_eq!(client.get_earned(&user), 89);
    assert_eq!(client.get_attestation(&other, &2).unwrap().value, 5);
    assert!(client.get_attestation(&other, &3).is_none());
}

#[test]
fn an_overflowing_award_reverts_and_leaves_the_record_intact() {
    let (env, client, _admin) = setup();
    let attester = Address::generate(&env);
    let user = Address::generate(&env);
    client.add_attester(&attester);
    client.award_xp(&attester, &user, &2u32, &u64::MAX);

    assert_eq!(
        client.try_award_xp(&attester, &user, &2u32, &1u64),
        Err(Ok(contract_err(Error::Overflow)))
    );
    let att = client.get_attestation(&user, &2).unwrap();
    assert_eq!(att.value, i128::from(u64::MAX));
    assert_eq!(client.get_earned(&user), u64::MAX);
}

/// The per-schema sum is checked on its own, not only through the Earned total: a record at
/// the u64 ceiling rejects the next award under its schema even when Earned has room.
#[test]
fn attestation_total_overflow_reverts_even_when_earned_has_room() {
    let (env, client, _admin) = setup();
    let attester = Address::generate(&env);
    let user = Address::generate(&env);
    client.add_attester(&attester);
    // Seeded directly: through award_xp alone the Earned total would overflow first.
    let ceiling = Attestation {
        issuer: attester.clone(),
        value: i128::from(u64::MAX),
        timestamp: 0,
        revoked: false,
    };
    env.as_contract(&client.address, || {
        env.storage()
            .persistent()
            .set(&DataKey::Attestation(user.clone(), 2), &ceiling);
    });

    assert_eq!(
        client.try_award_xp(&attester, &user, &2u32, &1u64),
        Err(Ok(contract_err(Error::Overflow)))
    );
    assert_eq!(client.get_earned(&user), 0);
    assert_eq!(
        client.get_attestation(&user, &2).unwrap().value,
        i128::from(u64::MAX)
    );
    // Other schemas are unaffected.
    client.award_xp(&attester, &user, &3u32, &1u64);
    assert_eq!(client.get_attestation(&user, &3).unwrap().value, 1);
}

/// The frozen `att_set` v1 layout is unchanged: `amount` is still the award's delta, and
/// only the stored record carries the running total.
#[test]
fn att_set_still_carries_the_award_delta_in_the_v1_layout() {
    use soroban_sdk::{testutils::Events as _, vec, IntoVal, Val};
    let (env, client, _admin) = setup();
    let attester = Address::generate(&env);
    let user = Address::generate(&env);
    client.add_attester(&attester);
    env.ledger().with_mut(|l| l.timestamp = 5_000);
    client.award_xp(&attester, &user, &2u32, &50u64);
    client.award_xp(&attester, &user, &2u32, &7u64);

    // `all()` holds the last invocation's events.
    let att_set: (Address, Vec<Val>, Val) = (
        client.address.clone(),
        (symbol_short!("att_set"), user.clone()).into_val(&env),
        (1u32, attester.clone(), 2u32, 7u64, 5_000u64).into_val(&env),
    );
    let xp: (Address, Vec<Val>, Val) = (
        client.address.clone(),
        (symbol_short!("xp"), user.clone()).into_val(&env),
        (7u64, 57u64).into_val(&env),
    );
    assert_eq!(env.events().all(), vec![&env, att_set, xp]);
    assert_eq!(client.get_attestation(&user, &2).unwrap().value, 57);
}

/// A caller compiled against the four-field `Attestation` (another contract, or a generated
/// binding) — and the shape of every record already on chain.
#[contracttype]
#[derive(Clone)]
pub struct LegacyAttestation {
    pub issuer: Address,
    pub value: i128,
    pub timestamp: u64,
    pub revoked: bool,
}

#[test]
fn a_record_from_before_accumulation_decodes_and_counts_on() {
    use soroban_sdk::{vec, IntoVal};
    let (env, client, _admin) = setup();
    let old_issuer = Address::generate(&env);
    let attester = Address::generate(&env);
    let user = Address::generate(&env);
    client.add_attester(&attester);
    // What the old code left after awards of 50 then 25 under schema 2: only the last one.
    let legacy = LegacyAttestation {
        issuer: old_issuer,
        value: 25,
        timestamp: 100,
        revoked: false,
    };
    env.as_contract(&client.address, || {
        env.storage()
            .persistent()
            .set(&DataKey::Attestation(user.clone(), 2), &legacy);
    });

    env.ledger().with_mut(|l| l.timestamp = 200);
    client.award_xp(&attester, &user, &2u32, &10u64);

    let att: Option<LegacyAttestation> = env.invoke_contract(
        &client.address,
        &Symbol::new(&env, "get_attestation"),
        vec![&env, user.into_val(&env), 2u32.into_val(&env)],
    );
    let att = att.unwrap();
    assert_eq!(
        (att.value, att.issuer, att.timestamp, att.revoked),
        (35, attester, 200, false)
    );
}

// --- Property/fuzz tests on the XP math (Green-belt AC) ---
use proptest::prelude::*;

proptest! {
    #![proptest_config(ProptestConfig::with_cases(40))]

    /// Invariant: Earned XP equals the EXACT sum of attester awards (no mint, no loss),
    /// and the Earned path never credits Social (two-track keystone) — for any sequence.
    #[test]
    fn earned_equals_sum_of_awards_and_social_untouched(
        amounts in prop::collection::vec(0u64..1000, 1..15)
    ) {
        let (env, client, _admin) = setup();
        let attester = Address::generate(&env);
        client.add_attester(&attester);
        let user = Address::generate(&env);
        let mut total = 0u64;
        for (i, a) in amounts.iter().enumerate() {
            client.award_xp(&attester, &user, &(i as u32), a);
            total += *a;
        }
        prop_assert_eq!(client.get_earned(&user), total);
        prop_assert_eq!(client.get_score(&user), 0);
    }

    /// Invariant: each attestation's value is the exact sum of the awards under its schema,
    /// and the values over all schemas add up to Earned — for any interleaving.
    #[test]
    fn attestation_value_is_the_per_schema_sum_of_awards(
        awards in prop::collection::vec((0u32..3, 0u64..1000), 1..15)
    ) {
        let (env, client, _admin) = setup();
        let attester = Address::generate(&env);
        client.add_attester(&attester);
        let user = Address::generate(&env);
        let mut per_schema = [0u64; 3];
        for (schema, a) in awards.iter() {
            client.award_xp(&attester, &user, schema, a);
            per_schema[*schema as usize] += *a;
        }
        for (schema, total) in per_schema.iter().enumerate() {
            let value = client
                .get_attestation(&user, &(schema as u32))
                .map_or(0, |att| att.value);
            prop_assert_eq!(value, i128::from(*total));
        }
        prop_assert_eq!(client.get_earned(&user), per_schema.iter().sum::<u64>());
    }
}

// --- On-chain people counters (issue #273) ---

/// Mint a half-card from `from` and claim it as `claimer` (fresh secret per `fill`).
fn vouch(
    env: &Env,
    client: &ReputationContractClient,
    from: &Address,
    claimer: &Address,
    fill: u8,
) {
    let (s, h) = secret_and_hash(env, fill);
    let id = client.mint_vouch(from, &h, &String::from_str(env, "hey"));
    client.claim_vouch(claimer, &id, &s);
}

/// The host error a `panic_with_error!(Error::X)` surfaces as through a `try_` call.
fn contract_err(e: Error) -> soroban_sdk::Error {
    soroban_sdk::Error::from_contract_error(e as u32)
}

#[test]
fn get_counts_both_zero_for_fresh_address() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    assert_eq!(client.get_counts(&alice), (0, 0));
}

#[test]
fn counters_increment_on_first_pair_claim() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    vouch(&env, &client, &alice, &bob, 7);

    // Bob was vouched BY Alice; Alice BACKED Bob. Each side moves only its own counter.
    assert_eq!(client.get_counts(&bob), (1, 0));
    assert_eq!(client.get_counts(&alice), (0, 1));
}

#[test]
fn counters_not_incremented_on_repeated_pair() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    vouch(&env, &client, &alice, &bob, 1);
    // Same (alice -> bob) pair again: the claim succeeds but is not a fresh pair.
    vouch(&env, &client, &alice, &bob, 2);
    vouch(&env, &client, &alice, &bob, 3);

    assert_eq!(
        client.get_counts(&bob),
        (1, 0),
        "repeat pair must not move vouched_by"
    );
    assert_eq!(
        client.get_counts(&alice),
        (0, 1),
        "repeat pair must not move backed"
    );
}

#[test]
fn self_vouch_leaves_counters_untouched() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let (s, h) = secret_and_hash(&env, 7);
    let id = client.mint_vouch(&alice, &h, &String::from_str(&env, "me"));

    assert_eq!(
        client.try_claim_vouch(&alice, &id, &s),
        Err(Ok(contract_err(Error::SelfVouch)))
    );
    assert_eq!(client.get_counts(&alice), (0, 0));
}

#[test]
fn rejected_claims_leave_counters_untouched() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);
    let (s, h) = secret_and_hash(&env, 7);
    let id = client.mint_vouch(&alice, &h, &String::from_str(&env, "x"));

    let wrong = Bytes::from_array(&env, &[9u8; 32]);
    assert_eq!(
        client.try_claim_vouch(&bob, &id, &wrong),
        Err(Ok(contract_err(Error::BadSecret)))
    );
    assert_eq!(client.get_counts(&bob), (0, 0));
    assert_eq!(client.get_counts(&alice), (0, 0));

    client.claim_vouch(&bob, &id, &s);
    // Re-claiming the same card (by anyone) is rejected and counts nothing.
    assert_eq!(
        client.try_claim_vouch(&carol, &id, &s),
        Err(Ok(contract_err(Error::AlreadyClaimed)))
    );
    assert_eq!(client.get_counts(&carol), (0, 0));
    assert_eq!(client.get_counts(&alice), (0, 1));
}

#[test]
fn reverse_pair_is_a_distinct_first_pair() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    vouch(&env, &client, &alice, &bob, 1);
    vouch(&env, &client, &bob, &alice, 2);

    // Alice vouched Bob and Bob vouched Alice back: each was vouched by one person and
    // backed one person.
    assert_eq!(client.get_counts(&alice), (1, 1));
    assert_eq!(client.get_counts(&bob), (1, 1));
}

#[test]
fn both_counters_count_distinct_people() {
    let (env, client, _admin) = setup();
    let carol = Address::generate(&env);
    let dave = Address::generate(&env);

    // Three different people vouch Carol (one of them twice).
    let vouchers = [
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
    ];
    for (i, v) in vouchers.iter().enumerate() {
        vouch(&env, &client, v, &carol, i as u8);
    }
    vouch(&env, &client, &vouchers[0], &carol, 10);
    assert_eq!(client.get_counts(&carol), (3, 0));
    for v in vouchers.iter() {
        assert_eq!(client.get_counts(v), (0, 1));
    }

    // Carol backs two different people.
    vouch(&env, &client, &carol, &dave, 20);
    vouch(&env, &client, &carol, &vouchers[1], 21);
    assert_eq!(client.get_counts(&carol), (3, 2));
    assert_eq!(client.get_counts(&vouchers[1]), (1, 1));
}

/// A caller compiled against the original three-field `Profile` (another contract, or a
/// generated binding). Soroban decodes a struct only when the map has exactly its fields,
/// so this is what breaks if `Profile` ever grows.
#[contracttype]
#[derive(Clone)]
pub struct LegacyProfile {
    pub social: u64,
    pub earned: u64,
    pub verified: bool,
}

#[test]
fn get_profile_keeps_its_three_field_shape_for_existing_callers() {
    use soroban_sdk::{vec, IntoVal};
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    vouch(&env, &client, &alice, &bob, 7);

    let p: LegacyProfile = env.invoke_contract(
        &client.address,
        &Symbol::new(&env, "get_profile"),
        vec![&env, bob.into_val(&env)],
    );
    assert_eq!(p.social, 30);
    assert_eq!(p.earned, 0);
    assert!(!p.verified);
    assert_eq!(client.get_counts(&bob), (1, 0));
}

// --- Pending 2nd-order bonuses read view (issue #275) ---

#[test]
fn get_pending_is_empty_for_an_untouched_address() {
    let (env, client, _admin) = setup();
    let stranger = Address::generate(&env);
    assert_eq!(client.get_pending(&stranger).len(), 0);
}

#[test]
fn get_pending_lists_queued_bonuses_until_the_claimer_verifies() {
    let (env, client, _admin) = setup();
    let attester = Address::generate(&env);
    client.add_attester(&attester);
    let alice = Address::generate(&env);
    let carol = Address::generate(&env);
    let bob = Address::generate(&env);

    vouch(&env, &client, &alice, &bob, 1);
    vouch(&env, &client, &carol, &bob, 2);
    // A repeat pair queues nothing new.
    vouch(&env, &client, &alice, &bob, 3);

    let pending = client.get_pending(&bob);
    assert_eq!(pending.len(), 2);
    let first = pending.get(0).unwrap();
    let second = pending.get(1).unwrap();
    assert_eq!(
        (first.voucher, first.amount),
        (alice.clone(), BONUS_VOUCHER)
    );
    assert_eq!(
        (second.voucher, second.amount),
        (carol.clone(), BONUS_VOUCHER)
    );
    // Pending is Bob's queue, not a list of what Alice is owed.
    assert_eq!(client.get_pending(&alice).len(), 0);

    // Bob's first verified action pays the queue out and clears it.
    client.award_xp(&attester, &bob, &2u32, &50u64);
    assert_eq!(client.get_pending(&bob).len(), 0);
    assert_eq!(client.get_score(&alice), 25);
    assert_eq!(client.get_score(&carol), 25);
}

#[test]
fn get_pending_stays_empty_when_the_claimer_was_already_verified() {
    let (env, client, _admin) = setup();
    let attester = Address::generate(&env);
    client.add_attester(&attester);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    client.award_xp(&attester, &bob, &2u32, &50u64);

    vouch(&env, &client, &alice, &bob, 1);
    // The bonus was paid at claim time, so nothing is waiting.
    assert_eq!(client.get_pending(&bob).len(), 0);
    assert_eq!(client.get_score(&alice), 25);
}

/// Release build of this contract, committed so the upgrade path can be tested without a
/// wasm build step in CI. Refresh with `make upgrade-fixtures` after changing the contract.
const REPUTATION_WASM: &[u8] = include_bytes!("../testdata/alvinmunk_reputation.wasm");

#[test]
fn upgrade_to_identical_wasm_preserves_scores_and_attesters() {
    let (env, client, _admin) = setup();
    let attester = Address::generate(&env);
    client.add_attester(&attester);
    let user = Address::generate(&env);
    client.award_xp(&attester, &user, &2u32, &30u64);

    let hash = env.deployer().upload_contract_wasm(REPUTATION_WASM);
    client.upgrade(&hash);

    assert_eq!(client.get_earned(&user), 30);
    assert!(client.is_attester(&attester));
    // The allowlist still works on the upgraded code, and the attestation written before the
    // upgrade keeps accumulating under it.
    client.award_xp(&attester, &user, &2u32, &20u64);
    assert_eq!(client.get_earned(&user), 50);
    assert_eq!(client.get_attestation(&user, &2).unwrap().value, 50);
}

#[test]
fn upgrade_preserves_people_counters() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);
    vouch(&env, &client, &alice, &bob, 1);

    let hash = env.deployer().upload_contract_wasm(REPUTATION_WASM);
    client.upgrade(&hash);

    assert_eq!(client.get_counts(&bob), (1, 0));
    assert_eq!(client.get_counts(&alice), (0, 1));
    // Alice's bonus queued before the upgrade is still readable after it.
    assert_eq!(client.get_pending(&bob).len(), 1);
    // The first-pair guard carries across the upgrade: a repeat pair still counts nothing,
    // a new pair still counts once.
    vouch(&env, &client, &alice, &bob, 2);
    vouch(&env, &client, &alice, &carol, 3);
    assert_eq!(client.get_counts(&bob), (1, 0));
    assert_eq!(client.get_counts(&alice), (0, 2));
}

#[test]
fn upgrade_keeps_notes_and_enforces_the_note_cap() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let (secret, h1) = secret_and_hash(&env, 1);
    let note = String::from_str(&env, &"ş".repeat(120));
    let id = client.mint_vouch(&alice, &h1, &note);

    let hash = env.deployer().upload_contract_wasm(REPUTATION_WASM);
    client.upgrade(&hash);

    // A vouch minted before the upgrade decodes and claims as before.
    client.claim_vouch(&bob, &id, &secret);
    assert_eq!(client.get_vouch(&id).unwrap().note, note);
    // The deployed build carries the cap.
    let (_s2, h2) = secret_and_hash(&env, 2);
    let over = String::from_str(&env, &std::format!("{}a", "ş".repeat(120)));
    assert_eq!(
        client.try_mint_vouch(&alice, &h2, &over),
        Err(Ok(contract_err(Error::NoteTooLong)))
    );
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn non_admin_upgrade_reverts() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let id = env.register(ReputationContract, ());
    let client = ReputationContractClient::new(&env, &id);
    client.init(&admin);
    let hash = soroban_sdk::BytesN::from_array(&env, &[1; 32]);
    client.upgrade(&hash);
}

// --- Storage TTLs ---

/// Live `state_archival` settings from `stellar network settings` (checked 2026-09-28):
/// (min_persistent_ttl, min_temporary_ttl, max_entry_ttl).
const TESTNET_TTLS: (u32, u32, u32) = (120_960, 720, 3_110_400);
const MAINNET_TTLS: (u32, u32, u32) = (2_073_600, 17_280, 3_110_400);

/// `setup()` on a ledger with the given network TTL limits. The limits are set before the
/// contract is registered so its instance gets the same TTLs as on the network.
fn setup_with_ttls(
    (min_persistent, min_temp, max_ttl): (u32, u32, u32),
) -> (Env, ReputationContractClient<'static>) {
    let env = Env::default();
    env.ledger().with_mut(|l| {
        l.sequence_number = 1_000;
        l.min_persistent_entry_ttl = min_persistent;
        l.min_temp_entry_ttl = min_temp;
        l.max_entry_ttl = max_ttl;
    });
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let id = env.register(ReputationContract, ());
    let client = ReputationContractClient::new(&env, &id);
    client.init(&admin);
    (env, client)
}

fn ttl(env: &Env, client: &ReputationContractClient, key: &DataKey) -> u32 {
    env.as_contract(&client.address, || env.storage().persistent().get_ttl(key))
}

fn temp_ttl(env: &Env, client: &ReputationContractClient, key: &DataKey) -> u32 {
    env.as_contract(&client.address, || env.storage().temporary().get_ttl(key))
}

/// A new entry starts at the network's min_persistent_ttl; the bump right after each write
/// must still lift it to BUMP_EXTEND, on testnet and on mainnet.
#[test]
fn writes_extend_persistent_entries_to_bump_extend() {
    for ttls in [TESTNET_TTLS, MAINNET_TTLS] {
        let (env, client) = setup_with_ttls(ttls);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let attester = Address::generate(&env);
        client.add_attester(&attester);
        let (secret, h) = secret_and_hash(&env, 7);

        let id = client.mint_vouch(&alice, &h, &String::from_str(&env, "hi"));
        client.claim_vouch(&bob, &id, &secret);
        // Bob is not verified yet, so Alice's 2nd-order bonus is queued under Pending(bob).
        assert_eq!(
            ttl(&env, &client, &DataKey::Pending(bob.clone())),
            BUMP_EXTEND
        );
        client.award_xp(&attester, &bob, &2u32, &40u64);

        for key in [
            DataKey::Vouch(id),
            DataKey::Started(alice.clone()),
            DataKey::Social(alice.clone()),
            DataKey::Started(bob.clone()),
            DataKey::Social(bob.clone()),
            DataKey::Seen(alice.clone(), bob.clone()),
            DataKey::Earned(bob.clone()),
            DataKey::Attestation(bob.clone(), 2),
            DataKey::Verified(bob.clone()),
        ] {
            assert_eq!(ttl(&env, &client, &key), BUMP_EXTEND);
        }
    }
}

/// The per-day vouch counter is temporary and lives ~2 days, not the persistent target.
#[test]
fn daily_vouch_counter_lives_two_days() {
    for ttls in [TESTNET_TTLS, MAINNET_TTLS] {
        let (env, client) = setup_with_ttls(ttls);
        let alice = Address::generate(&env);
        let (_s, h) = secret_and_hash(&env, 7);
        client.mint_vouch(&alice, &h, &String::from_str(&env, "hi"));
        let key = DataKey::DailyCount(alice.clone(), 0);
        assert_eq!(temp_ttl(&env, &client, &key), DAY_LEDGERS * 2);
    }
}

/// A later write tops an entry back up once a day has passed, and a write within the same
/// day leaves it alone (no rent paid for a few ledgers at a time).
#[test]
fn later_writes_top_the_ttl_back_up() {
    let (env, client) = setup_with_ttls(TESTNET_TTLS);
    let alice = Address::generate(&env);
    let (_s1, h1) = secret_and_hash(&env, 1);
    let (_s2, h2) = secret_and_hash(&env, 2);
    let (_s3, h3) = secret_and_hash(&env, 3);
    let social = DataKey::Social(alice.clone());

    let first = client.mint_vouch(&alice, &h1, &String::from_str(&env, "a"));
    env.ledger().with_mut(|l| l.sequence_number += 100);
    client.mint_vouch(&alice, &h2, &String::from_str(&env, "b"));
    assert_eq!(ttl(&env, &client, &social), BUMP_EXTEND - 100);

    env.ledger().with_mut(|l| {
        l.sequence_number += DAY_LEDGERS * 3;
        l.timestamp += DAY_SECS * 3;
    });
    client.mint_vouch(&alice, &h3, &String::from_str(&env, "c"));
    assert_eq!(ttl(&env, &client, &social), BUMP_EXTEND);
    // The first half-card was not written again, so it kept ageing.
    assert_eq!(
        ttl(&env, &client, &DataKey::Vouch(first)),
        BUMP_EXTEND - 100 - DAY_LEDGERS * 3
    );
}
