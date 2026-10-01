import { Redis } from '@upstash/redis';

export interface Report {
  id: string;
  target: string;
  vouchId?: number;
  reason: string;
  detail?: string;
  ts: number;
  resolved: boolean;
}

type KvStore = {
  getOpenReports: () => Promise<Report[]>;
  saveReport: (report: Report) => Promise<void>;
  markResolved: (id: string) => Promise<void>;
};

let cached: { url: string; token: string; store: KvStore | null } | null = null;

export function getReportKv(): KvStore | null {
  const url = process.env.KV_REST_API_URL ?? '';
  const token = process.env.KV_REST_API_TOKEN ?? '';
  if (!url && !token) return null;
  if (cached?.url !== url || cached.token !== token) {
    cached = { url, token, store: createKvStore(url, token) };
  }
  return cached.store;
}

const REPORT_SET_KEY = 'reports:open';

function createKvStore(url: string, token: string): KvStore | null {
  if (!url || !token) return null;
  let redis: Redis;
  try {
    redis = new Redis({ url, token });
  } catch {
    return null;
  }
  return {
    getOpenReports: async () => {
      const ids = await redis.smembers(REPORT_SET_KEY);
      if (!ids.length) return [];
      const reports = await Promise.all(ids.map(id => redis.get<Report>(`report:${id}`)));
      return reports.filter((r): r is Report => r !== null && !r.resolved);
    },
    saveReport: async (report: Report) => {
      await redis.set(`report:${report.id}`, report);
      await redis.sadd(REPORT_SET_KEY, report.id);
    },
    markResolved: async (id: string) => {
      const report = await redis.get<Report>(`report:${id}`);
      if (report) {
        report.resolved = true;
        await redis.set(`report:${id}`, report);
        await redis.srem(REPORT_SET_KEY, id);
      }
    }
  };
}

const memReports = new Map<string, Report>();

export async function saveReport(report: Report): Promise<void> {
  const kv = getReportKv();
  if (kv) {
    await kv.saveReport(report);
  } else {
    memReports.set(report.id, report);
  }
}

export async function getOpenReports(): Promise<Report[]> {
  const kv = getReportKv();
  if (kv) {
    return kv.getOpenReports();
  } else {
    return Array.from(memReports.values()).filter(r => !r.resolved);
  }
}

export async function resolveReport(id: string): Promise<void> {
  const kv = getReportKv();
  if (kv) {
    await kv.markResolved(id);
  } else {
    const r = memReports.get(id);
    if (r) {
      r.resolved = true;
      memReports.set(id, r);
    }
  }
}
