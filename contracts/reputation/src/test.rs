#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
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
}
