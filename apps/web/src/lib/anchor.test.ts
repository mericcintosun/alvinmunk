import { describe, it, expect, afterEach } from 'vitest';
import { getAnchorConfig, isAnchorConfigured, anchorEntryUrl } from './anchor';

describe('anchor config hook', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_ANCHOR_HOME_DOMAIN;
    delete process.env.NEXT_PUBLIC_ANCHOR_TRANSFER_SERVER;
  });

  it('is unconfigured until BOTH the home domain and transfer server are set', () => {
    expect(getAnchorConfig()).toBeNull();
    expect(isAnchorConfigured()).toBe(false);
    process.env.NEXT_PUBLIC_ANCHOR_HOME_DOMAIN = 'anchor.example.com';
    expect(isAnchorConfigured()).toBe(false); // still missing the transfer server
    process.env.NEXT_PUBLIC_ANCHOR_TRANSFER_SERVER = 'https://anchor.example.com/sep24';
    expect(isAnchorConfigured()).toBe(true);
  });

  it('builds an https entry url from a bare home domain', () => {
    process.env.NEXT_PUBLIC_ANCHOR_HOME_DOMAIN = 'anchor.example.com';
    process.env.NEXT_PUBLIC_ANCHOR_TRANSFER_SERVER = 'https://anchor.example.com/sep24';
    expect(anchorEntryUrl()).toBe('https://anchor.example.com');
  });
});
