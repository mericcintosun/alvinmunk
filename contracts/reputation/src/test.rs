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
    let id = env.register(ReputationContract, (&admin,));
    let client = ReputationContractClient::new(&env, &id);
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
fn claim_with_wrong_secret_reverts() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let (_secret, hash) = secret_and_hash(&env, 7);
    let id = client.mint_vouch(&alice, &hash, &String::from_str(&env, "x"));
    let wrong = Bytes::from_array(&env, &[9u8; 32]);
    assert_eq!(
        client.try_claim_vouch(&bob, &id, &wrong),
        Err(Ok(contract_err(Error::BadSecret)))
    );
}

#[test]
fn double_claim_reverts() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let (secret, hash) = secret_and_hash(&env, 7);
    let id = client.mint_vouch(&alice, &hash, &String::from_str(&env, "gg"));
    client.claim_vouch(&bob, &id, &secret);
    assert_eq!(
        client.try_claim_vouch(&bob, &id, &secret),
        Err(Ok(contract_err(Error::AlreadyClaimed)))
    );
}

// --- Cancel an unclaimed half-card whose link leaked (issue #137) ---

#[test]
fn cancelled_keeps_error_code_16() {
    // Appended after BadBatchSize: the web maps #16 to its "cancelled" copy.
    assert_eq!(Error::BadBatchSize as u32, 15);
    assert_eq!(Error::Cancelled as u32, 16);
}

#[test]
fn a_cancelled_card_cannot_be_claimed_with_its_secret() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let (secret, hash) = secret_and_hash(&env, 7);
    let id = client.mint_vouch(&alice, &hash, &String::from_str(&env, "leaked"));
    assert!(!client.is_cancelled(&id));

    client.cancel_vouch(&alice, &id);

    assert!(client.is_cancelled(&id));
    assert_eq!(
        client.try_claim_vouch(&bob, &id, &secret),
        Err(Ok(contract_err(Error::Cancelled)))
    );
    // Nothing moved: the card is untouched and Bob got no starter or claim XP.
    let v = client.get_vouch(&id).unwrap();
    assert!(!v.claimed && v.claimer.is_none() && !v.slashed);
    assert_eq!(client.get_score(&bob), 0);
    assert_eq!(client.get_counts(&bob), (0, 0));
}

#[test]
fn a_cancelled_card_cannot_be_claimed_with_a_valid_signature() {
    let (env, client, _admin) = setup_testnet();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let sk = link_key(7);
    let id = mint_signed(&env, &client, &alice, &sk);
    let sig = claim_sig(&env, &client, &sk, id, &bob);

    client.cancel_vouch(&alice, &id);

    assert_eq!(
        client.try_claim_vouch_signed(&bob, &id, &sig),
        Err(Ok(contract_err(Error::Cancelled)))
    );
    assert!(!client.get_vouch(&id).unwrap().claimed);
}

#[test]
fn only_the_voucher_can_cancel() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let (secret, hash) = secret_and_hash(&env, 7);
    let id = client.mint_vouch(&alice, &hash, &String::from_str(&env, "x"));

    assert_eq!(
        client.try_cancel_vouch(&bob, &id),
        Err(Ok(contract_err(Error::NotAuthorized)))
    );
    // The failed attempt left the card live: it still claims.
    assert!(!client.is_cancelled(&id));
    client.claim_vouch(&bob, &id, &secret);
    assert!(client.get_vouch(&id).unwrap().claimed);
}

#[test]
fn cancel_takes_the_vouchers_own_auth() {
    use soroban_sdk::testutils::{AuthorizedFunction, AuthorizedInvocation};
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let (_secret, hash) = secret_and_hash(&env, 7);
    let id = client.mint_vouch(&alice, &hash, &String::from_str(&env, "x"));

    client.cancel_vouch(&alice, &id);
    assert_eq!(
        env.auths(),
        std::vec![(
            alice.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    client.address.clone(),
                    Symbol::new(&env, "cancel_vouch"),
                    (alice.clone(), id).into_val(&env),
                )),
                sub_invocations: std::vec![],
            }
        )]
    );
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn cancel_without_the_vouchers_auth_reverts() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let (_secret, hash) = secret_and_hash(&env, 7);
    let id = client.mint_vouch(&alice, &hash, &String::from_str(&env, "x"));

    env.set_auths(&[]);
    client.cancel_vouch(&alice, &id);
}

#[test]
fn cancelling_does_not_refund_the_stake() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let (_secret, hash) = secret_and_hash(&env, 7);
    let id = client.mint_vouch(&alice, &hash, &String::from_str(&env, "x"));
    assert_eq!(client.get_score(&alice), STARTER_SOCIAL - VOUCH_STAKE);

    client.cancel_vouch(&alice, &id);
    assert_eq!(client.get_score(&alice), STARTER_SOCIAL - VOUCH_STAKE);

    // The stake stays forfeit after the window too: the keeper's slash refunds nothing.
    env.ledger().with_mut(|l| l.timestamp = VOUCH_TTL_SECS + 1);
    client.expire_vouch(&id);
    assert!(client.get_vouch(&id).unwrap().slashed);
    assert!(client.is_cancelled(&id));
    assert_eq!(client.get_score(&alice), STARTER_SOCIAL - VOUCH_STAKE);
}

#[test]
fn a_claimed_card_cannot_be_cancelled() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let (secret, hash) = secret_and_hash(&env, 7);
    let id = client.mint_vouch(&alice, &hash, &String::from_str(&env, "x"));
    client.claim_vouch(&bob, &id, &secret);

    assert_eq!(
        client.try_cancel_vouch(&alice, &id),
        Err(Ok(contract_err(Error::AlreadyClaimed)))
    );
    assert!(!client.is_cancelled(&id));
}

#[test]
fn a_card_cancels_only_once() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let (_secret, hash) = secret_and_hash(&env, 7);
    let id = client.mint_vouch(&alice, &hash, &String::from_str(&env, "x"));
    client.cancel_vouch(&alice, &id);

    assert_eq!(
        client.try_cancel_vouch(&alice, &id),
        Err(Ok(contract_err(Error::Cancelled)))
    );
}

#[test]
fn cancelling_an_unknown_card_reverts_with_vouch_not_found() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    assert_eq!(
        client.try_cancel_vouch(&alice, &99),
        Err(Ok(contract_err(Error::VouchNotFound)))
    );
    assert!(!client.is_cancelled(&99));
}

#[test]
fn a_card_past_its_window_can_still_be_cancelled_before_a_late_claim() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let (secret, hash) = secret_and_hash(&env, 7);
    let id = client.mint_vouch(&alice, &hash, &String::from_str(&env, "x"));
    env.ledger().with_mut(|l| l.timestamp = VOUCH_TTL_SECS + 1);

    // A late claim would still land (slashing, no refund) — cancelling stops it.
    client.cancel_vouch(&alice, &id);
    assert_eq!(
        client.try_claim_vouch(&bob, &id, &secret),
        Err(Ok(contract_err(Error::Cancelled)))
    );
}

#[test]
fn cancelling_one_card_leaves_the_vouchers_other_cards_claimable() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let (s1, h1) = secret_and_hash(&env, 1);
    let (s2, h2) = secret_and_hash(&env, 2);
    let leaked = client.mint_vouch(&alice, &h1, &String::from_str(&env, "leaked"));
    let fine = client.mint_vouch(&alice, &h2, &String::from_str(&env, "fine"));

    client.cancel_vouch(&alice, &leaked);

    assert!(!client.is_cancelled(&fine));
    client.claim_vouch(&bob, &fine, &s2);
    assert_eq!(
        client.try_claim_vouch(&bob, &leaked, &s1),
        Err(Ok(contract_err(Error::Cancelled)))
    );
}

/// `vouch` / `cancelled` (docs/ON_CHAIN_EVENTS.md §1): (vouch_id, from), and nothing else —
/// no `social` event, since nothing is refunded.
#[test]
fn cancel_emits_only_the_documented_cancelled_event() {
    use soroban_sdk::{testutils::Events as _, vec, IntoVal, Val};
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let (_secret, hash) = secret_and_hash(&env, 7);
    let id = client.mint_vouch(&alice, &hash, &String::from_str(&env, "x"));

    client.cancel_vouch(&alice, &id);

    let cancelled: (Address, Vec<Val>, Val) = (
        client.address.clone(),
        (symbol_short!("vouch"), symbol_short!("cancelled")).into_val(&env),
        (id, alice.clone()).into_val(&env),
    );
    assert_eq!(env.events().all(), vec![&env, cancelled]);
}

#[test]
fn cancellation_entry_is_bumped_like_a_vouch() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let (_secret, hash) = secret_and_hash(&env, 7);
    let id = client.mint_vouch(&alice, &hash, &String::from_str(&env, "x"));
    client.cancel_vouch(&alice, &id);

    let ttl = env.as_contract(&client.address, || {
        env.storage().persistent().get_ttl(&DataKey::Cancelled(id))
    });
    assert_eq!(ttl, BUMP_EXTEND);
}

#[test]
fn self_vouch_reverts() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let (secret, hash) = secret_and_hash(&env, 7);
    let id = client.mint_vouch(&alice, &hash, &String::from_str(&env, "me"));
    assert_eq!(
        client.try_claim_vouch(&alice, &id, &secret),
        Err(Ok(contract_err(Error::SelfVouch)))
    );
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
    assert_eq!(
        client.try_mint_vouch(&alice, &h, &String::from_str(&env, "spam")),
        Err(Ok(contract_err(Error::DailyCapReached)))
    );
}

