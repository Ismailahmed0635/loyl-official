/**
 * backend/firebase.ts — Firebase ID-token verification (Admin SDK).
 *
 * Email/password is the app's sign-in method: the client signs in with the
 * Firebase Web SDK and POSTs the resulting ID token to
 * `/api/auth/session`; this module verifies it server-side and the route
 * mints the `loyl_session` JWT. Phone numbers are collected data only —
 * there is no OTP step anywhere (merchant phone at business-setup, customer
 * name+phone at check-in).
 *
 * Env-gated: verification uses Google's public certs, so only
 * FIREBASE_PROJECT_ID is required. When a real FIREBASE_PRIVATE_KEY is also
 * present the Admin SDK initializes with full credentials (needed for any
 * future admin writes); otherwise it initializes verify-only with the
 * project ID. A placeholder/non-PEM value is treated as absent.
 */

export interface FirebaseDecodedUser {
  uid: string;
  /** E.164 phone, e.g. +8801712345678 — present for the phone provider only. */
  phoneNumber: string | null;
  /** Present for the email/password provider. */
  email: string | null;
  emailVerified: boolean;
}

interface AdminApp {
  /** Opaque — auth operations go through `getAuth(app)` (firebase-admin/auth). */
  name?: string;
}

/** The subset of the firebase-admin namespace this module uses. */
interface AdminNamespace {
  apps?: AdminApp[];
  initializeApp: (options: Record<string, unknown>) => AdminApp;
  credential: { cert: (options: Record<string, unknown>) => unknown };
}

/** The subset of `firebase-admin/auth` this module uses. */
interface AuthNamespace {
  getAuth: (app: AdminApp) => {
    verifyIdToken: (idToken: string) => Promise<Record<string, unknown>>;
  };
}

const globalAdmin = globalThis as unknown as {
  __loylFirebaseAdmin?: AdminApp | null;
  __loylFirebaseAdminError?: string;
  /** In-flight init — concurrent first requests share one import. */
  __loylFirebaseAdminInit?: Promise<AdminApp | null>;
};

/** Upper bound for one Admin SDK verification (public-certs fetch included). */
const VERIFY_TIMEOUT_MS = 10_000;

function getPrivateKey(): string | null {
  const raw = process.env.FIREBASE_PRIVATE_KEY;
  if (!raw) return null;
  // A pasted service-account key always carries PEM armor — anything else is
  // the .env.example placeholder (or a truncated paste) and must not count
  // as configured credentials.
  if (!raw.includes('BEGIN PRIVATE KEY')) return null;
  // Vercel env editors store the PEM with literal \n — restore real newlines.
  return raw.replace(/\\n/g, '\n');
}

/**
 * True when the server can verify Firebase ID tokens: the project ID alone
 * suffices (verification uses Google's public certs). The private key only
 * upgrades the Admin app to full credentials for future admin writes.
 */
export function isFirebaseConfigured(): boolean {
  return !!process.env.FIREBASE_PROJECT_ID;
}

/** True when full Admin credentials (not just verify-only) are present. */
export function isFirebaseAdminWriteConfigured(): boolean {
  return !!(
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    getPrivateKey()
  );
}

/**
 * firebase-admin ships dual CJS/ESM (`exports` with `require`/`import`
 * conditions). A bundler evaluating this module in ESM context resolves the
 * `import` condition to `lib/esm/*`, whose `lib/esm/package.json` declares
 * `"type": "module"` — a runtime `require()` of that path throws
 * `ERR_REQUIRE_ESM`, which used to surface as a blanket 401
 * `INVALID_FIREBASE_TOKEN` for every production sign-in (local `next dev`
 * resolved the CJS path, so the failure was Vercel-only). Dynamic `import()`
 * is the one form both resolvers accept.
 */
async function loadAdminNamespace(): Promise<AdminNamespace> {
  const mod = (await import('firebase-admin')) as unknown as {
    default?: AdminNamespace;
  } & AdminNamespace;
  return mod.default ?? mod;
}

async function loadAuthNamespace(): Promise<AuthNamespace> {
  const mod = (await import('firebase-admin/auth')) as unknown as {
    default?: AuthNamespace;
  } & AuthNamespace;
  return mod.default ?? mod;
}

