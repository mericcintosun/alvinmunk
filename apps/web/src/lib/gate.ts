/**
 * Gate client — reputation as a capability. Lists access gates, checks/records unlocks.
 * The composable bit: `check(addr, id)` is a pure on-chain read any app can call.
 */
import { invokeAndWait, invokeAndWaitHash, readPublic, args, gateId } from './contracts';
import { readClient } from './sdk';
import type { Wallet } from './wallet';

export const TRACK = { SOCIAL: 0, EARNED: 1 } as const;

export interface Gate {
  id: number;
  track: number; // 0 = Social, 1 = Earned
  min: number;
  label: string;
  active: boolean;
}

/** One gate as a wallet sees it, from `get_status`: `passes` = `check`, `unlocked` =
 *  `is_unlocked` (a current-version unlock of an active gate), both from one ledger. */
export interface GateStatus {
  gate: Gate;
  passes: boolean;
  unlocked: boolean;
}

type RawGate = { id: number; track: number; min: bigint; label: string; active: boolean };

const toGate = (g: RawGate): Gate => ({
  id: Number(g.id),
  track: Number(g.track),
  min: Number(g.min),
  label: String(g.label),
  active: Boolean(g.active),
});

export async function getGates(): Promise<Gate[]> {
  if (!gateId()) return [];
  return readGates().catch(() => []);
}

/** Every gate, active or not. Throws on RPC failure (the admin table must not read an
 *  outage as "no gates"); `getGates` is the forgiving variant for player views. */
export async function readGates(): Promise<Gate[]> {
  const raw = await readPublic<RawGate[]>(gateId(), 'get_gates', []);
  return (raw ?? []).map(toGate);
}

/**
 * Every gate with `address`'s pass / unlock state in ONE simulation (`get_status`), which
 * reads reputation at most once per track. Forgiving like `getGates`: no gate contract or
 * an RPC failure reads as no gates, so the perks panel hides instead of breaking.
 */
export async function getGateStatus(address: string): Promise<GateStatus[]> {
  if (!gateId()) return [];
  const raw = await readPublic<Array<{ gate: RawGate; passes: boolean; unlocked: boolean }>>(
    gateId(),
    'get_status',
    [args.addr(address)],
  ).catch(() => []);
  return (raw ?? []).map((s) => ({
    gate: toGate(s.gate),
    passes: Boolean(s.passes),
    unlocked: Boolean(s.unlocked),
  }));
}

/** Composable read — does `address` pass gate `id`? (cross-reads reputation on-chain). */
export async function checkGate(address: string, id: number): Promise<boolean> {
  if (!gateId()) return false;
  return readClient()
    .checkGate(address, id)
    .catch(() => false);
}

export async function isUnlocked(address: string, id: number): Promise<boolean> {
  if (!gateId()) return false;
  return (
    (await readPublic<boolean>(gateId(), 'is_unlocked', [args.addr(address), args.u32(id)]).catch(
      () => false,
    )) ?? false
  );
}

export async function unlockGate(wallet: Wallet, id: number): Promise<void> {
  await invokeAndWait(gateId(), 'unlock', [args.addr(wallet.address), args.u32(id)], wallet);
}

// --- Admin content management. Every write is `admin.require_auth()`-gated on-chain. ---

/** Define or replace gate `id` (always saved ACTIVE). Resolves the confirmed tx hash. */
export async function createGate(
  wallet: Wallet,
  id: number,
  track: number,
  min: bigint,
  label: string,
): Promise<string> {
  return invokeAndWaitHash(
    gateId(),
    'create_gate',
    [args.u32(id), args.u32(track), args.u64(min), args.str(label)],
    wallet,
  );
}

export async function setGateActive(wallet: Wallet, id: number, active: boolean): Promise<string> {
  return invokeAndWaitHash(gateId(), 'set_gate_active', [args.u32(id), args.bool(active)], wallet);
}
