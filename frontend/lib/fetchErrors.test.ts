import { describe, it, expect } from 'vitest';
import {
  AUTH_SLOW_NETWORK_MESSAGE,
  isTimeoutOrAbort,
  abortError,
} from './fetchErrors';

describe('fetchErrors', () => {
  it('recognises both abort flavours', () => {
    expect(isTimeoutOrAbort(new DOMException('signal timed out', 'TimeoutError'))).toBe(true);
    expect(isTimeoutOrAbort(new DOMException('The operation was aborted.', 'AbortError'))).toBe(true);
    // Name-only shapes (some runtimes hand back a plain object) count too.
    expect(isTimeoutOrAbort({ name: 'TimeoutError' })).toBe(true);
  });

  it('leaves every other rejection alone', () => {
    expect(isTimeoutOrAbort(new Error('signal timed out'))).toBe(false);
    expect(isTimeoutOrAbort({ code: 'auth/network-request-failed' })).toBe(false);
    expect(isTimeoutOrAbort(null)).toBe(false);
    expect(isTimeoutOrAbort(undefined)).toBe(false);
    expect(isTimeoutOrAbort('signal timed out')).toBe(false);
  });

  it('turns a timeout into the friendly message', () => {
    const friendly = abortError(new DOMException('signal timed out', 'TimeoutError'));
    expect(friendly).toBeInstanceOf(Error);
    expect(friendly?.message).toBe(AUTH_SLOW_NETWORK_MESSAGE);
    // The raw text must not survive anywhere in the mapped error.
    expect(friendly?.message).not.toContain('signal timed out');
  });

  it('returns null for non-aborts so callers rethrow the original', () => {
    const original = new Error('boom');
    expect(abortError(original)).toBeNull();
    expect(abortError({ code: 'auth/too-many-requests' })).toBeNull();
  });
});
