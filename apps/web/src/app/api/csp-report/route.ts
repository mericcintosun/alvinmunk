/**
 * POST /api/csp-report — the `report-uri` of the Content-Security-Policy (src/config/csp.mjs).
 * Browsers post violations here; it logs one line per violation — the directive and what
 * was blocked — and answers with an empty body (204 for a report, 400/413 for anything
 * else), so nothing it received is ever echoed.
 *
 * What is logged, and what never is, is decided in lib/csp-report.
 */
import { withRoute } from '@/lib/api-route';
import { MAX_CSP_REPORT_BYTES, parseCspReports } from '@/lib/csp-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noContent = (status: number) => new Response(null, { status });

export const POST = withRoute('POST /api/csp-report', async (req: Request) => {
  if (Number(req.headers.get('content-length') ?? 0) > MAX_CSP_REPORT_BYTES) return noContent(413);
  const text = await req.text();
  if (text.length > MAX_CSP_REPORT_BYTES) return noContent(413);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return noContent(400);
  }
  const violations = parseCspReports(body);
  if (violations.length === 0) return noContent(400);
  for (const v of violations) console.warn(JSON.stringify({ csp: 'violation', ...v }));
  return noContent(204);
});
