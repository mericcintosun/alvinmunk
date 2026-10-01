export function createRateLimiter(maxHits: number, windowMs: number) {
  const hits = new Map<string, { n: number; resetAt: number }>();

  return function rateLimited(ip: string, now: number): boolean {
    const h = hits.get(ip);
    if (!h || now > h.resetAt) {
      hits.set(ip, { n: 1, resetAt: now + windowMs });
      return false;
    }
    h.n += 1;
    return h.n > maxHits;
  };
}
