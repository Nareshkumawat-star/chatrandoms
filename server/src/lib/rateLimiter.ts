type Bucket = { count: number; resetAt: number; last: number };

const buckets = new Map<string, Bucket>();

// Periodically clean stale buckets to avoid unbounded growth.
const CLEANUP_INTERVAL_MS = 60_000;
const MAX_BUCKETS = 20_000;

export function hit(
  key: string,
  limit: number,
  windowMs: number
): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs, last: now });
    return { ok: true, retryAfterMs: 0 };
  }
  b.last = now;
  b.count += 1;
  if (b.count > limit) {
    return { ok: false, retryAfterMs: b.resetAt - now };
  }
  return { ok: true, retryAfterMs: 0 };
}

export function penalize(key: string, ms: number): void {
  const now = Date.now();
  const b = buckets.get(key);
  if (b) {
    b.resetAt = Math.max(b.resetAt, now + ms);
  } else {
    buckets.set(key, { count: 0, resetAt: now + ms, last: now });
  }
}

export function cooldownUntil(key: string): number {
  const b = buckets.get(key);
  return b && b.resetAt > Date.now() ? b.resetAt : 0;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now > b.resetAt + 5 * 60_000) buckets.delete(k);
  }
  if (buckets.size > MAX_BUCKETS) {
    const entries = [...buckets.entries()].sort((a, b) => a[1].last - b[1].last);
    for (let i = 0; i < entries.length - MAX_BUCKETS; i++) buckets.delete(entries[i][0]);
  }
}, CLEANUP_INTERVAL_MS).unref();
