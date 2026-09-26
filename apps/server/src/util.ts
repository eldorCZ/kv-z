import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const newId = (bytes = 12) => randomBytes(bytes).toString('base64url');
export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
export const hmac = (key: string, data: string) => createHmac('sha256', key).update(data).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function randomPin(length: number): string {
  let s = String(randomInt(1, 10));
  while (s.length < length) s += String(randomInt(0, 10));
  return s;
}

/** Deterministic JSON (sorted keys) used for request hashing. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** Simple fixed-window in-memory rate limiter (single instance – see README). */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Returns 0 when allowed, otherwise seconds until the window resets. */
  hit(key: string, now = Date.now()): number {
    let e = this.hits.get(key);
    if (!e || e.resetAt <= now) {
      e = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, e);
      if (this.hits.size > 10_000) this.sweep(now);
    }
    e.count++;
    return e.count > this.limit ? Math.ceil((e.resetAt - now) / 1000) : 0;
  }

  private sweep(now: number) {
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }
}
