import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const resolveHandleMock = vi.fn();
const setInviterMock = vi.fn();

vi.mock('./registry', () => ({
  resolveHandle: (...a: unknown[]) => resolveHandleMock(...a),
  setInviter: (...a: unknown[]) => setInviterMock(...a),
}));

import { bindInviter, readRefHandle, clearRefHandle, REF_STORAGE_KEY } from './invite';
import type { Wallet } from './wallet';

const G = 'G'.padEnd(56, 'A');
const C = 'C'.padEnd(56, 'A'); // passkey smart-wallet contract address
const inviter = 'G'.padEnd(56, 'B');
const wallet = { kind: 'dev', address: G } as unknown as Wallet;
const passkey = { kind: 'passkey', address: C } as unknown as Wallet;

describe('ref handle storage', () => {
  beforeEach(() => {
    sessionStorage.clear();
    resolveHandleMock.mockReset();
    setInviterMock.mockReset();
  });

  it('round-trips the stashed inviter handle', () => {
    sessionStorage.setItem(REF_STORAGE_KEY, 'alice');
    expect(readRefHandle()).toBe('alice');
    clearRefHandle();
    expect(readRefHandle()).toBeNull();
  });
});

describe('bindInviter', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    resolveHandleMock.mockReset();
    setInviterMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves the stashed handle and binds the inviter, then clears the ref', async () => {
    sessionStorage.setItem(REF_STORAGE_KEY, 'alice');
    resolveHandleMock.mockResolvedValueOnce(inviter);
    setInviterMock.mockResolvedValueOnce(undefined);

    await expect(bindInviter(wallet)).resolves.toBe(true);

    expect(resolveHandleMock).toHaveBeenCalledWith('alice');
    expect(setInviterMock).toHaveBeenCalledWith(wallet, inviter);
    expect(readRefHandle()).toBeNull();
  });

  it('works for a passkey smart wallet too (C… address, invoke path)', async () => {
    sessionStorage.setItem(REF_STORAGE_KEY, 'alice');
    resolveHandleMock.mockResolvedValueOnce(inviter);
    setInviterMock.mockResolvedValueOnce(undefined);

    await expect(bindInviter(passkey)).resolves.toBe(true);
    expect(setInviterMock).toHaveBeenCalledWith(passkey, inviter);
  });

  it('is a no-op (false) without a stashed ref, and never resolves or signs', async () => {
    await expect(bindInviter(wallet)).resolves.toBe(false);
    expect(resolveHandleMock).not.toHaveBeenCalled();
    expect(setInviterMock).not.toHaveBeenCalled();
  });

  it('skips binding when the ref names an unclaimed handle', async () => {
    sessionStorage.setItem(REF_STORAGE_KEY, 'ghost');
    resolveHandleMock.mockResolvedValueOnce(null);

    await expect(bindInviter(wallet)).resolves.toBe(false);
    expect(setInviterMock).not.toHaveBeenCalled();
    expect(readRefHandle()).toBeNull(); // handled: don't retry on every onboard
  });

  it('skips binding yourself (stale ref naming your own handle)', async () => {
    sessionStorage.setItem(REF_STORAGE_KEY, 'me');
    resolveHandleMock.mockResolvedValueOnce(G);

    await expect(bindInviter(wallet)).resolves.toBe(false);
    expect(setInviterMock).not.toHaveBeenCalled();
  });

  it('never throws: a failed binding is logged and swallowed, ref still cleared', async () => {
    sessionStorage.setItem(REF_STORAGE_KEY, 'alice');
    resolveHandleMock.mockResolvedValueOnce(inviter);
    setInviterMock.mockRejectedValueOnce(new Error('HostError: Error(Contract, #10)'));

    await expect(bindInviter(wallet)).resolves.toBe(false);
    expect(readRefHandle()).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  it('clears the ref even when the resolve itself fails', async () => {
    sessionStorage.setItem(REF_STORAGE_KEY, 'alice');
    resolveHandleMock.mockRejectedValueOnce(new Error('rpc down'));

    await expect(bindInviter(wallet)).resolves.toBe(false);
    expect(readRefHandle()).toBeNull();
  });
});
