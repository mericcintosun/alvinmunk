// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { REQUEST_ID_HEADER, json, requestIdFor, withRoute } from './api-route';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VERCEL_ID = 'fra1::iad1::abcde-1700000000000-0123456789ab';

let logSpy: MockInstance<typeof console.log>;
let errorSpy: MockInstance<typeof console.error>;

beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Every structured line the wrapper wrote, from either stream. */
function logLines(): Record<string, unknown>[] {
  return [...logSpy.mock.calls, ...errorSpy.mock.calls].map(([text]) => JSON.parse(String(text)));
}

describe('withRoute — request ids', () => {
  it('uses a well-formed x-vercel-id as the request id', async () => {
    const GET = withRoute<[Request?]>('GET /api/x', async () => json({ ok: true }));

    const res = await GET(
      new Request('http://localhost/api/x', { headers: { 'x-vercel-id': VERCEL_ID } }),
    );

    expect(res.headers.get(REQUEST_ID_HEADER)).toBe(VERCEL_ID);
    expect(logLines()[0].requestId).toBe(VERCEL_ID);
  });

  it('falls back to a fresh UUID without an x-vercel-id, or without a request at all', async () => {
    const GET = withRoute<[Request?]>('GET /api/x', () => new Response('ok'));

    const a = (await GET()).headers.get(REQUEST_ID_HEADER);
    const b = (await GET(new Request('http://localhost/api/x'))).headers.get(REQUEST_ID_HEADER);

    expect(a).toMatch(UUID);
    expect(b).toMatch(UUID);
    expect(a).not.toBe(b);
  });

  it('never echoes a malformed x-vercel-id', () => {
    // Header-only stand-ins: a real Request refuses some of these values outright.
    for (const bad of ['', 'a b', 'id\n{"forged":1}', 'x'.repeat(129), '<script>']) {
      expect(requestIdFor({ headers: { get: () => bad } })).toMatch(UUID);
    }
    expect(requestIdFor({ headers: { get: () => null } })).toMatch(UUID);
    expect(requestIdFor(undefined)).toMatch(UUID);
  });
});

describe('withRoute — responses', () => {
  it("keeps the handler's status, body and headers, and adds x-request-id", async () => {
    const POST = withRoute('POST /api/x', async (req: Request) => {
      const body = (await req.json()) as { n: number };
      return new Response(JSON.stringify({ n: body.n + 1 }), {
        status: 202,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      });
    });

    const res = await POST(
      new Request('http://localhost/api/x', { method: 'POST', body: '{"n":1}' }),
    );

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ n: 2 });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(UUID);
  });

  it('passes every argument through to the handler', async () => {
    const handler = vi.fn(async (_req: Request, _ctx: { params: { id: string } }) => json({}));
    const req = new Request('http://localhost/api/x');

    await withRoute('GET /api/x', handler)(req, { params: { id: '7' } });

    expect(handler).toHaveBeenCalledWith(req, { params: { id: '7' } });
  });

  it('adds the header to a response whose headers are immutable', async () => {
    const GET = withRoute('GET /api/x', () => Response.redirect('https://example.com/', 307));

    const res = await GET();

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://example.com/');
    expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(UUID);
  });

  it('turns an uncaught throw into a JSON 500 that names the request id, not the cause', async () => {
    const POST = withRoute<[Request?]>('POST /api/x', async (): Promise<Response> => {
      throw new TypeError('rpc https://key:SECRET@rpc.example.com failed for GABC');
    });

    const res = await POST(
      new Request('http://localhost/api/x', { headers: { 'x-vercel-id': VERCEL_ID } }),
    );

    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe(VERCEL_ID);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: 'internal error', requestId: VERCEL_ID });
    expect(text).not.toMatch(/SECRET|rpc\.example|GABC/);
  });

  it('handles a thrown non-Error and a synchronous throw the same way', async () => {
    const GET = withRoute('GET /api/x', (): Response => {
      throw 'boom';
    });

    const res = await GET();

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('internal error');
    expect(logLines()).toEqual([
      expect.objectContaining({ outcome: 'uncaught', errorName: 'string' }),
    ]);
  });
});

