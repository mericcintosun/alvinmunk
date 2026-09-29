'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Wallet, ConnectMode } from '@/lib/wallet';
import { loadProfile, saveProfile, clearProfile, type Profile } from '@/lib/profile';

interface WalletContextValue {
  wallet: Wallet | null;
  profile: Profile | null;
  balance: string | null;
  connecting: boolean;
  connect: (mode?: ConnectMode) => Promise<Wallet>;
  disconnect: () => void;
  setProfile: (p: Profile) => void;
  /**
   * The profile of the handle `w` already holds on-chain, adopted as the local one — null when
   * its address holds none. Throws when the registry can't be read: a caller about to claim a
   * handle must not take "unknown" for "none", because claiming renames an existing one.
   */
  restoreProfile: (w: Wallet) => Promise<Profile | null>;
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

  const setProfile = useCallback((p: Profile) => {
    saveProfile(p);
    setProfileState(p);
  }, []);

  const refreshBalance = useCallback(() => {
    const addr = wallet?.address ?? profile?.address;
    if (!addr) return;
    void import('@/lib/stellar').then(({ getXlmBalance }) =>
      getXlmBalance(addr).then(setBalance).catch(() => {}),
    );
  }, [wallet, profile]);

  const restoreProfile = useCallback(async (w: Wallet): Promise<Profile | null> => {
    // This browser already knows the address's handle: nothing to look up.
    const local = loadProfile();
    if (local?.address === w.address) return local;
    // Otherwise it may still hold one (issue #278): a new device, a second browser, cleared
    // site data. Adopt it; the published face and bio follow via IdentityBar's get_meta read.
    const { reverseHandle } = await import('@/lib/registry');
    const handle = await reverseHandle(w.address, { strict: true }).catch((e: unknown) => {
      throw new Error("Couldn't look up your handle — try again in a moment.", { cause: e });
    });
    if (!handle) return null;
    const p: Profile = { handle, address: w.address, createdAt: Date.now() };
    setProfile(p);
    return p;
  }, [setProfile]);

  const connect = useCallback(async (mode: ConnectMode = 'create') => {
    setConnecting(true);
    try {
      const { getWallet } = await import('@/lib/wallet');
      const { getXlmBalance } = await import('@/lib/stellar');
      const w = await getWallet(mode);
      setWallet(w);
      setBalance(await getXlmBalance(w.address).catch(() => null));
      // Every connect adopts a handle the address already holds, so a returning user never
      // lands on the create-handle form. Best-effort: a failed read changes nothing, and the
      // flows that claim a handle check again (strictly) before they do.
      await restoreProfile(w).catch(() => null);
      return w;
    } finally {
      setConnecting(false);
    }
  }, [restoreProfile]);

  const disconnect = useCallback(() => {
    clearProfile();
    setProfileState(null);
    setWallet(null);
    setBalance(null);
  }, []);

  return (
    <WalletContext.Provider
      value={{
        wallet,
        profile,
        balance,
        connecting,
        connect,
        disconnect,
        setProfile,
        restoreProfile,
        refreshBalance,
      }}
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
