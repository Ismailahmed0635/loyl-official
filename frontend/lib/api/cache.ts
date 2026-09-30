import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

/**
 * Tiny stale-while-revalidate cache for the API layer.
 *
 * Why not React Query / SWR: CODIN §1 forbids adding a dependency that is not
 * already in `package.json` without asking first, and the app needs exactly one
 * behaviour — serve what we have instantly, revalidate in the background, and
 * dedupe concurrent requests for the same key. That is what this file is.
 *
 * Keys are plain strings derived from the request, so navigating away and back
 * replays the same key: the page paints with the previous response instead of a
 * spinner, then revalidates once it is older than the TTL.
 */

const DEFAULT_TTL = 30_000;

/** Immutable read model handed to `useSyncExternalStore`. */
export interface CacheState<T> {
  data?: T;
  error?: unknown;
  updatedAt: number;
}

interface Entry<T = unknown> {
  data?: T;
  error?: unknown;
  /** Timestamp of the last resolution (success or failure). */
  updatedAt: number;
  /** In-flight request, shared by every subscriber hitting the same key. */
  inflight?: Promise<T>;
  listeners: Set<() => void>;
  /**
   * Memoized snapshot. `getSnapshot` must return the *same reference* until the
   * data actually changes — rebuilding the object on every read makes React
   * re-render forever ("Maximum update depth exceeded").
   */
  snapshot: CacheState<T>;
}

const EMPTY_STATE: CacheState<never> = { updatedAt: 0 };

const store = new Map<string, Entry>();

function entryFor(key: string): Entry {
  let e = store.get(key);
  if (!e) {
    e = { updatedAt: 0, listeners: new Set(), snapshot: EMPTY_STATE as CacheState<unknown> };
    store.set(key, e);
  }
  return e;
}

/** Publishes a new snapshot to subscribers. Only call after a real change. */
function commit(e: Entry): void {
  e.snapshot = { data: e.data, error: e.error, updatedAt: e.updatedAt };
  e.listeners.forEach((l) => l());
}

/**
 * Writes a known-good response into `key` without a network round trip.
 * Used after a successful mutation so the next visit shows the saved value
 * instead of re-fetching stale data.
 */
export function prime<T>(key: string, data: T): void {
  const e = entryFor(key);
  e.data = data;
  e.error = undefined;
  e.updatedAt = Date.now();
  commit(e);
}

/**
 * Introspection for tests: `{ fresh, data }` for a key, or `undefined` when the
 * key was never registered. Not used by app code — `useQuery` is the public API.
 */
export function inspect<T>(key: string): { fresh: boolean; data?: T } | undefined {
  const e = store.get(key);
  if (!e) return undefined;
  return { fresh: e.updatedAt > 0, data: e.data as T | undefined };
}

/** Marks a key stale so the next mount revalidates, without dropping data. */
export function invalidate(...keys: string[]): void {
  keys.forEach((k) => {
    const e = store.get(k);
    if (!e) return;
    e.updatedAt = 0;
    commit(e);
  });
}

/**
 * Drops every entry. Sign-out must never let the next account see the previous
 * account's cached responses, so `logout()` calls this.
 */
export function clearCache(): void {
  const entries = [...store.values()];
  store.clear();
  entries.forEach((e) => {
    e.listeners.clear();
  });
}

/** Runs `fetcher` for `key`, sharing one in-flight promise across callers. */
function run<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const e = entryFor(key);
  if (e.inflight) return e.inflight as Promise<T>;

  const p = fetcher()
    .then((data) => {
      e.data = data;
      e.error = undefined;
      e.updatedAt = Date.now();
      return data;
    })
    .catch((error) => {
      e.error = error;
      e.updatedAt = Date.now();
      throw error;
    })
    .finally(() => {
      e.inflight = undefined;
      commit(e);
    });

  e.inflight = p;
  // A rejected promise that nobody awaits yet must not become an unhandled
  // rejection — the caller above re-throws it for the component that asked.
  p.catch(() => undefined);
  return p;
}

export interface UseQueryResult<T> {
  data: T | undefined;
  error: unknown;
  /** Nothing cached yet and a request is outstanding. */
  isLoading: boolean;
  /** A revalidation is running while cached data (if any) stays on screen. */
  isValidating: boolean;
  refetch: () => Promise<T | undefined>;
}

/**
 * SWR-style read of `key`.
 *
 * - cached + fresh  -> returns immediately, no network
 * - cached + stale  -> returns immediately, revalidates behind the paint
 * - nothing cached  -> fetches; `isLoading` stays true until it resolves
 *
 * `enabled: false` skips the fetch while still exposing cached data (for keys
 * whose inputs are not ready yet).
 */
export function useQuery<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  options: { ttl?: number; enabled?: boolean } = {}
): UseQueryResult<T> {
  const { ttl = DEFAULT_TTL, enabled = true } = options;
  const active = key !== null && enabled;

  // Keep the latest fetcher without making it part of the subscription identity.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!key) return () => {};
      const e = entryFor(key);
      e.listeners.add(onChange);
      return () => {
        e.listeners.delete(onChange);
      };
    },
    [key]
  );

  const getSnapshot = useCallback((): CacheState<T> => {
    if (!key) return EMPTY_STATE as CacheState<T>;
    return entryFor(key).snapshot as CacheState<T>;
  }, [key]);

  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [isValidating, setValidating] = useState(false);

  // Bump on every commit so a stale entry triggers exactly one revalidation.
  const stamp = state.updatedAt;

  useEffect(() => {
    if (!active || !key) return;
    const e = entryFor(key);
    if (e.inflight) return;
    if (stamp > 0 && Date.now() - stamp < ttl) return;

    let alive = true;
    setValidating(true);
    // The rejection also publishes through state.error (commit in run), so
    // swallow it here: without this, the effect-fired fetch is an unhandled
    // rejection (pageerror in the console) on every failed load — e.g. a guest
    // landing on /menu, which middleware leaves public for /menu/[slug].
    run(key, () => fetcherRef.current())
      .catch(() => undefined)
      .finally(() => {
        if (alive) setValidating(false);
      });
    return () => {
      alive = false;
    };
  }, [key, active, ttl, stamp]);

  const refetch = useCallback(async () => {
    if (!key) return undefined;
    setValidating(true);
    try {
      return await run(key, () => fetcherRef.current());
    } catch {
      return undefined;
    } finally {
      setValidating(false);
    }
  }, [key]);

  const hasData = state.data !== undefined;
  return {
    data: state.data,
    error: state.error,
    isLoading: active && !hasData && state.error === undefined,
    isValidating,
    refetch,
  };
}
