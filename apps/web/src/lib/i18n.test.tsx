import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { I18nProvider, useTranslations, useLocale, getFormat, useFormat, type Locale } from './i18n';

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

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

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

describe('getFormat (#493)', () => {
  it('groups thousands for the locale: 1,234 in English, 1.234 in Turkish', () => {
    expect(getFormat('en').number(1234)).toBe('1,234');
    expect(getFormat('tr').number(1234)).toBe('1.234');
    expect(getFormat('en').number(99_999)).toBe('99,999');
    expect(getFormat('tr').number(1_234_567)).toBe('1.234.567');
    expect(getFormat('en').number(0)).toBe('0');
    expect(getFormat('tr').number(999)).toBe('999');
  });

  it('takes number options, e.g. a two-decimal balance', () => {
    const two = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
    expect(getFormat('en').number(1234.5, two)).toBe('1,234.50');
    expect(getFormat('tr').number(1234.5, two)).toBe('1.234,50');
    // The options never leak into the plain formatter.
    expect(getFormat('en').number(1234.5)).toBe('1,234.5');
  });

  it('formats a date for the locale, from a Date or epoch milliseconds', () => {
    expect(getFormat('en').date(SEP_30)).toBe('Sep 30, 2026');
    expect(getFormat('tr').date(SEP_30)).toBe('30 Eyl 2026');
    expect(getFormat('en').date(new Date(SEP_30))).toBe('Sep 30, 2026');
  });

  it('is stable per locale and falls back to English for an unknown one', () => {
    expect(getFormat('tr')).toBe(getFormat('tr'));
    expect(getFormat('xx' as Locale).number(1234)).toBe('1,234');
    expect(getFormat('constructor' as Locale).number(1234)).toBe('1,234');
  });
});

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
