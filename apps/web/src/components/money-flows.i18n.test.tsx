import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getWallet: vi.fn(),
  getEarnedScore: vi.fn(),
  getScores: vi.fn(),
  getRewardsFor: vi.fn(),
  claimReward: vi.fn(),
  getUsdcBalance: vi.fn(),
  hasUsdcTrustline: vi.fn(),
  tip: vi.fn(),
  requestTestUsdc: vi.fn(),
  enableUsdc: vi.fn(),
  getGateStatus: vi.fn(),
  unlockGate: vi.fn(),
  getAnchorConfig: vi.fn(),
  getStreak: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/i18n')>();
  return {
    ...actual,
    useTranslations: () => actual.getTranslations('tr'),
    useLocale: () => ({ locale: 'tr' as const, setLocale: () => {} }),
  };
});
vi.mock('@/lib/wallet', () => ({ getWallet: mocks.getWallet }));
vi.mock('@/lib/reputation', async (io) => ({
  ...(await io<typeof import('@/lib/reputation')>()),
  getEarnedScore: mocks.getEarnedScore,
  getScores: mocks.getScores,
}));
vi.mock('@/lib/rewards', async (io) => ({
  ...(await io<typeof import('@/lib/rewards')>()),
  getUsdcBalance: mocks.getUsdcBalance,
  hasUsdcTrustline: mocks.hasUsdcTrustline,
  tip: mocks.tip,
  requestTestUsdc: mocks.requestTestUsdc,
  enableUsdc: mocks.enableUsdc,
  getRewardsFor: mocks.getRewardsFor,
  claimReward: mocks.claimReward,
}));
vi.mock('@/lib/anchor', async (io) => ({
  ...(await io<typeof import('@/lib/anchor')>()),
  getAnchorConfig: mocks.getAnchorConfig,
}));
vi.mock('@/lib/gate', async (io) => ({
  ...(await io<typeof import('@/lib/gate')>()),
  getGateStatus: mocks.getGateStatus,
  unlockGate: mocks.unlockGate,
}));
vi.mock('@/lib/quests', async (io) => ({
  ...(await io<typeof import('@/lib/quests')>()),
  getStreak: mocks.getStreak,
}));
// Decorative chrome is stubbed so the assertions are about copy, not SVG.
vi.mock('@/components/fx/number-ticker', () => ({
  NumberTicker: ({ value }: { value: number }) => <span data-testid="ticker">{String(value)}</span>,
}));
vi.mock('@/components/ui/skeleton', () => ({ Skeleton: () => null }));
vi.mock('@/components/Avatar', () => ({ Avatar: () => null }));
vi.mock('@/components/ui/toaster', () => ({ toast: mocks.toast }));

import { getTranslations } from '@/lib/i18n';
import { Tip, buildTipErrors } from './Tip';
import { Quests } from './Quests';
import { Rewards, buildRewardErrors } from './Rewards';
import { Unlockables } from './Unlockables';

const OWNER = 'GOWNER';

