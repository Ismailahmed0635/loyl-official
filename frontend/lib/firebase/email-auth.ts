'use client';

/**
 * frontend/lib/firebase/email-auth.ts — Email/Password Auth + Firestore `users`.
 *
 * Spark-plan compatible: Email/Password provider + Cloud Firestore only,
 * no phone OTP / SMS gateway involved.
 *
 * Pure helpers (validateEmail / validatePassword / normalizeOptionalPhone /
 * buildUserDoc / authErrorMessage) have zero Firebase imports so colocated
 * vitest needs no SDK or DOM. The three async wrappers dynamic-import the SDK
 * and reuse the `client.ts` singleton (no second Firebase app).
 */

import { getFirebaseAuth } from '@/lib/firebase/client';

/** Shown when any auth network step stalls — every await below is bounded. */
export const AUTH_SLOW_NETWORK_MESSAGE =
  'Taking too long — check your connection and try again.';

/** Budgets: the Firestore profile write is best-effort, never a blocker. */
export const REGISTER_TIMEOUT_MS = 30_000;
export const PROFILE_WRITE_TIMEOUT_MS = 10_000;
export const LOGIN_TIMEOUT_MS = 20_000;
export const ID_TOKEN_TIMEOUT_MS = 15_000;

export interface EmailRegisterInput {
  email: string;
  password: string;
  /** Optional — stored only when non-empty and valid. */
  phone?: string;
}

export interface UserDoc {
  uid: string;
  email: string;
  /** Present only when the user supplied a phone number. */
  phone?: string;
}

/** RFC-lite email check — Firebase re-validates server-side. */
export function validateEmail(email: string): string | null {
  const clean = email.trim();
  if (!clean) return 'Email is required.';
  if (clean.length > 254) return 'Enter a valid email address.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return 'Enter a valid email address.';
  return null;
}

/** Standard security bar: 8+ chars with upper + lower + number. */
export function validatePassword(password: string): string | null {
  if (!password) return 'Password is required.';
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Use upper + lower + number (e.g. Loyl2026Bd).';
  }
  return null;
}

/**
 * Optional phone: empty/whitespace → null (field omitted).
 * Otherwise accepts E.164 or BD local digits; null = invalid.
 */
export function normalizeOptionalPhone(phone?: string): string | null {
  if (phone === undefined || phone === null) return null;
  const clean = phone.trim().replace(/[\s-]/g, '');
  if (!clean) return null;
  if (/^\+?[0-9]{7,15}$/.test(clean)) return clean;
  return null;
}

export function isValidOptionalPhone(phone?: string): boolean {
  if (!phone || !phone.trim()) return true;
  return normalizeOptionalPhone(phone) !== null;
}

/** Firestore `users/{uid}` payload (caller adds `createdAt: serverTimestamp()`). */
export function buildUserDoc(uid: string, email: string, phone?: string): UserDoc {
  const normalized = normalizeOptionalPhone(phone);
  return {
    uid,
    email: email.trim(),
    ...(normalized ? { phone: normalized } : {}),
  };
}

/** Firebase code → user-friendly message. Unknown → safe fallback. */
export function authErrorMessage(e: unknown): string {
  // AbortSignal.timeout rejections (fetch) carry name, not code.
  if (typeof e === 'object' && e !== null && 'name' in e && (e as { name: unknown }).name === 'AbortError') {
    return AUTH_SLOW_NETWORK_MESSAGE;
  }
  const code =
    typeof e === 'object' && e !== null && 'code' in e
      ? String((e as { code: unknown }).code)
      : '';
  switch (code) {
    case 'auth/email-already-in-use':
      return 'This email is already registered. Try logging in.';
    case 'auth/weak-password':
      return 'Password too weak — use 8+ characters with letters and numbers.';
    case 'auth/invalid-email':
      return 'Enter a valid email address.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Wrong email or password.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Try again later.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and retry.';
    default:
      if (e instanceof Error && e.message) return e.message;
      return 'Something went wrong. Please try again.';
  }
}

