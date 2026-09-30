import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { randomUUID } from 'node:crypto';
import { sessionPayloadSchema } from './validation/schemas';

/**
 * SEC-01 fix: no hardcoded fallback. A missing JWT_SECRET is a loud boot-time
 * error, never a silent downgrade to a publicly known string (session forgery
 * on any var-missing deploy). Lazy on purpose: module import must stay cheap
 * for route collection; the throw fires on first actual use.
 */
export function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'JWT_SECRET is not set. Generate a long random value and set it in ' +
        'frontend/.env.local (local) and in the hosting env (prod). ' +
        'Refusing to sign sessions with an insecure default.'
    );
  }
  return new TextEncoder().encode(secret);
}

export const AUTH_COOKIE_NAME = 'loyl_session';

export interface SessionPayload {
  userId: string;
  phoneNumber: string;
  /**
   * Legacy Cognito user id — no longer issued (email/password is the auth
   * method). Kept in the shape so old sessions still parse until they expire.
   */
  cognitoSub?: string;
  /** Firebase user id (uid) — present once OTP was verified via Firebase. */
  firebaseUid?: string;
  /**
   * Email/password identity — verified server-side from the Firebase ID
   * token. Present on merchant sessions minted via POST /api/auth/session.
   */
  email?: string;
  role?: string;
  /**
   * Phase 11: the name a customer verified when signing in. Absent for merchant
   * and admin sessions, and for customer sessions issued before name capture.
   */
  name?: string;
  /**
   * RT-01: unique token id, minted per session. Logout records it in the
   * revocation set so a stolen cookie dies with the session instead of
   * living to its 30d expiry.
   */
  jti?: string;
  exp?: number;
}

/**
 * RT-01 revocation set: jti → expiry epoch ms. Entries die with the token
 * they belong to (swept on every check), so the map cannot grow without
 * bound. Single-instance scope like the other in-memory guards — a
 * multi-instance deploy needs this in shared storage (documented, P-12 era).
 */
const revokedJtis = new Map<string, number>();

function sweepRevocations(now: number): void {
  for (const [jti, exp] of revokedJtis) {
    if (exp <= now) revokedJtis.delete(jti);
  }
}

/** True when `jti` was revoked and its original expiry has not passed yet. */
export function isSessionRevoked(jti: string | undefined, now: number = Date.now()): boolean {
  if (!jti) return false;
  sweepRevocations(now);
  return revokedJtis.has(jti);
}

/**
 * Revokes one token (logout path): verifies the signature, then records its
 * jti until its natural expiry. Returns false when the token was never valid.
 */
export async function revokeSessionToken(token: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    const parsed = sessionPayloadSchema.safeParse(payload);
    if (!parsed.success || !parsed.data.jti) return false;
    const expMs =
      typeof payload.exp === 'number' ? payload.exp * 1000 : Date.now() + 30 * 24 * 60 * 60 * 1000;
    revokedJtis.set(parsed.data.jti, expMs);
    return true;
  } catch {
    return false;
  }
}

export async function createSessionToken(
  payload: Omit<SessionPayload, 'exp'>,
  /** Defaults to the 30d merchant/customer session; admin sessions use 12h. */
  expiresIn: string = '30d'
): Promise<string> {
  // RT-01: every token carries a unique id so logout can revoke exactly it.
  return new SignJWT({ jti: randomUUID(), ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(getJwtSecret());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    // ST-01: validate the claim shape instead of casting — drift fails here.
    const parsed = sessionPayloadSchema.safeParse(payload);
    if (!parsed.success) return null;
    const p = parsed.data;
    // RT-01: a logged-out token stays dead until its natural expiry.
    if (isSessionRevoked(p.jti)) return null;
    return {
      userId: p.userId,
      phoneNumber: p.phoneNumber,
      cognitoSub: p.cognitoSub,
      firebaseUid: p.firebaseUid,
      email: p.email,
      role: p.role,
      name: p.name,
      jti: p.jti,
    };
  } catch (err) {
    return null;
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export function setAuthCookieHeader(token: string): string {
  const maxAge = 30 * 24 * 60 * 60; // 30 days
  return `${AUTH_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; ${
    process.env.NODE_ENV === 'production' ? 'Secure;' : ''
  }`;
}

export function clearAuthCookieHeader(): string {
  return `${AUTH_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; ${
    process.env.NODE_ENV === 'production' ? 'Secure;' : ''
  }`;
}
