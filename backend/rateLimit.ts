/**
 * backend/rateLimit.ts — throttle (SEC-02/ST-02).
 *
 * Two layers: the original in-memory fixed window (local dev, unit tests,
 * and fallback), plus `rateLimitGate` which prefers shared Redis so the
 * limit holds across Vercel instances. Redis errors always fall back to
 * memory — throttling degrades, requests never 500.
 */

export interface RateLimitRule {
  max: number;
  windowMs: number;
}

interface Window {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Window>();

/** Remove expired windows so the map cannot grow without bound. */
function sweep(now: number): void {
  for (const [key, win] of buckets) {
    if (win.resetAt <= now) buckets.delete(key);
  }
}

export function checkRateLimit(
  key: string,
  rule: RateLimitRule,
  now: number = Date.now()
): { allowed: boolean; retryAfterMs: number } {
  sweep(now);
  const win = buckets.get(key);
  if (!win) return { allowed: true, retryAfterMs: 0 };
  if (win.count >= rule.max) {
    return { allowed: false, retryAfterMs: Math.max(0, win.resetAt - now) };
  }
  return { allowed: true, retryAfterMs: 0 };
}

/** Counts one hit against `key`; call only after `checkRateLimit` allowed it. */
export function recordHit(key: string, rule: RateLimitRule, now: number = Date.now()): void {
  const win = buckets.get(key);
  if (!win || win.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    return;
  }
  win.count += 1;
}

/** Test/maintenance hook: how many live windows exist. */
export function rateLimitSize(now: number = Date.now()): number {
  sweep(now);
  return buckets.size;
}

/**
 * Shared async gate for route handlers: Redis first (cross-instance), the
 * in-memory window on miss/error. Single call — check + hit are atomic, so
 * concurrent requests cannot both slip under max.
 */
export async function rateLimitGate(
  key: string,
  rule: RateLimitRule,
  now: number = Date.now()
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  try {
    const { redisRateGate } = await import('./redis');
    const shared = await redisRateGate(key, rule.max, rule.windowMs);
    if (shared) return shared;
  } catch {
    // Fall through to memory.
  }
  const gate = checkRateLimit(key, rule, now);
  if (gate.allowed) recordHit(key, rule, now);
  return gate;
}

/**
 * Throttle key from request headers. Takes a getter (not NextRequest) so
 * this module stays free of `next/*` imports per CODIN §2.
 */
export function clientIpKey(getHeader: (name: string) => string | null): string {
  const forwarded = getHeader('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return `ip:${first}`;
  }
  return `ip:${getHeader('x-real-ip') || 'local'}`;
}

/** Email session minting (per IP — the email is unknown pre-verify). */
export const EMAIL_SESSION_IP: RateLimitRule = { max: 60, windowMs: 10 * 60 * 1000 };

/** Customer session minting (per IP — no verification step). */
export const CUSTOMER_SESSION_IP: RateLimitRule = { max: 60, windowMs: 10 * 60 * 1000 };

/** Paid checkout submissions (per merchant — 5MB screenshot writes + PENDING rows). */
export const CHECKOUT_MERCHANT: RateLimitRule = { max: 10, windowMs: 10 * 60 * 1000 };

/** OpenAI Vision extractions (per merchant — each hit is model spend). */
export const EXTRACT_MERCHANT: RateLimitRule = { max: 10, windowMs: 10 * 60 * 1000 };

/** Authenticated write endpoints (per merchant — DB-write spam brake). */
export const MUTATION_MERCHANT: RateLimitRule = { max: 60, windowMs: 10 * 60 * 1000 };

/** Pre-auth write endpoints (per IP — identity unknown or unverified). */
export const MUTATION_IP: RateLimitRule = { max: 30, windowMs: 10 * 60 * 1000 };
