import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = vi.hoisted(() => ({
  getScores: vi.fn(),
  getQuestAttestation: vi.fn(),
  getPeopleCounts: vi.fn(),
}));

vi.mock('@/lib/reputation', () => ({ getScores: m.getScores, getQuestAttestation: m.getQuestAttestation }));
vi.mock('@/lib/constellation', () => ({ getPeopleCounts: m.getPeopleCounts }));
vi.mock('@/components/ReputationSnippet', () => ({ ReputationSnippet: () => null }));

import ScorePage from './page';
import { I18nProvider } from '@/lib/i18n';

// A valid G… key (StrKey of 32 × 0x07), so the page passes its address check.
const ADDRESS = 'GADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOZPI';
// Noon UTC: the same calendar day in every test-runner time zone.
const SEP_30 = Date.UTC(2026, 8, 30, 12) / 1000;

/** The server component formats nothing itself; its figures render in the reader's locale (#493). */
describe('/score/[address] formatting (#493)', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    m.getScores.mockReset().mockResolvedValue({ social: 1_234, earned: 56_789 });
    m.getPeopleCounts.mockReset().mockResolvedValue({ vouchedBy: 2_048, backed: 1_500 });
    m.getQuestAttestation
      .mockReset()
      .mockResolvedValue({ issuer: ADDRESS, value: 12_000n, timestamp: SEP_30, revoked: false });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
  });

  async function render() {
    const page = await ScorePage({ params: Promise.resolve({ address: ADDRESS }) });
    await act(async () => root.render(<I18nProvider>{page}</I18nProvider>));
    return container.textContent ?? '';
  }

  it('groups figures with a comma and writes the date the English way', async () => {
    const text = await render();
    for (const s of ['2,048', 'backed 1,500', '1,234', '56,789', '12,000 XP', 'Sep 30, 2026']) {
      expect(text).toContain(s);
    }
    expect(container.querySelector('time')?.getAttribute('datetime')).toBe('2026-09-30T12:00:00.000Z');
  });

  it('groups figures with a dot and writes the date the Turkish way', async () => {
    localStorage.setItem('alvinmunk_locale', 'tr');
    const text = await render();
    for (const s of ['2.048', 'backed 1.500', '1.234', '56.789', '12.000 XP', '30 Eyl 2026']) {
      expect(text).toContain(s);
    }
    expect(text).not.toContain('1,234');
    expect(text).not.toContain('Sep 30');
  });
});
