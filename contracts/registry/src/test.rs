#![cfg(test)]
use super::*;
extern crate std;
use soroban_sdk::{
    symbol_short,
    testutils::{
        storage::{Persistent as _, Temporary as _},
        Address as _, AuthorizedFunction, AuthorizedInvocation, Events as _, Ledger as _,
    },
    vec, Address, Env, IntoVal, String, Symbol, Val, Vec,
};

fn setup() -> (Env, RegistryContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let id = env.register(RegistryContract, ());
    let client = RegistryContractClient::new(&env, &id);
    client.init(&admin);
    (env, client, admin)
}

/// A `handle/<kind> (who, handle)` event as `env.events().all()` reports it.
fn handle_event(
    client: &RegistryContractClient,
    kind: &str,
    who: &Address,
    handle: &str,
) -> (Address, Vec<Val>, Val) {
    let env = &client.env;
    (
        client.address.clone(),
        (symbol_short!("handle"), Symbol::new(env, kind)).into_val(env),
        (who.clone(), Symbol::new(env, handle)).into_val(env),
    )
}

/// A `handle/released (who, handle, until)` event: `until` is when its cooldown ends.
fn released_event(
    client: &RegistryContractClient,
    who: &Address,
    handle: &str,
    until: u64,
) -> (Address, Vec<Val>, Val) {
    let env = &client.env;
    (
        client.address.clone(),
        (symbol_short!("handle"), symbol_short!("released")).into_val(env),
        (who.clone(), Symbol::new(env, handle), until).into_val(env),
    )
}

/// Ledger time the cooldown tests start at, so `until` is a real timestamp, not an offset.
const T0: u64 = 1_790_000_000;

/// Move ledger time forward by `secs` (ledger sequence is left alone).
fn pass(env: &Env, secs: u64) {
    env.ledger().with_mut(|l| l.timestamp += secs);
}

/// `init` is one-shot: a second call must not take over, whoever makes it. The first admin
/// keeps its rights, so an initialized contract cannot be re-pointed at a new admin.
#[test]
fn init_twice_reverts_and_keeps_the_first_admin() {
    let (env, client, admin) = setup();
    let impostor = Address::generate(&env);

    assert_eq!(
        client.try_init(&impostor),
        Err(Ok(Error::AlreadyInitialized.into()))
    );
    assert_eq!(
        client.try_init(&admin),
        Err(Ok(Error::AlreadyInitialized.into()))
    );

    // still the first admin, not the impostor: a forced release asks the first admin to sign
    let squatter = claimed(&env, &client, "brand");
    client.admin_release(&symbol_short!("brand"));
    assert_eq!(
        env.auths(),
        std::vec![(
            admin.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    client.address.clone(),
                    Symbol::new(&env, "admin_release"),
                    (symbol_short!("brand"),).into_val(&env),
                )),
                sub_invocations: std::vec![],
            }
        )]
    );
    assert_eq!(client.resolve(&symbol_short!("brand")), None);
    assert_eq!(client.reverse(&squatter), None);
}

#[test]
fn claim_sets_forward_and_reverse() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    client.claim(&alice, &symbol_short!("alice"));
    assert_eq!(client.resolve(&symbol_short!("alice")), Some(alice.clone()));
    assert_eq!(client.reverse(&alice), Some(symbol_short!("alice")));
}

#[test]
fn unknown_handle_resolves_none() {
    let (env, client, _admin) = setup();
    assert_eq!(client.resolve(&symbol_short!("nobody")), None);
    let ghost = Address::generate(&env);
    assert_eq!(client.reverse(&ghost), None);
}

#[test]
#[should_panic]
fn claim_taken_by_other_reverts() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    client.claim(&alice, &symbol_short!("star"));
    client.claim(&bob, &symbol_short!("star")); // panics: HandleTaken
}

/// A rename onto someone else's handle is a `claim` like any other, so it reverts with
/// `HandleTaken` and the whole call rolls back: alice keeps `a` (it is not freed on the way),
/// bob keeps `b`.
#[test]
fn renaming_into_a_taken_handle_reverts_and_changes_nothing() {
    let (env, client, _admin) = setup();
    let alice = claimed(&env, &client, "a");
    let bob = claimed(&env, &client, "b");

    assert_eq!(
        client.try_claim(&alice, &symbol_short!("b")),
        Err(Ok(Error::HandleTaken.into()))
    );

    assert_eq!(client.reverse(&alice), Some(symbol_short!("a")));
    assert_eq!(client.resolve(&symbol_short!("a")), Some(alice));
    assert_eq!(client.resolve(&symbol_short!("b")), Some(bob.clone()));
    assert_eq!(client.reverse(&bob), Some(symbol_short!("b")));
    // `a` is still held, so nobody else can take it
    let carol = Address::generate(&env);
    assert_eq!(
        client.try_claim(&carol, &symbol_short!("a")),
        Err(Ok(Error::HandleTaken.into()))
    );
}

#[test]
fn first_claim_emits_claimed() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    client.claim(&alice, &symbol_short!("alice"));
    assert_eq!(
        env.events().all(),
        vec![&env, handle_event(&client, "claimed", &alice, "alice")]
    );
}

