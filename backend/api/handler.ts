import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getSession, SessionPayload } from '@/backend/auth';
import { logger } from '@/backend/logger';
import { db } from '@/backend/db';
import type { Merchant } from '@prisma/client';
import { apiError } from './response';
import { adminPasswordConfigured } from '@/backend/admin';
import { authenticateDeviceApproval, DEVICE_PROOF_HEADER } from '@/backend/devices';

/** Next.js App Router dynamic-segment context ([id] / [offerId] routes).
 *  Next 15 resolves `params` asynchronously — always `await ctx.params`. */
export interface RouteContext {
  params: Promise<{ id?: string; offerId?: string }>;
}

export type AuthenticatedHandler = (
  req: NextRequest,
  session: SessionPayload,
  ctx: RouteContext
) => Promise<NextResponse>;

export type MerchantHandler = (
  req: NextRequest,
  session: SessionPayload,
  merchant: Merchant,
  ctx: RouteContext
) => Promise<NextResponse>;

export type CustomerHandler = (
  req: NextRequest,
  session: SessionPayload,
  /** Normalized (no `+88` prefix) phone identifying the customer. */
  customerPhone: string,
  ctx: RouteContext
) => Promise<NextResponse>;

/** Verified native-app identity attached by `withMerchantApp`. */
export interface DeviceIdentity {
  id: string;
  deviceName: string;
}

export type MerchantAppHandler = (
  req: NextRequest,
  session: SessionPayload,
  merchant: Merchant,
  device: DeviceIdentity,
  ctx: RouteContext
) => Promise<NextResponse>;

/**
 * P-03: request id for log correlation. Honors an upstream `x-request-id`
 * (Vercel/LB), else mints one. Never logged with PII — pair it with the
 * route + status, not with phones or tokens.
 */
export function getRequestId(req: NextRequest): string {
  return req.headers.get('x-request-id') || randomUUID();
}

export function withAuth(handler: AuthenticatedHandler) {
  return async (req: NextRequest, ctx: RouteContext): Promise<NextResponse> => {
    const requestId = getRequestId(req);
    try {
      const session = await getSession();
      if (!session) {
        return apiError('Unauthorized: Please sign in', 'UNAUTHORIZED', 401);
      }
      return await handler(req, session, ctx);
    } catch (error) {
      logger.error('API Error in protected route', { requestId, error });
      return apiError('Internal Server Error', 'INTERNAL_ERROR', 500, { requestId });
    }
  };
}

/**
 * Auth + super-admin guard for Phase 5 admin APIs.
 * 401 no session → 403 NOT_ADMIN (any non-admin session) → 503
 * ADMIN_NOT_CONFIGURED: unsetting ADMIN_PASSWORD revokes admin access
 * deployment-wide, even for tokens that were already issued.
 */
export function withAdmin(handler: AuthenticatedHandler) {
  return withAuth(async (req, session, ctx) => {
    if (session.role !== 'admin') {
      return apiError('Super admin access required.', 'NOT_ADMIN', 403);
    }
    if (!adminPasswordConfigured()) {
      return apiError(
        'Admin access is not configured on this deployment (set ADMIN_PASSWORD).',
        'ADMIN_NOT_CONFIGURED',
        503
      );
    }
    return handler(req, session, ctx);
  });
}

/**
 * Resolves the Merchant row for the current session.
 * Returns null when the session has no persisted profile yet
 * (fresh OTP session with userId `temp_…`, or profile not created).
 */
export async function getCurrentMerchant(session: SessionPayload): Promise<Merchant | null> {
  if (!session.userId || session.userId.startsWith('temp_')) return null;
  try {
    return await db.merchant.findFirst({
      where: { id: session.userId, deletedAt: null },
    });
  } catch (dbErr) {
    console.warn('Merchant lookup failed in getCurrentMerchant', dbErr);
    return null;
  }
}

/** Auth + merchant-profile guard for all Phase 2 merchant APIs. */
export function withMerchant(handler: MerchantHandler) {
  return withAuth(async (req, session, ctx) => {
    // Admin/customer sessions must never resolve as merchant sessions —
    // say so explicitly instead of falling through to the setup gate.
    if (session.role === 'admin') {
      return apiError(
        'This session is signed in as the platform admin.',
        'ADMIN_SESSION',
        403
      );
    }
    const merchant = await getCurrentMerchant(session);
    if (!merchant) {
      // A customer session must never be told to "complete business setup".
      if (session.role === 'customer') {
        return apiError(
          'This account is signed in as a customer, not a merchant.',
          'CUSTOMER_SESSION',
          403
        );
      }
      // Suspended (soft-deleted) merchants get an explicit error, not SETUP_REQUIRED.
      if (session.userId && !session.userId.startsWith('temp_')) {
        try {
          const suspended = await db.merchant.findFirst({
            where: { id: session.userId, deletedAt: { not: null } },
            select: { id: true },
          });
          if (suspended) {
            return apiError('This merchant account has been suspended.', 'ACCOUNT_SUSPENDED', 403);
          }
        } catch (dbErr) {
          console.warn('Suspension probe failed in withMerchant', dbErr);
        }
      }
      return apiError(
        'Merchant profile not found. Please complete business setup first.',
        'SETUP_REQUIRED',
        409
      );
    }
    return handler(req, session, merchant, ctx);
  });
}

/**
 * Phase 10: merchant guard that additionally requires a **signed proof from an
 * ACTIVE registered device**. This is the gate that makes approvals
 * app-only — a merchant web session has no device key, so it is rejected with
 * 403 `APP_APPROVAL_REQUIRED`.
 *
 * The signature is bound to `ctx.params`'s `id` (the ScanRequest being approved),
 * so a proof harvested for one check-in cannot be pointed at another.
 */
export function withMerchantApp(handler: MerchantAppHandler) {
  return withMerchant(async (req, session, merchant, ctx) => {
    const { id } = await ctx.params;
    const auth = await authenticateDeviceApproval({
      merchantId: merchant.id,
      targetId: id ?? '',
      header: req.headers.get(DEVICE_PROOF_HEADER),
    });
    if (!auth.ok) {
      return apiError(auth.failure.message, auth.failure.code, auth.failure.status);
    }
    return handler(req, session, merchant, auth.device, ctx);
  });
}

/** Session guard for Phase 3 customer APIs — identity is the phone number. */
export function withCustomer(handler: CustomerHandler, opts?: { requireName?: boolean }) {
  return withAuth(async (req, session, ctx) => {
    if (session.role === 'admin') {
      return apiError('Admin sessions cannot use customer endpoints.', 'ADMIN_SESSION', 403);
    }
    // Merchant sessions carry the verified email (fresh) or a real merchant
    // userId (post-setup) plus the shop phone — they must never act as a
    // customer with the shop's number. Customer sessions never have an email.
    if (session.role === 'merchant' || !!session.email) {
      return apiError(
        'This session is signed in as a merchant, not a customer.',
        'MERCHANT_SESSION',
        403
      );
    }
    const customerPhone = (session.phoneNumber || '').replace(/^\+88/, '');
    if (!customerPhone) {
      return apiError('Customer session has no phone number', 'UNAUTHORIZED', 401);
    }
    // Phase 11 invariant ("the merchant always knows who is asking") enforced
    // at the trust boundary, not per-route: state-changing customer routes opt
    // in; read-only routes (cards, offer context) stay name-free.
    if (opts?.requireName && !(session.name || '').trim()) {
      return apiError(
        'Please add your name before continuing — the shop needs to know who is asking.',
        'NAME_REQUIRED',
        422
      );
    }
    return handler(req, session, customerPhone, ctx);
  });
}