/// The cap counts per voucher per UTC calendar day (`timestamp / DAY_SECS`), not over a
/// rolling 24 hours: a full day's mints at 23:59:59 and another full day's at 00:00:00 are
/// both allowed (issue #133).
#[test]
fn daily_cap_resets_at_utc_boundary() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);
    let (_s, h) = secret_and_hash(&env, 99);
    let spam = String::from_str(&env, "spam");

    // Last second of day 0: Alice uses her whole allowance (each claim refunds her stake).
    env.ledger().with_mut(|l| l.timestamp = DAY_SECS - 1);
    for i in 0..MAX_VOUCH_PER_DAY {
        vouch(&env, &client, &alice, &bob, i as u8);
    }
    assert_eq!(
        client.try_mint_vouch(&alice, &h, &spam),
        Err(Ok(contract_err(Error::DailyCapReached)))
    );
    // Caps are per voucher: Carol still mints while Alice is capped.
    vouch(&env, &client, &carol, &bob, 100);

    // First second of day 1: Alice has a whole new allowance, and it is capped again.
    env.ledger().with_mut(|l| l.timestamp = DAY_SECS);
    for i in 0..MAX_VOUCH_PER_DAY {
        vouch(&env, &client, &alice, &bob, 200 + i as u8);
    }
    assert_eq!(
        client.try_mint_vouch(&alice, &h, &spam),
        Err(Ok(contract_err(Error::DailyCapReached)))
    );
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
    // The stored vouch must record the slash (#122: was always false before the fix).
    assert!(client.get_vouch(&id).unwrap().slashed);
}

/// A late claim emits exactly one `vouch`/`slashed` carrying the stake BEFORE
/// `vouch`/`claimed` — the same event order as `expire_vouch` (issue #122).
#[test]
fn late_claim_emits_slashed_then_claimed_events() {
    use soroban_sdk::{testutils::Events as _, vec, IntoVal, Val};
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let (s, h) = secret_and_hash(&env, 7);
    let id = client.mint_vouch(&alice, &h, &String::from_str(&env, "x"));
    env.ledger().with_mut(|l| l.timestamp = VOUCH_TTL_SECS + 1);
    client.claim_vouch(&bob, &id, &s);

    // No social/refund event because the stake is slashed, not refunded.
    // Events in order:
    //   1. vouch/slashed(id, alice, VOUCH_STAKE)  <- emitted before claimed
    //   2. social(bob, XP_CLAIMER, 30)            <- fresh-pair claim XP
    //   3. vouch/claimed(id, alice, bob)
    let slashed: (Address, Vec<Val>, Val) = (
        client.address.clone(),
        (symbol_short!("vouch"), symbol_short!("slashed")).into_val(&env),
        (id, alice.clone(), VOUCH_STAKE).into_val(&env),
    );
    let bob_xp: (Address, Vec<Val>, Val) = (
        client.address.clone(),
        (symbol_short!("social"), bob.clone()).into_val(&env),
        (XP_CLAIMER, 30u64).into_val(&env),
    );
    let claimed: (Address, Vec<Val>, Val) = (
        client.address.clone(),
        (symbol_short!("vouch"), symbol_short!("claimed")).into_val(&env),
        (id, alice.clone(), bob.clone()).into_val(&env),
    );
    assert_eq!(env.events().all(), vec![&env, slashed, bob_xp, claimed]);
}

/// A card `expire_vouch` already slashed can still be claimed, but its stake is slashed
/// once: the claim neither refunds it nor announces a second `vouch`/`slashed`.
#[test]
fn claim_after_expire_vouch_does_not_slash_twice() {
    use soroban_sdk::{testutils::Events as _, IntoVal};
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let (s, h) = secret_and_hash(&env, 7);
    let id = client.mint_vouch(&alice, &h, &String::from_str(&env, "x"));
    env.ledger().with_mut(|l| l.timestamp = VOUCH_TTL_SECS + 1);
    client.expire_vouch(&id);
    client.claim_vouch(&bob, &id, &s);

    // Events of the claim transaction only: no second slash.
    let slashed_topics: soroban_sdk::Vec<soroban_sdk::Val> =
        (symbol_short!("vouch"), symbol_short!("slashed")).into_val(&env);
    let slashes = env
        .events()
        .all()
        .iter()
        .filter(|(_, topics, _)| *topics == slashed_topics)
        .count();
    assert_eq!(slashes, 0);
    let v = client.get_vouch(&id).unwrap();
    assert!(v.slashed && v.claimed);
    assert_eq!(client.get_score(&alice), 15); // stake stays slashed, never refunded
    assert_eq!(client.get_score(&bob), STARTER_SOCIAL + XP_CLAIMER); // the claimer still earns
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
fn expire_vouch_before_ttl_reverts() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let (_s, h) = secret_and_hash(&env, 7);
    let id = client.mint_vouch(&alice, &h, &String::from_str(&env, "x"));
    // now = 0, well inside the window
    assert_eq!(
        client.try_expire_vouch(&id),
        Err(Ok(contract_err(Error::NotExpired)))
    );
    assert!(!client.get_vouch(&id).unwrap().slashed);
}

#[test]
fn expire_vouch_unknown_id_reverts_with_vouch_not_found() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let (_s, h) = secret_and_hash(&env, 7);
    let id = client.mint_vouch(&alice, &h, &String::from_str(&env, "x"));
    env.ledger().with_mut(|l| l.timestamp = VOUCH_TTL_SECS + 1);
    // The id right after the only minted card was never minted.
    assert_eq!(
        client.try_expire_vouch(&(id + 1)),
        Err(Ok(contract_err(Error::VouchNotFound)))
    );
}

/// Both claim entrypoints reject an id that was never minted, before checking the
/// secret or signature.
#[test]
fn claim_vouch_unknown_id_reverts_with_vouch_not_found() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let (s, h) = secret_and_hash(&env, 7);
    let id = client.mint_vouch(&alice, &h, &String::from_str(&env, "x"));
    assert_eq!(
        client.try_claim_vouch(&bob, &(id + 1), &s),
        Err(Ok(contract_err(Error::VouchNotFound)))
    );
    assert_eq!(
        client.try_claim_vouch_signed(&bob, &(id + 1), &BytesN::from_array(&env, &[0; 64])),
        Err(Ok(contract_err(Error::VouchNotFound)))
    );
}

/// A claimed card can't be slashed afterwards — not once its window has passed, and not
/// inside it either (the claim check comes before the deadline check).
#[test]
fn expire_vouch_after_claim_reverts_with_already_claimed() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let (s, h) = secret_and_hash(&env, 7);
    let id = client.mint_vouch(&alice, &h, &String::from_str(&env, "x"));
    client.claim_vouch(&bob, &id, &s);
    assert_eq!(
        client.try_expire_vouch(&id),
        Err(Ok(contract_err(Error::AlreadyClaimed)))
    );
    env.ledger().with_mut(|l| l.timestamp = VOUCH_TTL_SECS + 1);
    assert_eq!(
        client.try_expire_vouch(&id),
        Err(Ok(contract_err(Error::AlreadyClaimed)))
    );
    assert!(!client.get_vouch(&id).unwrap().slashed);
    assert_eq!(client.get_score(&alice), STARTER_SOCIAL); // the timely refund stands
}

/// A second `expire_vouch` on an already-slashed card is a no-op: it emits nothing (no
/// second `vouch`/`slashed`) and touches no score.
#[test]
fn expire_vouch_is_idempotent() {
    use soroban_sdk::{testutils::Events as _, vec, IntoVal, Val};
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let (_s, h) = secret_and_hash(&env, 7);
    let id = client.mint_vouch(&alice, &h, &String::from_str(&env, "x"));
    env.ledger().with_mut(|l| l.timestamp = VOUCH_TTL_SECS + 1);

    client.expire_vouch(&id);
    let slashed: (Address, Vec<Val>, Val) = (
        client.address.clone(),
        (symbol_short!("vouch"), symbol_short!("slashed")).into_val(&env),
        (id, alice.clone(), VOUCH_STAKE).into_val(&env),
    );
    assert_eq!(env.events().all(), vec![&env, slashed]);
    let score = client.get_score(&alice);
    assert_eq!(score, STARTER_SOCIAL - VOUCH_STAKE);

    client.expire_vouch(&id); // e.g. a second keeper run
    assert!(
        env.events().all().is_empty(),
        "a re-expiry must not announce anything"
    );
    assert_eq!(client.get_score(&alice), score);
    assert!(client.get_vouch(&id).unwrap().slashed);
}

/// `claim_vouch` (refund) and `expire_vouch` (slash) share one deadline, `created +
/// VOUCH_TTL_SECS` inclusive: at it a claim still refunds and nothing can be slashed, one
/// second later a claim refunds nothing and the card can be slashed (issue #128).
#[test]
fn claim_and_expire_agree_on_the_deadline() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);
    let (s1, h1) = secret_and_hash(&env, 1);
    let (s2, h2) = secret_and_hash(&env, 2);
    let (_s3, h3) = secret_and_hash(&env, 3);
    let created = 1_000u64;
    env.ledger().with_mut(|l| l.timestamp = created);
    let on_time = client.mint_vouch(&alice, &h1, &String::from_str(&env, "a"));
    let late = client.mint_vouch(&alice, &h2, &String::from_str(&env, "b"));
    let unclaimed = client.mint_vouch(&alice, &h3, &String::from_str(&env, "c"));
    assert_eq!(client.get_score(&alice), STARTER_SOCIAL - 3 * VOUCH_STAKE);

    env.ledger()
        .with_mut(|l| l.timestamp = created + VOUCH_TTL_SECS);
    assert_eq!(
        client.try_expire_vouch(&unclaimed),
        Err(Ok(contract_err(Error::NotExpired)))
    );
    client.claim_vouch(&bob, &on_time, &s1);
    assert_eq!(
        client.get_score(&alice),
        STARTER_SOCIAL - 2 * VOUCH_STAKE,
        "a claim at the deadline refunds"
    );

    env.ledger()
        .with_mut(|l| l.timestamp = created + VOUCH_TTL_SECS + 1);
    client.claim_vouch(&carol, &late, &s2);
    assert_eq!(
        client.get_score(&alice),
        STARTER_SOCIAL - 2 * VOUCH_STAKE,
        "a claim past the deadline refunds nothing"
    );
    client.expire_vouch(&unclaimed);
    assert!(client.get_vouch(&unclaimed).unwrap().slashed);
}

