/**
 * The `Vouch` / `Profile` mirrors against the reputation contract itself (issue #266).
 *
 * `contracts/reputation/testdata/read_views.json` holds what `get_vouch` / `get_profile`
 * return, as the XDR of each `ScVal`: the contract test `read_view_fixtures_match_the_contract`
 * writes it from real calls and fails whenever it goes stale. Decoding it here, the way a
 * client does (RPC `ScVal` → `scValToNative` → decoder), fails when the mirrors drift.
 */
import { readFileSync } from 'node:fs';
import { StrKey, scValToNative, xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import {
  PROFILE_FIELDS,
  VOUCH_FIELDS,
  decodeProfile,
  decodeVouch,
  type Profile,
  type Vouch,
} from './index';

const repo = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

const fixtures = JSON.parse(repo('contracts/reputation/testdata/read_views.json')) as Record<
  'get_vouch_claimed' | 'get_vouch_slashed' | 'get_vouch_absent' | 'get_profile',
  string
>;

/** A fixture exactly as a client sees it: the RPC `ScVal`, through `scValToNative`. */
const native = (name: keyof typeof fixtures): unknown =>
  scValToNative(xdr.ScVal.fromXDR(fixtures[name], 'hex'));

// The fixture's accounts and claim hashes (the contract test's inputs).
const VOUCHER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 0x11));
const CLAIMER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 0x22));
const sha256 = async (fill: number) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(32).fill(fill)));
const MINTED_AT = 1_758_633_600n;

/** The field names of a `#[contracttype]` struct, in declaration order, from lib.rs. */
function rustFields(struct: string): string[] {
  const lib = repo('contracts/reputation/src/lib.rs');
  const start = lib.indexOf(`pub struct ${struct} {`);
  expect(start, `pub struct ${struct}`).toBeGreaterThan(-1);
  const body = lib.slice(start, lib.indexOf('}', start));
  return [...body.matchAll(/pub\s+(\w+)\s*:/g)].map((m) => m[1]);
}

describe('read-view fixtures (issue #266)', () => {
  it('are the struct maps the contract returns, not positional vecs', () => {
    // A named-field #[contracttype] struct is an ScVal::Map keyed by field name.
    for (const name of ['get_vouch_claimed', 'get_profile'] as const) {
      expect(xdr.ScVal.fromXDR(fixtures[name], 'hex').switch().name).toBe('scvMap');
    }
    expect(xdr.ScVal.fromXDR(fixtures.get_vouch_absent, 'hex').switch().name).toBe('scvVoid');
  });

  it('name the fields lib.rs declares, the same as the mirrors', () => {
    expect([...VOUCH_FIELDS]).toEqual(rustFields('Vouch'));
    expect([...PROFILE_FIELDS]).toEqual(rustFields('Profile'));
    expect(Object.keys(native('get_vouch_claimed') as object).sort()).toEqual(
      [...VOUCH_FIELDS].sort(),
    );
    expect(Object.keys(native('get_profile') as object).sort()).toEqual([...PROFILE_FIELDS].sort());
  });
});

describe('decodeVouch', () => {
  it('decodes a claimed half-card field for field, every u64 a bigint', async () => {
    expect(decodeVouch(native('get_vouch_claimed'))).toEqual({
      id: 1n,
      from: VOUCHER,
      claim_hash: await sha256(7),
      note: 'solid work on the quest',
      claimed: true,
      claimer: CLAIMER,
      created: MINTED_AT,
      stake: 5n,
      slashed: false,
    } satisfies Vouch);
  });

  it('decodes an unclaimed, slashed half-card: None claimer as null, empty note', async () => {
    expect(decodeVouch(native('get_vouch_slashed'))).toEqual({
      id: 2n,
      from: VOUCHER,
      claim_hash: await sha256(9),
      note: '',
      claimed: false,
      claimer: null,
      created: MINTED_AT,
      stake: 5n,
      slashed: true,
    } satisfies Vouch);
  });

  it('reads None (an id never minted) as null', () => {
    expect(decodeVouch(native('get_vouch_absent'))).toBeNull();
  });

  it('hands the claim hash back as a plain 32-byte Uint8Array', () => {
    const v = decodeVouch(native('get_vouch_claimed'))!;
    expect(Object.getPrototypeOf(v.claim_hash)).toBe(Uint8Array.prototype);
    expect(v.claim_hash).toHaveLength(32);
  });

  it('refuses a struct that gained, lost or renamed a field', () => {
    const v = native('get_vouch_claimed') as Record<string, unknown>;
    expect(() => decodeVouch({ ...v, expires: 1n })).toThrow(/unknown: expires/);
    const { stake: _stake, ...lost } = v;
    expect(() => decodeVouch(lost)).toThrow(/missing: stake/);
    const { claimer, ...rest } = v;
    expect(() => decodeVouch({ ...rest, claimed_by: claimer })).toThrow(
      /missing: claimer; unknown: claimed_by/,
    );
  });

  it('refuses a field of the wrong type instead of passing it through', () => {
    const v = native('get_vouch_claimed') as Record<string, unknown>;
    expect(() => decodeVouch({ ...v, stake: 5 })).toThrow(/Vouch.stake: expected a u64/);
    expect(() => decodeVouch({ ...v, claim_hash: new Uint8Array(31) })).toThrow(/32 bytes/);
    expect(() => decodeVouch({ ...v, claimed: 1 })).toThrow(/Vouch.claimed: expected a bool/);
  });

  it('refuses what is not a struct at all', () => {
    expect(() => decodeVouch(undefined)).toThrow(/expected a contract struct/);
    expect(() => decodeVouch([1n, VOUCHER])).toThrow(/got an array/);
  });
});

describe('decodeProfile', () => {
  it('decodes the aggregate view field for field', () => {
    expect(decodeProfile(native('get_profile'))).toEqual({
      social: 30n,
      earned: 50n,
      verified: true,
    } satisfies Profile);
  });

  it('has no subject or attestations: the address is the call argument', () => {
    expect(Object.keys(decodeProfile(native('get_profile')))).toEqual([...PROFILE_FIELDS]);
  });

  it('refuses a drifted struct', () => {
    const p = native('get_profile') as Record<string, unknown>;
    expect(() => decodeProfile({ ...p, handle: 'x' })).toThrow(/unknown: handle/);
    expect(() => decodeProfile(null)).toThrow(/got null/);
  });
});
