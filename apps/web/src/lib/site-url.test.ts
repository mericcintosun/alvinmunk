import { afterEach, describe, expect, it } from 'vitest';
import { getSiteUrl } from './site-url';

const env = process.env;

afterEach(() => {
  process.env = { ...env };
});

describe('getSiteUrl', () => {
  it('prefers NEXT_PUBLIC_SITE_URL', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://fork.example.com';
    delete process.env.VERCEL_URL;
    expect(getSiteUrl().origin).toBe('https://fork.example.com');
  });

  it('falls back to https://VERCEL_URL', () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    process.env.VERCEL_URL = 'my-preview.vercel.app';
    expect(getSiteUrl().href).toBe('https://my-preview.vercel.app/');
    expect(getSiteUrl().origin).toBe('https://my-preview.vercel.app');
  });

  it('uses localhost when no env is set', () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.VERCEL_URL;
    expect(getSiteUrl().origin).toBe('http://localhost:3000');
  });
});
