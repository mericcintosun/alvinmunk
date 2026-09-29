import { describe, it, expect, vi, beforeEach } from 'vitest';

const readPublicMock = vi.fn();
const gateIdMock = vi.fn(() => 'CGATEID');
const invokeAndWaitMock = vi.fn();

vi.mock('./contracts', () => ({
  gateId: () => gateIdMock(),
  readPublic: (...a: unknown[]) => readPublicMock(...a),
  invokeAndWait: (...a: unknown[]) => invokeAndWaitMock(...a),
  args: {
    addr: (g: string) => ({ __addr: g }),
    u32: (n: number) => ({ __u32: n }),
  },
}));

// checkGate reads through the app's @alvinmunk/sdk client (its own tests pin the view and
// arguments against a mocked RPC); here it is a stub.
const sdkMock = vi.hoisted(() => ({ checkGate: vi.fn() }));
vi.mock('./sdk', () => ({ readClient: () => sdkMock }));

import { TRACK, getGates, getGateStatus, checkGate, isUnlocked, unlockGate } from './gate';
import type { Wallet } from './wallet';

describe('gate TRACK constants', () => {
  it('defines SOCIAL as 0 and EARNED as 1', () => {
    expect(TRACK.SOCIAL).toBe(0);
    expect(TRACK.EARNED).toBe(1);
  });
});

describe('getGates', () => {
  beforeEach(() => {
    readPublicMock.mockReset();
    gateIdMock.mockReturnValue('CGATEID');
  });

  it('fetches and maps raw gates to typed Gate objects', async () => {
    readPublicMock.mockResolvedValueOnce([
      { id: 1, track: 0, min: 10n, label: 'Noobs', active: true },
      { id: 2, track: 1, min: 50n, label: 'Pros', active: false },
    ]);
    const gates = await getGates();
    
    expect(gates).toEqual([
      { id: 1, track: 0, min: 10, label: 'Noobs', active: true },
      { id: 2, track: 1, min: 50, label: 'Pros', active: false },
    ]);
    expect(readPublicMock).toHaveBeenCalledWith('CGATEID', 'get_gates', []);
  });

  it('handles null/undefined gracefully (fallback to empty array)', async () => {
    readPublicMock.mockResolvedValueOnce(undefined);
    const gates = await getGates();
    expect(gates).toEqual([]);
  });

  it('returns empty array if readPublic fails', async () => {
    readPublicMock.mockRejectedValueOnce(new Error('fail'));
    const gates = await getGates();
    expect(gates).toEqual([]);
  });

  it('returns empty array if gateId is missing', async () => {
    gateIdMock.mockReturnValueOnce('');
    const gates = await getGates();
    expect(gates).toEqual([]);
    expect(readPublicMock).not.toHaveBeenCalled();
  });
});

describe('checkGate', () => {
  beforeEach(() => {
    readPublicMock.mockReset();
    sdkMock.checkGate.mockReset();
    gateIdMock.mockReturnValue('CGATEID');
  });

  it('returns true if address passes gate', async () => {
    sdkMock.checkGate.mockResolvedValueOnce(true);
    const result = await checkGate('GADDR', 1);

    expect(result).toBe(true);
    expect(sdkMock.checkGate).toHaveBeenCalledWith('GADDR', 1);
    expect(readPublicMock).not.toHaveBeenCalled();
  });

  it('returns false if address fails gate', async () => {
    sdkMock.checkGate.mockResolvedValueOnce(false);
    const result = await checkGate('GADDR', 1);
    expect(result).toBe(false);
    expect(sdkMock.checkGate).toHaveBeenCalledTimes(1);
  });

  it('returns false if the read fails', async () => {
    sdkMock.checkGate.mockRejectedValueOnce(new Error('fail'));
    const result = await checkGate('GADDR', 1);
    expect(result).toBe(false);
    expect(sdkMock.checkGate).toHaveBeenCalledTimes(1);
  });

  it('returns false if gateId is missing', async () => {
    gateIdMock.mockReturnValueOnce('');
    const result = await checkGate('GADDR', 1);
    expect(result).toBe(false);
    expect(sdkMock.checkGate).not.toHaveBeenCalled();
  });
});

describe('isUnlocked', () => {
  beforeEach(() => {
    readPublicMock.mockReset();
    gateIdMock.mockReturnValue('CGATEID');
  });

  it('returns true if gate is unlocked', async () => {
    readPublicMock.mockResolvedValueOnce(true);
    const result = await isUnlocked('GADDR', 2);
    expect(result).toBe(true);
    expect(readPublicMock).toHaveBeenCalledWith('CGATEID', 'is_unlocked', [
      { __addr: 'GADDR' },
      { __u32: 2 },
    ]);
  });

  it('returns false if gate is locked', async () => {
    readPublicMock.mockResolvedValueOnce(false);
    const result = await isUnlocked('GADDR', 2);
    expect(result).toBe(false);
  });

  it('returns false on error', async () => {
    readPublicMock.mockRejectedValueOnce(new Error('fail'));
    const result = await isUnlocked('GADDR', 2);
    expect(result).toBe(false);
  });
});

describe('getGateStatus', () => {
  beforeEach(() => {
    readPublicMock.mockReset();
    gateIdMock.mockReturnValue('CGATEID');
  });

  it('reads every gate with passes/unlocked in one get_status call', async () => {
    readPublicMock.mockResolvedValueOnce([
      { gate: { id: 1, track: 0, min: 10n, label: 'Noobs', active: true }, passes: true, unlocked: true },
      { gate: { id: 2, track: 1, min: 50n, label: 'Pros', active: false }, passes: false, unlocked: false },
    ]);
    await expect(getGateStatus('GADDR')).resolves.toEqual([
      { gate: { id: 1, track: 0, min: 10, label: 'Noobs', active: true }, passes: true, unlocked: true },
      { gate: { id: 2, track: 1, min: 50, label: 'Pros', active: false }, passes: false, unlocked: false },
    ]);
    expect(readPublicMock).toHaveBeenCalledTimes(1);
    expect(readPublicMock).toHaveBeenCalledWith('CGATEID', 'get_status', [{ __addr: 'GADDR' }]);
  });

  it('returns no gates without a gate contract, and makes no call', async () => {
    gateIdMock.mockReturnValueOnce('');
    await expect(getGateStatus('GADDR')).resolves.toEqual([]);
    expect(readPublicMock).not.toHaveBeenCalled();
  });

  it('reads an RPC failure or an empty result as no gates', async () => {
    readPublicMock.mockRejectedValueOnce(new Error('fail'));
    await expect(getGateStatus('GADDR')).resolves.toEqual([]);
    readPublicMock.mockResolvedValueOnce(undefined);
    await expect(getGateStatus('GADDR')).resolves.toEqual([]);
  });
});

describe('unlockGate', () => {
  beforeEach(() => {
    invokeAndWaitMock.mockReset();
    gateIdMock.mockReturnValue('CGATEID');
  });

  it('invokes unlock on the contract', async () => {
    const mockWallet = { address: 'WADDR' } as Wallet;
    await unlockGate(mockWallet, 3);
    
    expect(invokeAndWaitMock).toHaveBeenCalledWith(
      'CGATEID',
      'unlock',
      [{ __addr: 'WADDR' }, { __u32: 3 }],
      mockWallet
    );
  });
});
