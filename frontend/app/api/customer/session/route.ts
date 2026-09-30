import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/backend/api/response';
import { customerSessionSchema } from '@/backend/validation/schemas';
import {
  checkRateLimit,
  recordHit,
  clientIpKey,
  CUSTOMER_SESSION_IP,
} from '@/backend/rateLimit';
import { createSessionToken, setAuthCookieHeader } from '@/backend/auth';

// POST /api/customer/session — Customer check-in identity.
//
// Collects { name, phoneNumber } and mints a `role: 'customer'` session
// directly. There is no OTP step: numbers are collected data (the merchant
// sees the name on the check-in before approving the stamp), not a verified
// identity.
export async function POST(req: NextRequest) {
  try {
    // T-01: malformed JSON is a 422, never a 500.
    const body = await req.json().catch(() => null);
    const validation = customerSessionSchema.safeParse(body);
    if (!validation.success) {
      const issue = validation.error.issues[0]?.message || 'Invalid input';
      return apiError(issue, 'VALIDATION_ERROR', 422);
    }

    const ipKey = clientIpKey((n) => req.headers.get(n));
    const gate = checkRateLimit(`customer-session:${ipKey}`, CUSTOMER_SESSION_IP);
    if (!gate.allowed) {
      return apiError('Too many attempts. Please wait a few minutes and try again.', 'RATE_LIMITED', 429, {
        retryAfterMs: gate.retryAfterMs,
      });
    }
    recordHit(`customer-session:${ipKey}`, CUSTOMER_SESSION_IP);

    const customerName = validation.data.name.trim();
    const cleanPhone = validation.data.phoneNumber.replace(/^\+88/, '');

    const token = await createSessionToken({
      userId: `cust_${cleanPhone}`,
      phoneNumber: cleanPhone,
      role: 'customer',
      name: customerName,
    });

    const response = NextResponse.json({
      success: true,
      data: { name: customerName, phoneNumber: cleanPhone },
    });
    response.headers.append('Set-Cookie', setAuthCookieHeader(token));
    return response;
  } catch (error) {
    console.error('Error in customer session route:', error);
    return apiError('Failed to create session', 'INTERNAL_ERROR', 500);
  }
}