async function getAdminApp(): Promise<AdminApp | null> {
  if (globalAdmin.__loylFirebaseAdmin !== undefined) {
    return globalAdmin.__loylFirebaseAdmin;
  }
  if (!isFirebaseConfigured()) {
    globalAdmin.__loylFirebaseAdmin = null;
    return null;
  }
  // Share one init across concurrent first requests (import + initializeApp
  // are not idempotent across interleaved callers).
  if (globalAdmin.__loylFirebaseAdminInit) {
    return globalAdmin.__loylFirebaseAdminInit;
  }
  const init = (async () => {
    try {
      const admin = await loadAdminNamespace();
      if (admin.apps?.length) {
        globalAdmin.__loylFirebaseAdmin = admin.apps[0];
        return globalAdmin.__loylFirebaseAdmin;
      }
      // Verify-only init needs no secret (ID-token checks use Google's public
      // certs); attach full credentials only when a real private key is set.
      const privateKey = getPrivateKey();
      const app = privateKey
        ? admin.initializeApp({
            credential: admin.credential.cert({
              projectId: process.env.FIREBASE_PROJECT_ID,
              clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
              privateKey,
            }),
            projectId: process.env.FIREBASE_PROJECT_ID,
          })
        : admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID });
      globalAdmin.__loylFirebaseAdmin = app;
      return app;
    } catch (err) {
      globalAdmin.__loylFirebaseAdminError = err instanceof Error ? err.message : String(err);
      globalAdmin.__loylFirebaseAdmin = null;
      return null;
    }
  })();
  globalAdmin.__loylFirebaseAdminInit = init;
  return init;
}

/**
 * Local 11-digit identity (01712345678) from a Firebase E.164 claim
 * (+8801712345678). Returns null when the claim is not a BD mobile.
 */
export function firebasePhoneToLocal(e164: string): string | null {
  const clean = e164.trim().replace(/[\s-]/g, '');
  const m = clean.match(/^\+880(1[3-9]\d{8})$/);
  return m ? `0${m[1]}` : null;
}

/** E.164 (+880...) from a local 11-digit number. Null when invalid. */
export function localPhoneToE164(local: string): string | null {
  const clean = local.trim().replace(/^\+88/, '');
  return /^01[3-9]\d{8}$/.test(clean) ? `+88${clean}` : null;
}

/**
 * Verify a Firebase ID token. Null = missing/expired/forged — never throws.
 * Email/password tokens carry `email` (no `phone_number`); phone-provider
 * tokens carry `phone_number`. At least one identity claim must be present.
 *
 * Bounded: a stalled Admin SDK (e.g. unreachable public-certs endpoint)
 * rejects with a coded error instead of hanging the session-mint request.
 */
export async function verifyFirebaseIdToken(idToken: string): Promise<FirebaseDecodedUser | null> {
  const app = await getAdminApp();
  if (!app) {
    console.warn(
      'verifyFirebaseIdToken: Admin app unavailable',
      globalAdmin.__loylFirebaseAdminError ?? 'not configured'
    );
    return null;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Modular API: firebase-admin v14 removed the legacy `app.auth()` method —
    // calling it throws `app.auth is not a function`, which used to surface
    // as a blanket INVALID_FIREBASE_TOKEN for every real sign-in.
    const { getAuth } = await loadAuthNamespace();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error('Firebase verification timed out') as Error & { code?: string };
        err.code = 'auth/network-request-failed';
        reject(err);
      }, VERIFY_TIMEOUT_MS);
      (timer as unknown as { unref?: () => void }).unref?.();
    });
    const decoded = (await Promise.race([
        getAuth(app).verifyIdToken(idToken),
        timeout,
      ])) as Record<string, unknown>;
    const uid = typeof decoded.uid === 'string' ? decoded.uid : null;
    const phone =
      typeof decoded.phone_number === 'string' ? (decoded.phone_number as string) : null;
    const email =
      typeof decoded.email === 'string' ? (decoded.email as string).trim().toLowerCase() : null;
    if (!uid || (!phone && !email)) {
      console.warn('verifyFirebaseIdToken: token verified but carries no identity claim');
      return null;
    }
    // Bound the token to this project (Admin SDK already checks aud/iss, but
    // an explicit project pin keeps multi-project mistakes loud, not silent).
    if (
      process.env.FIREBASE_PROJECT_ID &&
      typeof decoded.aud === 'string' &&
      decoded.aud !== process.env.FIREBASE_PROJECT_ID
    ) {
      console.warn('verifyFirebaseIdToken: token aud does not match FIREBASE_PROJECT_ID');
      return null;
    }
    return {
      uid,
      phoneNumber: phone,
      email,
      emailVerified: decoded.email_verified === true,
    };
  } catch (err) {
    // Code only (auth/id-token-expired, auth/argument-error, …) — never the token.
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code: unknown }).code)
        : 'unknown';
    // Message is diagnostic only — truncated, and never the token (the SDK
    // error messages carry module paths/claims, not the raw JWT).
    const msg = err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
    console.warn('verifyFirebaseIdToken: verification failed', code, '|', msg);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
