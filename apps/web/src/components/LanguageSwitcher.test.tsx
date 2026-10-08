import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { I18nProvider, useLocale, type Locale } from '@/lib/i18n';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { LanguageSwitcher } from './LanguageSwitcher';

/** Reports the active locale, so a click on the switcher is observable. */
function Probe() {
  return <span data-testid="locale">{useLocale().locale}</span>;
}

describe('LanguageSwitcher (#511)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    document.cookie = 'alvinmunk_locale=; path=/; max-age=0';
    document.documentElement.lang = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function mount(variant: 'pill' | 'icon' = 'pill', initialLocale?: Locale) {
    await act(async () =>
      root.render(
        <I18nProvider initialLocale={initialLocale}>
          <LanguageSwitcher variant={variant} />
          <Probe />
        </I18nProvider>,
      ),
    );
    return container;
  }

  const locale = () => container.querySelector('[data-testid="locale"]')?.textContent;
  const buttons = () => [...container.querySelectorAll<HTMLButtonElement>('button')];
  const byText = (text: string) => buttons().find((b) => b.textContent === text);

  it('names each option in its own language, with no flag emoji left', async () => {
    await mount();
    expect(buttons().map((b) => b.textContent)).toEqual(['English', 'Türkçe']);
    // English is the active one: it is the only pressed option.
    expect(byText('English')?.getAttribute('aria-pressed')).toBe('true');
    expect(byText('Türkçe')?.getAttribute('aria-pressed')).toBe('false');
    // A regional-indicator pair (the old 🇬🇧 / 🇹🇷) is what Windows renders as bare letters.
    expect(/[\u{1F1E6}-\u{1F1FF}]/u.test(container.textContent ?? '')).toBe(false);
  });

  it('tags each option with its own lang, so it is pronounced correctly', async () => {
    await mount();
    expect(byText('English')?.getAttribute('lang')).toBe('en');
    expect(byText('Türkçe')?.getAttribute('lang')).toBe('tr');
    expect(container.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Language');
  });

  it('switches the locale when a pill is picked', async () => {
    await mount();
    await act(async () => byText('Türkçe')!.click());
    expect(locale()).toBe('tr');
    expect(byText('Türkçe')?.getAttribute('aria-pressed')).toBe('true');
    expect(byText('English')?.getAttribute('aria-pressed')).toBe('false');
    expect(document.documentElement.lang).toBe('tr');
    // The group label is translated too.
    expect(container.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Dil');
  });

  it('is a one-button toggle in the icon variant, naming the language it switches to', async () => {
    await mount('icon');
    const toggle = () => container.querySelector<HTMLButtonElement>('button[title]')!;
    expect(toggle().textContent).toBe('Türkçe');
    expect(toggle().getAttribute('aria-label')).toBe('Switch to Türkçe');
    expect(toggle().querySelector('span')?.getAttribute('lang')).toBe('tr');

    await act(async () => toggle().click());
    expect(locale()).toBe('tr');
    expect(toggle().textContent).toBe('English');
    expect(toggle().getAttribute('aria-label')).toBe('English diline geç');
  });

  it('renders Turkish copy when the provider starts in Turkish', async () => {
    await mount('icon', 'tr');
    expect(
      container.querySelector<HTMLButtonElement>('button[title]')?.getAttribute('aria-label'),
    ).toBe('English diline geç');
    expect(document.documentElement.lang).toBe('tr');
  });
});
