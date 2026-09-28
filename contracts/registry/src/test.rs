#![cfg(test)]
use super::*;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events as _},
    vec, Address, Env, IntoVal, Symbol, Val, Vec,
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
    let alice = Address::generate(&env);
    client.claim(&alice, &symbol_short!("old"));
    client.claim(&alice, &symbol_short!("new"));
    // the freed handle is announced first, then the new claim
    assert_eq!(
        env.events().all(),
        vec![
            &env,
            handle_event(&client, "released", &alice, "old"),
            handle_event(&client, "claimed", &alice, "new"),
        ]
    );
    // old handle is freed; new one points to alice; reverse reflects the new one.
    assert_eq!(client.resolve(&symbol_short!("old")), None);
    assert_eq!(client.resolve(&symbol_short!("new")), Some(alice.clone()));
    assert_eq!(client.reverse(&alice), Some(symbol_short!("new")));
}

#[test]
fn renamed_away_handle_is_reclaimable_by_another() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    client.claim(&alice, &symbol_short!("old"));
    client.claim(&alice, &symbol_short!("new"));
    client.claim(&bob, &symbol_short!("old"));
    assert_eq!(
        env.events().all(),
        vec![&env, handle_event(&client, "claimed", &bob, "old")]
    );
    assert_eq!(client.resolve(&symbol_short!("old")), Some(bob));
    assert_eq!(client.resolve(&symbol_short!("new")), Some(alice));
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

/// Release build of this contract, committed so the upgrade path can be tested without a
/// wasm build step in CI. Refresh with `make upgrade-fixtures` after changing the contract.
const REGISTRY_WASM: &[u8] = include_bytes!("../testdata/alvinmunk_registry.wasm");

#[test]
fn upgrade_to_identical_wasm_preserves_handles() {
    let (env, client, _admin) = setup();
    let alice = Address::generate(&env);
    client.claim(&alice, &symbol_short!("alice"));

    let hash = env.deployer().upload_contract_wasm(REGISTRY_WASM);
    client.upgrade(&hash);

    assert_eq!(client.resolve(&symbol_short!("alice")), Some(alice.clone()));
    assert_eq!(client.reverse(&alice), Some(symbol_short!("alice")));
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
