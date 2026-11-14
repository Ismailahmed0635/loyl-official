import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/backend/api/response';
import { businessSetupSchema } from '@/backend/validation/schemas';
import { withAuth, getRequestId } from '@/backend/api/handler';
import { rateLimitGate, clientIpKey, MUTATION_IP } from '@/backend/rateLimit';
import { db } from '@/backend/db';
import { logger } from '@/backend/logger';
import { createSessionToken, setAuthCookieHeader } from '@/backend/auth';

// POST /api/auth/business-setup — Completes merchant business profile setup.
//
// Identity is the verified session email (from POST /api/auth/session) —
// never a client-sent field. The phone number is collected contact data,
// not a verified identity, so there is no cross-check against the session.
export const POST = withAuth(async (req: NextRequest, session) => {
  const requestId = getRequestId(req);
  // Pre-auth write surface (temp sessions included): throttle the IP so a
  // single client cannot spam merchant-row upserts.
  const ipKey = clientIpKey((n) => req.headers.get(n));
  const gate = await rateLimitGate(`business-setup:${ipKey}`, MUTATION_IP);
  if (!gate.allowed) {
    return apiError('Too many attempts. Please wait a few minutes and try again.', 'RATE_LIMITED', 429, {
      retryAfterMs: gate.retryAfterMs,
    });
  }

  try {
    // T-01: malformed JSON is a 422 (Zod rejects the null), never a 500.
    const body = await req.json().catch(() => null);
    const validation = businessSetupSchema.safeParse(body);

    if (!validation.success) {
      const issue = validation.error.issues[0]?.message || 'Invalid input';
      return apiError(issue, 'VALIDATION_ERROR', 422);
    }

    const sessionEmail = (session.email || '').trim().toLowerCase();
    if (!sessionEmail) {
      return apiError(
        'This session has no verified email — sign in with email and password first',
        'EMAIL_REQUIRED',
        403
      );
    }

    const { businessName, category, phoneNumber } = validation.data;
    const cleanPhone = phoneNumber.replace(/^\+88/, '');

    let merchant;
    try {
      // Drift-resilient RETURNING: only the columns this endpoint needs.
      // A deploy whose DB predates a newer Prisma field (e.g. `logoPath`)
      // would otherwise fail the whole upsert at read-back time with
      // INTERNAL_ERROR, even though the write itself touches none of it.
      // (Full sync still belongs in Supabase — see
      // `scripts/prod-business-setup-fix.sql`.)
      merchant = await db.merchant.upsert({
        where: { email: sessionEmail },
        update: {
          businessName,
          category,
          phoneNumber: cleanPhone,
          ...(session.cognitoSub ? { cognitoSub: session.cognitoSub } : {}),
          ...(session.firebaseUid ? { firebaseUid: session.firebaseUid } : {}),
        },
        create: {
          email: sessionEmail,
          businessName,
          category,
          phoneNumber: cleanPhone,
          cognitoSub: session.cognitoSub ?? null,
          firebaseUid: session.firebaseUid ?? null,
          subscriptionStatus: 'PENDING',
        },
        select: {
          id: true,
          email: true,
          businessName: true,
          category: true,
          phoneNumber: true,
          logoUrl: true,
          subscriptionStatus: true,
        },
      });
    } catch (dbErr) {
      // Collected phone numbers can collide (shared shop line) — the unique
      // column rejects the second merchant instead of merging two businesses.
      // P2002 carries the target field(s) in `meta.target`: only a
      // `phoneNumber` collision is PHONE_TAKEN. A firebaseUid/cognitoSub
      // collision means this sign-in already owns a business under a different
      // email — that is a distinct ACCOUNT_CONFLICT, never a phone error.
      if (
        typeof dbErr === 'object' &&
        dbErr !== null &&
        (dbErr as { code?: string }).code === 'P2002'
      ) {
        const target = JSON.stringify(
          (dbErr as { meta?: { target?: unknown } }).meta?.target ?? ''
        );
        if (/phoneNumber/i.test(target)) {
          return apiError(
            'This phone number is already registered to another business',
            'PHONE_TAKEN',
            409
          );
        }
        logger.warn('business-setup identity conflict', { requestId, target });
        return apiError(
          'This sign-in is already linked to another business — sign in with the original email instead',
          'ACCOUNT_CONFLICT',
          409,
          { requestId }
        );
      }
      logger.error('DB upsert error in business-setup', {
        requestId,
        code: (dbErr as { code?: unknown })?.code,
        meta: (dbErr as { meta?: unknown })?.meta,
        error: dbErr,
      });
      return apiError('Failed to save business profile — please try again', 'INTERNAL_ERROR', 500, {
        requestId,
      });
    }

    const newToken = await createSessionToken({
      userId: merchant.id,
      phoneNumber: cleanPhone,
      email: sessionEmail,
      ...(session.cognitoSub ? { cognitoSub: session.cognitoSub } : {}),
      ...(session.firebaseUid ? { firebaseUid: session.firebaseUid } : {}),
    });

    const response = NextResponse.json({
      success: true,
      data: {
        merchant,
        message: 'Business profile saved successfully',
      },
    });

    response.headers.append('Set-Cookie', setAuthCookieHeader(newToken));
    return response;
  } catch (error) {
    logger.error('Error in business-setup route:', { requestId, error });
    return apiError('Failed to save business profile', 'INTERNAL_ERROR', 500, { requestId });
  }
});