/// `handle/claimed` and `handle/released` are frozen in docs/ON_CHAIN_EVENTS.md and are the
/// only way an indexer learns a handle changed hands, so their topics and payload order are
/// pinned end to end: the claim announces `claimed`, the release announces `released`.
#[test]
fn claim_and_release_publish_the_documented_payloads() {
    let (env, client, _admin) = setup();
    env.ledger().with_mut(|l| l.timestamp = T0);
    let alice = claimed(&env, &client, "alice");

    assert_eq!(
        env.events().all(),
        vec![&env, handle_event(&client, "claimed", &alice, "alice")]
    );

    client.release(&alice);
    assert_eq!(
        env.events().all(),
        vec![
            &env,
            released_event(&client, &alice, "alice", T0 + HANDLE_COOLDOWN_SECS)
        ]
    );
    // both applied in order, the indexer is left with nothing for this handle
    assert_eq!(client.resolve(&symbol_short!("alice")), None);
}

#[test]
fn reclaim_same_handle_is_idempotent() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    client.claim(&alice, &symbol_short!("alice"));
    // no-op, no panic; `all()` holds the last invocation's events, so it announced nothing
    client.claim(&alice, &symbol_short!("alice"));
    assert_eq!(env.events().all(), vec![&env]);
    assert_eq!(client.resolve(&symbol_short!("alice")), Some(alice.clone()));
    assert_eq!(client.reverse(&alice), Some(symbol_short!("alice")));
}

#[test]
fn rename_frees_the_old_handle() {
    let (env, client, _admin) = setup();
    env.ledger().with_mut(|l| l.timestamp = T0);
    let alice = Address::generate(&env);
    client.claim(&alice, &symbol_short!("old"));
    client.claim(&alice, &symbol_short!("new"));
    // the freed handle is announced first (with its cooldown's end), then the new claim
    assert_eq!(
        env.events().all(),
        vec![
            &env,
            released_event(&client, &alice, "old", T0 + HANDLE_COOLDOWN_SECS),
            handle_event(&client, "claimed", &alice, "new"),
        ]
    );
    // old handle is freed; new one points to alice; reverse reflects the new one.
    assert_eq!(client.resolve(&symbol_short!("old")), None);
    assert_eq!(client.resolve(&symbol_short!("new")), Some(alice.clone()));
    assert_eq!(client.reverse(&alice), Some(symbol_short!("new")));
}

/// Renaming away starts the old handle's cooldown: nobody else can take it until it
/// ends. Then the freed handle is really free, and each reverse record follows its own
/// holder.
#[test]
fn renamed_away_handle_is_reclaimable_by_another_after_the_cooldown() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    client.claim(&alice, &symbol_short!("old"));
    client.claim(&alice, &symbol_short!("new"));
    assert_eq!(
        client.try_claim(&bob, &symbol_short!("old")),
        Err(Ok(Error::HandleCoolingDown.into()))
    );
    assert_eq!(client.reverse(&bob), None);

    pass(&env, HANDLE_COOLDOWN_SECS);
    client.claim(&bob, &symbol_short!("old"));
    assert_eq!(
        env.events().all(),
        vec![&env, handle_event(&client, "claimed", &bob, "old")]
    );
    assert_eq!(client.resolve(&symbol_short!("old")), Some(bob.clone()));
    assert_eq!(client.resolve(&symbol_short!("new")), Some(alice.clone()));
    assert_eq!(client.reverse(&bob), Some(symbol_short!("old")));
    assert_eq!(client.reverse(&alice), Some(symbol_short!("new")));
}

#[test]
fn release_frees_both_directions() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    client.claim(&alice, &symbol_short!("alice"));
    client.release(&alice);
    assert_eq!(client.resolve(&symbol_short!("alice")), None);
    assert_eq!(client.reverse(&alice), None);
}

#[test]
#[should_panic]
fn release_without_handle_reverts() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    client.release(&alice); // panics: NoHandle
}

#[test]
fn freed_handle_is_reclaimable_by_another() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    client.claim(&alice, &symbol_short!("star"));
    client.release(&alice);
    pass(&env, HANDLE_COOLDOWN_SECS);
    client.claim(&bob, &symbol_short!("star"));
    assert_eq!(client.resolve(&symbol_short!("star")), Some(bob));
}

#[test]
fn admin_release_clears_a_squatted_handle() {
    let (env, client, _admin) = setup();
    let squatter = Address::generate(&env);
    let real = Address::generate(&env);
    client.claim(&squatter, &symbol_short!("brand"));
    client.admin_release(&symbol_short!("brand"));
    assert_eq!(client.resolve(&symbol_short!("brand")), None);
    assert_eq!(client.reverse(&squatter), None);
    // now the rightful owner can claim it
    client.claim(&real, &symbol_short!("brand"));
    assert_eq!(client.resolve(&symbol_short!("brand")), Some(real));
}

// --- Handle cooldown ---

fn cooling(prev_owner: &Address, until: u64) -> Option<CooldownInfo> {
    Some(CooldownInfo {
        prev_owner: prev_owner.clone(),
        until,
    })
}

fn has_cooldown_entry(env: &Env, client: &RegistryContractClient, handle: &str) -> bool {
    env.as_contract(&client.address, || {
        env.storage()
            .temporary()
            .has(&DataKey::Cooldown(Symbol::new(env, handle)))
    })
}

