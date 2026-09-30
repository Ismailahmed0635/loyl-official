import { afterEach, describe, expect, it } from 'vitest';
import { clearCache, inspect, invalidate, prime } from './cache';

/**
 * Tests for the cache store half of `lib/api/cache.ts`.
 *
 * The read path is a React hook (`useQuery`), so it is exercised in the running
 * app rather than here: a revisited route repaints from cache instead of a
 * spinner, and the `useSyncExternalStore` snapshot stays referentially stable
 * (the failure mode this module once had — "Maximum update depth exceeded" —
 * is visible immediately if the snapshot is rebuilt per read).
 *
 * What is unit-testable without React is exactly what a wrong implementation
 * would break: writing, going stale without losing data, and clearing on sign-out.
 */

const KEY = 'unit:test:key';

afterEach(() => {
  clearCache();
});

describe('cache store', () => {
  it('prime() writes a value a later reader observes, marked fresh', () => {
    prime(KEY, { hello: 'world' });
    expect(inspect(KEY)).toEqual({ fresh: true, data: { hello: 'world' } });
  });

  it('invalidate() marks an entry stale without dropping its payload', () => {
    prime(KEY, { n: 1 });
    invalidate(KEY);
    expect(inspect(KEY)).toEqual({ fresh: false, data: { n: 1 } });
  });

  it('re-priming replaces the payload and makes it fresh again', () => {
    prime(KEY, { n: 1 });
    invalidate(KEY);
    prime(KEY, { n: 2 });
    expect(inspect(KEY)).toEqual({ fresh: true, data: { n: 2 } });
  });

  it('invalidate() accepts several keys and ignores unknown ones', () => {
    prime('a', 1);
    prime('b', 2);
    expect(() => invalidate('a', 'never:registered')).not.toThrow();
    expect(inspect('a')?.fresh).toBe(false);
    expect(inspect('never:registered')).toBeUndefined();
  });

  it('clearCache() drops every entry — sign-out must not leak between accounts', () => {
    prime(KEY, { secret: 'merchant-a' });
    prime('other', { secret: 'merchant-a' });
    clearCache();
    expect(inspect(KEY)).toBeUndefined();
    expect(inspect('other')).toBeUndefined();
  });

  it('inspect() on a never-used key is undefined, not an empty entry', () => {
    expect(inspect('brand:new')).toBeUndefined();
  });

  it('prime() accepts falsy payloads (0, empty string, null)', () => {
    prime('zero', 0);
    prime('empty', '');
    prime('nil', null);
    expect(inspect('zero')).toEqual({ fresh: true, data: 0 });
    expect(inspect('empty')).toEqual({ fresh: true, data: '' });
    expect(inspect('nil')).toEqual({ fresh: true, data: null });
  });
});
