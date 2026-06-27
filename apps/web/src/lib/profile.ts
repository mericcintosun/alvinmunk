/**
 * Local profile persistence (Sprint 1). Handle + address + art seed survive reloads.
 * On-chain handle binding happens via the Genesis tx (recordGenesis); this is the
 * client-side cache so returning users skip onboarding.
 */
import type { AvatarConfig } from './avatar';

export interface Profile {
  handle: string;
  address: string;
  createdAt: number;
  genesisTx?: string;
  /** Chosen profile face. Absent → a deterministic default is derived from address. */
  avatar?: AvatarConfig;
}

const KEY = 'alvinmunk.profile';

export function loadProfile(): Profile | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Profile;
  } catch {
    return null;
  }
}

export function saveProfile(p: Profile): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify(p));
}

export function clearProfile(): void {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY);
}

/** Normalize a user-typed handle: lowercase, alnum + underscore, <= 20 chars. */
export function normalizeHandle(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 20);
}
