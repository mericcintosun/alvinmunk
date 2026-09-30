import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import { HandleHint } from './handle-hint';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('HandleHint (#479)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
  });

  async function render(value: string, tr = false) {
    if (tr) localStorage.setItem('alvinmunk_locale', 'tr');
    const hint = <HandleHint id="hint" value={value} />;
    await act(async () => root.render(tr ? <I18nProvider>{hint}</I18nProvider> : hint));
    return container.querySelector('#hint')!;
  }

  it('states the rules before anything is typed', async () => {
    const hint = await render('');
    expect(hint.textContent).toBe('3–20 characters: a–z, 0–9 or _');
    expect(hint.getAttribute('aria-live')).toBe('polite');
  });

  it('keeps showing the rules for a handle that needs no cleaning', async () => {
    expect((await render('Ada_Lovelace')).textContent).toBe('3–20 characters: a–z, 0–9 or _');
  });

  it('says which characters were removed, and why', async () => {
    const hint = await render('Ayşe K');
    expect(hint.textContent).toBe('Removed “ş”, space — use 3–20 characters: a–z, 0–9 or _');
  });

  it('is translated', async () => {
    expect((await render('', true)).textContent).toBe('3–20 karakter: a–z, 0–9 veya _');
    expect((await render('Ayşe K', true)).textContent).toBe(
      '“ş”, boşluk çıkarıldı — 3–20 karakter kullan: a–z, 0–9 veya _',
    );
  });

  it('grows with a wrapped message instead of a fixed one-line height', async () => {
    const hint = await render('Ayşe K');
    expect(hint.className.split(' ')).toContain('min-h-4');
    expect(hint.className.split(' ')).not.toContain('h-4');
  });
});
