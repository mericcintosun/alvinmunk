/**
 * The one wrapper every /api/* route handler goes through (#183), so errors and logs are
 * handled the same way everywhere:
 *   - each request gets an id — Vercel's `x-vercel-id` when present, else a random UUID —
 *     returned as `x-request-id` on EVERY response, so a user's report can be matched to
 *     its log line;
 *   - anything the handler throws becomes a JSON 500 `{ error: 'internal error', requestId }`
 *     instead of Next's HTML error page, without leaking the cause to the client;
 *   - exactly one structured log line per request: `{ t, route, requestId, status, ms,
 *     outcome }` (plus `errorName` for a throw). Only what the wrapper measured is logged —
 *     never request bodies, XDR, addresses, secrets or error messages (an RPC error can
 *     carry a keyed RPC URL).
 * Handlers keep their own responses and status codes; the wrapper only adds the header.
 */

export const REQUEST_ID_HEADER = 'x-request-id';
const VERCEL_ID_HEADER = 'x-vercel-id';
// Vercel ids look like "fra1::iad1::abcde-1700000000000-0123456789ab". Anything else in
// that header (a client can send it when not behind Vercel) is replaced, never echoed.
const SAFE_ID = /^[\w:.-]{1,128}$/;

/** `ok` < 400, `rejected` 4xx, `error` 5xx returned by the handler, `uncaught` a throw. */
export type RouteOutcome = 'ok' | 'rejected' | 'error' | 'uncaught';

export interface RouteLogLine {
  t: string;
  route: string;
  requestId: string;
  status: number;
  ms: number;
  outcome: RouteOutcome;
  errorName?: string;
}

/** A JSON response — the shared replacement for the per-route `json` helpers. */
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** The request id for `req`: a well-formed `x-vercel-id`, else a fresh UUID. */
export function requestIdFor(req: unknown): string {
  // Duck-typed: handlers get a Request or NextRequest, and tests pass header-only stand-ins.
  const headers = (req as { headers?: { get?: (name: string) => string | null } } | undefined)
    ?.headers;
  const incoming = typeof headers?.get === 'function' ? headers.get(VERCEL_ID_HEADER) : null;
  return incoming && SAFE_ID.test(incoming) ? incoming : globalThis.crypto.randomUUID();
}

function outcomeFor(status: number): RouteOutcome {
  if (status >= 500) return 'error';
  return status >= 400 ? 'rejected' : 'ok';
}

function withRequestId(res: Response, requestId: string): Response {
  try {
    res.headers.set(REQUEST_ID_HEADER, requestId);
    return res;
  } catch {
    // Immutable headers (Response.redirect, a proxied fetch response): copy the response.
    const copy = new Response(res.body, res);
    copy.headers.set(REQUEST_ID_HEADER, requestId);
    return copy;
  }
}

function log(line: RouteLogLine): void {
  const text = JSON.stringify(line);
  if (line.status >= 500) console.error(text);
  else console.log(text);
}

/**
 * Wrap a route handler. `route` names it in the log line, e.g. `'POST /api/attest'`. The
 * wrapped function keeps the handler's parameters, so Next and the tests call it as before.
 */
export function withRoute<A extends unknown[]>(
  route: string,
  handler: (...args: A) => Response | Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A): Promise<Response> => {
    const started = Date.now();
    const requestId = requestIdFor(args[0]);
    let res: Response;
    let errorName: string | undefined;
    try {
      res = await handler(...args);
    } catch (e) {
      errorName = e instanceof Error ? e.name : typeof e;
      res = json({ error: 'internal error', requestId }, 500);
    }
    log({
      t: new Date().toISOString(),
      route,
      requestId,
      status: res.status,
      ms: Date.now() - started,
      outcome: errorName === undefined ? outcomeFor(res.status) : 'uncaught',
      ...(errorName === undefined ? {} : { errorName }),
    });
    return withRequestId(res, requestId);
  };
}