/// The deadline saturates instead of overflowing: a card minted within `VOUCH_TTL_SECS` of
/// `u64::MAX` still claims (with its refund), and can never be expired (issue #128).
#[test]
fn claim_deadline_saturates_at_the_end_of_time() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let (s1, h1) = secret_and_hash(&env, 1);
    let (_s2, h2) = secret_and_hash(&env, 2);
    env.ledger().with_mut(|l| l.timestamp = u64::MAX - 1);
    let claimed = client.mint_vouch(&alice, &h1, &String::from_str(&env, "a"));
    let unclaimed = client.mint_vouch(&alice, &h2, &String::from_str(&env, "b"));

    // `created + VOUCH_TTL_SECS` would overflow here; the refund check must not trap.
    client.claim_vouch(&bob, &claimed, &s1);
    assert_eq!(client.get_score(&alice), STARTER_SOCIAL - VOUCH_STAKE);

    // No ledger time passes a deadline pinned at u64::MAX.
    env.ledger().with_mut(|l| l.timestamp = u64::MAX);
    assert_eq!(
        client.try_expire_vouch(&unclaimed),
        Err(Ok(contract_err(Error::NotExpired)))
    );
    assert!(!client.get_vouch(&unclaimed).unwrap().slashed);
}

/// The expire deadline in isolation: at exactly `created + VOUCH_TTL_SECS` a card is still
/// live (`NotExpired`), one second later it slashes — pinning the `<=` on `expire_vouch`
/// independently of the claim side.
#[test]
fn expire_vouch_boundary_second() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let (_s, h) = secret_and_hash(&env, 7);
    let created = 1_000u64;
    env.ledger().with_mut(|l| l.timestamp = created);
    let id = client.mint_vouch(&alice, &h, &String::from_str(&env, "x"));

    env.ledger()
        .with_mut(|l| l.timestamp = created + VOUCH_TTL_SECS);
    assert_eq!(
        client.try_expire_vouch(&id),
        Err(Ok(contract_err(Error::NotExpired)))
    );
    assert!(!client.get_vouch(&id).unwrap().slashed);

    env.ledger()
        .with_mut(|l| l.timestamp = created + VOUCH_TTL_SECS + 1);
    client.expire_vouch(&id);
    assert!(client.get_vouch(&id).unwrap().slashed);
}

#[test]
fn second_order_bonus_unlocks_on_verified_action() {
    let (env, client, _admin) = setup();
    let attester = Address::generate(&env);
    client.add_attester(&attester);
    let bob = Address::generate(&env);
    let mut vouchers = Vec::new(&env);

    for i in 0..3u8 {
        let voucher = Address::generate(&env);
        let (secret, hash) = secret_and_hash(&env, i);
        let id = client.mint_vouch(&voucher, &hash, &String::from_str(&env, "x"));
        client.claim_vouch(&bob, &id, &secret); // refund -> voucher 20; bonus PENDING
        vouchers.push_back(voucher);
    }

    // Bob is unverified, so every bonus is queued (in claim order) and none is paid yet.
    assert!(!client.is_verified(&bob));
    let pending = client.get_pending(&bob);
    assert_eq!(pending.len(), 3);
    for (queued, voucher) in pending.iter().zip(vouchers.iter()) {
        assert_eq!(
            (queued.voucher, queued.amount),
            (voucher.clone(), BONUS_VOUCHER)
        );
        assert_eq!(client.get_score(&voucher), 20);
    }

    // Bob's first verified action releases every queued voucher bonus and drops the queue.
    client.award_xp(&attester, &bob, &2u32, &50u64);
    assert!(client.is_verified(&bob));
    for voucher in vouchers.iter() {
        assert_eq!(client.get_score(&voucher), 20 + BONUS_VOUCHER);
    }
    assert_eq!(client.get_pending(&bob).len(), 0);
    let pending_stored = env.as_contract(&client.address, || {
        env.storage()
            .persistent()
            .has(&DataKey::Pending(bob.clone()))
    });
    assert!(!pending_stored, "the released queue must be removed");
    assert_eq!(client.get_earned(&bob), 50);

    // Further verified awards must not release the same queue a second time.
    client.award_xp(&attester, &bob, &2u32, &25u64);
    for voucher in vouchers.iter() {
        assert_eq!(client.get_score(&voucher), 20 + BONUS_VOUCHER);
    }
    assert_eq!(client.get_pending(&bob).len(), 0);
    assert_eq!(client.get_earned(&bob), 75);
}

#[test]
fn pending_bonus_cap_pays_only_first_64_vouchers() {
    // The cap this test pins; the web and docs describe the queue as at most 64 long.
    assert_eq!(MAX_PENDING, 64);
    let (env, client, _admin) = setup();
    let attester = Address::generate(&env);
    client.add_attester(&attester);
    let claimer = Address::generate(&env);
    let mut vouchers = Vec::new(&env);
    let mut last_id = 0;

    for i in 0..(MAX_PENDING + 1) {
        let voucher = Address::generate(&env);
        let (secret, hash) = secret_and_hash(&env, i as u8);
        last_id = client.mint_vouch(&voucher, &hash, &String::from_str(&env, "x"));
        client.claim_vouch(&claimer, &last_id, &secret);
        vouchers.push_back(voucher);
    }

    // The 65th claim itself succeeds and is a fresh pair (claim XP, counters) — only its
    // voucher's bonus is dropped: the queue holds exactly the first 64 vouchers.
    assert!(client.get_vouch(&last_id).unwrap().claimed);
    assert_eq!(client.get_counts(&claimer), (MAX_PENDING + 1, 0));
    assert_eq!(
        client.get_score(&claimer),
        STARTER_SOCIAL + XP_CLAIMER * u64::from(MAX_PENDING + 1)
    );
    let pending = client.get_pending(&claimer);
    assert_eq!(pending.len(), MAX_PENDING);
    for i in 0..MAX_PENDING {
        assert_eq!(pending.get(i).unwrap().voucher, vouchers.get(i).unwrap());
    }

    client.award_xp(&attester, &claimer, &2u32, &50u64);

    for i in 0..MAX_PENDING {
        assert_eq!(
            client.get_score(&vouchers.get(i).unwrap()),
            20 + BONUS_VOUCHER
        );
    }
    assert_eq!(client.get_score(&vouchers.get(MAX_PENDING).unwrap()), 20);
    assert_eq!(client.get_pending(&claimer).len(), 0);
}