#[test]
fn handle_cooling_down_is_appended_as_error_9() {
    // codes are append-only (docs/ON_CHAIN_EVENTS.md documents #9); a renumber breaks clients
    assert_eq!(Error::TooMany as u32, 8);
    assert_eq!(Error::HandleCoolingDown as u32, 9);
}

#[test]
fn release_cooldown_prevents_immediate_claim() {
    let (env, client, _admin) = setup();
    env.ledger().with_mut(|l| l.timestamp = T0);
    let alice = claimed(&env, &client, "alice");
    client.release(&alice);
    assert_eq!(
        client.cooldown(&symbol_short!("alice")),
        cooling(&alice, T0 + HANDLE_COOLDOWN_SECS)
    );

    let bob = Address::generate(&env);
    assert_eq!(
        client.try_claim(&bob, &symbol_short!("alice")),
        Err(Ok(Error::HandleCoolingDown.into()))
    );
    // the refused claim changed nothing: still free, still reserved for alice
    assert_eq!(client.resolve(&symbol_short!("alice")), None);
    assert_eq!(client.reverse(&bob), None);
    assert_eq!(
        client.cooldown(&symbol_short!("alice")),
        cooling(&alice, T0 + HANDLE_COOLDOWN_SECS)
    );
}

/// The window is `[freed, freed + HANDLE_COOLDOWN_SECS)`: one second short still reverts,
/// and from `until` on the handle is first-come again (the stale entry goes with the claim).
#[test]
fn release_handle_claimable_after_cooldown() {
    let (env, client, _admin) = setup();
    env.ledger().with_mut(|l| l.timestamp = T0);
    let alice = claimed(&env, &client, "alice");
    client.release(&alice);
    let bob = Address::generate(&env);

    pass(&env, HANDLE_COOLDOWN_SECS - 1);
    assert_eq!(
        client.try_claim(&bob, &symbol_short!("alice")),
        Err(Ok(Error::HandleCoolingDown.into()))
    );
    assert!(client.cooldown(&symbol_short!("alice")).is_some());

    pass(&env, 1);
    assert_eq!(client.cooldown(&symbol_short!("alice")), None);
    client.claim(&bob, &symbol_short!("alice"));
    assert_eq!(
        env.events().all(),
        vec![&env, handle_event(&client, "claimed", &bob, "alice")]
    );
    assert_eq!(client.resolve(&symbol_short!("alice")), Some(bob.clone()));
    assert_eq!(client.reverse(&bob), Some(symbol_short!("alice")));
    assert!(!has_cooldown_entry(&env, &client, "alice"));
}

/// The previous owner can take a cooling handle back at any time, after a release or a
/// rename; taking it back ends that cooldown, and a rename starts one on the handle left.
#[test]
fn previous_owner_can_reclaim_during_the_cooldown() {
    let (env, client, _admin) = setup();
    env.ledger().with_mut(|l| l.timestamp = T0);
    let alice = claimed(&env, &client, "alice");

    client.release(&alice);
    pass(&env, 3_600);
    client.claim(&alice, &symbol_short!("alice"));
    assert_eq!(
        env.events().all(),
        vec![&env, handle_event(&client, "claimed", &alice, "alice")]
    );
    assert_eq!(client.cooldown(&symbol_short!("alice")), None);
    assert!(!has_cooldown_entry(&env, &client, "alice"));

    // rename away and straight back: `alice` is hers again, `alice_x` now cools for her
    client.claim(&alice, &symbol_short!("alice_x"));
    pass(&env, HANDLE_COOLDOWN_SECS - 1);
    client.claim(&alice, &symbol_short!("alice"));
    let until = T0 + 3_600 + HANDLE_COOLDOWN_SECS - 1 + HANDLE_COOLDOWN_SECS;
    assert_eq!(
        env.events().all(),
        vec![
            &env,
            released_event(&client, &alice, "alice_x", until),
            handle_event(&client, "claimed", &alice, "alice"),
        ]
    );
    assert_eq!(client.cooldown(&symbol_short!("alice")), None);
    assert_eq!(
        client.cooldown(&symbol_short!("alice_x")),
        cooling(&alice, until)
    );
    assert_eq!(client.resolve(&symbol_short!("alice")), Some(alice.clone()));
    assert_eq!(client.reverse(&alice), Some(symbol_short!("alice")));
    let bob = Address::generate(&env);
    assert_eq!(
        client.try_claim(&bob, &symbol_short!("alice_x")),
        Err(Ok(Error::HandleCoolingDown.into()))
    );
}

