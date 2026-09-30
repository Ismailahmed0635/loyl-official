/**
 * backend/rateLimit.ts — tiny in-memory throttle (SEC-02/ST-02).
 *
 * Same contract as the admin-login throttle in `backend/admin.ts`, extracted
 * so OTP send/verify (and later checkout/extract) share one implementation:
 * max hits per key per window, 429 + retryAfterMs on excess, expired windows
 * swept on every check so idle keys never accumulate (ST-02 fix).
 *
 * Single-instance scope, like the admin throttle: the effective limit is
 * `max × instanceCount` on a multi-instance deploy. OTP abuse is
 * cost-driven (SMS/OpenAI spend), so this is a spend brake, not a security
 * boundary — the security boundaries are the OTP entropy + expiry.
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
