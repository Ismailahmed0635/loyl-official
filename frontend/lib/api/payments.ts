// Phase 7 — merchant-facing billing client: plan catalog + checkout calls.

export type BillingTier = 'FREE' | 'MONTHLY' | 'YEARLY' | 'PREMIUM';

export interface BillingPlan {
  tier: BillingTier;
  name: string;
  /** MVP price table — the server enforces the same amounts on submit. */
  priceBdt: number;
  durationDays: number | null;
  blurb: string;
}

export const PLANS: BillingPlan[] = [
  {
    tier: 'FREE',
    name: 'Free Tier',
    priceBdt: 0,
    durationDays: null,
    blurb: 'Core features with no expiry — request access, we review it manually.',
  },
  {
    tier: 'MONTHLY',
    name: '1 Month',
    priceBdt: 500,
    durationDays: 30,
    blurb: 'Full access for 30 days.',
  },
  {
    tier: 'YEARLY',
    name: '1 Year',
    priceBdt: 5000,
    durationDays: 365,
    blurb: 'Full access for a year — two months free vs monthly.',
  },
  {
    tier: 'PREMIUM',
    name: 'Premium',
    priceBdt: 10000,
    durationDays: 365,
    blurb: 'A year of Premium perks and priority support.',
  },
];

export const TIER_LABELS: Record<BillingTier, string> = {
  FREE: 'Free',
  MONTHLY: '1 Month',
  YEARLY: '1 Year',
  PREMIUM: 'Premium',
};

export function planFor(tier: BillingTier): BillingPlan {
  return PLANS.find((plan) => plan.tier === tier) ?? PLANS[0];
}

/** Personal receive numbers shown in the checkout modal (set in .env.local). */
export const BKASH_NUMBER = process.env.NEXT_PUBLIC_BKASH_NUMBER || 'bKash number not configured';
export const NAGAD_NUMBER = process.env.NEXT_PUBLIC_NAGAD_NUMBER || 'Nagad number not configured';

export type BillingRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface BillingRequest {
  id: string;
  status: BillingRequestStatus;
  requestedTier: BillingTier;
  paymentMethod: 'BKASH' | 'NAGAD';
  senderNumber: string | null;
  trxId: string | null;
  amount: number;
  createdAt: string;
  hasScreenshot: boolean;
}

export interface BillingResponse {
  subscription: {
    status: 'PENDING' | 'ACTIVE' | 'EXPIRED';
    tier: BillingTier;
    expiresAt: string | null;
  };
  pending: BillingRequest | null;
  requests: BillingRequest[];
}

export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; data?: Record<string, unknown> };
}

export async function getBilling(): Promise<ApiEnvelope<BillingResponse>> {
  const res = await fetch('/api/billing');
  return res.json();
}

/** Multipart submit — do NOT set Content-Type; the browser adds the boundary. */
export async function submitCheckout(form: FormData): Promise<ApiEnvelope<{ request: BillingRequest }>> {
  const res = await fetch('/api/billing/checkout', { method: 'POST', body: form });
  return res.json();
}

/** Client-side mirror of the server's upload rules (server re-validates). */
export const CLIENT_SCREENSHOT_RULES = {
  maxBytes: 5 * 1024 * 1024,
  accept: 'image/png,image/jpeg,image/webp,image/gif',
};

export function screenshotClientCheck(file: File): string | null {
  if (!CLIENT_SCREENSHOT_RULES.accept.split(',').includes(file.type)) {
    return 'Screenshot must be a PNG, JPEG, WebP or GIF image.';
  }
  if (file.size > CLIENT_SCREENSHOT_RULES.maxBytes) {
    return 'Screenshot must be 5MB or smaller.';
  }
  return null;
}