/// Abuse removal frees a handle outright: `admin_release` starts no cooldown, and lifts
/// one a squatter left behind by renaming away.
#[test]
fn admin_release_skips_the_cooldown() {
    let (env, client, _admin) = setup();
    env.ledger().with_mut(|l| l.timestamp = T0);
    let real = Address::generate(&env);

    let squatter = claimed(&env, &client, "brand");
    client.admin_release(&symbol_short!("brand"));
    assert_eq!(client.cooldown(&symbol_short!("brand")), None);
    assert!(!has_cooldown_entry(&env, &client, "brand"));
    client.claim(&real, &symbol_short!("brand"));
    assert_eq!(client.resolve(&symbol_short!("brand")), Some(real.clone()));

    // a squatter parks `acme` in a cooldown by renaming away from it
    client.claim(&squatter, &symbol_short!("acme"));
    client.claim(&squatter, &symbol_short!("parked"));
    assert!(client.cooldown(&symbol_short!("acme")).is_some());
    client.admin_release(&symbol_short!("acme"));
    assert_eq!(env.events().all(), vec![&env]);
    assert_eq!(client.cooldown(&symbol_short!("acme")), None);
    let owner = claimed(&env, &client, "acme");
    assert_eq!(client.resolve(&symbol_short!("acme")), Some(owner));
    // the squatter keeps the handle it renamed to
    assert_eq!(client.reverse(&squatter), Some(symbol_short!("parked")));
}

/// The cooldown is measured in ledger time only: ledgers closing (sequence moving on) while
/// the clock stands still do not shorten it.
#[test]
fn cooldown_runs_on_ledger_time_not_ledger_sequence() {
    // mainnet TTLs, so the instance itself lives through the ledgers skipped below
    let (env, client) = setup_with_ttls(MAINNET_TTLS);
    env.ledger().with_mut(|l| l.timestamp = T0);
    let alice = claimed(&env, &client, "alice");
    client.release(&alice);

    // a full window's worth of 5s ledgers, but only half the time has passed
    env.ledger().with_mut(|l| {
        l.sequence_number += (HANDLE_COOLDOWN_SECS / 5) as u32;
        l.timestamp += HANDLE_COOLDOWN_SECS / 2;
    });
    let bob = Address::generate(&env);
    assert_eq!(
        client.try_claim(&bob, &symbol_short!("alice")),
        Err(Ok(Error::HandleCoolingDown.into()))
    );
    assert_eq!(
        client.cooldown(&symbol_short!("alice")),
        cooling(&alice, T0 + HANDLE_COOLDOWN_SECS)
    );
}

/// The cooldown entry is temporary storage that outlives its window with room to spare
/// (it must not vanish before `until`), and stays inside max_entry_ttl, past which a
/// temporary extension traps.
#[test]
fn cooldown_entry_outlives_the_window() {
    for ttls in [TESTNET_TTLS, MAINNET_TTLS] {
        let (env, client) = setup_with_ttls(ttls);
        let alice = Address::generate(&env);
        client.claim(&alice, &symbol_short!("alice"));
        client.release(&alice);
        let live = env.as_contract(&client.address, || {
            env.storage()
                .temporary()
                .get_ttl(&DataKey::Cooldown(symbol_short!("alice")))
        });
        assert_eq!(live, COOLDOWN_TTL_LEDGERS);
        assert!(u64::from(live) * 5 >= 2 * HANDLE_COOLDOWN_SECS);
        assert!(live < ttls.2);
    }
}

/// `cooldown` is a pure read (the web app only simulates it).
#[test]
fn cooldown_view_does_not_write_or_extend() {
    let (env, client) = setup_with_ttls(TESTNET_TTLS);
    let alice = Address::generate(&env);
    client.claim(&alice, &symbol_short!("alice"));
    client.release(&alice);
    env.ledger()
        .with_mut(|l| l.sequence_number += DAY_LEDGERS * 3);

    assert!(client.cooldown(&symbol_short!("alice")).is_some());
    let used = env.cost_estimate().resources();
    assert_eq!(used.write_entries, 0);
    assert_eq!(used.persistent_entry_rent_bumps, 0);
    assert_eq!(client.cooldown(&symbol_short!("never")), None);
}

/// Releasing a handle nobody holds is deliberately a silent no-op rather than a revert: the
/// admin can sweep a list of handles without special-casing the free ones. Pinned so that
/// turning it into an error, or giving it a voice, has to be a deliberate change.
#[test]
fn admin_release_of_an_unclaimed_handle_is_a_silent_no_op() {
    let (env, client, _admin) = setup();
    let alice = claimed(&env, &client, "alice");
    client.set_meta(&alice, &FACE_03, &bio(&env, "not yours"));

    client.admin_release(&symbol_short!("ghost"));

    // nothing announced, nothing handed out, and no other holder disturbed
    assert_eq!(env.events().all(), vec![&env]);
    assert_eq!(client.resolve(&symbol_short!("ghost")), None);
    assert_eq!(client.resolve(&symbol_short!("alice")), Some(alice.clone()));
    assert_eq!(client.reverse(&alice), Some(symbol_short!("alice")));
    assert_eq!(
        client.get_meta(&alice),
        Some(meta(&env, FACE_03, "not yours"))
    );

    // alice still owns her name and can hand it on, so the sweep changed nothing
    client.release(&alice);
    pass(&env, HANDLE_COOLDOWN_SECS);
    let bob = claimed(&env, &client, "alice");
    assert_eq!(client.resolve(&symbol_short!("alice")), Some(bob));
}

/// Release build of this contract, committed so the upgrade path can be tested without a
/// wasm build step in CI. Refresh with `make upgrade-fixtures` after changing the contract.
const REGISTRY_WASM: &[u8] = include_bytes!("../testdata/alvinmunk_registry.wasm");

