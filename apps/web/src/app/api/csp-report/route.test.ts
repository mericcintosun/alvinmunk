// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import { MAX_CSP_REPORT_BYTES, parseCspReports } from '@/lib/csp-report';

const SECRET = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

/** What Chrome and Firefox send to a `report-uri` (application/csp-report). */
const LEGACY = {
  'csp-report': {
    'document-uri': `https://alvinmunk.vercel.app/claim/7?s=${SECRET}#k=${SECRET}`,
    referrer: `https://wa.me/?text=https://alvinmunk.vercel.app/claim/7?s=${SECRET}`,
    'violated-directive': 'img-src',
    'effective-directive': 'img-src',
    'original-policy': "default-src 'self'; report-uri /api/csp-report",
    disposition: 'report',
    'blocked-uri': `https://cdn.example.com/pixel.gif?leak=${SECRET}`,
    'line-number': 12,
    'column-number': 3,
    'source-file': `https://alvinmunk.vercel.app/_next/static/chunks/app.js?s=${SECRET}`,
    'status-code': 200,
    'script-sample': `const s = "${SECRET}"`,
  },
};

const post = (body: string, headers: Record<string, string> = {}) =>
  POST(
    new Request('https://alvinmunk.vercel.app/api/csp-report', {
      method: 'POST',
      headers: { 'content-type': 'application/csp-report', ...headers },
      body,
    }),
  );

describe('POST /api/csp-report', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  let logged: () => string;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    logged = () => JSON.stringify([warn.mock.calls, log.mock.calls, error.mock.calls]);
  });
  afterEach(() => vi.restoreAllMocks());

  it('logs the directive and what was blocked, and answers 204 with an empty body', async () => {
    const res = await post(JSON.stringify(LEGACY));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(warn.mock.calls[0][0] as string)).toEqual({
      csp: 'violation',
      directive: 'img-src',
      blocked: 'https://cdn.example.com',
      document: 'https://alvinmunk.vercel.app/claim/7',
      source: 'https://alvinmunk.vercel.app/_next/static/chunks/app.js',
      line: 12,
      disposition: 'report',
    });
  });

  it('never logs a claim secret, the referrer or the script sample', async () => {
    await post(JSON.stringify(LEGACY));
    expect(logged()).not.toContain(SECRET);
    expect(logged()).not.toContain('wa.me');
  });

  it('reads a Reporting API batch too', async () => {
    const batch = [
      {
        type: 'csp-violation',
        url: `https://alvinmunk.vercel.app/claim/7?s=${SECRET}`,
        body: {
          documentURL: `https://alvinmunk.vercel.app/claim/7?s=${SECRET}`,
          effectiveDirective: 'connect-src',
          blockedURL: 'wss://relay.example.com/socket',
          disposition: 'report',
          sample: SECRET,
        },
      },
      { type: 'deprecation', body: { id: 'x' } },
    ];
    const res = await post(JSON.stringify(batch), { 'content-type': 'application/reports+json' });
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(warn.mock.calls[0][0] as string)).toMatchObject({
      directive: 'connect-src',
      blocked: 'wss://relay.example.com',
      document: 'https://alvinmunk.vercel.app/claim/7',
    });
    expect(logged()).not.toContain(SECRET);
  });

  it('turns away an oversized body without reading it', async () => {
    const res = await post('{}', { 'content-length': String(MAX_CSP_REPORT_BYTES + 1) });
    expect(res.status).toBe(413);
    expect(await res.text()).toBe('');
    const big = await post(JSON.stringify({ 'csp-report': { 'effective-directive': 'img-src', pad: 'x'.repeat(MAX_CSP_REPORT_BYTES) } }));
    expect(big.status).toBe(413);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(['not json', '{}', '[]', '{"csp-report":{"effective-directive":"img-src; script-src *"}}', '{"csp-report":{"blocked-uri":"x"}}'])(
    'rejects what is not a report (%s) with a 400 and logs no violation',
    async (body) => {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(await res.text()).toBe('');
      expect(warn).not.toHaveBeenCalled();
    },
  );
});

describe('parseCspReports', () => {
  it('keeps keywords, reduces other schemes to the scheme, and drops junk', () => {
    const [v] = parseCspReports({
      'csp-report': {
        'violated-directive': "script-src-elem 'self'",
        'blocked-uri': 'inline',
        'document-uri': 'chrome-extension://abcdef/page.html?s=x',
        'source-file': 12,
        'line-number': 'NaN',
        disposition: 'whatever',
      },
    });
    expect(v).toEqual({
      directive: 'script-src-elem',
      blocked: 'inline',
      document: 'chrome-extension:',
      source: undefined,
      line: undefined,
      disposition: undefined,
    });
  });

  it('logs at most ten violations from one batch', () => {
    const one = { type: 'csp-violation', body: { effectiveDirective: 'img-src', blockedURL: 'data' } };
    expect(parseCspReports(Array(50).fill(one))).toHaveLength(10);
  });
});