describe('withRoute — the log line', () => {
  it('writes exactly one line per request with only the wrapper-measured fields', async () => {
    const GET = withRoute<[Request?]>('GET /api/x', () => json({ ok: true }));

    await GET(new Request('http://localhost/api/x', { headers: { 'x-vercel-id': VERCEL_ID } }));

    const lines = logLines();
    expect(lines).toHaveLength(1);
    expect(Object.keys(lines[0]).sort()).toEqual([
      'ms',
      'outcome',
      'requestId',
      'route',
      'status',
      't',
    ]);
    expect(lines[0]).toMatchObject({
      route: 'GET /api/x',
      requestId: VERCEL_ID,
      status: 200,
      outcome: 'ok',
    });
    expect(new Date(String(lines[0].t)).toISOString()).toBe(lines[0].t);
    expect(lines[0].ms).toBeGreaterThanOrEqual(0);
    expect(logSpy).toHaveBeenCalledOnce();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('never logs request body fields — addresses, XDR, secrets, notes', async () => {
    const body = {
      recipient: 'G'.padEnd(56, 'Q'),
      xdr: 'AAAAAgAAAABEXDRSENTINEL',
      secret: 'S'.padEnd(56, 'Z'),
      note: 'private note text',
    };
    const POST = withRoute('POST /api/x', async (req: Request) => {
      const got = (await req.json()) as typeof body;
      return json({ error: `bad recipient ${got.recipient}` }, 422); // even echoed in the body
    });

    await POST(
      new Request('http://localhost/api/x', { method: 'POST', body: JSON.stringify(body) }),
    );

    const logged = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().map(String).join('\n');
    expect(logged).not.toBe('');
    for (const value of Object.values(body)) expect(logged).not.toContain(value);
    for (const key of Object.keys(body)) expect(logged).not.toContain(key);
  });

  it('never logs the thrown error message, only its name', async () => {
    const POST = withRoute<[Request?]>('POST /api/x', async (): Promise<Response> => {
      throw new RangeError('secret-bearing message SXYZ');
    });

    await POST(new Request('http://localhost/api/x', { method: 'POST' }));

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledOnce();
    const [line] = logLines();
    expect(line).toMatchObject({ status: 500, outcome: 'uncaught', errorName: 'RangeError' });
    expect(JSON.stringify(line)).not.toContain('SXYZ');
  });

  it('classifies 4xx as rejected (log) and a returned 5xx as error (error stream)', async () => {
    await withRoute('GET /api/a', () => json({ error: 'nope' }, 429))();
    await withRoute('GET /api/b', () => json({ error: 'upstream' }, 502))();

    expect(logSpy).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(logLines()).toEqual([
      expect.objectContaining({ route: 'GET /api/a', status: 429, outcome: 'rejected' }),
      expect.objectContaining({ route: 'GET /api/b', status: 502, outcome: 'error' }),
    ]);
  });
});

describe('json', () => {
  it('serializes with a JSON content type, 200 by default', async () => {
    const res = json({ a: 1 });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.json()).toEqual({ a: 1 });
    expect(json({ error: 'x' }, 418).status).toBe(418);
  });
});

describe('every /api/* route', () => {
  const API_DIR = path.resolve(__dirname, '../app/api');
  const routeFiles = (readdirSync(API_DIR, { recursive: true }) as string[])
    .filter((f) => path.basename(f) === 'route.ts')
    .map((f) => path.join(API_DIR, f));

  it('finds the route files', () => {
    expect(routeFiles.length).toBeGreaterThanOrEqual(8);
  });

  it.each(routeFiles.map((f) => [path.relative(API_DIR, f), f]))(
    '%s exports its handlers through withRoute, with no local json/logEvent',
    (_name, file) => {
      const src = readFileSync(file, 'utf8');
      expect(src).not.toMatch(
        /export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/,
      );
      expect(src).toMatch(/export const (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) = withRoute\(/);
      expect(src).not.toMatch(/function\s+(json|logEvent)\s*\(/);
    },
  );
});
