import { describe, it, expect, vi, beforeEach } from 'vitest';

const readPublicMock = vi.fn();
const invokeMock = vi.fn();
const cosignedMock = vi.fn();
let registry = 'CREGISTRY';

vi.mock('./contracts', () => ({
  readPublic: (...a: unknown[]) => readPublicMock(...a),
  invokeAndWait: (...a: unknown[]) => invokeMock(...a),
  invokeCosigned: (...a: unknown[]) => cosignedMock(...a),
  registryId: () => registry,
  args: {
    addr: (a: string) => ({ __addr: a }),
    addrs: (a: string[]) => ({ __addrs: a }),
    sym: (s: string) => ({ __sym: s }),
    u64: (n: bigint) => ({ __u64: n }),
    str: (s: string) => ({ __str: s }),
  },
}));

// resolveHandle / reverseHandle read through the app's @alvinmunk/sdk client (its own tests
// pin the views and arguments against a mocked RPC); here it is a stub.
const sdkMock = vi.hoisted(() => ({ resolveHandle: vi.fn(), reverseHandle: vi.fn() }));
vi.mock('./sdk', () => ({ readClient: () => sdkMock }));

import {
  getMeta,
  setMeta,
  clearMetaCache,
  isMetaUnsupported,
  resolveHandle,
  reverseHandle,
  reverseHandles,
  getHandleCooldown,
  handleAvailability,
  isHandleAvailable,
  transferHandle,
} from './registry';
import type { Wallet } from './wallet';

const G = 'G'.padEnd(56, 'A');
const wallet = { kind: 'dev', address: G } as unknown as Wallet;

// What the RPC reports when the deployed registry predates get_meta / set_meta.
const MISSING_FN =
  'simulate get_meta failed: HostError: Error(WasmVm, MissingValue)\n\nEvent log (newest first):\n' +
  '   0: [Diagnostic Event] topics:[error, Error(WasmVm, MissingValue)], data:["trying to invoke non-existent contract function", get_meta]';

describe('getMeta', () => {
  beforeEach(() => {
    readPublicMock.mockReset();
    invokeMock.mockReset();
    clearMetaCache();
    registry = 'CREGISTRY';
  });

  it('reads get_meta and decodes the packed face', async () => {
    readPublicMock.mockResolvedValueOnce({ avatar: 0x0100_0307_0504_0902n, bio: 'hi there' });
    await expect(getMeta(G)).resolves.toEqual({
      avatar: { kind: 'kit', skin: 3, hair: 7, eyes: 5, mouth: 4, acc: 9, bg: 2 },
      bio: 'hi there',
    });
    expect(readPublicMock).toHaveBeenCalledWith('CREGISTRY', 'get_meta', [{ __addr: G }]);
  });

  it('is null when the address never published a profile', async () => {
    readPublicMock.mockResolvedValueOnce(null);
    await expect(getMeta(G)).resolves.toBeNull();
  });

  it('is null (default face, no bio) on a registry without get_meta', async () => {
    readPublicMock.mockRejectedValueOnce(new Error(MISSING_FN));
    await expect(getMeta(G)).resolves.toBeNull();
  });

  it('resolves null (never throws) for an address the SDK rejects', async () => {
    readPublicMock.mockResolvedValueOnce({ avatar: 1n, bio: '' });
    const addrSpy = vi.fn(() => {
      throw new Error('invalid address');
    });
    const { args } = await import('./contracts');
    const real = args.addr;
    (args as { addr: unknown }).addr = addrSpy;
    try {
      await expect(getMeta('not-an-address')).resolves.toBeNull();
    } finally {
      (args as { addr: unknown }).addr = real;
    }
  });

  it('is null without an address or a configured registry, and never calls the RPC', async () => {
    await expect(getMeta('')).resolves.toBeNull();
    registry = '';
    await expect(getMeta(G)).resolves.toBeNull();
    expect(readPublicMock).not.toHaveBeenCalled();
  });

  it('keeps the bio but drops a face this build cannot render', async () => {
    readPublicMock.mockResolvedValueOnce({
      avatar: 0x0200_0000_0000_0001n,
      bio: 'from the future',
    });
    await expect(getMeta(G)).resolves.toEqual({ avatar: undefined, bio: 'from the future' });
  });

  it('sanitizes the bio it hands to renderers', async () => {
    readPublicMock.mockResolvedValueOnce({ avatar: 3n, bio: 'two\nlines ‮spoof' });
    await expect(getMeta(G)).resolves.toEqual({
      avatar: { kind: 'face', id: 'face-03' },
      bio: 'two lines spoof',
    });
  });

  it('shares one simulation between concurrent and repeated reads', async () => {
    readPublicMock.mockResolvedValue({ avatar: 1n, bio: '' });
    const [a, b] = await Promise.all([getMeta(G), getMeta(G)]);
    await getMeta(G);
    expect(a).toEqual(b);
    expect(readPublicMock).toHaveBeenCalledTimes(1);
  });

  it('caches a failed read too, so a broken RPC is not hammered per render', async () => {
    readPublicMock.mockRejectedValue(new Error('rpc down'));
    await getMeta(G);
    await getMeta(G);
    expect(readPublicMock).toHaveBeenCalledTimes(1);
  });
});

