/**
 * Parsing for the CSP violation reports /api/csp-report receives — kept out of the route
 * file, which may only export route handlers.
 *
 * A report names the page it happened on, and a legacy claim link carries its secret in the
 * query (`?s=`, #78), so a logged page or script URL is cut to scheme + host + path (never a
 * query or fragment) and a blocked URL to its origin, which is all a policy source can
 * name. The referrer and the script sample (page source) are never read.
 */

/** A real report is well under 4 KB; anything past this is not one. */
export const MAX_CSP_REPORT_BYTES = 16_384;
/** Reporting API batches carry several; more than this in one POST is noise. */
const MAX_REPORTS = 10;

/** What gets logged for one violation. */
export interface CspViolation {
  directive: string;
  blocked?: string;
  document?: string;
  source?: string;
  line?: number;
  disposition?: 'enforce' | 'report';
}

const KEYWORD = /^[a-z][a-z0-9-]{0,39}$/i;

/** A logged form of a report URL: a bare keyword as is (`inline`, `eval`, `data`…), an
 *  http(s)/ws(s) URL as its origin (+ path when `withPath`), any other scheme as the
 *  scheme alone (`chrome-extension:`), and anything else dropped. */
function safeUrl(v: unknown, withPath: boolean): string | undefined {
  if (typeof v !== 'string' || !v) return undefined;
  if (KEYWORD.test(v)) return v;
  try {
    const u = new URL(v);
    if (!/^(https?|wss?):$/.test(u.protocol)) return u.protocol;
    return (withPath ? `${u.origin}${u.pathname}` : u.origin).slice(0, 200);
  } catch {
    return undefined;
  }
}

/** One violation from either report format, or null when it doesn't look like one. */
function violation(r: Record<string, unknown>): CspViolation | null {
  const directive = r['effective-directive'] ?? r['violated-directive'] ?? r.effectiveDirective;
  if (typeof directive !== 'string') return null;
  const name = directive.split(' ')[0];
  if (!KEYWORD.test(name)) return null;
  const line = r['line-number'] ?? r.lineNumber;
  const disposition = r.disposition;
  return {
    directive: name,
    blocked: safeUrl(r['blocked-uri'] ?? r.blockedURL, false),
    document: safeUrl(r['document-uri'] ?? r.documentURL, true),
    source: safeUrl(r['source-file'] ?? r.sourceFile, true),
    line: Number.isInteger(line) ? (line as number) : undefined,
    disposition: disposition === 'enforce' || disposition === 'report' ? disposition : undefined,
  };
}

/** The violations in a report body: the `report-uri` format (`{ "csp-report": {…} }`) or
 *  a Reporting API batch (`[{ type: "csp-violation", body: {…} }]`). */
export function parseCspReports(body: unknown): CspViolation[] {
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
  const raw = Array.isArray(body)
    ? body.filter((r) => isObj(r) && r.type === 'csp-violation').map((r) => r.body)
    : [isObj(body) ? body['csp-report'] : undefined];
  return raw
    .slice(0, MAX_REPORTS)
    .filter(isObj)
    .map(violation)
    .filter((v): v is CspViolation => v !== null);
}

