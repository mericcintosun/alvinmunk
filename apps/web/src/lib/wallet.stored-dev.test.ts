// @vitest-environment node
import { Address, Keypair, Networks, authorizeEntry, xdr } from '@stellar/stellar-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { config, assertNetworkConfig } = vi.hoisted(() => ({
  config: { network: 'testnet' },
  assertNetworkConfig: vi.fn(),
}));
vi.mock('./stellar', () => ({
  assertNetworkConfig,
  config,
  networkPassphrase: Networks.TESTNET,
  server: {},
  waitForAccountReady: vi.fn(),
}));

import { storedDevWallet } from './wallet';

const DEV_SECRET_KEY = 'alvinmunk.devSecret';
const CONTRACT = 'CBEJVYLWTU6BQDL3RXKWW6CYUISRC4SUIVURCG452CTOIANGY2N7V3WI';

function unsignedEntry(who: string): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(who).toScAddress(),
        nonce: xdr.Int64.fromString('7'),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: new Address(CONTRACT).toScAddress(),
          functionName: 'transfer_handle',
          args: [],
        }),
      ),
      subInvocations: [],
    }),
  });
}

describe('storedDevWallet', () => {
  let store: Map<string, string>;
  const fetchSpy = vi.fn();

  beforeEach(() => {
    config.network = 'testnet';
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchSpy.mockReset();
  });

  it('is null when this browser has no in-app key, and never creates or funds one', () => {
    expect(storedDevWallet()).toBeNull();
    expect(store.size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is null on mainnet, where the dev wallet is disabled', () => {
    store.set(DEV_SECRET_KEY, Keypair.random().secret());
    config.network = 'mainnet';
    expect(storedDevWallet()).toBeNull();
  });

  it('refuses, like every wallet handout, on an inconsistent network config', () => {
    store.set(DEV_SECRET_KEY, Keypair.random().secret());
    assertNetworkConfig.mockImplementationOnce(() => {
      throw new Error('This deployment is misconfigured');
    });
    expect(() => storedDevWallet()).toThrow('misconfigured');
  });

  it('is null for a stored secret that is not a key', () => {
    store.set(DEV_SECRET_KEY, 'not-a-secret');
    expect(storedDevWallet()).toBeNull();
  });

  it('co-signs its own auth entry with the stored key', async () => {
    const kp = Keypair.random();
    store.set(DEV_SECRET_KEY, kp.secret());
    const wallet = storedDevWallet();
    expect(wallet?.kind).toBe('dev');
    expect(wallet?.address).toBe(kp.publicKey());

    const signed = await wallet!.signAuthEntry!(unsignedEntry(kp.publicKey()), 1_120);
    const expected = await authorizeEntry(unsignedEntry(kp.publicKey()), kp, 1_120, Networks.TESTNET);
    expect(signed.toXDR('base64')).toBe(expected.toXDR('base64'));
    expect(signed.credentials().address().signatureExpirationLedger()).toBe(1_120);
  });
});
