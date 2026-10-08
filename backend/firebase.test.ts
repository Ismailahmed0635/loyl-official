import { describe, it, expect } from 'vitest';
import {
  firebasePhoneToLocal,
  localPhoneToE164,
  isFirebaseConfigured,
  isFirebaseAdminWriteConfigured,
  verifyFirebaseIdToken,
} from './firebase';

describe('backend/firebase phone mapping', () => {
  it('maps Firebase E.164 to the local 11-digit identity', () => {
    expect(firebasePhoneToLocal('+8801712345678')).toBe('01712345678');
    expect(firebasePhoneToLocal('+8801812345678')).toBe('01812345678');
  });

  it('rejects non-BD E.164 claims', () => {
    expect(firebasePhoneToLocal('+14155552671')).toBeNull();
    expect(firebasePhoneToLocal('01712345678')).toBeNull();
    expect(firebasePhoneToLocal('')).toBeNull();
  });

  it('builds E.164 from local numbers', () => {
    expect(localPhoneToE164('01712345678')).toBe('+8801712345678');
    expect(localPhoneToE164('+8801712345678')).toBe('+8801712345678');
    expect(localPhoneToE164('12345')).toBeNull();
  });

  it('reports unconfigured without a project id (verification needs it)', () => {
    const had = {
      project: process.env.FIREBASE_PROJECT_ID,
      email: process.env.FIREBASE_CLIENT_EMAIL,
      key: process.env.FIREBASE_PRIVATE_KEY,
    };
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PRIVATE_KEY;
    expect(isFirebaseConfigured()).toBe(false);
    expect(isFirebaseAdminWriteConfigured()).toBe(false);
    if (had.project) process.env.FIREBASE_PROJECT_ID = had.project;
    if (had.email) process.env.FIREBASE_CLIENT_EMAIL = had.email;
    if (had.key) process.env.FIREBASE_PRIVATE_KEY = had.key;
  });

  it('is configured verify-only with just the project id (no secret needed)', () => {
    const had = {
      project: process.env.FIREBASE_PROJECT_ID,
      email: process.env.FIREBASE_CLIENT_EMAIL,
      key: process.env.FIREBASE_PRIVATE_KEY,
    };
    process.env.FIREBASE_PROJECT_ID = 'verify-only-probe';
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PRIVATE_KEY;
    expect(isFirebaseConfigured()).toBe(true);
    expect(isFirebaseAdminWriteConfigured()).toBe(false);
    if (had.project) process.env.FIREBASE_PROJECT_ID = had.project;
    else delete process.env.FIREBASE_PROJECT_ID;
    if (had.email) process.env.FIREBASE_CLIENT_EMAIL = had.email;
    if (had.key) process.env.FIREBASE_PRIVATE_KEY = had.key;
  });

  it('a placeholder/non-PEM private key never counts as write credentials', () => {
    const had = {
      project: process.env.FIREBASE_PROJECT_ID,
      email: process.env.FIREBASE_CLIENT_EMAIL,
      key: process.env.FIREBASE_PRIVATE_KEY,
    };
    process.env.FIREBASE_PROJECT_ID = 'placeholder-probe';
    process.env.FIREBASE_CLIENT_EMAIL = 'admin@example.iam.gserviceaccount.com';
    process.env.FIREBASE_PRIVATE_KEY = 'copy private_key from your JSON here';
    expect(isFirebaseConfigured()).toBe(true);
    expect(isFirebaseAdminWriteConfigured()).toBe(false);
    if (had.project) process.env.FIREBASE_PROJECT_ID = had.project;
    if (had.email) process.env.FIREBASE_CLIENT_EMAIL = had.email;
    if (had.key) process.env.FIREBASE_PRIVATE_KEY = had.key;
  });

  it('rejects a forged token with a real Firebase auth/* code (SDK wiring intact)', async () => {
    // Regression: firebase-admin v14 removed `app.auth()`, so verification
    // threw a codeless TypeError and EVERY sign-in 401'd. A malformed token
    // must fail with a genuine SDK code, proving the call path is live.
    // (Malformed input is rejected before any network, so this is offline-safe.)
    const had = process.env.FIREBASE_PROJECT_ID;
    process.env.FIREBASE_PROJECT_ID = 'wiring-probe';
    const codes: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      if (typeof args[1] === 'string') codes.push(args[1]);
    };
    try {
      await expect(verifyFirebaseIdToken('x'.repeat(500))).resolves.toBeNull();
    } finally {
      console.warn = origWarn;
      if (had === undefined) delete process.env.FIREBASE_PROJECT_ID;
      else process.env.FIREBASE_PROJECT_ID = had;
    }
    expect(codes).toContain('auth/argument-error');
  });

  it('resolves jwks-rsa -> jose through a require()-able CJS build', async () => {
    // Regression: firebase-admin -> jwks-rsa declares jose@^6, which is
    // `"type":"module"` with NO `require` condition. Vercel's runtime rejects
    // require(esm) (local Node 24 allows it, so dev never showed it), killing
    // EVERY real sign-in with ERR_REQUIRE_ESM -> 401 INVALID_FIREBASE_TOKEN.
    // The `jose` override pins v5 (dual CJS/ESM): assert the resolution
    // jwks-rsa actually performs stays on a CommonJS file.
    const path = await import('node:path');
    const { createRequire } = await import('node:module');
    const req = createRequire(path.join(process.cwd(), 'node_modules/jwks-rsa/src/utils.js'));
    const resolved = req.resolve('jose');
    expect(resolved.replace(/\\/g, '/')).toMatch(/\/dist\/node\/cjs\/index\.js$/);
    // And the call must be loadable the way jwks-rsa loads it: require().
    expect(() => req('jose')).not.toThrow();
  });
});
