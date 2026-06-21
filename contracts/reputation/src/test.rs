#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::Address as _, Env, String};

fn setup() -> (Env, ReputationContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let id = env.register(ReputationContract, ());
    let client = ReputationContractClient::new(&env, &id);
    client.init(&admin);
    (env, client, admin)
}

#[test]
fn vouch_grants_social_xp_to_both_on_claim() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    let id = client.mint_vouch(&alice, &bob, &String::from_str(&env, "unblocked me at 2am"));

    // Before claim: no score granted yet.
    assert_eq!(client.get_score(&bob), 0);
    assert_eq!(client.get_score(&alice), 0);

    client.claim_vouch(&bob, &id);

    // Vouches grant SOCIAL XP only (non-cashable) — never the Earned track.
    assert_eq!(client.get_score(&alice), 10);
    assert_eq!(client.get_score(&bob), 10);
    assert_eq!(client.get_earned(&alice), 0);
    assert_eq!(client.get_earned(&bob), 0);
    // Vouches are NOT attestations (the fundable primitive is verified-only).
    assert!(client.get_attestation(&bob, &1).is_none());
}

#[test]
fn repeated_pair_grants_no_more_social_xp() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    let id1 = client.mint_vouch(&alice, &bob, &String::from_str(&env, "first"));
    client.claim_vouch(&bob, &id1);
    let id2 = client.mint_vouch(&alice, &bob, &String::from_str(&env, "again"));
    client.claim_vouch(&bob, &id2);

    // first-pair-only: the second (alice->bob) vouch grants 0 extra XP.
    assert_eq!(client.get_score(&alice), 10);
    assert_eq!(client.get_score(&bob), 10);
}

#[test]
#[should_panic]
fn double_claim_reverts() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let id = client.mint_vouch(&alice, &bob, &String::from_str(&env, "gg"));
    client.claim_vouch(&bob, &id);
    client.claim_vouch(&bob, &id); // panics: AlreadyClaimed
}

#[test]
#[should_panic]
fn self_vouch_reverts() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    client.mint_vouch(&alice, &alice, &String::from_str(&env, "myself"));
}

#[test]
fn attester_award_writes_attestation() {
    let (env, client, _admin) = setup();
    let attester = Address::generate(&env);
    let user = Address::generate(&env);
    client.add_attester(&attester);
    client.award_xp(&attester, &user, &2u32, &50u64); // schema 2 = "quest"
                                                      // Attester awards credit the EARNED (cashable) track, not Social.
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