#[test]
fn upgrade_to_identical_wasm_preserves_handles() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    client.claim(&alice, &symbol_short!("alice"));
    let hi = String::from_str(&env, "hi");
    client.set_meta(&alice, &FACE_03, &hi);

    // a cooldown started before the upgrade still holds after it
    let bob = claimed(&env, &client, "bob");
    client.release(&bob);

    let hash = env.deployer().upload_contract_wasm(REGISTRY_WASM);
    client.upgrade(&hash);

    assert_eq!(
        client.try_claim(&Address::generate(&env), &symbol_short!("bob")),
        Err(Ok(Error::HandleCoolingDown.into()))
    );
    assert_eq!(
        client.cooldown(&symbol_short!("bob")).map(|c| c.prev_owner),
        Some(bob)
    );
    assert_eq!(client.resolve(&symbol_short!("alice")), Some(alice.clone()));
    assert_eq!(client.reverse(&alice), Some(symbol_short!("alice")));
    assert_eq!(
        client.reverse_many(&vec![&env, alice.clone()]),
        vec![&env, Some(symbol_short!("alice"))]
    );
    // the fixture build serves the profile written before the upgrade, and still takes writes
    let before = ProfileMeta {
        avatar: FACE_03,
        bio: hi.clone(),
    };
    assert_eq!(client.get_meta(&alice), Some(before));
    client.set_meta(&alice, &KIT_MIN, &hi);
    assert_eq!(client.get_meta(&alice).map(|m| m.avatar), Some(KIT_MIN));
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn non_admin_upgrade_reverts() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let id = env.register(RegistryContract, ());
    let client = RegistryContractClient::new(&env, &id);
    client.init(&admin);
    let hash = soroban_sdk::BytesN::from_array(&env, &[1; 32]);
    client.upgrade(&hash);
}

// --- Storage TTLs ---

/// Live `state_archival` settings from `stellar network settings` (checked 2026-09-28):
/// (min_persistent_ttl, min_temporary_ttl, max_entry_ttl).
const TESTNET_TTLS: (u32, u32, u32) = (120_960, 720, 3_110_400);
const MAINNET_TTLS: (u32, u32, u32) = (2_073_600, 17_280, 3_110_400);

/// `setup()` on a ledger with the given network TTL limits, set before registration so the
/// instance gets the same TTLs as on the network.
fn setup_with_ttls(
    (min_persistent, min_temp, max_ttl): (u32, u32, u32),
) -> (Env, RegistryContractClient<'static>) {
    let env = Env::default();
    env.ledger().with_mut(|l| {
        l.sequence_number = 1_000;
        l.min_persistent_entry_ttl = min_persistent;
        l.min_temp_entry_ttl = min_temp;
        l.max_entry_ttl = max_ttl;
    });
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let id = env.register(RegistryContract, ());
    let client = RegistryContractClient::new(&env, &id);
    client.init(&admin);
    (env, client)
}

fn ttl(env: &Env, client: &RegistryContractClient, key: &DataKey) -> u32 {
    env.as_contract(&client.address, || env.storage().persistent().get_ttl(key))
}

#[test]
fn claim_extends_both_directions_to_bump_extend() {
    for ttls in [TESTNET_TTLS, MAINNET_TTLS] {
        let (env, client) = setup_with_ttls(ttls);
        let alice = Address::generate(&env);
        client.claim(&alice, &symbol_short!("alice"));
        assert_eq!(
            ttl(&env, &client, &DataKey::Fwd(symbol_short!("alice"))),
            BUMP_EXTEND
        );
        assert_eq!(
            ttl(&env, &client, &DataKey::Rev(alice.clone())),
            BUMP_EXTEND
        );

        // A rename days later writes both keys again and tops them back up.
        env.ledger()
            .with_mut(|l| l.sequence_number += DAY_LEDGERS * 3);
        client.claim(&alice, &symbol_short!("alice2"));
        assert_eq!(
            ttl(&env, &client, &DataKey::Fwd(symbol_short!("alice2"))),
            BUMP_EXTEND
        );
        assert_eq!(ttl(&env, &client, &DataKey::Rev(alice)), BUMP_EXTEND);
    }
}

/// `resolve` is a pure read (the web app only simulates it), so it must not extend.
#[test]
fn resolve_does_not_extend_the_handle() {
    let (env, client) = setup_with_ttls(TESTNET_TTLS);
    let alice = Address::generate(&env);
    client.claim(&alice, &symbol_short!("alice"));
    env.ledger()
        .with_mut(|l| l.sequence_number += DAY_LEDGERS * 3);
    assert_eq!(client.resolve(&symbol_short!("alice")), Some(alice));
    assert_eq!(
        ttl(&env, &client, &DataKey::Fwd(symbol_short!("alice"))),
        BUMP_EXTEND - DAY_LEDGERS * 3
    );
}

// --- Batched reverse lookup ---

/// `n` fresh addresses; every other one claims a handle (`h0`, `h2`, ...).
fn some_claimed(env: &Env, client: &RegistryContractClient, n: u32) -> Vec<Address> {
    let mut addrs = Vec::new(env);
    for i in 0..n {
        let a = Address::generate(env);
        if i % 2 == 0 {
            client.claim(&a, &Symbol::new(env, &std::format!("h{i}")));
        }
        addrs.push_back(a);
    }
    addrs
}

