'use client';

import { useCallback } from 'react';
import { useReducedMotion } from 'framer-motion';

/** Brand palette bursts (green = positive, amber = reward, red accent). */
const CONFETTI_COLORS = ['#16A34A', '#F59E0B', '#AC1820', '#FFFFFF'];

/**
 * Returns a `fire()` callback that bursts canvas-confetti once.
 * No-ops when the user prefers reduced motion (design rule) or when the
 * canvas package can't load.
 */
export function useConfetti() {
  const shouldReduceMotion = useReducedMotion();

  return useCallback(async () => {
    if (shouldReduceMotion) return;
    try {
      const confetti = (await import('canvas-confetti')).default;
      confetti({
        particleCount: 100,
        spread: 75,
        origin: { y: 0.6 },
        colors: CONFETTI_COLORS,
        disableForReducedMotion: true,
      });
    } catch (err) {
      // Confetti is decoration — never surface failures. Dev-only log so
      // production consoles stay clean.
      if (process.env.NODE_ENV !== 'production') console.debug('confetti unavailable', err);
    }
  }, [shouldReduceMotion]);
}
