import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

/**
 * Phase 7 — the main app sits strictly behind authentication (server-side).
 *
 * Every page request must carry a valid `loyl_session` JWT or it is bounced
 * to the right sign-in flow *before* any HTML is rendered:
 *   merchant pages -> /welcome
 *   admin panel    -> /admin/login
 *   customer pages -> /scan?next=…   (mirrors the customer layout gate)
 *
 * The public allowlist is where the Phase 6 SEO landing directory will live:
 * add `/pricing`, `/terms`, `/privacy` (+ prefixes) when it lands - those
 * pages must stay crawlable without a session.
 *
 * API routes are excluded on purpose: each route guards itself and must keep
 * answering 401/403 JSON (a redirect would break fetch clients), and the auth
 * endpoints (/api/auth/otp/*, /api/auth/logout, /api/admin/login) are public
 * by design.
 *
 * Keep the cookie name in sync with backend/auth.ts — edge middleware
 * cannot import next/headers, so the value is mirrored. The secret is NOT
 * mirrored as a default anymore (SEC-01): both sides fail fast when
 * JWT_SECRET is unset instead of agreeing on a public string.
 */
const AUTH_COOKIE_NAME = 'loyl_session';

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'JWT_SECRET is not set. Set it in frontend/.env.local (local) and in ' +
        'the hosting env (prod). Refusing to gate pages on an insecure default.'
    );
  }
  return new TextEncoder().encode(secret);
}

/** Page routes reachable without a session. */
const PUBLIC_PATHS = new Set(['/', '/welcome', '/business-setup', '/admin/login', '/pricing', '/terms', '/privacy']);

/** Customer sign-in entry points: /scan and /scan/[offerId]. */
const PUBLIC_PREFIXES = ['/scan', '/menu'];

/** Customer pages (non-entry) — guests re-enter through the scan flow. */
const CUSTOMER_PREFIXES = ['/stamp-card', '/reward', '/profile'];

/** Merchant console pages — merchant sessions only. */
const MERCHANT_PREFIXES = [
  '/dashboard',
  '/offers',
  '/branches',
  '/analytics',
  '/customers',
  '/requests',
  '/settings',
  '/billing',
];

async function getSessionRole(req: NextRequest): Promise<{ valid: boolean; role?: string }> {
  const token = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return { valid: false };
  try {
    const { payload } = await jwtVerify(token, getJwtSecret()); // verifies signature + expiry
    const role = typeof (payload as { role?: unknown }).role === 'string'
      ? (payload as { role: string }).role
      : undefined;
    return { valid: true, role };
  } catch {
    return { valid: false };
  }
}

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Where a guest lands for the page they asked for (mirrors the layout gates). */
function guestDestination(pathname: string): { pathname: string; search: string } {
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return { pathname: '/admin/login', search: '' };
  }
  if (CUSTOMER_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return { pathname: '/scan', search: `?next=${encodeURIComponent(pathname)}` };
  }
  return { pathname: '/welcome', search: '' };
}

export async function middleware(req: NextRequest) {
  const raw = req.nextUrl.pathname;
  // Tolerate a trailing slash (/billing/ behaves like /billing).
  const pathname = raw.length > 1 && raw.endsWith('/') ? raw.slice(0, -1) : raw;

  if (isPublic(pathname)) return NextResponse.next();

  const session = await getSessionRole(req);
  const isAdminPath = pathname === '/admin' || pathname.startsWith('/admin/');

  // Admin panel: valid session is not enough — role must be admin.
  // Guests -> /admin/login. Signed-in non-admins -> their own home
  // (customer -> /scan, everyone else -> /dashboard), never the login form.
  if (isAdminPath) {
    if (!session.valid) {
      const url = req.nextUrl.clone();
      url.pathname = '/admin/login';
      url.search = '';
      return NextResponse.redirect(url);
    }
    if (session.role !== 'admin') {
      const url = req.nextUrl.clone();
      url.pathname = session.role === 'customer' ? '/scan' : '/dashboard';
      url.search = '';
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // Merchant console: bounce admin sessions server-side (was client-only).
  if (MERCHANT_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    if (!session.valid) {
      const url = req.nextUrl.clone();
      url.pathname = '/welcome';
      url.search = '';
      return NextResponse.redirect(url);
    }
    if (session.role === 'admin') {
      const url = req.nextUrl.clone();
      url.pathname = '/admin';
      url.search = '';
      return NextResponse.redirect(url);
    }
    if (session.role === 'customer') {
      const url = req.nextUrl.clone();
      url.pathname = '/scan';
      url.search = '';
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (session.valid) return NextResponse.next();

  const dest = guestDestination(pathname);
  const url = req.nextUrl.clone();
  url.pathname = dest.pathname;
  url.search = dest.search;
  return NextResponse.redirect(url);
}

export const config = {
  // Pages only: skip API routes, Next internals, and any path with a file
  // extension (static assets). Root `/` falls through to the root page's own
  // redirect to /welcome.
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};
