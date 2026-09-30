import { describe, it, expect } from 'vitest';
import { POST as emailSessionHandler } from '@/app/api/auth/session/route';
import { POST as customerSessionHandler } from '@/app/api/customer/session/route';
import { NextRequest } from 'next/server';

function sessionReq(body: unknown) {
  return new NextRequest('http://localhost:3000/api/auth/session', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function customerReq(body: unknown) {
  return new NextRequest('http://localhost:3000/api/customer/session', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function setEnv(key: string, value: string | undefined): () => void {
  const env = process.env as Record<string, string | undefined>;
  const prev = env[key];
  if (value === undefined) delete env[key];
  else env[key] = value;
  return () => {
    if (prev === undefined) delete env[key];
    else env[key] = prev;
  };
}

describe('Email Session API (POST /api/auth/session)', () => {
  it('T-01: malformed JSON is a 422, never a 500', async () => {
    const req = new NextRequest('http://localhost:3000/api/auth/session', {
      method: 'POST',
      body: 'not-json{{{',
    });
    const res = await emailSessionHandler(req);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects empty and short-token bodies with 422', async () => {
    for (const body of [{}, { idToken: 'short' }, { idToken: 'x'.repeat(64), email: 'a@b.c' }]) {
      const res = await emailSessionHandler(sessionReq(body));
      expect(res.status).toBe(422);
    }
  });

  it('answers 503 FIREBASE_NOT_CONFIGURED without a project id', async () => {
    const restore = setEnv('FIREBASE_PROJECT_ID', undefined);
    try {
      const res = await emailSessionHandler(sessionReq({ idToken: 'x'.repeat(500) }));
      expect(res.status).toBe(503);
      expect((await res.json()).error.code).toBe('FIREBASE_NOT_CONFIGURED');
      expect(res.headers.get('set-cookie')).toBeNull();
    } finally {
      restore();
    }
  });

  it('rejects a forged token with 401 and sets no cookie', async () => {
    const restore = setEnv('FIREBASE_PROJECT_ID', 'email-session-test-probe');
    try {
      const res = await emailSessionHandler(sessionReq({ idToken: 'x'.repeat(500) }));
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe('INVALID_FIREBASE_TOKEN');
      expect(res.headers.get('set-cookie')).toBeNull();
    } finally {
      restore();
    }
  });
});

describe('Customer Session API (POST /api/customer/session)', () => {
  it('mints a named customer session and sets the cookie', async () => {
    const res = await customerSessionHandler(
      customerReq({ name: 'Rahim Uddin', phoneNumber: '01712345678' })
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual({ name: 'Rahim Uddin', phoneNumber: '01712345678' });
    expect(res.headers.get('set-cookie')).toContain('loyl_session=');
  });

  it('rejects missing/invalid name or phone with 422 and no cookie', async () => {
    for (const body of [
      { phoneNumber: '01712345678' },
      { name: 'Rahim Uddin' },
      { name: 'R', phoneNumber: '01712345678' },
      { name: 'Rahim Uddin', phoneNumber: '12345' },
      {},
    ]) {
      const res = await customerSessionHandler(customerReq(body));
      expect(res.status).toBe(422);
      expect(res.headers.get('set-cookie')).toBeNull();
    }
  });

  it('T-01: malformed JSON is a 422, never a 500', async () => {
    const req = new NextRequest('http://localhost:3000/api/customer/session', {
      method: 'POST',
      body: 'not-json{{{',
    });
    const res = await customerSessionHandler(req);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });
});