#[test]
fn reverse_many_returns_handles_in_input_order() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env); // never claims
    client.claim(&alice, &symbol_short!("alice"));
    client.claim(&bob, &symbol_short!("bob"));
    assert_eq!(
        client.reverse_many(&vec![&env, bob.clone(), carol, alice.clone(), bob]),
        vec![
            &env,
            Some(symbol_short!("bob")),
            None,
            Some(symbol_short!("alice")),
            Some(symbol_short!("bob")),
        ]
    );
}

#[test]
fn reverse_many_matches_reverse_after_rename_and_release() {
    let (env, client, _admin) = setup();
    let addrs = some_claimed(&env, &client, 6);
    client.claim(&addrs.get(0).unwrap(), &symbol_short!("renamed"));
    client.release(&addrs.get(2).unwrap());
    let mut expected = Vec::new(&env);
    for a in addrs.iter() {
        expected.push_back(client.reverse(&a));
    }
    assert_eq!(expected.get(0).unwrap(), Some(symbol_short!("renamed")));
    assert_eq!(expected.get(2).unwrap(), None);
    assert_eq!(client.reverse_many(&addrs), expected);
}

#[test]
fn reverse_many_of_nothing_is_empty() {
    let (env, client, _admin) = setup();
    assert_eq!(client.reverse_many(&vec![&env]), vec![&env]);
}

#[test]
fn reverse_many_takes_up_to_the_cap_and_reverts_past_it() {
    let (env, client, _admin) = setup();
    let mut addrs = some_claimed(&env, &client, REVERSE_MANY_CAP);
    let handles = client.reverse_many(&addrs);
    assert_eq!(handles.len(), REVERSE_MANY_CAP);
    assert_eq!(handles.get(0).unwrap(), Some(symbol_short!("h0")));
    assert_eq!(handles.get(1).unwrap(), None);

    addrs.push_back(Address::generate(&env));
    assert_eq!(
        client.try_reverse_many(&addrs),
        Err(Ok(Error::TooMany.into()))
    );
}

/// `reverse_many` is a pure read (the web app only simulates it): it writes nothing and
/// extends nothing, just like `reverse`.
#[test]
fn reverse_many_does_not_write_or_extend() {
    let (env, client) = setup_with_ttls(TESTNET_TTLS);
    let addrs = some_claimed(&env, &client, 4);
    env.ledger()
        .with_mut(|l| l.sequence_number += DAY_LEDGERS * 3);

    client.reverse_many(&addrs);
    let used = env.cost_estimate().resources();
    assert_eq!(used.write_entries, 0);
    assert_eq!(used.persistent_entry_rent_bumps, 0);
    assert_eq!(
        ttl(&env, &client, &DataKey::Rev(addrs.get(0).unwrap())),
        BUMP_EXTEND - DAY_LEDGERS * 3
    );
}

/// A full batch against the release build stays far inside the per-transaction limits
/// `REVERSE_MANY_CAP` was sized for (testnet and mainnet, checked 2026-09-29).
#[test]
fn a_full_reverse_many_fits_one_transaction() {
    const TX_MAX_INSTRUCTIONS: i64 = 400_000_000;
    const TX_MAX_FOOTPRINT_ENTRIES: u32 = 400;
    const TX_MAX_DISK_READ_BYTES: u32 = 200_000;

    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(REGISTRY_WASM, ());
    let client = RegistryContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let addrs = some_claimed(&env, &client, REVERSE_MANY_CAP);

    client.reverse_many(&addrs);
    let used = env.cost_estimate().resources();
    // one `Rev` key per address, plus the instance and the code
    assert_eq!(used.read_entries, REVERSE_MANY_CAP + 2, "{used:?}");
    assert!(used.read_entries < TX_MAX_FOOTPRINT_ENTRIES / 4, "{used:?}");
    assert!(used.read_bytes < TX_MAX_DISK_READ_BYTES / 4, "{used:?}");
    assert!(used.instructions < TX_MAX_INSTRUCTIONS / 4, "{used:?}");
}

// --- Profile meta (avatar + bio) ---

/// Golden packings, shared with apps/web/src/lib/avatar.test.ts so the two stay in step.
const FACE_03: u64 = 0x0000_0000_0000_0003;
/// kit: skin 3, hair 7, eyes 5, mouth 4, acc 9, bg 2
const KIT_3_7_5_4_9_2: u64 = 0x0100_0307_0504_0902;
/// kit at every field's maximum, then at the minimum with no accessory or background
const KIT_MAX: u64 = 0x0100_060a_0a09_0d05;
const KIT_MIN: u64 = 0x0100_0101_0101_0000;

fn bio(env: &Env, s: &str) -> String {
    String::from_str(env, s)
}

fn claimed(env: &Env, client: &RegistryContractClient, handle: &str) -> Address {
    let who = Address::generate(env);
    client.claim(&who, &Symbol::new(env, handle));
    who
}

fn meta(env: &Env, avatar: u64, text: &str) -> ProfileMeta {
    ProfileMeta {
        avatar,
        bio: bio(env, text),
    }
}

