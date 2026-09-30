import { afterEach, describe, expect, it, vi } from 'vitest';
import { feedbackFormLink, feedbackFormUrl } from './feedback';

const FORM = 'https://docs.google.com/forms/d/e/FORM/viewform';
const G = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';

const setForm = (url: string) => vi.stubEnv('NEXT_PUBLIC_FEEDBACK_FORM_URL', url);
const query = (link: string | null) => Object.fromEntries(new URL(link!).searchParams);

describe('feedback form link (#287)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is null when the env var is unset, blank, or not an http(s) URL', () => {
    setForm('');
    expect(feedbackFormUrl()).toBeNull();
    expect(feedbackFormLink({ handle: 'bob', address: G })).toBeNull();
    setForm('   ');
    expect(feedbackFormLink()).toBeNull();
    setForm('javascript:alert(1)');
    expect(feedbackFormLink()).toBeNull();
    setForm('not a url');
    expect(feedbackFormLink()).toBeNull();
  });

  it('leaves a plain form URL as it is', () => {
    setForm('https://forms.gle/kNXR3zmZhGhgmrt58');
    expect(feedbackFormLink({ handle: 'bob', address: G })).toBe('https://forms.gle/kNXR3zmZhGhgmrt58');
  });

  it('fills the {handle} and {address} placeholders of a pre-filled link, encoded or not', () => {
    setForm(`${FORM}?usp=pp_url&entry.111=%7Bhandle%7D&entry.222={address}`);
    const link = feedbackFormLink({ handle: 'bob', address: G });
    expect(link!.startsWith(`${FORM}?`)).toBe(true);
    expect(query(link)).toEqual({ usp: 'pp_url', 'entry.111': '@bob', 'entry.222': G });
  });

  it('prefixes the handle with a single @', () => {
    setForm(`${FORM}?entry.111={handle}`);
    expect(query(feedbackFormLink({ handle: '@bob' }))).toEqual({ 'entry.111': '@bob' });
  });

  it('drops a placeholder it has no value for instead of sending it blank or literal', () => {
    setForm(`${FORM}?usp=pp_url&entry.111={handle}&entry.222={address}`);
    expect(query(feedbackFormLink({ address: G }))).toEqual({ usp: 'pp_url', 'entry.222': G });
    expect(query(feedbackFormLink())).toEqual({ usp: 'pp_url' });
    expect(feedbackFormLink()).not.toContain('handle');
  });
});
