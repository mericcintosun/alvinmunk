import { describe, it, expect, vi, beforeEach } from 'vitest';

const readPublicMock = vi.fn();
const invokeMock = vi.fn();
let registry = 'CREGISTRY';

vi.mock('./contracts', () => ({
  readPublic: (...a: unknown[]) => readPublicMock(...a),
  invokeAndWait: (...a: unknown[]) => invokeMock(...a),
  registryId: () => registry,
  args: {
    addr: (a: string) => ({ __addr: a }),
    sym: (s: string) => ({ __sym: s }),
    u64: (n: bigint) => ({ __u64: n }),
    str: (s: string) => ({ __str: s }),
  },
}));

import { getMeta, setMeta, clearMetaCache, isMetaUnsupported } from './registry';
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