describe('setMeta', () => {
  beforeEach(() => {
    readPublicMock.mockReset();
    invokeMock.mockReset();
    clearMetaCache();
  });

  it('sends the packed face and the sanitized bio, then serves them from the cache', async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await setMeta(wallet, { kind: 'face', id: 'face-02' }, '  hello\nworld  ');
    expect(invokeMock).toHaveBeenCalledWith(
      'CREGISTRY',
      'set_meta',
      [{ __addr: G }, { __u64: 2n }, { __str: 'hello world' }],
      wallet,
    );
    await expect(getMeta(G)).resolves.toEqual({
      avatar: { kind: 'face', id: 'face-02' },
      bio: 'hello world',
    });
    expect(readPublicMock).not.toHaveBeenCalled();
  });

  it('throws before signing for a face the app does not ship', async () => {
    await expect(setMeta(wallet, { kind: 'face', id: 'face-99' as never }, '')).rejects.toThrow();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('leaves the cache alone when the tx fails', async () => {
    invokeMock.mockRejectedValueOnce(new Error('HostError: Error(Contract, #4)'));
    await expect(setMeta(wallet, { kind: 'face', id: 'face-02' }, '')).rejects.toThrow();
    readPublicMock.mockResolvedValueOnce(null);
    await expect(getMeta(G)).resolves.toBeNull();
  });
});

describe('isMetaUnsupported', () => {
  it('spots a registry that predates set_meta / get_meta', () => {
    expect(isMetaUnsupported(new Error(MISSING_FN))).toBe(true);
  });

  it('does not mistake contract reverts or network errors for it', () => {
    expect(isMetaUnsupported(new Error('HostError: Error(Contract, #4)'))).toBe(false);
    expect(isMetaUnsupported(new Error('Error(Storage, MissingValue)'))).toBe(false);
    expect(isMetaUnsupported(new Error('fetch failed'))).toBe(false);
  });
});

describe('reverseHandle', () => {
  beforeEach(() => {
    readPublicMock.mockReset();
    sdkMock.reverseHandle.mockReset();
    registry = 'CREGISTRY';
  });

  it("reads the address's handle, null when it holds none", async () => {
    sdkMock.reverseHandle.mockResolvedValueOnce('alvin').mockResolvedValueOnce(null);
    await expect(reverseHandle(G)).resolves.toBe('alvin');
    await expect(reverseHandle(G, { strict: true })).resolves.toBeNull();
    expect(sdkMock.reverseHandle.mock.calls).toEqual([[G], [G]]);
  });

  it('answers null for a failed read — unless strict, which throws it', async () => {
    const down = new Error('fetch failed');
    sdkMock.reverseHandle.mockRejectedValue(down);
    await expect(reverseHandle(G)).resolves.toBeNull();
    await expect(reverseHandle(G, { strict: true })).rejects.toBe(down);
  });

  it('is null without a configured registry, strict or not, and never calls the RPC', async () => {
    registry = '';
    await expect(reverseHandle(G, { strict: true })).resolves.toBeNull();
    expect(sdkMock.reverseHandle).not.toHaveBeenCalled();
    expect(readPublicMock).not.toHaveBeenCalled();
  });
});

describe('resolveHandle', () => {
  beforeEach(() => {
    sdkMock.resolveHandle.mockReset();
    registry = 'CREGISTRY';
  });

  it("reads the handle's holder, null when unclaimed or unreadable", async () => {
    sdkMock.resolveHandle
      .mockResolvedValueOnce(G)
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('fetch failed'));
    await expect(resolveHandle('alvin')).resolves.toBe(G);
    await expect(resolveHandle('nobody')).resolves.toBeNull();
    await expect(resolveHandle('alvin')).resolves.toBeNull();
    expect(sdkMock.resolveHandle.mock.calls).toEqual([['alvin'], ['nobody'], ['alvin']]);
  });

  it('is null for an empty handle or without a configured registry, and never calls the RPC', async () => {
    await expect(resolveHandle('')).resolves.toBeNull();
    registry = '';
    await expect(resolveHandle('alvin')).resolves.toBeNull();
    expect(sdkMock.resolveHandle).not.toHaveBeenCalled();
  });
});

