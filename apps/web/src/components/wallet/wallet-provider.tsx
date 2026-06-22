'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Wallet } from '@/lib/wallet';
import { loadProfile, saveProfile, clearProfile, type Profile } from '@/lib/profile';

interface WalletContextValue {
  wallet: Wallet | null;
  profile: Profile | null;
  balance: string | null;
  connecting: boolean;
  connect: () => Promise<Wallet>;
  disconnect: () => void;
  setProfile: (p: Profile) => void;
  refreshBalance: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

/**
 * Single client boundary for wallet state. The heavy stellar-sdk modules (lib/wallet,
 * lib/stellar) are **dynamically imported** inside callbacks so they never enter the
 * root-layout eager module graph — that keeps SSR/static pages (and Lighthouse on the
 * marketing surface) free of the SDK, and avoids the layout-level prerender crash that
 * eager-importing stellar-sdk caused. Profile (localStorage) is safe to import statically.
 */
export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [profile, setProfileState] = useState<Profile | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    const p = loadProfile();
    if (p) {
      setProfileState(p);
      void import('@/lib/stellar').then(({ getXlmBalance }) =>
        getXlmBalance(p.address).then(setBalance).catch(() => {}),
      );
    }
  }, []);

  const refreshBalance = useCallback(() => {
    const addr = wallet?.address ?? profile?.address;
    if (!addr) return;
    void import('@/lib/stellar').then(({ getXlmBalance }) =>
      getXlmBalance(addr).then(setBalance).catch(() => {}),
    );
  }, [wallet, profile]);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const { getWallet } = await import('@/lib/wallet');
      const { getXlmBalance } = await import('@/lib/stellar');
      const w = await getWallet();
      setWallet(w);
      setBalance(await getXlmBalance(w.address).catch(() => null));
      return w;
    } finally {
      setConnecting(false);
    }
  }, []);

  const setProfile = useCallback((p: Profile) => {
    saveProfile(p);
    setProfileState(p);
  }, []);

  const disconnect = useCallback(() => {
    clearProfile();
    setProfileState(null);
    setWallet(null);
    setBalance(null);
  }, []);

  return (
    <WalletContext.Provider
      value={{ wallet, profile, balance, connecting, connect, disconnect, setProfile, refreshBalance }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
}
