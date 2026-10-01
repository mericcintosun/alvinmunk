// @vitest-environment node
/**
 * The app reads vouches and profiles through `@alvinmunk/sdk` (lib/sdk.ts). Its views must
 * stay the shared contract mirrors (`@alvinmunk/shared` Vouch / Profile) with every u64
 * narrowed to a number — issue #266 was two view types drifting from the contract unseen.
 * The shared mirrors are pinned to the contract by packages/shared/src/read-views.test.ts.
 */
import { readFileSync } from 'node:fs';
import { scValToNative, xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import * as sdk from '@alvinmunk/sdk';
import * as shared from '@alvinmunk/shared';

type AsNumbers<T> = { [K in keyof T]: bigint extends T[K] ? number : T[K] };
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// Compile-time (tsconfig.test.json): a field added, dropped or retyped on one side only.
const views: [
  Same<sdk.VouchView, Omit<AsNumbers<shared.Vouch>, 'claim_hash'>>,
  Same<sdk.ProfileView, AsNumbers<shared.Profile>>,
] = [true, true];

const fixtures = JSON.parse(
  readFileSync(
    new URL('../../../../contracts/reputation/testdata/read_views.json', import.meta.url),
    'utf8',
  ),
) as Record<string, string>;
const native = (name: string): unknown => scValToNative(xdr.ScVal.fromXDR(fixtures[name], 'hex'));

describe('the SDK views are the shared contract mirrors (issue #266)', () => {
  it('have the same fields and types, u64s as numbers', () => {
    expect(views).toEqual([true, true]);
  });

  it.each(['get_vouch_claimed', 'get_vouch_slashed', 'get_vouch_absent'])(
    'decode the contract’s %s like the shared mirror',
    (name) => {
      const mirror = shared.decodeVouch(native(name));
      const narrowed = mirror && {
        id: Number(mirror.id),
        from: mirror.from,
        note: mirror.note,
        claimed: mirror.claimed,
        claimer: mirror.claimer,
        created: Number(mirror.created),
        stake: Number(mirror.stake),
        slashed: mirror.slashed,
      };
      expect(sdk.decodeVouch(native(name))).toEqual(narrowed);
    },
  );

  it('decode the contract’s get_profile like the shared mirror', () => {
    const p = shared.decodeProfile(native('get_profile'));
    expect(sdk.decodeProfile(native('get_profile'))).toEqual({
      social: Number(p.social),
      earned: Number(p.earned),
      verified: p.verified,
    });
  });
});
