import { describe, it, expect, afterEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/**
 * T-03: route-level unit tests for the auth guard contract (CODIN §3).
 *
 * These exercise the guards exactly as a route does — no HTTP server, no
 * DB (every branch below resolves before or without a query):
 *   withAuth   401 UNAUTHORIZED
 *   withAdmin  403 NOT_ADMIN / 503 ADMIN_NOT_CONFIGURED
 *   withMerchant 403 ADMIN_SESSION / 403 CUSTOMER_SESSION / 409 SETUP_REQUIRED
 *   withCustomer 403 ADMIN_SESSION / 403 MERCHANT_SESSION / 422 NAME_REQUIRED
 * plus the RT-01 end-to-end: logout kills the old cookie token (401 after).
 *
 * `next/headers` is mocked with a one-slot cookie jar so a bare vitest run
 * (no request scope) can carry a session the same way the cookie would.
 */

const jar = vi.hoisted(() => ({ token: undefined as string | undefined }));

vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (name: string) =>
      jar.token && name === 'loyl_session' ? { name: 'loyl_session', value: jar.token } : undefined,
  }),
}));

import { AUTH_COOKIE_NAME, createSessionToken, revokeSessionToken } from '@/backend/auth';
import { withAdmin, withAuth, withCustomer, withMerchant, type RouteContext } from './handler';
import { POST as logoutHandler } from '@/app/api/auth/logout/route';
import { GET as healthHandler } from '@/app/api/health/route';

const ok = withAuth(async (_req, session) => NextResponse.json({ userId: session.userId }));
const pass = async () => NextResponse.json({ ok: true });

function setEnv(key: string, value: string | undefined): () => void {
  const prev = process.env[key] as string | undefined;
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  return () => {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  };
}

const req = () => new NextRequest('http://localhost:3000/api/probe');

// Next 15 passes an async params context to every route handler; direct
// handler invocations in tests supply the same shape.
const ctx: RouteContext = { params: Promise.resolve({}) };

afterEach(() => {
  jar.token = undefined;
});