/**
 * Bound an await that may stall forever (unprovisioned Firestore, dropped
 * network). Rejects with `message` after `ms`; the timer is always cleared.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
    // Don't hold a Node process open for a timer nobody waits on.
    (timer as unknown as { unref?: () => void }).unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Register with Email/Password, then write `users/{uid}` =
 * { uid, email, phone? } (+ serverTimestamp). Throws Error with a
 * user-friendly message — render `err.message` directly.
 *
 * The profile write is best-effort: the Auth account already exists at that
 * point, so a slow/denied/unprovisioned Firestore only warns and sign-in
 * proceeds instead of trapping the merchant on a spinner.
 */
export async function registerWithEmail(input: EmailRegisterInput): Promise<{ uid: string; email: string | null }> {
  const emailErr = validateEmail(input.email);
  if (emailErr) throw new Error(emailErr);
  const pwErr = validatePassword(input.password);
  if (pwErr) throw new Error(pwErr);
  if (!isValidOptionalPhone(input.phone)) {
    throw new Error('Enter a valid phone number or leave it blank.');
  }
  try {
    const auth = await withTimeout(getFirebaseAuth(), ID_TOKEN_TIMEOUT_MS, AUTH_SLOW_NETWORK_MESSAGE);
    const { createUserWithEmailAndPassword } = await import('firebase/auth');
    const cred = await withTimeout(
      createUserWithEmailAndPassword(auth, input.email.trim(), input.password),
      REGISTER_TIMEOUT_MS,
      AUTH_SLOW_NETWORK_MESSAGE
    );
    try {
      const { getFirestore, doc, setDoc, serverTimestamp } = await import('firebase/firestore');
      const db = getFirestore(auth.app);
      await withTimeout(
        setDoc(doc(db, 'users', cred.user.uid), {
          ...buildUserDoc(cred.user.uid, cred.user.email ?? input.email.trim()),
          createdAt: serverTimestamp(),
        }),
        PROFILE_WRITE_TIMEOUT_MS,
        'Profile save timed out.'
      );
    } catch (profileErr) {
      console.warn(
        'users/{uid} profile write skipped:',
        profileErr instanceof Error ? profileErr.message : profileErr
      );
    }
    return { uid: cred.user.uid, email: cred.user.email };
  } catch (e) {
    throw new Error(authErrorMessage(e));
  }
}

/** Sign in with Email/Password. Throws Error with a user-friendly message. */
export async function loginWithEmail(email: string, password: string): Promise<{ uid: string; email: string | null }> {
  const emailErr = validateEmail(email);
  if (emailErr) throw new Error(emailErr);
  if (!password) throw new Error('Password is required.');
  try {
    const auth = await withTimeout(getFirebaseAuth(), ID_TOKEN_TIMEOUT_MS, AUTH_SLOW_NETWORK_MESSAGE);
    const { signInWithEmailAndPassword } = await import('firebase/auth');
    const cred = await withTimeout(
      signInWithEmailAndPassword(auth, email.trim(), password),
      LOGIN_TIMEOUT_MS,
      AUTH_SLOW_NETWORK_MESSAGE
    );
    return { uid: cred.user.uid, email: cred.user.email };
  } catch (e) {
    throw new Error(authErrorMessage(e));
  }
}

/** Sign out the current Firebase user (best-effort, never throws). */
export async function logoutEmail(): Promise<void> {
  try {
    const auth = await withTimeout(getFirebaseAuth(), ID_TOKEN_TIMEOUT_MS, AUTH_SLOW_NETWORK_MESSAGE);
    const { signOut } = await import('firebase/auth');
    await withTimeout(signOut(auth), ID_TOKEN_TIMEOUT_MS, AUTH_SLOW_NETWORK_MESSAGE);
  } catch {
    /* best-effort */
  }
}

/**
 * ID token for the currently signed-in Firebase user — the server verifies
 * it to mint `loyl_session` (POST /api/auth/session). Null when signed out.
 * Force-refreshes: a cached token older than 1h fails server verification
 * with INVALID_FIREBASE_TOKEN. Bounded so it can never hang the UI.
 */
export async function getFirebaseIdToken(): Promise<string | null> {
  try {
    const auth = await withTimeout(getFirebaseAuth(), ID_TOKEN_TIMEOUT_MS, AUTH_SLOW_NETWORK_MESSAGE);
    const user = auth.currentUser;
    if (!user) return null;
    return await withTimeout(user.getIdToken(true), ID_TOKEN_TIMEOUT_MS, AUTH_SLOW_NETWORK_MESSAGE);
  } catch {
    return null;
  }
}
