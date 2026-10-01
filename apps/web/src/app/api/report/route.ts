import { json, withRoute } from '../../../lib/api-route';
import { saveReport, getOpenReports, resolveReport, type Report } from '../../../lib/report-store';
import { createRateLimiter } from '../../../lib/rate-limit';

const rateLimited = createRateLimiter(5, 60_000); // 5 reports per minute per IP

export const POST = withRoute('POST /api/report', async (req: Request) => {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (rateLimited(ip, Date.now())) return json({ error: 'rate limited' }, 429);

  const bodyText = await req.text();
  if (bodyText.length > 2000) return json({ error: 'body too large' }, 413);

  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const { target, vouchId, reason, detail } = body;
  if (!target || !reason) return json({ error: 'missing fields' }, 400);

  const report: Report = {
    id: globalThis.crypto.randomUUID(),
    target,
    vouchId,
    reason,
    detail,
    ts: Date.now(),
    resolved: false
  };

  await saveReport(report);
  return json({ ok: true });
});

export const GET = withRoute('GET /api/report', async (req: Request) => {
  const reports = await getOpenReports();
  // Sort oldest first
  reports.sort((a, b) => a.ts - b.ts);
  return json({ reports });
});

export const PATCH = withRoute('PATCH /api/report', async (req: Request) => {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const { id } = body;
  if (!id) return json({ error: 'missing report id' }, 400);

  await resolveReport(id);
  return json({ ok: true });
});
