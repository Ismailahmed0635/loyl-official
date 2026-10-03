import type { SubscriptionTier } from '@prisma/client';

/**
 * Subscription access rules (manual bKash/Nagad approval model).
 *
 * There is no payment gateway: the merchant pays the shop owner's bKash/Nagad
 * number, submits a request from /billing, and the admin grants a tier. This
 * module owns what a granted tier actually *buys*, as pure functions so both
 * the server guards and the dashboard banner read the same clock.
 *
 * Policy (owner decision, 2026-10-03):
 *  - FREE is a 3-DAY TRIAL limited to scratch card offers.
 *  - Expired merchants keep every page (no route block) but cannot create
 *    offers or a digital menu, and their existing QR codes stop working.
 *  - Renewing re-enables both immediately (nothing is deleted).
 *  - Everyone is warned 24h before access ends.
 */

/** Free tier length: a 3-day trial, not an unlimited plan. */
export const FREE_TRIAL_DAYS = 3;
/** How long before expiry the warning banner appears. */
export const EXPIRY_WARNING_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The subscription columns any caller already has (dates may arrive as ISO strings). */
export interface SubscriptionSnapshot {
  subscriptionTier: SubscriptionTier;
  subscriptionExpiresAt: Date | string | null;
  createdAt: Date | string;
}

/** ACTIVE = paid and in date · TRIAL = free trial running · EXPIRED = locked down. */
export type SubscriptionPhase = 'ACTIVE' | 'TRIAL' | 'EXPIRED';

/** Stable error codes returned by the gates below (CODIN §3). */
export type GateCode = 'SUBSCRIPTION_EXPIRED' | 'TIER_FEATURE_LOCKED';

export type Gate = { ok: true } | { ok: false; code: GateCode; message: string };

const toDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));

/**
 * When access ends.
 *
 * A granted expiry always wins. `subscriptionExpiresAt` is null only for a
 * merchant nobody has granted a tier to yet — they are on the free trial
 * clock, counted from sign-up.
 */
export function accessEndsAt(m: SubscriptionSnapshot): Date {
  if (m.subscriptionExpiresAt) return toDate(m.subscriptionExpiresAt);
  return new Date(toDate(m.createdAt).getTime() + FREE_TRIAL_DAYS * DAY_MS);
}

export function subscriptionPhase(m: SubscriptionSnapshot, now: Date = new Date()): SubscriptionPhase {
  if (now.getTime() >= accessEndsAt(m).getTime()) return 'EXPIRED';
  return m.subscriptionTier === 'FREE' ? 'TRIAL' : 'ACTIVE';
}

export function isExpired(m: SubscriptionSnapshot, now: Date = new Date()): boolean {
  return subscriptionPhase(m, now) === 'EXPIRED';
}

/** Negative once past expiry — the banner renders "expired" from the same number. */
export function hoursUntilExpiry(m: SubscriptionSnapshot, now: Date = new Date()): number {
  return (accessEndsAt(m).getTime() - now.getTime()) / 3_600_000;
}

/** True inside the final 24h window (and not already expired). */
export function withinExpiryWarning(m: SubscriptionSnapshot, now: Date = new Date()): boolean {
  const left = hoursUntilExpiry(m, now);
  return left > 0 && left <= EXPIRY_WARNING_MS / 3_600_000;
}

function expiredGate(action: string): Gate {
  return {
    ok: false,
    code: 'SUBSCRIPTION_EXPIRED',
    message: `This shop's subscription has expired. Renew the plan to ${action}.`,
  };
}

/**
 * Creating an offer: expired = no; free trial = scratch cards only.
 * Reading and editing existing offers stays open (spec: pages never block).
 */
export function gateOfferCreate(
  m: SubscriptionSnapshot,
  offerType: 'STAMP' | 'SCRATCH' | 'DICE',
  now: Date = new Date()
): Gate {
  if (isExpired(m, now)) return expiredGate('create offers');
  if (m.subscriptionTier === 'FREE' && offerType !== 'SCRATCH') {
    return {
      ok: false,
      code: 'TIER_FEATURE_LOCKED',
      message:
        'The free trial only includes scratch card offers. Upgrade your plan to create stamp or dice offers.',
    };
  }
  return { ok: true };
}

/** Digital menu (create/edit/upload/extract): a paid feature — free and expired both refuse. */
export function gateMenuWrite(m: SubscriptionSnapshot, now: Date = new Date()): Gate {
  if (isExpired(m, now)) return expiredGate('use the digital menu card');
  if (m.subscriptionTier === 'FREE') {
    return {
      ok: false,
      code: 'TIER_FEATURE_LOCKED',
      message: 'The digital menu card is a paid feature. Upgrade your plan to use it.',
    };
  }
  return { ok: true };
}

/**
 * Customer-side (QR path): only expiry bites, so a trial merchant's codes work.
 * Read-only customer endpoints are deliberately not gated — this is about the
 * stamp/scratch/dice/redeem actions a QR code starts.
 */
export function gateCustomerAction(m: SubscriptionSnapshot, now: Date = new Date()): Gate {
  if (isExpired(m, now)) {
    return {
      ok: false,
      code: 'SUBSCRIPTION_EXPIRED',
      message: "This shop's subscription has expired, so its QR code is temporarily disabled.",
    };
  }
  return { ok: true };
}
