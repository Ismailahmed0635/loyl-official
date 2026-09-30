import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ADMIN_SESSION_TTL,
  SUBSCRIPTION_DAYS,
  LOGIN_MAX_ATTEMPTS,
  LOGIN_WINDOW_MS,
  adminPasswordConfigured,
  verifyAdminPassword,
  checkLoginAllowed,
  recordFailedLogin,
  clearFailedLogins,
  applySubscriptionAction,
} from './admin';

describe('Phase 5 admin password verification', () => {
  const ORIGINAL = process.env.ADMIN_PASSWORD;

  beforeEach(() => {
    clearFailedLogins('pw-test');
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = ORIGINAL;
  });

  it('reports unconfigured when ADMIN_PASSWORD is unset', () => {
    delete process.env.ADMIN_PASSWORD;
    expect(adminPasswordConfigured()).toBe(false);
    // Unconfigured must fail closed, never accept anything.
    expect(verifyAdminPassword('anything')).toBe(false);
    expect(verifyAdminPassword('')).toBe(false);
  });

  it('accepts only the exact configured password', () => {
    process.env.ADMIN_PASSWORD = 'correct-horse-battery';
    expect(adminPasswordConfigured()).toBe(true);
    expect(verifyAdminPassword('correct-horse-battery')).toBe(true);
    expect(verifyAdminPassword('correct-horse-battery ')).toBe(false); // trailing space
    expect(verifyAdminPassword('Correct-Horse-Battery')).toBe(false); // case-sensitive
    expect(verifyAdminPassword('correct-horse-batt ery')).toBe(false);
    expect(verifyAdminPassword('')).toBe(false);
  });
});

describe('Phase 5 admin login throttle', () => {
  it('allows attempts until the failure cap, then locks for the window', () => {
    const key = 'ip-1';
    const t0 = 1_000_000;
    clearFailedLogins(key);

    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
      expect(checkLoginAllowed(key, t0).allowed).toBe(true);
      recordFailedLogin(key, t0);
    }

    const locked = checkLoginAllowed(key, t0);
    expect(locked.allowed).toBe(false);
    expect(locked.retryAfterMs).toBe(LOGIN_WINDOW_MS);
    expect(checkLoginAllowed(key, t0 + LOGIN_WINDOW_MS - 1).allowed).toBe(false);
    expect(checkLoginAllowed(key, t0 + LOGIN_WINDOW_MS).allowed).toBe(true); // window elapsed
  });

  it('a successful login clears the failure counter', () => {
    const key = 'ip-2';
    const t0 = 2_000_000;
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) recordFailedLogin(key, t0);
    expect(checkLoginAllowed(key, t0).allowed).toBe(false);
    clearFailedLogins(key);
    expect(checkLoginAllowed(key, t0).allowed).toBe(true);
  });

  it('tracks windows independently per key', () => {
    const t0 = 3_000_000;
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) recordFailedLogin('ip-a', t0);
    expect(checkLoginAllowed('ip-a', t0).allowed).toBe(false);
    expect(checkLoginAllowed('ip-b', t0).allowed).toBe(true);
    clearFailedLogins('ip-a');
    clearFailedLogins('ip-b');
  });

  it('a stale window resets on the next check', () => {
    const key = 'ip-3';
    recordFailedLogin(key, 1000);
    expect(checkLoginAllowed(key, 1000 + LOGIN_WINDOW_MS + 1).allowed).toBe(true);
    // Counter reset — a fresh failure starts a new window at the new time.
    recordFailedLogin(key, 5_000_000);
    expect(checkLoginAllowed(key, 5_000_000 + LOGIN_WINDOW_MS - 1).allowed).toBe(true); // 1 < cap
  });
});

describe('Phase 5 merchant subscription actions', () => {
  const now = new Date('2026-09-24T12:00:00.000Z');
  const in30Days = new Date(now.getTime() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000);

  it('activate grants ACTIVE for 30 days (BUILD.md approval flow)', () => {
    expect(applySubscriptionAction('activate', now)).toEqual({
      subscriptionStatus: 'ACTIVE',
      subscriptionExpiresAt: in30Days,
    });
  });

  it('expire marks EXPIRED with expiry pinned to now', () => {
    expect(applySubscriptionAction('expire', now)).toEqual({
      subscriptionStatus: 'EXPIRED',
      subscriptionExpiresAt: now,
    });
  });

  it('revoke returns to PENDING with no expiry', () => {
    expect(applySubscriptionAction('revoke', now)).toEqual({
      subscriptionStatus: 'PENDING',
      subscriptionExpiresAt: null,
    });
  });

  it('suspend / restore toggle soft deletion only (subscription untouched)', () => {
    expect(applySubscriptionAction('suspend', now)).toEqual({ deletedAt: now });
    expect(applySubscriptionAction('restore', now)).toEqual({ deletedAt: null });
  });

  it('keeps the documented security constants', () => {
    expect(ADMIN_SESSION_TTL).toBe('12h');
    expect(SUBSCRIPTION_DAYS).toBe(30);
    expect(LOGIN_MAX_ATTEMPTS).toBe(5);
    expect(LOGIN_WINDOW_MS).toBe(60_000);
  });
});
