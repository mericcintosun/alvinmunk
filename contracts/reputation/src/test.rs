#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::Address as _, Bytes, BytesN, Env, String};

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

    // Alice vouches WITHOUT knowing Bob's address (only the claim hash).
    let id = client.mint_vouch(
        &alice,
        &hash,
        &String::from_str(&env, "unblocked me at 2am"),
    );
    assert_eq!(client.get_score(&bob), 0);

    // Bob binds his address at claim time by presenting the secret.
    client.claim_vouch(&bob, &id, &secret);

    // Asymmetric (claimer 10 > voucher 5); Social only, never Earned.
    assert_eq!(client.get_score(&alice), 5);
    assert_eq!(client.get_score(&bob), 10);
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

    // first-pair-only: the repeated (alice->bob) pair grants 0 extra XP.
    assert_eq!(client.get_score(&alice), 5);
    assert_eq!(client.get_score(&bob), 10);
}

#[test]
#[should_panic]
fn daily_cap_reverts_on_overuse() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    for i in 0..=MAX_VOUCH_PER_DAY {
        let (_s, h) = secret_and_hash(&env, i as u8);
        client.mint_vouch(&alice, &h, &String::from_str(&env, "spam")); // panics on the 21st
    }
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
