/**
 * frontend/lib/fetchErrors.ts — where a stalled fetch becomes a readable message.
 *
 * `AbortSignal.timeout()` rejects with a DOMException named `TimeoutError`
 * (Chrome's text is exactly "signal timed out"); a manual `AbortController`
 * abort arrives as `AbortError`. Guarding only for `AbortError` let the raw
 * "signal timed out" text render on Stamp Requests and friends.
 *
 * Deliberately free of Firebase imports: every API wrapper imports this, so it
 * must not pull the SDK into their bundles. `email-auth.ts` re-exports the
 * message for its own callers.
 */

/** Shown when any bounded network step stalls — every wrapper below is bounded. */
export const AUTH_SLOW_NETWORK_MESSAGE =
  'Taking too long — check your connection and try again.';

/** True for either flavour of fetch abort: `AbortError` or `TimeoutError`. */
export function isTimeoutOrAbort(e: unknown): boolean {
  if (typeof e !== 'object' || e === null || !('name' in e)) return false;
  const name = (e as { name: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

/**
 * The error a wrapper should reject with: an abort/timeout becomes
 * `AUTH_SLOW_NETWORK_MESSAGE`, anything else returns `null` so the caller can
 * rethrow the original and keep its own message.
 */
export function abortError(e: unknown): Error | null {
  return isTimeoutOrAbort(e) ? new Error(AUTH_SLOW_NETWORK_MESSAGE) : null;
}