#[test]
fn set_meta_round_trips_and_emits_meta_set() {
    let (env, client, _admin) = setup();
    let alice = claimed(&env, &client, "alice");
    client.set_meta(&alice, &FACE_03, &bio(&env, "Builder on Stellar"));

    assert_eq!(
        env.auths(),
        std::vec![(
            alice.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    client.address.clone(),
                    Symbol::new(&env, "set_meta"),
                    (alice.clone(), FACE_03, bio(&env, "Builder on Stellar")).into_val(&env),
                )),
                sub_invocations: std::vec![],
            }
        )]
    );
    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                client.address.clone(),
                (symbol_short!("meta"), symbol_short!("set")).into_val(&env),
                (alice.clone(), FACE_03, bio(&env, "Builder on Stellar")).into_val(&env),
            )
        ]
    );
    assert_eq!(
        client.get_meta(&alice),
        Some(meta(&env, FACE_03, "Builder on Stellar"))
    );
}

#[test]
fn set_meta_overwrites_and_accepts_an_empty_bio() {
    let (env, client, _admin) = setup();
    let alice = claimed(&env, &client, "alice");
    client.set_meta(&alice, &FACE_03, &bio(&env, "first"));
    client.set_meta(&alice, &KIT_3_7_5_4_9_2, &bio(&env, ""));
    assert_eq!(
        client.get_meta(&alice),
        Some(meta(&env, KIT_3_7_5_4_9_2, ""))
    );
}

#[test]
fn get_meta_is_none_until_set() {
    let (env, client, _admin) = setup();
    let alice = claimed(&env, &client, "alice");
    assert_eq!(client.get_meta(&alice), None);
    assert_eq!(client.get_meta(&Address::generate(&env)), None);
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn set_meta_requires_the_callers_auth() {
    let (env, client, _admin) = setup();
    let alice = claimed(&env, &client, "alice");
    env.mock_auths(&[]); // nobody signs from here on
    client.set_meta(&alice, &FACE_03, &bio(&env, "not me"));
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn set_meta_without_a_handle_reverts() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    client.set_meta(&alice, &FACE_03, &bio(&env, "no handle"));
}

#[test]
fn bio_limit_counts_utf8_bytes_not_characters() {
    let (env, client, _admin) = setup();
    let alice = claimed(&env, &client, "alice");
    let set = |s: &str| client.try_set_meta(&alice, &FACE_03, &bio(&env, s));

    // exactly 80 bytes: 80 ASCII chars, 40 two-byte chars, 20 four-byte chars
    for ok in ["a".repeat(80), "ş".repeat(40), "🌟".repeat(20)] {
        assert_eq!(set(&ok), Ok(Ok(())), "{ok}");
    }
    // 81+ bytes, though each is well under 80 characters
    for long in [
        "a".repeat(81),
        "ş".repeat(41),
        "€".repeat(27),
        "🌟".repeat(21),
    ] {
        assert_eq!(set(&long), Err(Ok(Error::BioTooLong.into())), "{long}");
    }
    assert_eq!(
        client.get_meta(&alice),
        Some(meta(&env, FACE_03, &"🌟".repeat(20)))
    );
}

#[test]
fn bio_must_be_one_line_of_plain_utf8() {
    let (env, client, _admin) = setup();
    let alice = claimed(&env, &client, "alice");
    let set = |b: &String| client.try_set_meta(&alice, &FACE_03, b);

    for bad in [
        "line\nbreak",
        "tab\there",
        "nul\u{0}",
        "del\u{7f}",
        "c1\u{85}",
        "sep\u{2028}",
        "par\u{2029}",
        "rlo\u{202e}txt",
        "isolate\u{2066}",
        "pdi\u{2069}",
    ] {
        assert_eq!(
            set(&bio(&env, bad)),
            Err(Ok(Error::BadBio.into())),
            "{bad:?}"
        );
    }
    // not UTF-8 at all: a lone continuation byte, a truncated 2-byte sequence
    for raw in [&[b'o', b'k', 0x80][..], &[0xc5][..]] {
        assert_eq!(
            set(&String::from_bytes(&env, raw)),
            Err(Ok(Error::BadBio.into())),
            "{raw:?}"
        );
    }
    // punctuation, emoji, accents and zero-width joiners are ordinary text
    let fine = "Builder — ship it! 👩‍💻 çğış <b>&amp;</b>";
    assert_eq!(set(&bio(&env, fine)), Ok(Ok(())));
    assert_eq!(client.get_meta(&alice), Some(meta(&env, FACE_03, fine)));
}

#[test]
fn every_shipped_avatar_is_accepted() {
    let (env, client, _admin) = setup();
    let alice = claimed(&env, &client, "alice");
    let mut valid = std::vec![KIT_3_7_5_4_9_2, KIT_MAX, KIT_MIN];
    valid.extend((1..=FACE_COUNT).map(|n| (AVATAR_FACE << 56) | n));
    for avatar in valid {
        client.set_meta(&alice, &avatar, &bio(&env, ""));
        assert_eq!(
            client.get_meta(&alice).unwrap().avatar,
            avatar,
            "{avatar:#018x}"
        );
    }
}

#[test]
fn out_of_range_avatars_revert() {
    let (env, client, _admin) = setup();
    let alice = claimed(&env, &client, "alice");
    let invalid = [
        0x0000_0000_0000_0000, // face 0
        0x0000_0000_0000_0006, // face past FACE_COUNT
        0x0000_0000_0000_0103, // face with a stray byte
        0x8000_0000_0000_0003, // face with the top bit set
        0x0200_0101_0101_0101, // unknown kind
        0xff00_0101_0101_0101, // unknown kind
        0x0100_0001_0101_0101, // skin 0
        0x0100_0701_0101_0101, // skin past KIT_SKIN
        0x0100_010b_0101_0101, // hair past KIT_HAIR
        0x0100_0101_0b01_0101, // eyes past KIT_EYES
        0x0100_0101_010a_0101, // mouth past KIT_MOUTH
        0x0100_0101_0101_0e01, // acc past KIT_ACC
        0x0100_0101_0101_0106, // bg past KIT_BG
        0x0100_0000_0101_0101, // hair 0
        0x0101_0101_0101_0101, // kit with byte 6 set
        u64::MAX,
    ];
    for avatar in invalid {
        assert_eq!(
            client.try_set_meta(&alice, &avatar, &bio(&env, "")),
            Err(Ok(Error::BadAvatar.into())),
            "{avatar:#018x}"
        );
    }
    assert_eq!(client.get_meta(&alice), None);
}

#[test]
fn rename_keeps_the_profile() {
    let (env, client, _admin) = setup();
    let alice = claimed(&env, &client, "old");
    client.set_meta(&alice, &FACE_03, &bio(&env, "still me"));
    client.claim(&alice, &symbol_short!("new"));
    assert_eq!(
        client.get_meta(&alice),
        Some(meta(&env, FACE_03, "still me"))
    );
}

#[test]
fn release_drops_the_profile_so_the_next_owner_starts_blank() {
    let (env, client, _admin) = setup();
    env.ledger().with_mut(|l| l.timestamp = T0);
    let alice = claimed(&env, &client, "star");
    client.set_meta(&alice, &FACE_03, &bio(&env, "alice was here"));
    client.release(&alice);
    assert_eq!(
        env.events().all(),
        vec![
            &env,
            released_event(&client, &alice, "star", T0 + HANDLE_COOLDOWN_SECS),
            (
                client.address.clone(),
                (symbol_short!("meta"), symbol_short!("cleared")).into_val(&env),
                alice.clone().into_val(&env),
            ),
        ]
    );
    assert_eq!(client.get_meta(&alice), None);

    pass(&env, HANDLE_COOLDOWN_SECS);
    let bob = claimed(&env, &client, "star");
    assert_eq!(client.resolve(&symbol_short!("star")), Some(bob.clone()));
    assert_eq!(client.get_meta(&bob), None);

    // releasing a handle that never had a profile announces only the handle
    client.release(&bob);
    assert_eq!(
        env.events().all(),
        vec![
            &env,
            released_event(&client, &bob, "star", T0 + 2 * HANDLE_COOLDOWN_SECS)
        ]
    );
}

#[test]
fn admin_release_drops_the_profile_too() {
    let (env, client, _admin) = setup();
    let squatter = claimed(&env, &client, "brand");
    client.set_meta(&squatter, &FACE_03, &bio(&env, "abusive bio"));
    client.admin_release(&symbol_short!("brand"));
    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                client.address.clone(),
                (symbol_short!("meta"), symbol_short!("cleared")).into_val(&env),
                squatter.clone().into_val(&env),
            ),
        ]
    );
    assert_eq!(client.get_meta(&squatter), None);

    let real = claimed(&env, &client, "brand");
    assert_eq!(client.get_meta(&real), None);
    // the squatter can come back under another handle, but starts blank
    client.claim(&squatter, &symbol_short!("other"));
    assert_eq!(client.get_meta(&squatter), None);
}

