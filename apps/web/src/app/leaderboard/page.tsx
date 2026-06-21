'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchLeaderboard } from '@/lib/leaderboard';
import { shortAddr, type LeaderboardEntry } from '@passport/shared';
import { loadProfile } from '@/lib/profile';

/**
 * Leaderboard (Yellow belt) — framed SOCIALLY ("most connected", Kaan), folded from
 * on-chain `social` events via RPC, polled every 5s (MVP "real-time").
 */
export default function LeaderboardPage() {
  const [rows, setRows] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const me = loadProfile()?.address;

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetchLeaderboard();
        if (alive) setRows(r);
      } finally {
        if (alive) setLoading(false);
      }
    };
    tick();
    const iv = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Most connected</h1>
        <Link href="/" className="text-xs text-white/50 underline">
          ← passport
        </Link>
      </header>

      {loading && <p className="text-sm text-white/40">reading the chain…</p>}

      {!loading && rows.length === 0 && (
        <p className="text-sm text-white/40">
          No connections yet — be the first to vouch for 10 people.
        </p>
      )}

      <ol className="flex flex-col gap-2">
        {rows.map((e) => (
          <li
            key={e.address}
            className={`flex items-center justify-between rounded-xl px-4 py-3 ${
              e.address === me ? 'bg-stellar/15 ring-1 ring-stellar/40' : 'bg-white/[0.03]'
            }`}
          >
            <span className="flex items-center gap-3">
              <span className="w-5 text-right text-sm text-white/40">{e.rank}</span>
              <span className="text-sm">{shortAddr(e.address)}</span>
              {e.address === me && <span className="text-[10px] text-stellar">you</span>}
              {e.flagged && (
                <span
                  title="reciprocal vouch pair — possible ring"
                  className="text-[10px] text-amber-400"
                >
                  ⚠ flagged
                </span>
              )}
            </span>
            <span className="text-sm font-semibold text-stellar">{e.score}</span>
          </li>
        ))}
      </ol>

      <p className="mt-2 text-center text-[11px] text-white/30">
        social score · non-cashable · updates live
      </p>
    </main>
  );
}
