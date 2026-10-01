import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { I18nProvider, useTranslations, useLocale, useFormat } from './i18n';

function Consumer() {
  const t = useTranslations();
  const { locale, setLocale } = useLocale();
  return (
    <div>
      <span id="locale">{locale}</span>
      <span id="text">{t('nav.howItWorks')}</span>
      <button id="switch" onClick={() => setLocale('tr')}>
        Switch
      </button>
    </div>
  );
}

describe('I18nProvider', () => {
  let container: HTMLDivElement;
  let root: Root;

  const cookie = () => document.cookie.match(/(?:^|; )alvinmunk_locale=([^;]*)/)?.[1] ?? null;

  beforeEach(() => {
    localStorage.clear();
    document.cookie = 'alvinmunk_locale=; path=/; max-age=0';
    document.documentElement.lang = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  async function mount(initialLocale?: 'en' | 'tr') {
    await act(async () => {
      root.render(
        <I18nProvider initialLocale={initialLocale}>
          <Consumer />
        </I18nProvider>,
      );
    });
  }
  const shown = () => [container.querySelector('#locale')?.textContent, container.querySelector('#text')?.textContent];

  it('renders English by default and switches locale', async () => {
    await act(async () => {
      root.render(
        <I18nProvider>
          <Consumer />
        </I18nProvider>,
      );
    });

    expect(container.querySelector('#locale')?.textContent).toBe('en');
    expect(container.querySelector('#text')?.textContent).toBe('How it works');

    await act(async () => {
      (container.querySelector('#switch') as HTMLButtonElement).click();
    });

    expect(container.querySelector('#locale')?.textContent).toBe('tr');
    expect(container.querySelector('#text')?.textContent).toBe('Nasıl çalışır');
  });

  describe('saved locale and <html lang> (#236)', () => {
    it('keeps <html lang> on the active locale, and a switch saves it to storage and the cookie', async () => {
      await mount();
      expect(document.documentElement.lang).toBe('en');
      await act(async () => (container.querySelector('#switch') as HTMLButtonElement).click());
      expect(shown()).toEqual(['tr', 'Nasıl çalışır']);
      expect(document.documentElement.lang).toBe('tr');
      expect(localStorage.getItem('alvinmunk_locale')).toBe('tr');
      expect(cookie()).toBe('tr');
    });

    it('server-renders the cookie\'s locale, so the first paint is already Turkish', () => {
      const html = renderToString(
        <I18nProvider initialLocale="tr">
          <Consumer />
        </I18nProvider>,
      );
      expect(html).toContain('Nasıl çalışır');
      expect(html).not.toContain('How it works');
    });

    it('trusts the cookie over the browser language', async () => {
      vi.spyOn(navigator, 'language', 'get').mockReturnValue('tr-TR');
      await mount('en');
      expect(shown()).toEqual(['en', 'How it works']);
      expect(document.documentElement.lang).toBe('en');
    });

    it('starts on the cookie\'s Turkish without an English render', async () => {
      const seen: string[] = [];
      function Spy() {
        seen.push(useLocale().locale);
        return null;
      }
      await act(async () => {
        root.render(
          <I18nProvider initialLocale="tr">
            <Spy />
            <Consumer />
          </I18nProvider>,
        );
      });
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((l) => l === 'tr')).toBe(true);
      expect(shown()).toEqual(['tr', 'Nasıl çalışır']);
      expect(document.documentElement.lang).toBe('tr');
    });

    it('without a cookie, adopts a choice only localStorage has and writes the cookie', async () => {
      localStorage.setItem('alvinmunk_locale', 'tr');
      await mount();
      expect(shown()).toEqual(['tr', 'Nasıl çalışır']);
      expect(document.documentElement.lang).toBe('tr');
      expect(cookie()).toBe('tr');
    });

    it('without any saved choice, follows a Turkish browser and remembers it', async () => {
      vi.spyOn(navigator, 'language', 'get').mockReturnValue('tr-TR');
      await mount();
      expect(shown()).toEqual(['tr', 'Nasıl çalışır']);
      expect(cookie()).toBe('tr');
    });

    it('writes no cookie for an English browser that chose nothing', async () => {
      vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
      await mount();
      expect(shown()).toEqual(['en', 'How it works']);
      expect(cookie()).toBeNull();
    });
  });

  it('mounts without throwing even if window.localStorage getter throws', async () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('SecurityError', 'SecurityError');
      },
      configurable: true,
    });

    try {
      await act(async () => {
        root.render(
          <I18nProvider>
            <Consumer />
          </I18nProvider>,
        );
      });
      expect(container.querySelector('#locale')?.textContent).toBe('en');
      await act(async () => {
        (container.querySelector('#switch') as HTMLButtonElement).click();
      });
      expect(container.querySelector('#locale')?.textContent).toBe('tr');
    } finally {
      if (original) {
        Object.defineProperty(window, 'localStorage', original);
      }
    }
  });
});

// A fixed noon UTC, so the calendar day is the same in every test-runner time zone.
const SEP_30 = Date.UTC(2026, 8, 30, 12);

describe('useFormat (#493)', () => {
  let container: HTMLDivElement;
  let root: Root;

  function Figures() {
    const format = useFormat();
    const { setLocale } = useLocale();
    return (
      <div>
        <span id="n">{format.number(1234)}</span>
        <span id="d">{format.date(SEP_30)}</span>
        <button id="tr" onClick={() => setLocale('tr')}>
          tr
        </button>
      </div>
    );
  }

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
  });

  const text = (id: string) => container.querySelector(`#${id}`)?.textContent;

  it('follows the active locale when it switches', async () => {
    await act(async () => {
      root.render(
        <I18nProvider>
          <Figures />
        </I18nProvider>,
      );
    });
    expect(text('n')).toBe('1,234');
    expect(text('d')).toBe('Sep 30, 2026');
    await act(async () => {
      (container.querySelector('#tr') as HTMLButtonElement).click();
    });
    expect(text('n')).toBe('1.234');
    expect(text('d')).toBe('30 Eyl 2026');
  });

  it('picks up a stored Turkish preference', async () => {
    localStorage.setItem('alvinmunk_locale', 'tr');
    await act(async () => {
      root.render(
        <I18nProvider>
          <Figures />
        </I18nProvider>,
      );
    });
    expect(text('n')).toBe('1.234');
  });

  it('is English outside the provider, like useTranslations', async () => {
    await act(async () => root.render(<Figures />));
    expect(text('n')).toBe('1,234');
    expect(text('d')).toBe('Sep 30, 2026');
  });
});
