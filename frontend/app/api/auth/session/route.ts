import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/backend/api/response';
import { emailSessionSchema } from '@/backend/validation/schemas';
import { verifyFirebaseIdToken, isFirebaseConfigured } from '@/backend/firebase';
import {
  checkRateLimit,
  recordHit,
  clientIpKey,
  EMAIL_SESSION_IP,
} from '@/backend/rateLimit';
import { db } from '@/backend/db';
import { createSessionToken, setAuthCookieHeader } from '@/backend/auth';

// POST /api/auth/session — Email/password sign-in (the app's auth method).
//
// The client signs in with the Firebase Web SDK and POSTs the ID token. The
// server verifies it with the Admin SDK (public-certs only — no private key
// needed) and mints the `loyl_session` JWT keyed on the verified email.
// Phone numbers are collected data only; there is no OTP step anywhere.
//
// Response data: { isExistingMerchant, email, merchant } — the client routes
// to /dashboard when a merchant row exists, /business-setup otherwise.
export async function POST(req: NextRequest) {
  try {
    // T-01: malformed JSON is a 422, never a 500.
    const body = await req.json().catch(() => null);
    const validation = emailSessionSchema.safeParse(body);
    if (!validation.success) {
      const issue = validation.error.issues[0]?.message || 'Invalid input';
      return apiError(issue, 'VALIDATION_ERROR', 422);
    }

    if (!isFirebaseConfigured()) {
      return apiError(
        'Email sign-in is not configured on the server',
        'FIREBASE_NOT_CONFIGURED',
        503
      );
    }

    // The email is unknown pre-verify, so throttle the IP.
    const ipKey = clientIpKey((n) => req.headers.get(n));
    const gate = checkRateLimit(`email-session:${ipKey}`, EMAIL_SESSION_IP);
    if (!gate.allowed) {
      return apiError('Too many attempts. Please wait a few minutes and try again.', 'RATE_LIMITED', 429, {
        retryAfterMs: gate.retryAfterMs,
      });
    }
    recordHit(`email-session:${ipKey}`, EMAIL_SESSION_IP);

    const decoded = await verifyFirebaseIdToken(validation.data.idToken);
    if (!decoded || !decoded.email) {
      return apiError('Sign-in token is invalid or expired', 'INVALID_FIREBASE_TOKEN', 401);
    }

    let merchant = null;
    try {
      merchant = await db.merchant.findUnique({ where: { email: decoded.email } });
    } catch (dbErr) {
      console.warn('DB merchant lookup skipped/error', dbErr);
    }

    const token = await createSessionToken({
      userId: merchant?.id || `temp_${decoded.uid}`,
      // No verified phone exists on this transport — phone is collected data
      // at business-setup, never an identity. Presence (not content) is what
      // the session schema requires.
      phoneNumber: '',
      email: decoded.email,
      firebaseUid: decoded.uid,
    });

    const response = NextResponse.json({
      success: true,
      data: {
        isExistingMerchant: !!merchant,
        email: decoded.email,
        merchant,
      },
    });
    response.headers.append('Set-Cookie', setAuthCookieHeader(token));
    return response;
  } catch (error) {
    console.error('Error in email session route:', error);
    return apiError('Failed to create session', 'INTERNAL_ERROR', 500);
  }
}
