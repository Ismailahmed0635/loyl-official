import { describe, it, expect } from 'vitest';
import { SignJWT } from 'jose';
import {
  createSessionToken,
  verifySessionToken,
  getJwtSecret,
  revokeSessionToken,
  isSessionRevoked,
} from './auth';

function setEnv(key: string, value: string | undefined): () => void {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  return () => {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  };
}

describe('session secrets (SEC-01)', () => {
  it('getJwtSecret throws when JWT_SECRET is unset (fail-fast, no default)', () => {
    const restore = setEnv('JWT_SECRET', undefined);
    try {
      expect(() => getJwtSecret()).toThrow(/JWT_SECRET is not set/);
    } finally {
      restore();
    }
  });

  it('round-trips a valid session token', async () => {
    const token = await createSessionToken({
      userId: 'm_123',
      phoneNumber: '01712345678',
      role: 'merchant',
    });
    const session = await verifySessionToken(token);
    expect(session).toMatchObject({
      userId: 'm_123',
      phoneNumber: '01712345678',
      role: 'merchant',
    });
  });

  it('ST-01: rejects a correctly signed token with drifted claim shapes', async () => {
    const bad = await new SignJWT({ userId: 12345, role: 'superadmin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('30d')
      .sign(getJwtSecret());
    expect(await verifySessionToken(bad)).toBeNull();
  });

  it('accepts the admin session shape (empty phoneNumber, role admin)', async () => {
    const token = await createSessionToken({
      userId: 'admin',
      phoneNumber: '',
      role: 'admin',
    });
    expect(await verifySessionToken(token)).toMatchObject({
      userId: 'admin',
      role: 'admin',
    });
  });

  it('rejects tokens signed with the wrong secret (forgery)', async () => {
    const forged = await new SignJWT({ userId: 'm_x', phoneNumber: '01700000000' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('30d')
      .sign(new TextEncoder().encode('attacker-known-secret'));
    expect(await verifySessionToken(forged)).toBeNull();
  });

  it('RT-01: every token carries a unique jti', async () => {
    const a = await createSessionToken({ userId: 'm_1', phoneNumber: '0171' });
    const b = await createSessionToken({ userId: 'm_1', phoneNumber: '0171' });
    const sa = await verifySessionToken(a);
    const sb = await verifySessionToken(b);
    expect(sa?.jti).toBeTruthy();
    expect(sb?.jti).toBeTruthy();
    expect(sa?.jti).not.toBe(sb?.jti);
  });

  it('RT-01: logout revokes exactly that token (old cookie dies)', async () => {
    const a = await createSessionToken({ userId: 'm_1', phoneNumber: '0171' });
    const b = await createSessionToken({ userId: 'm_1', phoneNumber: '0171' });
    expect(await revokeSessionToken(a)).toBe(true);
    expect(await verifySessionToken(a)).toBeNull();
    // The other session from the same user is untouched.
    expect(await verifySessionToken(b)).toMatchObject({ userId: 'm_1' });
    expect(await revokeSessionToken('garbage')).toBe(false);
  });
});