#[test]
fn set_meta_extends_the_profile_and_its_handle_to_bump_extend() {
    for ttls in [TESTNET_TTLS, MAINNET_TTLS] {
        let (env, client) = setup_with_ttls(ttls);
        let alice = Address::generate(&env);
        client.claim(&alice, &symbol_short!("alice"));
        // days later the handle entries have aged; publishing a profile tops them back up
        env.ledger()
            .with_mut(|l| l.sequence_number += DAY_LEDGERS * 3);
        client.set_meta(&alice, &FACE_03, &bio(&env, "hi"));
        for key in [
            DataKey::Meta(alice.clone()),
            DataKey::Rev(alice.clone()),
            DataKey::Fwd(symbol_short!("alice")),
        ] {
            assert_eq!(ttl(&env, &client, &key), BUMP_EXTEND);
        }
    }
}

/// `get_meta` is a pure read (the web app only simulates it), so it must not extend.
#[test]
fn get_meta_does_not_extend_the_profile() {
    let (env, client) = setup_with_ttls(TESTNET_TTLS);
    let alice = Address::generate(&env);
    client.claim(&alice, &symbol_short!("alice"));
    client.set_meta(&alice, &FACE_03, &bio(&env, "hi"));
    env.ledger()
        .with_mut(|l| l.sequence_number += DAY_LEDGERS * 3);
    assert!(client.get_meta(&alice).is_some());
    assert_eq!(
        ttl(&env, &client, &DataKey::Meta(alice)),
        BUMP_EXTEND - DAY_LEDGERS * 3
    );
}
