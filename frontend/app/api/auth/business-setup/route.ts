import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/backend/api/response';
import { businessSetupSchema } from '@/backend/validation/schemas';
import { withAuth } from '@/backend/api/handler';
import { checkRateLimit, recordHit, clientIpKey, MUTATION_IP } from '@/backend/rateLimit';
import { db } from '@/backend/db';
import { createSessionToken, setAuthCookieHeader } from '@/backend/auth';

// POST /api/auth/business-setup — Completes merchant business profile setup.
//
// Identity is the verified session email (from POST /api/auth/session) —
// never a client-sent field. The phone number is collected contact data,
// not a verified identity, so there is no cross-check against the session.
export const POST = withAuth(async (req: NextRequest, session) => {
  // Pre-auth write surface (temp sessions included): throttle the IP so a
  // single client cannot spam merchant-row upserts.
  const ipKey = clientIpKey((n) => req.headers.get(n));
  const gate = checkRateLimit(`business-setup:${ipKey}`, MUTATION_IP);
  if (!gate.allowed) {
    return apiError('Too many attempts. Please wait a few minutes and try again.', 'RATE_LIMITED', 429, {
      retryAfterMs: gate.retryAfterMs,
    });
  }
  recordHit(`business-setup:${ipKey}`, MUTATION_IP);

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

    const { businessName, category, phoneNumber, logoUrl } = validation.data;
    const cleanPhone = phoneNumber.replace(/^\+88/, '');

    let merchant;
    try {
      merchant = await db.merchant.upsert({
        where: { email: sessionEmail },
        update: {
          businessName,
          category,
          phoneNumber: cleanPhone,
          logoUrl: logoUrl || null,
          ...(session.cognitoSub ? { cognitoSub: session.cognitoSub } : {}),
          ...(session.firebaseUid ? { firebaseUid: session.firebaseUid } : {}),
        },
        create: {
          email: sessionEmail,
          businessName,
          category,
          phoneNumber: cleanPhone,
          logoUrl: logoUrl || null,
          cognitoSub: session.cognitoSub ?? null,
          firebaseUid: session.firebaseUid ?? null,
          subscriptionStatus: 'PENDING',
        },
      });
    } catch (dbErr) {
      // Collected phone numbers can collide (shared shop line) — the unique
      // column rejects the second merchant instead of merging two businesses.
      if (
        typeof dbErr === 'object' &&
        dbErr !== null &&
        (dbErr as { code?: string }).code === 'P2002'
      ) {
        return apiError(
          'This phone number is already registered to another business',
          'PHONE_TAKEN',
          409
        );
      }
      console.error('DB upsert error in business-setup', dbErr);
      return apiError('Failed to save business profile — please try again', 'INTERNAL_ERROR', 500);
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
    console.error('Error in business-setup route:', error);
    return apiError('Failed to save business profile', 'INTERNAL_ERROR', 500);
  }
});