#[test]
fn first_pair_is_directional_and_repeats_do_not_queue_bonuses() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    vouch(&env, &client, &alice, &bob, 1);
    assert_eq!(client.get_score(&bob), 30);
    assert_eq!(client.get_pending(&bob).len(), 1);

    // Reversing the pair is a distinct first pair: it credits Alice and queues Bob's bonus
    // on Alice.
    vouch(&env, &client, &bob, &alice, 2);
    assert_eq!(client.get_score(&alice), 30);
    let alice_pending = client.get_pending(&alice);
    assert_eq!(alice_pending.len(), 1);
    assert_eq!(alice_pending.get(0).unwrap().voucher, bob);
    assert_eq!(client.get_counts(&alice), (1, 1));
    assert_eq!(client.get_counts(&bob), (1, 1));

    // Repeating either direction grants no more claim XP or pending bonus.
    vouch(&env, &client, &alice, &bob, 3);
    vouch(&env, &client, &bob, &alice, 4);
    assert_eq!(client.get_score(&alice), 30);
    assert_eq!(client.get_score(&bob), 30);
    assert_eq!(client.get_pending(&alice).len(), 1);
    assert_eq!(client.get_pending(&bob).len(), 1);
    assert_eq!(client.get_counts(&alice), (1, 1));
    assert_eq!(client.get_counts(&bob), (1, 1));
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
    assert_eq!(
        client.try_mint_vouch(&alice, &h, &String::from_str(&env, "x")),
        Err(Ok(contract_err(Error::InsufficientStake)))
    );
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
fn non_allowlisted_attester_reverts() {
    let (env, client, _admin) = setup();
    let imposter = Address::generate(&env);
    let user = Address::generate(&env);
    assert_eq!(
        client.try_award_xp(&imposter, &user, &2u32, &50u64),
        Err(Ok(contract_err(Error::NotAuthorized)))
    );
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

// --- Frozen on-chain event shapes (docs/ON_CHAIN_EVENTS.md §1, issue #135) ---
//
// The leaderboard and feed fold these events directly and the docs freeze their shapes,
// so each test below pins the full (contract, topics, data) triple of every event a call
// emits: reordering any tuple fails here instead of silently corrupting the indexers.
// In soroban-sdk 22 `env.events().all()` holds the events of the LAST invocation only,
// so every assert runs right after the call it pins — which also proves nothing extra
// was emitted. `att_set` and `xp` are pinned by
// `att_set_still_carries_the_award_delta_in_the_v1_layout` above.

/// `social` (docs/ON_CHAIN_EVENTS.md §1) — the leaderboard source. Pinned on both
/// directions: the stake debit and the running-total credits (refund + claim XP).
#[test]
fn social_events_carry_the_documented_topics_and_data_on_credit_and_debit() {
    use soroban_sdk::{testutils::Events as _, vec, IntoVal, Val};
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // Minting escrows the stake: one DEBIT for alice, 20 - 5 = 15, followed in the same
    // invocation by the `vouch`/`minted` event. (The starter grant itself is silent —
    // pinned by the test below.)
    let (s, h) = secret_and_hash(&env, 1);
    let id = client.mint_vouch(&alice, &h, &String::from_str(&env, "stake"));
    let debit: (Address, Vec<Val>, Val) = (
        client.address.clone(),
        (symbol_short!("social"), alice.clone()).into_val(&env),
        (VOUCH_STAKE, 15u64).into_val(&env),
    );
    let minted: (Address, Vec<Val>, Val) = (
        client.address.clone(),
        (symbol_short!("vouch"), symbol_short!("minted")).into_val(&env),
        (id, alice.clone()).into_val(&env),
    );
    assert_eq!(env.events().all(), vec![&env, debit, minted]);

    // A timely claim emits two CREDITS in this order — the stake refund (alice
    // 15 -> 20) and the fresh-pair claim XP (bob: silent starter 20 + 10 = 30) —
    // and only then the `vouch`/`claimed` event.
    client.claim_vouch(&bob, &id, &s);
    let refund: (Address, Vec<Val>, Val) = (
        client.address.clone(),
        (symbol_short!("social"), alice.clone()).into_val(&env),
        (VOUCH_STAKE, 20u64).into_val(&env),
    );
    let claim_xp: (Address, Vec<Val>, Val) = (
        client.address.clone(),
        (symbol_short!("social"), bob.clone()).into_val(&env),
        (XP_CLAIMER, 30u64).into_val(&env),
    );
    let claimed: (Address, Vec<Val>, Val) = (
        client.address.clone(),
        (symbol_short!("vouch"), symbol_short!("claimed")).into_val(&env),
        (id, alice.clone(), bob.clone()).into_val(&env),
    );
    assert_eq!(env.events().all(), vec![&env, refund, claim_xp, claimed]);
}

/// `attester`/`add` and `attester`/`rm` (docs/ON_CHAIN_EVENTS.md §1): the data is the
/// bare attester address, not a tuple.
#[test]
fn attester_add_and_rm_events_carry_the_documented_topics_and_data() {
    use soroban_sdk::{testutils::Events as _, vec, IntoVal, Val};
    let (env, client, _admin) = setup();
    let attester = Address::generate(&env);

    client.add_attester(&attester);
    let add: (Address, Vec<Val>, Val) = (
        client.address.clone(),
        (symbol_short!("attester"), symbol_short!("add")).into_val(&env),
        attester.clone().into_val(&env),
    );
    assert_eq!(env.events().all(), vec![&env, add]);

    client.remove_attester(&attester);
    let rm: (Address, Vec<Val>, Val) = (
        client.address.clone(),
        (symbol_short!("attester"), symbol_short!("rm")).into_val(&env),
        attester.into_val(&env),
    );
    assert_eq!(env.events().all(), vec![&env, rm]);
}

/// The three `vouch` lifecycle events (docs/ON_CHAIN_EVENTS.md §1): `minted`,
/// `claimed`, `slashed`.
#[test]
fn vouch_lifecycle_events_carry_the_documented_topics_and_data() {
    use soroban_sdk::{testutils::Events as _, vec, IntoVal, Val};
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // MINTED: (id, from). The stake debit precedes it in the same invocation.
    let (s, h) = secret_and_hash(&env, 1);
    let id = client.mint_vouch(&alice, &h, &String::from_str(&env, "gift"));
    let debit: (Address, Vec<Val>, Val) = (
        client.address.clone(),
        (symbol_short!("social"), alice.clone()).into_val(&env),
        (VOUCH_STAKE, 15u64).into_val(&env),
    );
    let minted: (Address, Vec<Val>, Val) = (
        client.address.clone(),
        (symbol_short!("vouch"), symbol_short!("minted")).into_val(&env),
        (id, alice.clone()).into_val(&env),
    );
    assert_eq!(env.events().all(), vec![&env, debit, minted]);

    // CLAIMED: (vouch_id, from, claimer), after the two social credits.
    client.claim_vouch(&bob, &id, &s);
    let refund: (Address, Vec<Val>, Val) = (
        client.address.clone(),
        (symbol_short!("social"), alice.clone()).into_val(&env),
        (VOUCH_STAKE, 20u64).into_val(&env),
    );
    let claim_xp: (Address, Vec<Val>, Val) = (
        client.address.clone(),
        (symbol_short!("social"), bob.clone()).into_val(&env),
        (XP_CLAIMER, 30u64).into_val(&env),
    );
    let claimed: (Address, Vec<Val>, Val) = (
        client.address.clone(),
        (symbol_short!("vouch"), symbol_short!("claimed")).into_val(&env),
        (id, alice.clone(), bob.clone()).into_val(&env),
    );
    assert_eq!(env.events().all(), vec![&env, refund, claim_xp, claimed]);

    // SLASHED: (vouch_id, from, stake). Mint a second card, never claim it, and let
    // the expiry keeper slash it after the 7-day window.
    let (_s2, h2) = secret_and_hash(&env, 3);
    let id2 = client.mint_vouch(&alice, &h2, &String::from_str(&env, "expires"));
    env.ledger().with_mut(|l| l.timestamp = VOUCH_TTL_SECS + 1);
    client.expire_vouch(&id2);
    let slashed: (Address, Vec<Val>, Val) = (
        client.address.clone(),
        (symbol_short!("vouch"), symbol_short!("slashed")).into_val(&env),
        (id2, alice.clone(), VOUCH_STAKE).into_val(&env),
    );
    assert_eq!(env.events().all(), vec![&env, slashed]);
}

/// The documented silence of the starter grant (docs/ON_CHAIN_EVENTS.md §social, and the
/// comment on `grant_starter`): a fresh wallet's first mint emits exactly ONE social
/// event — carrying the cumulative 15, not a separate (20, 20) starter event — and the
/// claim path stays silent about the claimer's starter 20 too, so her first social
/// event already carries the cumulative 30.
#[test]
fn starter_grant_is_silent_and_first_social_events_carry_the_cumulative_total() {
    use soroban_sdk::{testutils::Events as _, vec, IntoVal, Val};
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);

    // Mint on a fresh wallet: the whole invocation emits only the stake debit (plus the
    // `vouch`/`minted` event) — nothing for the starter grant, and the one social event
    // carries the cumulative 15, not a separate (20, 20) starter event. No contract call
    // may run between the mint and this assert: every invocation resets `all()`.
    let (_s, h) = secret_and_hash(&env, 1);
    client.mint_vouch(&alice, &h, &String::from_str(&env, "first"));
    let debit: (Address, Vec<Val>, Val) = (
        client.address.clone(),
        (symbol_short!("social"), alice.clone()).into_val(&env),
        (VOUCH_STAKE, 15u64).into_val(&env),
    );
    let minted: (Address, Vec<Val>, Val) = (
        client.address.clone(),
        (symbol_short!("vouch"), symbol_short!("minted")).into_val(&env),
        (1u64, alice.clone()).into_val(&env),
    );
    assert_eq!(env.events().all(), vec![&env, debit, minted]);
    assert_eq!(client.get_score(&alice), 15);

    // A fresh claimer's starter 20 is silent as well: her first social event is the
    // claim XP alone, carrying the cumulative total 30.
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);
    let (s, h2) = secret_and_hash(&env, 2);
    let id = client.mint_vouch(&bob, &h2, &String::from_str(&env, "x"));
    client.claim_vouch(&carol, &id, &s);
    let refund: (Address, Vec<Val>, Val) = (
        client.address.clone(),
        (symbol_short!("social"), bob.clone()).into_val(&env),
        (VOUCH_STAKE, 20u64).into_val(&env),
    );
    let carol_xp: (Address, Vec<Val>, Val) = (
        client.address.clone(),
        (symbol_short!("social"), carol.clone()).into_val(&env),
        (XP_CLAIMER, 30u64).into_val(&env),
    );
    let claimed: (Address, Vec<Val>, Val) = (
        client.address.clone(),
        (symbol_short!("vouch"), symbol_short!("claimed")).into_val(&env),
        (id, bob.clone(), carol.clone()).into_val(&env),
    );
    assert_eq!(env.events().all(), vec![&env, refund, carol_xp, claimed]);
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
    let id = env.register(ReputationContract, (&admin,));
    let client = ReputationContractClient::new(&env, &id);
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
    let id = env.register(ReputationContract, (&admin,));
    let client = ReputationContractClient::new(&env, &id);
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

// --- Signed claims: the link key binds a card to one claimer (issue #121) ---

use ed25519_dalek::{Signer, SigningKey};
use soroban_sdk::xdr::ToXdr;

/// sha256("Test SDF Network ; September 2015") and sha256("Public Global Stellar Network ;
/// September 2015") — the network ids the contract reads from the ledger.
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
fn setup_testnet() -> (Env, ReputationContractClient<'static>, Address) {
    let (env, client, admin) = setup();
    let id = network_id(&env, TESTNET_ID).to_array();
    env.ledger().set_network_id(id);
    (env, client, admin)
}

/// The share link's claim key: an ed25519 seed (in the link) and its public key (on-chain).
fn link_key(fill: u8) -> SigningKey {
    SigningKey::from_bytes(&[fill; 32])
}

fn claim_pubkey(env: &Env, sk: &SigningKey) -> BytesN<32> {
    BytesN::from_array(env, &sk.verifying_key().to_bytes())
}

/// The claim message exactly as docs/ON_CHAIN_EVENTS.md specifies it, built here rather
/// than through the contract so these tests pin the format instead of echoing it.
fn claim_message(
    env: &Env,
    tag: &str,
    network: &BytesN<32>,
    contract: &Address,
    vouch_id: u64,
    claimer: &Address,
) -> Bytes {
    let parts: Vec<Val> = soroban_sdk::vec![
        env,
        Symbol::new(env, tag).into_val(env),
        network.into_val(env),
        contract.into_val(env),
        vouch_id.into_val(env),
        claimer.into_val(env),
    ];
    parts.to_xdr(env)
}

fn sign(env: &Env, sk: &SigningKey, message: &Bytes) -> BytesN<64> {
    let msg: std::vec::Vec<u8> = message.iter().collect();
    BytesN::from_array(env, &sk.sign(&msg).to_bytes())
}

/// What the claim page does: sign (this network, this contract, `vouch_id`, `claimer`).
fn claim_sig(
    env: &Env,
    client: &ReputationContractClient,
    sk: &SigningKey,
    vouch_id: u64,
    claimer: &Address,
) -> BytesN<64> {
    let network = env.ledger().network_id();
    let msg = claim_message(
        env,
        CLAIM_DOMAIN,
        &network,
        &client.address,
        vouch_id,
        claimer,
    );
    sign(env, sk, &msg)
}

fn mint_signed(
    env: &Env,
    client: &ReputationContractClient,
    from: &Address,
    sk: &SigningKey,
) -> u64 {
    client.mint_vouch_signed(from, &claim_pubkey(env, sk), &String::from_str(env, "gm"))
}

