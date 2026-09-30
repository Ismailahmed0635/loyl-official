import { describe, it, expect } from 'vitest';
import {
  checkRateLimit,
  recordHit,
  rateLimitSize,
  clientIpKey,
  EMAIL_SESSION_IP,
  CHECKOUT_MERCHANT,
  EXTRACT_MERCHANT,
} from './rateLimit';

describe('rateLimit throttle (SEC-02/ST-02)', () => {
  it('allows hits under max, denies at max with retryAfterMs', () => {
    const rule = { max: 2, windowMs: 60_000 };
    const now = Date.now();
    expect(checkRateLimit('k1', rule, now).allowed).toBe(true);
    recordHit('k1', rule, now);
    expect(checkRateLimit('k1', rule, now).allowed).toBe(true);
    recordHit('k1', rule, now);
    const denied = checkRateLimit('k1', rule, now);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect(denied.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it('re-allows after the window passes', () => {
    const rule = { max: 1, windowMs: 1_000 };
    const now = Date.now();
    recordHit('k2', rule, now);
    expect(checkRateLimit('k2', rule, now).allowed).toBe(false);
    expect(checkRateLimit('k2', rule, now + 1_001).allowed).toBe(true);
  });

  it('sweeps expired windows so idle keys never accumulate', () => {
    const rule = { max: 1, windowMs: 1_000 };
    const now = Date.now();
    recordHit('sweep-a', rule, now);
    recordHit('sweep-b', rule, now);
    expect(rateLimitSize(now)).toBeGreaterThanOrEqual(2);
    expect(rateLimitSize(now + 60_000)).toBe(0);
  });

  it('derives the throttle key from x-forwarded-for first hop', () => {
    const get = (n: string) =>
      n === 'x-forwarded-for' ? '1.2.3.4, 5.6.7.8' : null;
    expect(clientIpKey(get)).toBe('ip:1.2.3.4');
    expect(clientIpKey(() => null)).toBe('ip:local');
  });

  it('EMAIL_SESSION_IP preset is 60 per 10 minutes', () => {
    expect(EMAIL_SESSION_IP).toEqual({ max: 60, windowMs: 600_000 });
  });

  it('CHECKOUT/EXTRACT presets trip at max (spend brake)', () => {
    expect(CHECKOUT_MERCHANT).toEqual({ max: 10, windowMs: 600_000 });
    expect(EXTRACT_MERCHANT).toEqual({ max: 10, windowMs: 600_000 });
    const now = Date.now();
    for (let i = 0; i < CHECKOUT_MERCHANT.max; i++) {
      expect(checkRateLimit('checkout:m1', CHECKOUT_MERCHANT, now).allowed).toBe(true);
      recordHit('checkout:m1', CHECKOUT_MERCHANT, now);
    }
    const denied = checkRateLimit('checkout:m1', CHECKOUT_MERCHANT, now);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });
});
