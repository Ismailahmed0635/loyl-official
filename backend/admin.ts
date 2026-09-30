import { createHash, timingSafeEqual } from 'crypto';
import { MERCHANT_ACTIONS } from '@/backend/validation/schemas';

// --- Phase 5: Admin Panel ----------------------------------------------------
//
// The super admin authenticates with a dedicated password (ADMIN_PASSWORD env
// var) through POST /api/admin/login — completely separate from merchant
// email sign-in, so admin access never depends on Firebase being live.
// Security properties:
//   * Timing-safe compare (SHA-256 both sides, then timingSafeEqual).
//   * Per-IP failed-attempt throttle (5 failures / 60s → 429 with Retry-After).
//   * Admin sessions are short-lived (12h vs. the 30d merchant session).
//   * withAdmin re-checks adminPasswordConfigured() on every request, so
//     removing ADMIN_PASSWORD revokes admin access deployment-wide.
//   * The client can never mint an admin session: verifyOtpSchema.role is an
//     enum of merchant|customer, and /api/admin/login derives role server-side.

/** Admin sessions live 12 hours (merchant/customer sessions live 30 days). */
export const ADMIN_SESSION_TTL = '12h';

/** BUILD.md: approving a payment activates the merchant's subscription for 30 days. */
export const SUBSCRIPTION_DAYS = 30;

/** Failed-login throttle: 5 wrong passwords per key per 60s window. */
export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_WINDOW_MS = 60_000;

export type MerchantAction = (typeof MERCHANT_ACTIONS)[number];

/** Admin login (and withAdmin) are disabled until ADMIN_PASSWORD is set. */
export function adminPasswordConfigured(): boolean {
  return (process.env.ADMIN_PASSWORD || '').length > 0;
}

/**
 * Timing-safe password check. Both sides are hashed (with a domain-separation
 * prefix) so timingSafeEqual always receives equal-length buffers — no length
 * leak, no early exit on mismatch.
 */
export function verifyAdminPassword(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  const a = createHash('sha256').update(`loyl-admin-pw:${input}`).digest();
  const b = createHash('sha256').update(`loyl-admin-pw:${expected}`).digest();
  return timingSafeEqual(a, b);
}

interface AttemptWindow {
  count: number;
  resetAt: number;
}

/**
 * Module-level throttle (per server instance — in a multi-instance serverless
 * deployment each instance counts separately; acceptable for a single-admin
 * login that is also timing-safe and rate-limited at the platform edge).
 */
const attempts = new Map<string, AttemptWindow>();

/** True while the key has fewer than LOGIN_MAX_ATTEMPTS failures in-window. */
export function checkLoginAllowed(
  key: string,
  now: number = Date.now()
): { allowed: boolean; retryAfterMs: number } {
  // ST-02: sweep expired windows so idle keys never accumulate.
  for (const [k, w] of attempts) {
    if (w.resetAt <= now) attempts.delete(k);
  }
  const win = attempts.get(key);
  if (!win) return { allowed: true, retryAfterMs: 0 };
  if (win.resetAt <= now) {
    attempts.delete(key);
    return { allowed: true, retryAfterMs: 0 };
  }
  if (win.count >= LOGIN_MAX_ATTEMPTS) {
    return { allowed: false, retryAfterMs: win.resetAt - now };
  }
  return { allowed: true, retryAfterMs: 0 };
}

/** Counts one failed password guess against `key`. */
export function recordFailedLogin(key: string, now: number = Date.now()): void {
  const win = attempts.get(key);
  if (!win || win.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  win.count += 1;
}

/** Called after a successful login so the next session starts clean. */
export function clearFailedLogins(key: string): void {
  attempts.delete(key);
}

/** Prisma-shaped partial update for one admin merchant action. */
export interface MerchantUpdatePatch {
  subscriptionStatus?: 'PENDING' | 'ACTIVE' | 'EXPIRED';
  subscriptionExpiresAt?: Date | null;
  deletedAt?: Date | null;
}

/**
 * Prisma `groupBy` `_count` results type loosely in some client versions
 * (`number | { _all: number } | true | undefined`) — normalize to a number.
 */
export function groupByCount(count: unknown): number {
  if (typeof count === 'number') return count;
  if (count && typeof count === 'object') {
    const all = (count as { _all?: unknown })._all;
    if (typeof all === 'number') return all;
  }
  return 0;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Maps an admin action to the columns it changes:
 *   activate — ACTIVE + expiry = now + 30 days (BUILD.md approval flow)
 *   expire   — EXPIRED, expiry pinned to now
 *   revoke   — back to PENDING, expiry cleared
 *   suspend  — soft delete (Merchant.deletedAt); subscription fields untouched
 *   restore  — clears the soft delete only
 */
export function applySubscriptionAction(action: MerchantAction, now: Date = new Date()): MerchantUpdatePatch {
  switch (action) {
    case 'activate':
      return {
        subscriptionStatus: 'ACTIVE',
        subscriptionExpiresAt: new Date(now.getTime() + SUBSCRIPTION_DAYS * DAY_MS),
      };
    case 'expire':
      return { subscriptionStatus: 'EXPIRED', subscriptionExpiresAt: now };
    case 'revoke':
      return { subscriptionStatus: 'PENDING', subscriptionExpiresAt: null };
    case 'suspend':
      return { deletedAt: now };
    case 'restore':
      return { deletedAt: null };
  }
}