/// Run a claim that must fail signature verification. `ed25519_verify` traps with
/// Error(Crypto, InvalidInput); a `try_` call would narrow that (like any host error) to
/// Error(Context, InvalidAction), which cannot tell a bad signature from other traps.
fn assert_bad_signature(claim: impl FnOnce()) {
    let payload = std::panic::catch_unwind(std::panic::AssertUnwindSafe(claim))
        .expect_err("the claim must be rejected");
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

#[test]
fn claim_errors_are_appended_after_note_too_long() {
    // Deployed web builds map #1..#12; the new code must not renumber any of them.
    assert_eq!(Error::NoteTooLong as u32, 12);
    assert_eq!(Error::WrongClaimMethod as u32, 13);
}

#[test]
fn signed_vouch_claims_for_the_address_the_link_holder_signed() {
    let (env, client, _admin) = setup_testnet();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let sk = link_key(7);

    let id = mint_signed(&env, &client, &alice, &sk);
    assert_eq!(client.get_claim_key(&id), Some(claim_pubkey(&env, &sk)));
    let minted = client.get_vouch(&id).unwrap();
    assert_eq!(minted.claim_hash, BytesN::from_array(&env, &[0; 32]));
    assert_eq!(client.get_score(&alice), 15); // stake escrowed, as with mint_vouch

    client.claim_vouch_signed(&bob, &id, &claim_sig(&env, &client, &sk, id, &bob));

    let v = client.get_vouch(&id).unwrap();
    assert!(v.claimed);
    assert_eq!(v.claimer, Some(bob.clone()));
    // Same economics as the legacy path: refund, starter + claim XP, queued bonus, counters.
    assert_eq!(client.get_score(&alice), 20);
    assert_eq!(client.get_score(&bob), 30);
    assert_eq!(client.get_pending(&bob).len(), 1);
    assert_eq!(client.get_counts(&bob), (1, 0));
    assert_eq!(client.get_counts(&alice), (0, 1));
}

#[test]
fn front_runner_cannot_reuse_a_claim_signature_for_their_own_address() {
    let (env, client, _admin) = setup_testnet();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let eve = Address::generate(&env);
    let sk = link_key(7);
    let id = mint_signed(&env, &client, &alice, &sk);

    // Eve copies Bob's pending claim (signature and all) and swaps in her own address.
    let bobs_sig = claim_sig(&env, &client, &sk, id, &bob);
    assert_bad_signature(|| client.claim_vouch_signed(&eve, &id, &bobs_sig));
    assert!(!client.get_vouch(&id).unwrap().claimed);
    assert_eq!(client.get_counts(&eve), (0, 0));
    assert_eq!(client.get_score(&eve), 0);

    // Bob's own claim still lands.
    client.claim_vouch_signed(&bob, &id, &bobs_sig);
    assert_eq!(client.get_vouch(&id).unwrap().claimer, Some(bob));
}

#[test]
fn claim_signature_does_not_replay_on_another_vouch() {
    let (env, client, _admin) = setup_testnet();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    // Even a voucher who reuses one link key: the signature names the card.
    let sk = link_key(7);
    let first = mint_signed(&env, &client, &alice, &sk);
    let second = mint_signed(&env, &client, &alice, &sk);

    let sig = claim_sig(&env, &client, &sk, first, &bob);
    assert_bad_signature(|| client.claim_vouch_signed(&bob, &second, &sig));
    client.claim_vouch_signed(&bob, &first, &sig);
    assert!(!client.get_vouch(&second).unwrap().claimed);
}

#[test]
fn claim_signature_does_not_replay_on_another_deployment() {
    let (env, client, admin) = setup_testnet();
    let other = ReputationContractClient::new(&env, &env.register(ReputationContract, (&admin,)));
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let sk = link_key(7);
    // Same key, same id (1) on both deployments.
    let id = mint_signed(&env, &client, &alice, &sk);
    assert_eq!(mint_signed(&env, &other, &alice, &sk), id);

    let sig = claim_sig(&env, &client, &sk, id, &bob);
    assert_bad_signature(|| other.claim_vouch_signed(&bob, &id, &sig));
    client.claim_vouch_signed(&bob, &id, &sig);
}

#[test]
fn claim_signature_for_another_network_or_domain_is_rejected() {
    let (env, client, _admin) = setup_testnet();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let sk = link_key(7);
    let id = mint_signed(&env, &client, &alice, &sk);
    let testnet = network_id(&env, TESTNET_ID);
    let mainnet = network_id(&env, MAINNET_ID);

    // Signed for mainnet, submitted on testnet.
    let wrong_network = claim_message(&env, CLAIM_DOMAIN, &mainnet, &client.address, id, &bob);
    assert_bad_signature(|| client.claim_vouch_signed(&bob, &id, &sign(&env, &sk, &wrong_network)));
    // Right network, wrong domain tag.
    let wrong_tag = claim_message(&env, "alvinmunk_quest", &testnet, &client.address, id, &bob);
    assert_bad_signature(|| client.claim_vouch_signed(&bob, &id, &sign(&env, &sk, &wrong_tag)));
    // The testnet message claims.
    let right = claim_message(&env, CLAIM_DOMAIN, &testnet, &client.address, id, &bob);
    client.claim_vouch_signed(&bob, &id, &sign(&env, &sk, &right));
    assert!(client.get_vouch(&id).unwrap().claimed);
}

#[test]
fn claim_signature_from_another_key_is_rejected() {
    let (env, client, _admin) = setup_testnet();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let id = mint_signed(&env, &client, &alice, &link_key(7));

    let forged = claim_sig(&env, &client, &link_key(8), id, &bob);
    assert_bad_signature(|| client.claim_vouch_signed(&bob, &id, &forged));
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn signed_claim_needs_the_claimers_own_auth() {
    let (env, client, _admin) = setup_testnet();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let sk = link_key(7);
    let id = mint_signed(&env, &client, &alice, &sk);
    let sig = claim_sig(&env, &client, &sk, id, &bob);

    // A valid signature for Bob, submitted without Bob's authorization.
    env.set_auths(&[]);
    client.claim_vouch_signed(&bob, &id, &sig);
}

#[test]
fn signed_claim_keeps_the_self_vouch_and_double_claim_guards() {
    let (env, client, _admin) = setup_testnet();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let sk = link_key(7);
    let id = mint_signed(&env, &client, &alice, &sk);

    let own = claim_sig(&env, &client, &sk, id, &alice);
    assert_eq!(
        client.try_claim_vouch_signed(&alice, &id, &own),
        Err(Ok(contract_err(Error::SelfVouch)))
    );
    let sig = claim_sig(&env, &client, &sk, id, &bob);
    client.claim_vouch_signed(&bob, &id, &sig);
    assert_eq!(
        client.try_claim_vouch_signed(&bob, &id, &sig),
        Err(Ok(contract_err(Error::AlreadyClaimed)))
    );
    assert_eq!(
        client.try_claim_vouch_signed(&bob, &99, &sig),
        Err(Ok(contract_err(Error::VouchNotFound)))
    );
}

#[test]
fn each_card_only_claims_through_its_own_entrypoint() {
    let (env, client, _admin) = setup_testnet();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let sk = link_key(7);
    let keyed = mint_signed(&env, &client, &alice, &sk);
    let (secret, hash) = secret_and_hash(&env, 7);
    let hashed = client.mint_vouch(&alice, &hash, &String::from_str(&env, "x"));
    assert_eq!(client.get_claim_key(&hashed), None);

    // A keyed card has no secret: not the public key, not the all-zero claim_hash's bytes.
    let pubkey = Bytes::from_array(&env, &claim_pubkey(&env, &sk).to_array());
    for guess in [pubkey, Bytes::from_array(&env, &[0; 32]), secret.clone()] {
        assert_eq!(
            client.try_claim_vouch(&bob, &keyed, &guess),
            Err(Ok(contract_err(Error::WrongClaimMethod)))
        );
    }
    // A hash-bound card never accepts a signature.
    assert_eq!(
        client.try_claim_vouch_signed(&bob, &hashed, &claim_sig(&env, &client, &sk, hashed, &bob)),
        Err(Ok(contract_err(Error::WrongClaimMethod)))
    );
    // Both still claim the right way.
    client.claim_vouch(&bob, &hashed, &secret);
    client.claim_vouch_signed(&bob, &keyed, &claim_sig(&env, &client, &sk, keyed, &bob));
    assert!(client.get_vouch(&hashed).unwrap().claimed);
    assert!(client.get_vouch(&keyed).unwrap().claimed);
}

#[test]
fn signed_mint_shares_the_note_cap_and_the_daily_cap() {
    let (env, client, _admin) = setup_testnet();
    let alice = Address::generate(&env);
    let key = claim_pubkey(&env, &link_key(7));
    let over = String::from_str(&env, &"a".repeat(MAX_NOTE_BYTES as usize + 1));
    assert_eq!(
        client.try_mint_vouch_signed(&alice, &key, &over),
        Err(Ok(contract_err(Error::NoteTooLong)))
    );

    // Half the day's mints one way, half the other: the cap counts both. Each card is
    // claimed right away so the refund keeps Alice's Social XP above the stake.
    let bob = Address::generate(&env);
    let sk = link_key(7);
    for i in 0..MAX_VOUCH_PER_DAY {
        if i % 2 == 0 {
            let id = mint_signed(&env, &client, &alice, &sk);
            client.claim_vouch_signed(&bob, &id, &claim_sig(&env, &client, &sk, id, &bob));
        } else {
            let (s, h) = secret_and_hash(&env, i as u8);
            let id = client.mint_vouch(&alice, &h, &String::from_str(&env, "b"));
            client.claim_vouch(&bob, &id, &s);
        }
    }
    assert_eq!(
        client.try_mint_vouch_signed(&alice, &key, &String::from_str(&env, "c")),
        Err(Ok(contract_err(Error::DailyCapReached)))
    );
}

fn to_hex(bytes: &Bytes) -> std::string::String {
    bytes.iter().map(|b| std::format!("{b:02x}")).collect()
}

/// The claim message for vouch 7 on testnet, from contract `C` = 32 × 0x11, for a classic
/// claimer (G… = 32 × 0x22) and a passkey smart wallet (C… = 32 × 0x33).
/// apps/web/src/lib/reputation.test.ts pins the web's `claimMessage` to the same bytes.
const CLAIM_MESSAGE_G: &str = concat!(
    "000000100000000100000005", // vec of 5
    "0000000f00000015616c76696e6d756e6b5f766f7563685f636c61696d000000", // Symbol("alvinmunk_vouch_claim")
    "0000000d00000020cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472", // BytesN<32> network id
    "00000012000000011111111111111111111111111111111111111111111111111111111111111111", // Address, contract
    "000000050000000000000007", // u64 vouch id
    "0000001200000000000000002222222222222222222222222222222222222222222222222222222222222222", // Address, account (ed25519)
);
const CLAIM_MESSAGE_C: &str = concat!(
    "000000100000000100000005", // vec of 5
    "0000000f00000015616c76696e6d756e6b5f766f7563685f636c61696d000000", // Symbol("alvinmunk_vouch_claim")
    "0000000d00000020cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472", // BytesN<32> network id
    "00000012000000011111111111111111111111111111111111111111111111111111111111111111", // Address, contract
    "000000050000000000000007", // u64 vouch id
    "00000012000000013333333333333333333333333333333333333333333333333333333333333333", // Address, contract
);

#[test]
fn claim_message_matches_the_documented_bytes() {
    let env = Env::default();
    let testnet = network_id(&env, TESTNET_ID);
    env.ledger().set_network_id(testnet.to_array());
    let contract = Address::from_str(
        &env,
        "CAIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRDB3V",
    );
    env.register_at(&contract, ReputationContract, (Address::generate(&env),));
    let classic = Address::from_str(
        &env,
        "GARCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCFRVX",
    );
    let passkey = Address::from_str(
        &env,
        "CAZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGGJH",
    );

    for (claimer, expected) in [(classic, CLAIM_MESSAGE_G), (passkey, CLAIM_MESSAGE_C)] {
        let msg = env.as_contract(&contract, || {
            ReputationContract::claim_message(&env, 7, &claimer)
        });
        assert_eq!(to_hex(&msg), expected);
        assert_eq!(
            msg,
            claim_message(&env, CLAIM_DOMAIN, &testnet, &contract, 7, &claimer)
        );
    }
}

#[test]
fn claim_key_entry_is_bumped_like_its_vouch() {
    for ttls in [TESTNET_TTLS, MAINNET_TTLS] {
        let (env, client) = setup_with_ttls(ttls);
        let alice = Address::generate(&env);
        let id = mint_signed(&env, &client, &alice, &link_key(7));
        assert_eq!(ttl(&env, &client, &DataKey::ClaimPubkey(id)), BUMP_EXTEND);
        assert_eq!(ttl(&env, &client, &DataKey::Vouch(id)), BUMP_EXTEND);
    }
}

/// A reader compiled against the nine-field `Vouch` (the web's funnel decodes raw ledger
/// entries, generated bindings decode `get_vouch`). The claim key lives in its own entry,
/// so a keyed card must still decode as exactly these fields.
#[contracttype]
#[derive(Clone)]
pub struct LegacyVouch {
    pub id: u64,
    pub from: Address,
    pub claim_hash: BytesN<32>,
    pub note: String,
    pub claimed: bool,
    pub claimer: Option<Address>,
    pub created: u64,
    pub stake: u64,
    pub slashed: bool,
}

#[test]
fn signed_vouch_keeps_the_nine_field_vouch_shape() {
    use soroban_sdk::vec;
    let (env, client, _admin) = setup_testnet();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let sk = link_key(7);
    let id = mint_signed(&env, &client, &alice, &sk);
    client.claim_vouch_signed(&bob, &id, &claim_sig(&env, &client, &sk, id, &bob));

    let v: Option<LegacyVouch> = env.invoke_contract(
        &client.address,
        &Symbol::new(&env, "get_vouch"),
        vec![&env, id.into_val(&env)],
    );
    let v = v.unwrap();
    assert_eq!((v.id, v.from, v.claimer), (id, alice, Some(bob)));
    assert!(v.claimed && !v.slashed);
    // The raw entry holds the same map, not a tenth field.
    let raw: LegacyVouch = env.as_contract(&client.address, || {
        env.storage().persistent().get(&DataKey::Vouch(id)).unwrap()
    });
    assert_eq!(raw.stake, VOUCH_STAKE);
}

#[test]
fn upgrade_keeps_legacy_vouches_claimable_and_serves_signed_ones() {
    let (env, client, _admin) = setup_testnet();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);
    // Half-cards minted by the deployed code, before the upgrade.
    let (s1, h1) = secret_and_hash(&env, 1);
    let (_s2, h2) = secret_and_hash(&env, 2);
    let old = client.mint_vouch(&alice, &h1, &String::from_str(&env, "old"));
    let other = client.mint_vouch(&alice, &h2, &String::from_str(&env, "old"));

    let hash = env.deployer().upload_contract_wasm(REPUTATION_WASM);
    client.upgrade(&hash);

    // An old card still claims with its secret, and never through the signed entrypoint.
    client.claim_vouch(&bob, &old, &s1);
    assert_eq!(client.get_vouch(&old).unwrap().claimer, Some(bob.clone()));
    let sk = link_key(9);
    assert_eq!(
        client.try_claim_vouch_signed(
            &carol,
            &other,
            &claim_sig(&env, &client, &sk, other, &carol)
        ),
        Err(Ok(contract_err(Error::WrongClaimMethod)))
    );

    // The upgraded build mints key-bound cards and binds them to the signed claimer.
    let id = mint_signed(&env, &client, &alice, &sk);
    let bobs_sig = claim_sig(&env, &client, &sk, id, &bob);
    assert_bad_signature(|| client.claim_vouch_signed(&carol, &id, &bobs_sig));
    client.claim_vouch_signed(&carol, &id, &claim_sig(&env, &client, &sk, id, &carol));
    assert_eq!(client.get_vouch(&id).unwrap().claimer, Some(carol));
}

/// A card minted before the upgrade that added `cancel_vouch` can be cancelled after it, and
/// the voucher's other pre-upgrade cards still claim.
#[test]
fn upgrade_serves_cancel_vouch_for_cards_minted_before_it() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let (s1, h1) = secret_and_hash(&env, 1);
    let (s2, h2) = secret_and_hash(&env, 2);
    let leaked = client.mint_vouch(&alice, &h1, &String::from_str(&env, "old"));
    let fine = client.mint_vouch(&alice, &h2, &String::from_str(&env, "old"));

    let hash = env.deployer().upload_contract_wasm(REPUTATION_WASM);
    client.upgrade(&hash);

    client.cancel_vouch(&alice, &leaked);
    assert!(client.is_cancelled(&leaked));
    assert_eq!(
        client.try_claim_vouch(&bob, &leaked, &s1),
        Err(Ok(contract_err(Error::Cancelled)))
    );
    client.claim_vouch(&bob, &fine, &s2);
    assert!(client.get_vouch(&fine).unwrap().claimed);
}

