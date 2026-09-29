import { withRoute } from '@/lib/api-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withRoute('GET /api/ready', (): Response => {
  return new Response('ok', { status: 200 });
});
