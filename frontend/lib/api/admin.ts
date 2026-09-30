import type {
  AdminLoginInput,
  AdminMerchantListInput,
  AdminPaymentListInput,
} from '@/backend/validation/schemas';

// --- Types -----------------------------------------------------------------

export interface AdminSubscriptionCounts {
  PENDING: number;
  ACTIVE: number;
  EXPIRED: number;
}

export interface AdminMerchantRow {
  id: string;
  businessName: string;
  category: string;
  phoneNumber: string;
  logoUrl?: string | null;
  websiteUrl?: string | null;
  subscriptionStatus: 'PENDING' | 'ACTIVE' | 'EXPIRED';
  subscriptionExpiresAt: string | null;
  createdAt: string;
  /** Soft-deleted (suspended) merchant — still listed for the admin. */
  suspended: boolean;
  _count?: {
    offers: number;
    branches: number;
    customerStamps: number;
    paymentRequests: number;
  };
}

export interface AdminMerchantsResponse {
  merchants: AdminMerchantRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  stats: { total: number; byStatus: AdminSubscriptionCounts; suspended: number };
}

export interface AdminPaymentRow {
  id: string;
  merchantId: string;
  paymentMethod: 'BKASH' | 'NAGAD';
  senderNumber: string | null;
  trxId: string | null;
  amount: number;
  /** Phase 7: tier the merchant asked for (admin can override on approve). */
  requestedTier: AdminTier;
  /** Phase 7: a screenshot is attached only until the request is reviewed. */
  hasScreenshot: boolean;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  merchant: { businessName: string; phoneNumber: string; subscriptionStatus: string };
}

/** Tiers an approval can grant (mirrors backend SUBSCRIPTION_TIERS). */
export type AdminTier = 'FREE' | 'MONTHLY' | 'YEARLY' | 'PREMIUM';

export interface AdminPaymentsResponse {
  payments: AdminPaymentRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  stats: { counts: Record<string, number>; pendingAmount: number };
}

export interface AdminStats {
  merchants: {
    total: number;
    suspended: number;
    subscriptions: AdminSubscriptionCounts;
    signupsLast7d: number;
  };
  platform: { offers: number; branches: number; customerCards: number; scansLast7d: number };
  payments: {
    counts: Record<string, number>;
    pendingAmount: number;
    approvedAmount: number;
  };
  recentMerchants: AdminMerchantRow[];
  recentPayments: AdminPaymentRow[];
}

// --- Helpers ---------------------------------------------------------------

/** fetch() has no default timeout — bound every wrapper so pages can't hang. */
const API_TIMEOUT_MS = 15_000;

async function request(path: string, init?: RequestInit) {
  const res = await fetch(path, { ...init, signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  return res.json();
}

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const out = search.toString();
  return out ? `?${out}` : '';
}

/** Error codes that mean "the admin session is gone" → bounce to /admin/login. */
export const ADMIN_SESSION_ERRORS = ['UNAUTHORIZED', 'NOT_ADMIN', 'ADMIN_NOT_CONFIGURED'];

// --- Auth ------------------------------------------------------------------

export async function adminLogin(data: AdminLoginInput) {
  return request('/api/admin/login', json('POST', data));
}

export async function getAdminSession() {
  return request('/api/admin/session');
}

// --- Dashboard -------------------------------------------------------------

export async function getAdminStats() {
  return request('/api/admin/stats');
}

// --- Merchants -------------------------------------------------------------

export async function listAdminMerchants(params: AdminMerchantListInput) {
  return request(`/api/admin/merchants${qs(params)}`);
}

export async function adminMerchantAction(
  id: string,
  action: 'activate' | 'expire' | 'revoke' | 'suspend' | 'restore'
) {
  return request(`/api/admin/merchants/${id}`, json('PATCH', { action }));
}

// --- Billing ---------------------------------------------------------------

export async function listAdminPayments(params: AdminPaymentListInput) {
  return request(`/api/admin/payments${qs(params)}`);
}

export async function approvePayment(paymentRequestId: string, tier?: AdminTier) {
  return request(
    '/api/admin/approve-payment',
    json('POST', tier ? { paymentRequestId, tier } : { paymentRequestId })
  );
}

export async function rejectPayment(paymentRequestId: string) {
  return request('/api/admin/reject-payment', json('POST', { paymentRequestId }));
}

/** Streams the transaction screenshot for review; null when unavailable. */
export async function fetchPaymentScreenshot(paymentRequestId: string): Promise<Blob | null> {
  const res = await fetch(`/api/admin/payments/${paymentRequestId}/screenshot`);
  if (!res.ok) return null;
  return res.blob();
}

// --- Formatting ------------------------------------------------------------

/** ৳ BDT amounts, e.g. 1500 → ৳1,500. */
export function formatBdt(amount: number): string {
  return `৳${amount.toLocaleString('en-US')}`;
}

/** ISO day for compact table cells (createdAt → 2026-09-24). */
export function isoDay(value: string): string {
  return value.slice(0, 10);
}