// --- Attester allowlist removal (issue #132) ---

/// `remove_attester` is the operator's kill switch for a compromised attester (the
/// quest_registry contract included): it must stop new Earned XP without undoing old awards.
#[test]
fn remove_attester_revokes_authorization_and_leaves_prior_awards_intact() {
    use soroban_sdk::{testutils::Events as _, vec, IntoVal, Val};
    let (env, client, _admin) = setup();
    let att = Address::generate(&env);
    let other = Address::generate(&env);
    let user = Address::generate(&env);

    client.add_attester(&att);
    client.add_attester(&other);
    assert!(client.is_attester(&att));

    client.award_xp(&att, &user, &2u32, &10u64);

    client.remove_attester(&att);
    // `all()` holds the last invocation's events: exactly the `(attester, rm)` notice.
    let rm: (Address, Vec<Val>, Val) = (
        client.address.clone(),
        (symbol_short!("attester"), symbol_short!("rm")).into_val(&env),
        att.clone().into_val(&env),
    );
    assert_eq!(env.events().all(), vec![&env, rm]);
    assert!(!client.is_attester(&att));
    // Only the removed attester loses the right.
    assert!(client.is_attester(&other));

    assert_eq!(
        client.try_award_xp(&att, &user, &2u32, &10u64),
        Err(Ok(contract_err(Error::NotAuthorized)))
    );
    // The award made before the removal is untouched, and the rejected one wrote nothing.
    assert_eq!(client.get_earned(&user), 10);
    let record = client.get_attestation(&user, &2).unwrap();
    assert_eq!((record.value, record.issuer), (10, att.clone()));
}

// --- Batch vouch (issue #271) ---

/// `n` distinct share-link keys (seeds `fill`, `fill + 1`, ...) and their public claim keys.
fn link_keys(env: &Env, n: u32, fill: u8) -> (std::vec::Vec<SigningKey>, Vec<BytesN<32>>) {
    let sks: std::vec::Vec<SigningKey> = (0..n).map(|i| link_key(fill + i as u8)).collect();
    let mut keys = Vec::new(env);
    for sk in &sks {
        keys.push_back(claim_pubkey(env, sk));
    }
    (sks, keys)
}

/// `n` notes, `"<prefix><i>"`.
fn batch_notes(env: &Env, n: u32, prefix: &str) -> Vec<String> {
    let mut notes = Vec::new(env);
    for i in 0..n {
        notes.push_back(String::from_str(env, &std::format!("{prefix}{i}")));
    }
    notes
}

/// Today's `DailyCount` for `who` (0 when there is none).
fn daily_count(env: &Env, client: &ReputationContractClient, who: &Address) -> u32 {
    let key = DataKey::DailyCount(who.clone(), env.ledger().timestamp() / DAY_SECS);
    env.as_contract(&client.address, || {
        env.storage().temporary().get(&key).unwrap_or(0)
    })
}

/// Give `who` Social XP beyond the starter 20: `claims` fresh vouchers each vouch for them.
fn fund_social(env: &Env, client: &ReputationContractClient, who: &Address, claims: u8) {
    for i in 0..claims {
        vouch(env, client, &Address::generate(env), who, 200 + i);
    }
}

