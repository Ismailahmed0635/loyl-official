import { BusinessSetupInput, EmailSessionInput } from '@/backend/validation/schemas';
import { AUTH_SLOW_NETWORK_MESSAGE } from '@/lib/firebase/email-auth';
import { clearCache } from '@/lib/api/cache';

/** fetch() has no default timeout — bound every auth POST so the UI can't hang. */
const AUTH_FETCH_TIMEOUT_MS = 20_000;

async function postJson(path: string, data: unknown) {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(AUTH_FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    if (typeof e === 'object' && e !== null && 'name' in e && (e as { name: unknown }).name === 'AbortError') {
      throw new Error(AUTH_SLOW_NETWORK_MESSAGE);
    }
    throw e;
  }
  return res.json();
}

/**
 * `GET /api/auth/me` is read by the merchant shell, the customer shell, and the
 * profile page. Each used to fetch it independently, so one navigation could
 * hit the endpoint twice. A single shared in-flight promise collapses a burst
 * of mounts into one request; the entry expires after `AUTH_ME_TTL` so a later
 * navigation still re-checks the session, and `logout()` drops it outright.
 */
const AUTH_ME_TTL = 15_000;

let authMePromise: Promise<any> | null = null;
let authMeExpiresAt = 0;

export function getAuthMe(): Promise<any> {
  // Cache the *promise*, not the result: a settled-but-fresh entry and a still
  // pending one are both reusable, so concurrent mounts share one request and a
  // later navigation re-checks after AUTH_ME_TTL.
  if (authMePromise && Date.now() < authMeExpiresAt) return authMePromise;

  authMePromise = fetch('/api/auth/me', { signal: AbortSignal.timeout(AUTH_FETCH_TIMEOUT_MS) })
    .then((res) => res.json())
    .then((payload) => {
      // HTTP-error payloads ({success:false}) are live state, not cacheable —
      // a 401 now must not mask a fresh login for the next 15s.
      if (!payload || payload.success !== true) {
        authMePromise = null;
        authMeExpiresAt = 0;
      }
      return payload;
    });
  authMeExpiresAt = Date.now() + AUTH_ME_TTL;
  authMePromise.catch(() => {
    authMePromise = null;
    authMeExpiresAt = 0;
  });
  return authMePromise;
}

/** Email/password transport: mint `loyl_session` from a verified Firebase ID token. */
export async function createEmailSession(data: EmailSessionInput) {
  return postJson('/api/auth/session', data);
}

export async function submitBusinessSetup(data: BusinessSetupInput) {
  return postJson('/api/auth/business-setup', data);
}

export async function logout() {
  try {
    const res = await fetch('/api/auth/logout', {
      method: 'POST',
      signal: AbortSignal.timeout(AUTH_FETCH_TIMEOUT_MS),
    });
    return res.json();
  } finally {
    // Drop the Firebase sign-in too, or the next visit would silently
    // re-mint a server session from the surviving Firebase user.
    try {
      const { logoutEmail } = await import('@/lib/firebase/email-auth');
      await logoutEmail();
    } catch {
      /* best-effort */
    }
    // Never let the next account see the previous one's cached responses.
    authMePromise = null;
    authMeExpiresAt = 0;
    clearCache();
  }
}
