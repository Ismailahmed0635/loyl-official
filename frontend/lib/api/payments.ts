// Phase 7 — merchant-facing billing client: plan catalog + checkout calls.
// Tiers mirror the landing pricing (all monthly): Free trial, Starter ৳500,
// Growth ৳1000, Enterprise custom.

export type BillingTier = 'FREE' | 'STARTER' | 'GROWTH' | 'ENTERPRISE';

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
    name: 'Free Trial',
    priceBdt: 0,
    durationDays: 3,
    blurb: 'Scratch-card offers for one shop — 3 days, then upgrade.',
  },
  {
    tier: 'STARTER',
    name: 'Starter',
    priceBdt: 500,
    durationDays: 30,
    blurb: 'All features incl. digital menu for a single shop, per month.',
  },
  {
    tier: 'GROWTH',
    name: 'Growth',
    priceBdt: 1000,
    durationDays: 30,
    blurb: 'Up to 3 branches + priority support, per month.',
  },
  {
    tier: 'ENTERPRISE',
    name: 'Enterprise',
    priceBdt: 0,
    durationDays: 30,
    blurb: 'Unlimited locations, custom price — contact us first.',
  },
];

export const TIER_LABELS: Record<BillingTier, string> = {
  FREE: 'Free Trial',
  STARTER: 'Starter',
  GROWTH: 'Growth',
  ENTERPRISE: 'Enterprise',
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
    /** Always set by the API: the real end of access (free trial included). */
    endsAt?: string;
    /** Derived now-state: free trial vs paid vs past expiry. */
    phase?: 'ACTIVE' | 'TRIAL' | 'EXPIRED';
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