#[test]
fn batch_errors_are_appended_after_wrong_claim_method() {
    // Deployed web builds map #1..#13; the batch codes must not renumber any of them.
    assert_eq!(Error::NoteTooLong as u32, 12);
    assert_eq!(Error::WrongClaimMethod as u32, 13);
    assert_eq!(Error::LengthMismatch as u32, 14);
    assert_eq!(Error::BadBatchSize as u32, 15);
    assert_eq!(MAX_BATCH_VOUCH, 10);
}

/// One signature mints N key-bound half-cards, and each one claims only with its own key.
#[test]
fn mint_vouches_mints_cards_that_each_claim_with_their_own_key() {
    let (env, client, _admin) = setup_testnet();
    let alice = Address::generate(&env);
    let (sks, keys) = link_keys(&env, 3, 1);
    let notes = batch_notes(&env, 3, "cohort ");

    let ids = client.mint_vouches(&alice, &keys, &notes);
    assert_eq!(ids, soroban_sdk::vec![&env, 1u64, 2, 3]);
    for (i, id) in ids.iter().enumerate() {
        let v = client.get_vouch(&id).unwrap();
        assert_eq!((v.id, v.from.clone()), (id, alice.clone()));
        assert_eq!(v.note, notes.get(i as u32).unwrap());
        assert_eq!(v.claim_hash, BytesN::from_array(&env, &[0; 32]));
        assert!(!v.claimed && !v.slashed);
        assert_eq!(client.get_claim_key(&id), Some(keys.get(i as u32).unwrap()));
    }
    assert_eq!(client.get_score(&alice), STARTER_SOCIAL - 3 * VOUCH_STAKE);

    // A card's key signs for that card only, and a keyed card never takes a secret.
    let (bob, carol) = (Address::generate(&env), Address::generate(&env));
    let wrong = claim_sig(&env, &client, &sks[0], 2, &bob);
    assert_bad_signature(|| client.claim_vouch_signed(&bob, &2, &wrong));
    assert_eq!(
        client.try_claim_vouch(&bob, &1, &Bytes::from_array(&env, &[1; 32])),
        Err(Ok(contract_err(Error::WrongClaimMethod)))
    );
    for (i, claimer) in [bob, carol, Address::generate(&env)].iter().enumerate() {
        let id = ids.get(i as u32).unwrap();
        client.claim_vouch_signed(
            claimer,
            &id,
            &claim_sig(&env, &client, &sks[i], id, claimer),
        );
        assert_eq!(
            client.get_vouch(&id).unwrap().claimer,
            Some(claimer.clone())
        );
    }
    // every timely claim refunded its own stake
    assert_eq!(client.get_score(&alice), STARTER_SOCIAL);
}

/// The whole batch sits under one authorization of `from`, over every key and note.
#[test]
fn mint_vouches_takes_one_auth_from_the_voucher() {
    use soroban_sdk::testutils::{AuthorizedFunction, AuthorizedInvocation};
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let (_sks, keys) = link_keys(&env, 4, 1);
    let notes = batch_notes(&env, 4, "n");

    client.mint_vouches(&alice, &keys, &notes);
    assert_eq!(
        env.auths(),
        std::vec![(
            alice.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    client.address.clone(),
                    Symbol::new(&env, "mint_vouches"),
                    (alice.clone(), keys.clone(), notes.clone()).into_val(&env),
                )),
                sub_invocations: std::vec![],
            }
        )]
    );
}

/// Indexers and the feed see a batch exactly as N `mint_vouch_signed` calls: per card, the
/// stake debit then `("vouch","minted")`, carrying the running balance and the card's id.
#[test]
fn mint_vouches_emits_what_single_mints_emit() {
    use soroban_sdk::testutils::Events as _;
    let (env, client, _admin) = setup();
    let (alice, bob) = (Address::generate(&env), Address::generate(&env));
    let expected = |who: &Address, first_id: u64, n: u64| {
        let mut out: Vec<(Address, Vec<Val>, Val)> = Vec::new(&env);
        for k in 0..n {
            out.push_back((
                client.address.clone(),
                (symbol_short!("social"), who.clone()).into_val(&env),
                (VOUCH_STAKE, STARTER_SOCIAL - (k + 1) * VOUCH_STAKE).into_val(&env),
            ));
            out.push_back((
                client.address.clone(),
                (symbol_short!("vouch"), symbol_short!("minted")).into_val(&env),
                (first_id + k, who.clone()).into_val(&env),
            ));
        }
        out
    };

    let (_sks, keys) = link_keys(&env, 3, 1);
    client.mint_vouches(&alice, &keys, &batch_notes(&env, 3, "n"));
    assert_eq!(env.events().all(), expected(&alice, 1, 3));

    // The same three cards minted one call at a time: the same events, split per call.
    let singles = expected(&bob, 4, 3);
    for (k, key) in keys.iter().enumerate() {
        client.mint_vouch_signed(&bob, &key, &String::from_str(&env, "n"));
        let k = k as u32;
        assert_eq!(env.events().all(), singles.slice(2 * k..2 * k + 2));
    }
}

/// A batch writes what N single mints write: each `Vouch` and `ClaimPubkey` with the same
/// fields and TTLs, the same stake debit, starter flag and per-day count.
#[test]
fn mint_vouches_writes_what_single_mints_write() {
    for ttls in [TESTNET_TTLS, MAINNET_TTLS] {
        let (env, client) = setup_with_ttls(ttls);
        let (alice, bob) = (Address::generate(&env), Address::generate(&env));
        let (_sks, keys) = link_keys(&env, 3, 1);
        let notes = batch_notes(&env, 3, "n");

        let batch = client.mint_vouches(&alice, &keys, &notes);
        let mut singles = std::vec::Vec::new();
        for (key, note) in keys.iter().zip(notes.iter()) {
            singles.push(client.mint_vouch_signed(&bob, &key, &note));
        }

        assert_eq!(client.get_score(&alice), client.get_score(&bob));
        assert_eq!(daily_count(&env, &client, &alice), 3);
        assert_eq!(daily_count(&env, &client, &bob), 3);
        for (i, (a, b)) in batch.iter().zip(singles).enumerate() {
            let (va, vb) = (client.get_vouch(&a).unwrap(), client.get_vouch(&b).unwrap());
            assert_eq!(
                (
                    va.claim_hash,
                    va.note,
                    va.claimed,
                    va.claimer,
                    va.created,
                    va.stake,
                    va.slashed
                ),
                (
                    vb.claim_hash,
                    vb.note,
                    vb.claimed,
                    vb.claimer,
                    vb.created,
                    vb.stake,
                    vb.slashed
                )
            );
            assert_eq!(client.get_claim_key(&a), client.get_claim_key(&b));
            assert_eq!(client.get_claim_key(&a), Some(keys.get(i as u32).unwrap()));
            for (ka, kb) in [
                (DataKey::Vouch(a), DataKey::Vouch(b)),
                (DataKey::ClaimPubkey(a), DataKey::ClaimPubkey(b)),
            ] {
                assert_eq!(ttl(&env, &client, &ka), BUMP_EXTEND);
                assert_eq!(ttl(&env, &client, &ka), ttl(&env, &client, &kb));
            }
        }
        let day = env.ledger().timestamp() / DAY_SECS;
        assert_eq!(
            temp_ttl(&env, &client, &DataKey::DailyCount(alice.clone(), day)),
            temp_ttl(&env, &client, &DataKey::DailyCount(bob.clone(), day))
        );
        assert_eq!(
            ttl(&env, &client, &DataKey::Started(alice)),
            ttl(&env, &client, &DataKey::Started(bob))
        );
    }
}

/// Mismatched vectors, an empty batch and one over `MAX_BATCH_VOUCH` revert before minting.
#[test]
fn mint_vouches_rejects_bad_batch_shapes() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    fund_social(&env, &client, &alice, 4); // 60 Social XP: stake is never the limit here
    let before = client.get_score(&alice);
    let (_sks, keys) = link_keys(&env, MAX_BATCH_VOUCH + 1, 1);
    let first = |n: u32| keys.slice(0..n);

    for (keys, notes, err) in [
        (first(2), batch_notes(&env, 1, "n"), Error::LengthMismatch),
        (first(1), batch_notes(&env, 2, "n"), Error::LengthMismatch),
        (first(0), batch_notes(&env, 0, "n"), Error::BadBatchSize),
        (
            first(MAX_BATCH_VOUCH + 1),
            batch_notes(&env, MAX_BATCH_VOUCH + 1, "n"),
            Error::BadBatchSize,
        ),
    ] {
        assert_eq!(
            client.try_mint_vouches(&alice, &keys, &notes),
            Err(Ok(contract_err(err)))
        );
    }
    assert_eq!(client.get_score(&alice), before);
    assert_eq!(daily_count(&env, &client, &alice), 0);
    // the four funding cards took ids 1..=4; nothing after them was minted
    assert!(client.get_vouch(&5).is_none());
}

/// A batch of exactly `MAX_BATCH_VOUCH` mints every card and escrows every stake.
#[test]
fn mint_vouches_accepts_a_full_batch() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    fund_social(&env, &client, &alice, 3);
    assert_eq!(client.get_score(&alice), 50);

    let (_sks, keys) = link_keys(&env, MAX_BATCH_VOUCH, 1);
    let ids = client.mint_vouches(&alice, &keys, &batch_notes(&env, MAX_BATCH_VOUCH, "n"));
    assert_eq!(ids.len(), MAX_BATCH_VOUCH);
    assert_eq!(ids.first(), Some(4)); // after the three funding cards
    assert_eq!(ids.last(), Some(3 + MAX_BATCH_VOUCH as u64));
    assert_eq!(client.get_score(&alice), 0);
    assert_eq!(daily_count(&env, &client, &alice), MAX_BATCH_VOUCH);
}