describe('reverseHandles', () => {
  // `h:<addr>` for addresses ending in an even digit, none for the rest.
  const handleOf = (a: string) => (Number(a.slice(-1)) % 2 === 0 ? `h:${a}` : null);
  const addrs = (n: number) => Array.from({ length: n }, (_, i) => `G${String(i).padStart(3, '0')}`);
  const batched = () =>
    readPublicMock.mockImplementation(async (_id: string, method: string, [arg]: [{ __addrs: string[] }]) => {
      if (method !== 'reverse_many') throw new Error(`unexpected ${method}`);
      return arg.__addrs.map(handleOf);
    });
  const calls = (method: string) => readPublicMock.mock.calls.filter((c) => c[1] === method);
  const MISSING_REVERSE_MANY = MISSING_FN.replaceAll('get_meta', 'reverse_many');

  beforeEach(() => {
    readPublicMock.mockReset();
    sdkMock.reverseHandle.mockReset();
    registry = 'CREGISTRY';
  });

  it('labels N addresses in ceil(N / 50) reverse_many reads, each in input order', async () => {
    batched();
    const input = addrs(120);
    const out = await reverseHandles(input);
    expect(calls('reverse_many').map((c) => c[2][0].__addrs.length)).toEqual([50, 50, 20]);
    expect(readPublicMock).toHaveBeenCalledTimes(3);
    expect(out).toEqual(Object.fromEntries(input.map((a) => [a, handleOf(a)])));
  });

  it('asks once per distinct address', async () => {
    batched();
    const out = await reverseHandles(['G002', 'G001', 'G002', '']);
    expect(calls('reverse_many').map((c) => c[2][0].__addrs)).toEqual([['G001', 'G002']]);
    expect(out).toEqual({ G001: null, G002: 'h:G002', '': null });
  });

  it('shares one read between callers asking for the same rows at once', async () => {
    batched();
    const [a, b] = await Promise.all([reverseHandles(addrs(3)), reverseHandles(addrs(3).reverse())]);
    expect(a).toEqual(b);
    expect(readPublicMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to one reverse per address on a registry without reverse_many', async () => {
    readPublicMock.mockImplementation(async (_id: string, method: string) => {
      if (method === 'reverse_many') throw new Error(MISSING_REVERSE_MANY);
      throw new Error(`unexpected ${method}`);
    });
    sdkMock.reverseHandle.mockImplementation(async (a: string) => handleOf(a));
    const input = addrs(60);
    const out = await reverseHandles(input);
    expect(calls('reverse_many')).toHaveLength(2);
    expect(sdkMock.reverseHandle).toHaveBeenCalledTimes(60);
    expect(out).toEqual(Object.fromEntries(input.map((a) => [a, handleOf(a)])));
  });

  it('leaves a chunk unlabelled when the read fails for another reason, without fanning out', async () => {
    readPublicMock.mockRejectedValue(new Error('fetch failed'));
    await expect(reverseHandles(addrs(3))).resolves.toEqual({ G000: null, G001: null, G002: null });
    expect(sdkMock.reverseHandle).not.toHaveBeenCalled();
  });

  it('treats a reply that does not line up with the request as unreadable', async () => {
    readPublicMock.mockResolvedValue(['h:G000']);
    await expect(reverseHandles(addrs(2))).resolves.toEqual({ G000: null, G001: null });
  });

  it('answers every address, null, without a configured registry', async () => {
    // callers merge the answer into their label map; a missing key would make them ask again
    registry = '';
    await expect(reverseHandles(['G001', 'G002'])).resolves.toEqual({ G001: null, G002: null });
    await expect(reverseHandles([])).resolves.toEqual({});
    expect(readPublicMock).not.toHaveBeenCalled();
  });
});

describe('transferHandle', () => {
  const OLD = 'G'.padEnd(56, 'O');
  const NEW = 'C'.padEnd(56, 'N');
  // the in-app key co-signs; the other wallet submits with its own prompt
  const dev = { kind: 'dev', address: OLD, signAuthEntry: vi.fn() } as unknown as Wallet;
  const passkey = { kind: 'passkey', address: NEW, invoke: vi.fn() } as unknown as Wallet;

  beforeEach(() => {
    readPublicMock.mockReset();
    cosignedMock.mockReset();
    cosignedMock.mockResolvedValue({ hash: 'tx-hash', value: undefined });
    clearMetaCache();
    registry = 'CREGISTRY';
  });

  it('calls transfer_handle(from, to): `to` submits and the in-app `from` co-signs', async () => {
    await expect(transferHandle(dev, passkey)).resolves.toBe('tx-hash');
    expect(cosignedMock).toHaveBeenCalledWith(
      'CREGISTRY',
      'transfer_handle',
      [{ __addr: OLD }, { __addr: NEW }],
      passkey,
      dev,
    );
  });

  it('lets an in-app `to` co-sign when `from` is the wallet that can only submit', async () => {
    const classic = { kind: 'freighter', address: NEW } as unknown as Wallet;
    const inApp = { kind: 'dev', address: OLD, signAuthEntry: vi.fn() } as unknown as Wallet;
    await transferHandle(classic, inApp);
    expect(cosignedMock).toHaveBeenCalledWith(
      'CREGISTRY',
      'transfer_handle',
      [{ __addr: NEW }, { __addr: OLD }],
      classic,
      inApp,
    );
  });

  it('re-reads both profiles afterwards: the face and bio moved with the handle', async () => {
    readPublicMock.mockResolvedValue({ avatar: 3n, bio: 'still me' });
    await getMeta(OLD);
    await getMeta(NEW);
    expect(readPublicMock).toHaveBeenCalledTimes(2);
    await transferHandle(dev, passkey);
    await getMeta(OLD);
    await getMeta(NEW);
    expect(readPublicMock).toHaveBeenCalledTimes(4);
  });

  it('keeps the cached profiles when the transfer fails', async () => {
    readPublicMock.mockResolvedValue(null);
    await getMeta(OLD);
    cosignedMock.mockRejectedValueOnce(new Error('Error(Contract, #10)'));
    await expect(transferHandle(dev, passkey)).rejects.toThrow('#10');
    await getMeta(OLD);
    expect(readPublicMock).toHaveBeenCalledTimes(1);
  });
});

describe('handle cooldown', () => {
  const PREV = 'G'.padEnd(56, 'P');
  const UNTIL = 1_790_000_000n; // ledger timestamp, seconds
  const COOLING = { prev_owner: PREV, until: UNTIL };

  beforeEach(() => {
    readPublicMock.mockReset();
    sdkMock.resolveHandle.mockReset();
    registry = 'CREGISTRY';
  });

  /** Answer the `resolve` (through the SDK) and `cooldown` reads for one handle. */
  function chain(owner: string | null, cooldown: unknown) {
    sdkMock.resolveHandle.mockResolvedValue(owner);
    readPublicMock.mockImplementation(async (_id: string, method: string) => {
      if (method === 'cooldown') return cooldown;
      throw new Error(`unexpected ${method}`);
    });
  }

  it('reads the cooldown view and turns `until` into a date', async () => {
    chain(null, COOLING);
    await expect(getHandleCooldown('alice')).resolves.toEqual({
      prevOwner: PREV,
      until: new Date(1_790_000_000_000),
    });
    expect(readPublicMock).toHaveBeenCalledWith('CREGISTRY', 'cooldown', [{ __sym: 'alice' }]);
  });

  it('is null with no cooldown, on a registry that predates cooldowns, or unconfigured', async () => {
    chain(null, null);
    await expect(getHandleCooldown('alice')).resolves.toBeNull();
    readPublicMock.mockRejectedValueOnce(new Error(MISSING_FN.replace(/get_meta/g, 'cooldown')));
    await expect(getHandleCooldown('alice')).resolves.toBeNull();
    readPublicMock.mockResolvedValueOnce({ prev_owner: PREV }); // malformed: no until
    await expect(getHandleCooldown('alice')).resolves.toBeNull();
    readPublicMock.mockReset();
    registry = '';
    await expect(getHandleCooldown('alice')).resolves.toBeNull();
    expect(readPublicMock).not.toHaveBeenCalled();
  });

  it('reports a cooling handle as reserved until its cooldown ends', async () => {
    chain(null, COOLING);
    await expect(handleAvailability('alice')).resolves.toEqual({
      status: 'reserved',
      until: new Date(1_790_000_000_000),
    });
    await expect(handleAvailability('alice', G)).resolves.toEqual({
      status: 'reserved',
      until: new Date(1_790_000_000_000),
    });
    await expect(isHandleAvailable('alice', G)).resolves.toBe(false);
  });

  it('lets the previous owner take its handle back during the cooldown', async () => {
    chain(null, COOLING);
    await expect(handleAvailability('alice', PREV)).resolves.toEqual({ status: 'free' });
    await expect(isHandleAvailable('alice', PREV)).resolves.toBe(true);
  });

  it('is owner-aware: a handle owned by the checking address is free for them to reclaim', async () => {
    const OWNER = 'G'.padEnd(56, 'O');
    const OTHER = 'G'.padEnd(56, 'X');
    chain(OWNER, null);
    // Owner can reclaim their own handle
    await expect(handleAvailability('alice', OWNER)).resolves.toEqual({ status: 'free' });
    await expect(isHandleAvailable('alice', OWNER)).resolves.toBe(true);
    // But it's taken for anyone else
    await expect(handleAvailability('alice', OTHER)).resolves.toEqual({ status: 'taken' });
    await expect(isHandleAvailable('alice', OTHER)).resolves.toBe(false);
    // And taken when no address is specified
    await expect(handleAvailability('alice')).resolves.toEqual({ status: 'taken' });
    await expect(isHandleAvailable('alice')).resolves.toBe(false);
  });

  it('is free when neither held nor cooling', async () => {
    chain(null, null);
    await expect(handleAvailability('alice')).resolves.toEqual({ status: 'free' });
    await expect(isHandleAvailable('alice')).resolves.toBe(true);
  });
});