describe('withAuth (T-03 guard matrix)', () => {
  it('401 UNAUTHORIZED with no session cookie', async () => {
    const res = await ok(req(), ctx);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHORIZED');
  });

  it('401 for a token signed with the wrong secret (forgery)', async () => {
    const { SignJWT } = await import('jose');
    jar.token = await new SignJWT({ userId: 'evil', phoneNumber: '01712345678' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('30d')
      .sign(new TextEncoder().encode('attacker-known-secret'));
    const res = await ok(req(), ctx);
    expect(res.status).toBe(401);
  });

  it('passes a valid session through to the handler', async () => {
    jar.token = await createSessionToken({ userId: 'm_1', phoneNumber: '01712345678' });
    const res = await ok(req(), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: 'm_1' });
  });
});

describe('logout revocation, end-to-end (RT-01)', () => {
  it('a logged-out token is 401 through the guard; a second session lives on', async () => {
    const dead = await createSessionToken({ userId: 'm_9', phoneNumber: '01712345678' });
    const alive = await createSessionToken({ userId: 'm_9', phoneNumber: '01712345678' });

    const res = await logoutHandler(
      new NextRequest('http://localhost:3000/api/auth/logout', {
        method: 'POST',
        headers: { cookie: `${AUTH_COOKIE_NAME}=${dead}` },
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');

    jar.token = dead;
    expect((await ok(req(), ctx)).status).toBe(401);
    jar.token = alive;
    expect((await ok(req(), ctx)).status).toBe(200);
  });

  it('logout without a cookie still answers 200 (idempotent)', async () => {
    const res = await logoutHandler(
      new NextRequest('http://localhost:3000/api/auth/logout', { method: 'POST' })
    );
    expect(res.status).toBe(200);
  });
});

describe('withAdmin (T-03 guard matrix)', () => {
  const admin = withAdmin(pass);

  it('401 without a session', async () => {
    expect((await admin(req(), ctx)).status).toBe(401);
  });

  it('403 NOT_ADMIN for a non-admin session', async () => {
    jar.token = await createSessionToken({ userId: 'm_1', phoneNumber: '01712345678', role: 'merchant' });
    const res = await admin(req(), ctx);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('NOT_ADMIN');
  });

  it('503 ADMIN_NOT_CONFIGURED when ADMIN_PASSWORD is unset (revokes access deployment-wide)', async () => {
    const restore = setEnv('ADMIN_PASSWORD', undefined);
    try {
      jar.token = await createSessionToken({ userId: 'admin', phoneNumber: '', role: 'admin' });
      const res = await admin(req(), ctx);
      expect(res.status).toBe(503);
      expect((await res.json()).error.code).toBe('ADMIN_NOT_CONFIGURED');
    } finally {
      restore();
    }
  });

  it('admits the admin session when configured', async () => {
    const restore = setEnv('ADMIN_PASSWORD', 'test-admin-password');
    try {
      jar.token = await createSessionToken({ userId: 'admin', phoneNumber: '', role: 'admin' });
      expect((await admin(req(), ctx)).status).toBe(200);
    } finally {
      restore();
    }
  });
});

describe('withMerchant (T-03 guard matrix)', () => {
  const merchant = withMerchant(pass);

  it('403 ADMIN_SESSION: an admin can never act as a merchant', async () => {
    jar.token = await createSessionToken({ userId: 'admin', phoneNumber: '', role: 'admin' });
    const res = await merchant(req(), ctx);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('ADMIN_SESSION');
  });

  it('403 CUSTOMER_SESSION: a customer session never reaches merchant routes', async () => {
    jar.token = await createSessionToken({
      userId: 'cust_01712345678',
      phoneNumber: '01712345678',
      role: 'customer',
      name: 'Rahim',
    });
    const res = await merchant(req(), ctx);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('CUSTOMER_SESSION');
  });

  it('409 SETUP_REQUIRED for a signed-in merchant with no profile yet', async () => {
    jar.token = await createSessionToken({ userId: 'temp_abc', phoneNumber: '', role: 'merchant' });
    const res = await merchant(req(), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('SETUP_REQUIRED');
  });
});

describe('withCustomer (T-03 guard matrix)', () => {
  const customer = withCustomer(pass);

  it('403 ADMIN_SESSION for an admin session', async () => {
    jar.token = await createSessionToken({ userId: 'admin', phoneNumber: '', role: 'admin' });
    const res = await customer(req(), ctx);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('ADMIN_SESSION');
  });

  it('403 MERCHANT_SESSION: a merchant can never act as a customer', async () => {
    jar.token = await createSessionToken({
      userId: 'm_1',
      phoneNumber: '01712345678',
      role: 'merchant',
      email: 'shop@example.com',
    });
    const res = await customer(req(), ctx);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('MERCHANT_SESSION');
  });

  it('401 when the customer session carries no phone', async () => {
    jar.token = await createSessionToken({ userId: 'cust_x', phoneNumber: '', name: 'Rahim' });
    expect((await customer(req(), ctx)).status).toBe(401);
  });

  it('422 NAME_REQUIRED at the guard for nameless state-changing sessions', async () => {
    jar.token = await createSessionToken({ userId: 'cust_x', phoneNumber: '01712345678' });
    const strict = withCustomer(pass, {
      requireName: true,
    });
    const res = await strict(req(), ctx);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('NAME_REQUIRED');
  });

  it('admits a named customer session', async () => {
    jar.token = await createSessionToken({
      userId: 'cust_x',
      phoneNumber: '01712345678',
      name: 'Rahim',
    });
    expect((await customer(req(), ctx)).status).toBe(200);
  });
});

describe('GET /api/health (P-05)', () => {
  it('answers with the probe envelope: 200 {ok,db} or 503 DB_UNHEALTHY', async () => {
    const res = await healthHandler();
    const json = await res.json();
    if (res.status === 200) {
      expect(json).toMatchObject({ success: true, data: { ok: true, db: true } });
    } else {
      expect(res.status).toBe(503);
      expect(json.error.code).toBe('DB_UNHEALTHY');
    }
  });
});

describe('revocation set hygiene (RT-01)', () => {
  it('revoking a garbage token is refused, not recorded', async () => {
    expect(await revokeSessionToken('not-a-jwt')).toBe(false);
  });
});