/// Every card counts against `MAX_VOUCH_PER_DAY`, together with single mints from either
/// entrypoint; a batch that would cross the cap reverts whole, not up to the cap.
#[test]
fn mint_vouches_over_the_daily_cap_reverts_the_whole_batch() {
    let (env, client, _admin) = setup();
    let (alice, bob) = (Address::generate(&env), Address::generate(&env));
    // 19 legacy mints today, each claimed at once so the stake comes back.
    for i in 0..(MAX_VOUCH_PER_DAY - 1) {
        vouch(&env, &client, &alice, &bob, i as u8);
    }
    let (score, next_id) = (client.get_score(&alice), u64::from(MAX_VOUCH_PER_DAY));

    let (_sks, keys) = link_keys(&env, 2, 100);
    assert_eq!(
        client.try_mint_vouches(&alice, &keys, &batch_notes(&env, 2, "n")),
        Err(Ok(contract_err(Error::DailyCapReached)))
    );
    // Not even the card that fit was minted, and the day's count did not move.
    assert!(client.get_vouch(&next_id).is_none());
    assert_eq!(client.get_score(&alice), score);
    assert_eq!(daily_count(&env, &client, &alice), MAX_VOUCH_PER_DAY - 1);

    // The last slot is still there for a batch of one; then the day is full.
    let one = keys.slice(0..1);
    assert_eq!(
        client
            .mint_vouches(&alice, &one, &batch_notes(&env, 1, "n"))
            .len(),
        1
    );
    assert_eq!(daily_count(&env, &client, &alice), MAX_VOUCH_PER_DAY);
    let last = keys.slice(1..2);
    assert_eq!(
        client.try_mint_vouches(&alice, &last, &batch_notes(&env, 1, "n")),
        Err(Ok(contract_err(Error::DailyCapReached)))
    );
}

/// Each card escrows its own stake: a batch the balance cannot cover reverts whole,
/// starter grant included.
#[test]
fn mint_vouches_without_enough_stake_reverts_the_whole_batch() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    // The starter 20 covers four stakes of 5, not five.
    let (_sks, keys) = link_keys(&env, 5, 1);
    assert_eq!(
        client.try_mint_vouches(&alice, &keys, &batch_notes(&env, 5, "n")),
        Err(Ok(contract_err(Error::InsufficientStake)))
    );
    assert_eq!(client.get_score(&alice), 0);
    assert!(client.get_vouch(&1).is_none());
    assert_eq!(client.get_claim_key(&1), None);
    assert_eq!(daily_count(&env, &client, &alice), 0);

    let four = keys.slice(0..4);
    client.mint_vouches(&alice, &four, &batch_notes(&env, 4, "n"));
    assert_eq!(client.get_score(&alice), 0);
}

/// One note over `MAX_NOTE_BYTES` reverts the batch; notes at the cap all mint.
#[test]
fn mint_vouches_shares_the_note_cap() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let (_sks, keys) = link_keys(&env, 4, 1);
    let mut notes = Vec::new(&env);
    for text in notes_at_cap() {
        notes.push_back(String::from_str(&env, &text));
    }
    let mut too_long = notes.clone();
    too_long.set(2, String::from_str(&env, &"a".repeat(241)));
    assert_eq!(
        client.try_mint_vouches(&alice, &keys, &too_long),
        Err(Ok(contract_err(Error::NoteTooLong)))
    );
    assert!(client.get_vouch(&1).is_none());

    let ids = client.mint_vouches(&alice, &keys, &notes);
    for (i, id) in ids.iter().enumerate() {
        assert_eq!(
            client.get_vouch(&id).unwrap().note,
            notes.get(i as u32).unwrap()
        );
    }
}

/// A full batch of cap-length notes against the release build stays far inside the
/// per-transaction limits `MAX_BATCH_VOUCH` was sized for (testnet and mainnet, checked
/// 2026-09-29).
#[test]
fn a_full_mint_vouches_fits_one_transaction() {
    const TX_MAX_INSTRUCTIONS: i64 = 400_000_000;
    const TX_MAX_WRITE_ENTRIES: u32 = 200;
    const TX_MAX_WRITE_BYTES: u32 = 132_096;
    const TX_MAX_EVENTS_BYTES: u32 = 16_384;

    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(REPUTATION_WASM, (&Address::generate(&env),));
    let client = ReputationContractClient::new(&env, &id);
    let alice = Address::generate(&env);
    fund_social(&env, &client, &alice, 3);

    let (_sks, keys) = link_keys(&env, MAX_BATCH_VOUCH, 1);
    let mut notes = Vec::new(&env);
    for _ in 0..MAX_BATCH_VOUCH {
        notes.push_back(String::from_str(&env, &"💧".repeat(60)));
    }
    client.mint_vouches(&alice, &keys, &notes);
    let used = env.cost_estimate().resources();
    // a `Vouch` and a `ClaimPubkey` per card, plus the day's count, the balance, the
    // instance (the vouch sequence) and the voucher's one auth nonce
    assert_eq!(used.write_entries, 2 * MAX_BATCH_VOUCH + 4, "{used:?}");
    assert!(used.write_entries < TX_MAX_WRITE_ENTRIES / 4, "{used:?}");
    assert!(used.write_bytes < TX_MAX_WRITE_BYTES / 4, "{used:?}");
    assert!(
        used.contract_events_size_bytes < TX_MAX_EVENTS_BYTES / 4,
        "{used:?}"
    );
    assert!(used.instructions < TX_MAX_INSTRUCTIONS / 4, "{used:?}");
}

/// The upgraded build serves `mint_vouches` on the deployed state: ids continue after the
/// cards minted before the upgrade, which still claim as before.
#[test]
fn upgrade_serves_mint_vouches_and_keeps_numbering() {
    let (env, client, _admin) = setup_testnet();
    let (alice, bob) = (Address::generate(&env), Address::generate(&env));
    let (s1, h1) = secret_and_hash(&env, 1);
    let old = client.mint_vouch(&alice, &h1, &String::from_str(&env, "old"));

    let hash = env.deployer().upload_contract_wasm(REPUTATION_WASM);
    client.upgrade(&hash);

    let (sks, keys) = link_keys(&env, 2, 1);
    let ids = client.mint_vouches(&alice, &keys, &batch_notes(&env, 2, "n"));
    assert_eq!(ids, soroban_sdk::vec![&env, old + 1, old + 2]);
    client.claim_vouch(&bob, &old, &s1);
    let id = ids.get(1).unwrap();
    client.claim_vouch_signed(&bob, &id, &claim_sig(&env, &client, &sks[1], id, &bob));
    assert_eq!(client.get_vouch(&id).unwrap().claimer, Some(bob));
}

// --- Read-view fixtures for the TypeScript mirrors (issue #266) ---

/// The `testdata/read_views.json` fixture: each read view's return value as the XDR (hex) of
/// the `ScVal` a client gets back from RPC. `packages/shared` decodes the same file into its
/// `Vouch` / `Profile` mirrors (`read-views.test.ts`), so a change to either struct fails
/// here first. Rerun with `UPDATE_READ_VIEWS=1` to rewrite the file, then update the mirrors.
#[test]
fn read_view_fixtures_match_the_contract() {
    use soroban_sdk::{
        xdr::{Limits, ScVal, WriteXdr},
        IntoVal, TryFromVal, Val,
    };
    fn hex(env: &Env, v: impl IntoVal<Env, Val>) -> std::string::String {
        let sc = ScVal::try_from_val(env, &v.into_val(env)).unwrap();
        // Qualified: the crate's `ToXdr` (in scope via `super::*`) has a `to_xdr` too.
        let bytes = WriteXdr::to_xdr(&sc, Limits::none()).unwrap();
        bytes.iter().map(|b| std::format!("{b:02x}")).collect()
    }

    let (env, client, _admin) = setup();
    env.ledger().with_mut(|l| l.timestamp = 1_758_633_600);
    // Accounts whose keys are 32 × 0x11 and 32 × 0x22.
    let voucher = Address::from_str(
        &env,
        "GAIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCF6M",
    );
    let claimer = Address::from_str(
        &env,
        "GARCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCFRVX",
    );
    let attester = Address::generate(&env);
    client.add_attester(&attester);

    // A claimed card (stake refunded), then an unclaimed one a keeper slashed after the TTL.
    let (secret, hash) = secret_and_hash(&env, 7);
    let note = String::from_str(&env, "solid work on the quest");
    let claimed = client.mint_vouch(&voucher, &hash, &note);
    client.claim_vouch(&claimer, &claimed, &secret);
    let (_, hash2) = secret_and_hash(&env, 9);
    let slashed = client.mint_vouch(&voucher, &hash2, &String::from_str(&env, ""));
    env.ledger().with_mut(|l| l.timestamp += VOUCH_TTL_SECS + 1);
    client.expire_vouch(&slashed);
    // Social from the claim, Earned (and verified) from one quest award.
    client.award_xp(&attester, &claimer, &2u32, &50u64);

    let fixtures = [
        ("get_vouch_claimed", hex(&env, client.get_vouch(&claimed))),
        ("get_vouch_slashed", hex(&env, client.get_vouch(&slashed))),
        ("get_vouch_absent", hex(&env, client.get_vouch(&999))),
        ("get_profile", hex(&env, client.get_profile(&claimer))),
    ];
    let mut json = std::string::String::from("{\n");
    for (i, (name, xdr)) in fixtures.iter().enumerate() {
        let comma = if i + 1 < fixtures.len() { "," } else { "" };
        json.push_str(&std::format!("  \"{name}\": \"{xdr}\"{comma}\n"));
    }
    json.push_str("}\n");

    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/testdata/read_views.json");
    if std::env::var_os("UPDATE_READ_VIEWS").is_some() {
        std::fs::write(path, &json).unwrap();
    }
    let committed = std::fs::read_to_string(path).unwrap_or_default();
    assert!(
        committed == json,
        "testdata/read_views.json is stale: rerun with UPDATE_READ_VIEWS=1 and update the \
         packages/shared mirrors. Current fixture:\n{json}"
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
    let id = env.register(REPUTATION_WASM, (&admin,));
    let init = soroban_sdk::Symbol::new(&env, "init");
    let impostor = soroban_sdk::Address::generate(&env);
    let call = soroban_sdk::vec![&env, impostor.into_val(&env)];
    assert!(env
        .try_invoke_contract::<(), soroban_sdk::Error>(&id, &init, call)
        .is_err());

    let hash = env.deployer().upload_contract_wasm(REPUTATION_WASM);
    ReputationContractClient::new(&env, &id).upgrade(&hash);
    assert_eq!(env.auths()[0].0, admin);
}
