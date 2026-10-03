import { describe, it, expect } from 'vitest';
import {
  FREE_TRIAL_DAYS,
  accessEndsAt,
  gateCustomerAction,
  gateMenuWrite,
  gateOfferCreate,
  hoursUntilExpiry,
  isExpired,
  subscriptionPhase,
  withinExpiryWarning,
} from './subscription';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = new Date('2026-10-03T12:00:00.000Z');

/** A merchant nobody has granted a tier to — free trial from sign-up. */
function trialMerchant(signUpAgoMs = DAY) {
  return {
    subscriptionTier: 'FREE' as const,
    subscriptionExpiresAt: null,
    createdAt: new Date(NOW.getTime() - signUpAgoMs),
  };
}

function paidMerchant(expiresAt: Date | null, tier: 'MONTHLY' | 'YEARLY' | 'PREMIUM' = 'MONTHLY') {
  return { subscriptionTier: tier, subscriptionExpiresAt: expiresAt, createdAt: new Date('2026-01-01') };
}

describe('accessEndsAt', () => {
  it('granted expiry wins over the trial clock', () => {
    const end = new Date(NOW.getTime() + 10 * DAY);
    expect(accessEndsAt(paidMerchant(end)).getTime()).toBe(end.getTime());
  });

  it('falls back to sign-up + 3 days when nothing was granted', () => {
    const m = trialMerchant(DAY);
    expect(accessEndsAt(m).getTime()).toBe(m.createdAt.getTime() + FREE_TRIAL_DAYS * DAY);
  });

  it('accepts ISO strings (dates crossing a JSON boundary)', () => {
    const m = { ...trialMerchant(DAY), createdAt: trialMerchant(DAY).createdAt.toISOString() };
    expect(accessEndsAt(m)).toBeInstanceOf(Date);
  });
});

describe('subscriptionPhase', () => {
  it('a fresh signup is a TRIAL', () => {
    expect(subscriptionPhase(trialMerchant(HOUR), NOW)).toBe('TRIAL');
  });

  it('the trial flips to EXPIRED exactly at sign-up + 3 days', () => {
    const m = { ...trialMerchant(0), createdAt: new Date(NOW.getTime() - FREE_TRIAL_DAYS * DAY) };
    expect(subscriptionPhase(m, NOW)).toBe('EXPIRED');
    expect(isExpired(m, NOW)).toBe(true);
  });

  it('a paid merchant inside the window is ACTIVE, past it EXPIRED', () => {
    expect(subscriptionPhase(paidMerchant(new Date(NOW.getTime() + HOUR)), NOW)).toBe('ACTIVE');
    expect(subscriptionPhase(paidMerchant(new Date(NOW.getTime() - HOUR)), NOW)).toBe('EXPIRED');
  });

  it('a FREE tier granted an expiry is still a TRIAL', () => {
    const m = { subscriptionTier: 'FREE' as const, subscriptionExpiresAt: new Date(NOW.getTime() + DAY), createdAt: new Date('2026-01-01') };
    expect(subscriptionPhase(m, NOW)).toBe('TRIAL');
  });
});

describe('hoursUntilExpiry / withinExpiryWarning', () => {
  it('reports the remaining hours and the negative value once expired', () => {
    expect(hoursUntilExpiry(paidMerchant(new Date(NOW.getTime() + 6 * HOUR)), NOW)).toBe(6);
    expect(hoursUntilExpiry(paidMerchant(new Date(NOW.getTime() - 6 * HOUR)), NOW)).toBe(-6);
  });

  it('warns only inside the final 24h, never after expiry', () => {
    expect(withinExpiryWarning(paidMerchant(new Date(NOW.getTime() + 23 * HOUR)), NOW)).toBe(true);
    expect(withinExpiryWarning(paidMerchant(new Date(NOW.getTime() + 25 * HOUR)), NOW)).toBe(false);
    expect(withinExpiryWarning(paidMerchant(new Date(NOW.getTime() - HOUR)), NOW)).toBe(false);
  });
});

describe('gateOfferCreate', () => {
  it('expired merchants cannot create anything', () => {
    const gate = gateOfferCreate(paidMerchant(new Date(NOW.getTime() - 1)), 'SCRATCH', NOW);
    expect(gate).toMatchObject({ ok: false, code: 'SUBSCRIPTION_EXPIRED' });
  });

  it('the free trial may create scratch offers only', () => {
    const m = trialMerchant(HOUR);
    expect(gateOfferCreate(m, 'SCRATCH', NOW)).toEqual({ ok: true });
    expect(gateOfferCreate(m, 'STAMP', NOW)).toMatchObject({ ok: false, code: 'TIER_FEATURE_LOCKED' });
    expect(gateOfferCreate(m, 'DICE', NOW)).toMatchObject({ ok: false, code: 'TIER_FEATURE_LOCKED' });
  });

  it('a paid merchant may create every offer type', () => {
    const m = paidMerchant(new Date(NOW.getTime() + DAY));
    for (const type of ['STAMP', 'SCRATCH', 'DICE'] as const) {
      expect(gateOfferCreate(m, type, NOW)).toEqual({ ok: true });
    }
  });
});

describe('gateMenuWrite', () => {
  it('refuses the free trial (paid feature)', () => {
    expect(gateMenuWrite(trialMerchant(HOUR), NOW)).toMatchObject({ ok: false, code: 'TIER_FEATURE_LOCKED' });
  });

  it('refuses an expired merchant with the expiry code', () => {
    expect(gateMenuWrite(paidMerchant(new Date(NOW.getTime() - 1)), NOW)).toMatchObject({
      ok: false,
      code: 'SUBSCRIPTION_EXPIRED',
    });
  });

  it('allows a paid merchant', () => {
    expect(gateMenuWrite(paidMerchant(new Date(NOW.getTime() + DAY)), NOW)).toEqual({ ok: true });
  });
});

describe('gateCustomerAction (QR path)', () => {
  it('lets a trial merchant scan — QR codes work during the trial', () => {
    expect(gateCustomerAction(trialMerchant(HOUR), NOW)).toEqual({ ok: true });
  });

  it('disables the QR once expired, and re-enables it on renewal', () => {
    const m = paidMerchant(new Date(NOW.getTime() - HOUR));
    expect(gateCustomerAction(m, NOW)).toMatchObject({ ok: false, code: 'SUBSCRIPTION_EXPIRED' });
    expect(gateCustomerAction(paidMerchant(new Date(NOW.getTime() + HOUR)), NOW)).toEqual({ ok: true });
  });
});
