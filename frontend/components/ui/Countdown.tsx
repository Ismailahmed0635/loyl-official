'use client';

import React, { useEffect, useRef, useState } from 'react';
import { timeLeftClock } from '@/lib/format';

export interface CountdownState {
  /** "23:59:41" — ticks once per second while the window is closed. */
  text: string;
  /** True once the target has passed (or there was no target at all). */
  done: boolean;
}

/**
 * Ticking HH:MM:SS countdown to an ISO timestamp.
 *
 * The clock is presentation only — it exists so the UI can unlock an action
 * the instant the window closes instead of waiting for a refetch. The real
 * window is always re-evaluated server-side against the server's own clock
 * (`backend/scratch.ts`), so a faked client clock buys nothing.
 *
 * Pass `null`/`undefined` for "no window" — that reports `done: true` so a
 * caller falls straight through to its unlocked state.
 */
export function useCountdown(iso: string | null | undefined): CountdownState {
  const [now, setNow] = useState(() => Date.now());

  const endMs = iso ? new Date(iso).getTime() : NaN;
  const hasTarget = Number.isFinite(endMs);

  // Re-render every second only while there is something to count down to.
  // The interval stops itself on expiry so an open tab stops ticking once the
  // caller has switched to its unlocked state.
  useEffect(() => {
    if (!hasTarget || endMs <= Date.now()) return;
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= endMs) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [hasTarget, endMs]);

  if (!hasTarget) return { text: '', done: true };
  return { text: timeLeftClock(iso, now), done: endMs <= now };
}

/**
 * Fires `onOpen` exactly once when a lock transitions closed → open.
 * Used to clear a stale "come back later" message the moment it stops being
 * true, rather than leaving it on screen over the newly-enabled action.
 */
export function useLockOpened(open: boolean, onOpen: () => void): void {
  const wasOpen = useRef<boolean | null>(null);
  const cb = useRef(onOpen);
  cb.current = onOpen;

  useEffect(() => {
    if (wasOpen.current === false && open) cb.current();
    wasOpen.current = open;
  }, [open]);
}