describe('money-flow i18n (#238)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.getWallet.mockResolvedValue({ address: OWNER, kind: 'freighter' });
    mocks.getEarnedScore.mockResolvedValue(0);
    mocks.getScores.mockResolvedValue({ social: 0, earned: 0 });
    mocks.getRewardsFor.mockResolvedValue({ rows: [], remainingToday: null });
    mocks.getUsdcBalance.mockResolvedValue(12345000n);
    mocks.hasUsdcTrustline.mockResolvedValue(true);
    mocks.getGateStatus.mockResolvedValue([]);
    mocks.getAnchorConfig.mockReturnValue(null);
    mocks.getStreak.mockResolvedValue({ weeks: 0, best: 0 });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function render(ui: React.ReactElement) {
    await act(async () => {
      root.render(ui);
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  const buttons = () => [...container.querySelectorAll('button')].map((b) => b.textContent ?? '');

  it('renders Tip in Turkish', async () => {
    await render(<Tip address={OWNER} />);
    expect(container.textContent).toContain('Bahşiş gönder');
    expect(container.textContent).toContain('harca // bahşiş');
    expect(container.textContent).toContain('gerçek test ağı USDC');
    expect(container.textContent).toContain('5 test USDC al');
    const placeholders = [...container.querySelectorAll('input')].map((i) => i.getAttribute('placeholder'));
    expect(placeholders).toContain('@kullanıcı adı veya adres (G… / C…)');
    expect(container.textContent).not.toContain('Send a tip');
    expect(container.textContent).not.toContain('Looking up handle');
  });

  it('renders Quests in Turkish', async () => {
    await render(<Quests address={OWNER} />);
    expect(container.textContent).toContain('Doğrulanmış görevler');
    expect(container.textContent).toContain('Kazanılan XP');
    expect(container.textContent).toContain('görevler // kazan');
    expect(container.textContent).toContain('Bir görevi doğrula');
    expect(container.textContent).toContain('Geri desteği al (3+ destek)');
    expect(container.textContent).not.toContain('Verified quests');
  });

  it('renders Rewards row states and cash-out copy in Turkish', async () => {
    mocks.getEarnedScore.mockResolvedValue(5);
    mocks.getRewardsFor.mockResolvedValue({
      rows: [
        { entry: { id: 1, threshold: 3n, amount: 1000000n, active: true }, claimed: false, eligible: true, reason: 0 },
        {
          entry: { id: 2, threshold: 50n, amount: 2000000n, active: true, max_claims: 3, claims: 1 },
          claimed: false,
          eligible: false,
          reason: 3,
        },
        { entry: { id: 3, threshold: 3n, amount: 9000000n, active: true }, claimed: false, eligible: false, reason: 9 },
      ],
      remainingToday: 5000000n,
    });
    await render(<Rewards address={OWNER} />);
    expect(container.textContent).toContain('Rütbe ödülleri');
    expect(container.textContent).toContain('Kazanılan XP');
    expect(buttons()).toContain('Al');
    expect(buttons()).toContain('Kilitli');
    expect(container.textContent).toContain('3 adetten 2 kaldı');
    expect(container.textContent).toContain('Bugünkü ödül bütçesinde 0.5 USDC kaldı');
    expect(container.textContent).toContain(buildRewardErrors(getTranslations('tr'))[9]);
    // Anchor is unconfigured in tests, so the fallback copy must be Turkish too.
    expect(container.textContent).toContain('ana ağda geliyor');
    expect(container.textContent).not.toContain('Rank rewards');
    expect(container.textContent).not.toContain('Sold out');
  });

  it('renders Unlockables track labels and states in Turkish', async () => {
    mocks.getScores.mockResolvedValue({ social: 10, earned: 2 });
    mocks.getGateStatus.mockResolvedValue([
      // Earned, not passed
      { gate: { id: 1, track: 1, min: 5, label: 'VIP', active: true }, passes: false, unlocked: false },
      // Social, passed + unlocked
      { gate: { id: 2, track: 0, min: 5, label: 'OG', active: true }, passes: true, unlocked: true },
    ]);
    await render(<Unlockables address={OWNER} />);
    expect(container.textContent).toContain('İtibar erişimin kilidini açar');
    expect(container.textContent).toContain('Kazanılan XP için 5 gerekli · sende 2');
    expect(container.textContent).toContain('Sosyal XP için 5 gerekli · sende 10');
    expect(container.textContent).toContain('✦ açıldı');
    expect(buttons()).toContain('kilitli');
    expect(container.textContent).not.toContain('Earned XP');
    expect(container.textContent).not.toContain('unlocked');
  });

  it('maps contract error codes to Turkish copy', () => {
    const tr = getTranslations('tr');
    expect(buildTipErrors(tr)[5]).toBe('Bahşişler şu anda duraklatıldı — sonra tekrar dene.');
    expect(buildTipErrors(tr)[10]).toBe(
      'Bu hesap inceleme altında ve şu anda bahşiş gönderemiyor.',
    );
    const rewards = buildRewardErrors(tr);
    expect(rewards[3]).toBe(
      "Bu ödülün kilidini açmak için daha fazla Kazanılan XP'ye ihtiyacın var.",
    );
    expect(rewards[13]).toBe('Bu ödülün havuzu tükendi.');
    // English stays English via the same builder.
    const en = getTranslations('en');
    expect(buildTipErrors(en)[5]).toBe('Tips are paused right now — try again later.');
    expect(buildRewardErrors(en)[4]).toBe("You've already claimed this reward.");
  });
});
