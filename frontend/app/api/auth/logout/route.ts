import { NextRequest, NextResponse } from 'next/server';
import { clearAuthCookieHeader, revokeSessionToken, AUTH_COOKIE_NAME } from '@/backend/auth';

// POST /api/auth/logout — Clears session cookie to sign merchant out.
//
// RT-01: clearing the cookie is not enough on its own (the JWT would stay
// valid to expiry), so the token's jti is recorded in the server revocation
// set first. Best-effort ordering: even if revocation throws, the cookie is
// still cleared — the client always ends logged out.
export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get(AUTH_COOKIE_NAME)?.value;
    if (token) await revokeSessionToken(token);
  } catch {
    // Revocation must never block logout.
  }
  const response = NextResponse.json({
    success: true,
    data: { message: 'Signed out successfully' },
  });

  response.headers.append('Set-Cookie', clearAuthCookieHeader());
  return response;
}
