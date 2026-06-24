/**
 * My minted vouches — kept locally (the claim-secret only ever exists client-side) so
 * the dashboard can resurface UNCLAIMED half-cards: the re-engagement hook (your stake
 * gets slashed if nobody claims within the window — re-share the link).
 */
import { buildClaimUrl } from '@passport/shared';
import { getVouch, VOUCH_TTL_SECS } from './reputation';

export interface MyVouch {
  id: number;
  secret: string;
  note: string;
  created: number; // unix seconds
}

const KEY = 'passport.myVouches';

export function getMyVouches(): MyVouch[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as MyVouch[];
  } catch {
    return [];
  }
}

export function addMyVouch(v: MyVouch): void {
  if (typeof localStorage === 'undefined') return;
  const list = [v, ...getMyVouches().filter((x) => x.id !== v.id)].slice(0, 60);
  localStorage.setItem(KEY, JSON.stringify(list));
}

export interface PendingVouch extends MyVouch {
  claimUrl: string;
  daysLeft: number;
}

/** Minted vouches still awaiting a claim (not claimed, not slashed, in-window). */
export async function getPendingVouches(origin: string): Promise<PendingVouch[]> {
  const mine = getMyVouches();
  const now = Math.floor(Date.now() / 1000);
  const out: PendingVouch[] = [];
  await Promise.all(
    mine.map(async (m) => {
      const v = await getVouch(m.id).catch(() => null);
      if (!v || v.claimed || v.slashed) return;
      const deadline = v.created + VOUCH_TTL_SECS;
      if (now >= deadline) return; // window closed — stake already slashable
      out.push({
        ...m,
        claimUrl: `${buildClaimUrl(origin, m.id)}?s=${m.secret}`,
        daysLeft: Math.max(0, Math.ceil((deadline - now) / 86_400)),
      });
    }),
  );
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}
