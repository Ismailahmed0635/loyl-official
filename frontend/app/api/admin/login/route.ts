import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/backend/api/response';
import { adminLoginSchema } from '@/backend/validation/schemas';
import { createSessionToken, setAuthCookieHeader } from '@/backend/auth';
import {
  ADMIN_SESSION_TTL,
  adminPasswordConfigured,
  checkLoginAllowed,
  clearFailedLogins,
  recordFailedLogin,
  verifyAdminPassword,
} from '@/backend/admin';

/** Throttle key: first forwarded hop (behind a proxy) or the socket host. */
function clientKey(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip') || 'local';
}

// POST /api/admin/login — super-admin password sign-in (Phase 5).
// Separate transport from merchant email sign-in: role is derived
// server-side only here, never accepted from the request body.
export async function POST(req: NextRequest) {
  try {
    let body: unknown = null;
    try {
      body = await req.json();
    } catch {
      body = null;
    }

    const validation = adminLoginSchema.safeParse(body);
    if (!validation.success) {
      const issue = validation.error.issues[0]?.message || 'Invalid input';
      return apiError(issue, 'VALIDATION_ERROR', 422);
    }

    if (!adminPasswordConfigured()) {
      return apiError(
        'Admin login is not configured on this deployment (set ADMIN_PASSWORD).',
        'ADMIN_NOT_CONFIGURED',
        503
      );
    }

    const key = clientKey(req);
    const throttle = checkLoginAllowed(key);
    if (!throttle.allowed) {
      const response = apiError(
        'Too many failed attempts. Please wait a minute and try again.',
        'ADMIN_LOCKED_OUT',
        429,
        { retryAfterMs: throttle.retryAfterMs }
      );
      response.headers.set(
        'Retry-After',
        String(Math.max(1, Math.ceil(throttle.retryAfterMs / 1000)))
      );
      return response;
    }

    if (!verifyAdminPassword(validation.data.password)) {
      recordFailedLogin(key);
      return apiError('Incorrect admin password.', 'ADMIN_INVALID_PASSWORD', 401);
    }

    clearFailedLogins(key);
    const token = await createSessionToken(
      { userId: 'admin', phoneNumber: '', role: 'admin' },
      ADMIN_SESSION_TTL
    );
    const response = apiSuccess({ role: 'admin' });
    response.headers.append('Set-Cookie', setAuthCookieHeader(token));
    return response;
  } catch (error) {
    console.error('Error in admin login route:', error);
    return apiError('Failed to sign in', 'INTERNAL_ERROR', 500);
  }
}
