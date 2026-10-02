import { Transition, Variants } from 'framer-motion';

export const EASE_OUT = [0.16, 1, 0.3, 1];
export const EASE_BOUNCE = [0.34, 1.56, 0.64, 1];

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: EASE_OUT },
  },
};

export const slideUp: Variants = {
  hidden: { opacity: 0, y: 60 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: EASE_OUT },
  },
};

/**
 * slideUpVisible — the same slide-up, but the hidden state keeps opacity 1:
 * the server HTML paints the content immediately (the animation only moves it),
 * so above-the-fold hero content is never held invisible until hydration.
 * Lighthouse measured the fade-from-invisible variant as LCP 2.7s (the element
 * only "painted" once React took over); with this recipe it paints at FCP.
 * Use it for the LCP-critical hero — not for content that should stay hidden.
 */
export const slideUpVisible: Variants = {
  hidden: { opacity: 1, y: 60 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: EASE_OUT },
  },
};

export const slideDown: Variants = {
  hidden: { opacity: 0, y: -200 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: EASE_OUT },
  },
};

export const slideFromLeft: Variants = {
  hidden: { opacity: 0, x: -20 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.4, ease: EASE_OUT },
  },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.3, ease: EASE_BOUNCE },
  },
};

export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0, rotate: -180 },
  visible: {
    opacity: 1,
    scale: 1,
    rotate: 0,
    transition: { duration: 0.6, ease: EASE_BOUNCE },
  },
};

export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.3,
    },
  },
};

/** progressFill — width 0→N%, 800ms ease-out (cookbook factory: pass the target %). */
export const progressFill = (percent: number): Variants => ({
  hidden: { width: '0%' },
  visible: {
    width: `${Math.max(0, Math.min(100, percent))}%`,
    transition: { duration: 0.8, ease: EASE_OUT },
  },
});

/**
 * diceTumble — one tick of the 3D tumble while a roll is in flight: the dice
 * flip a full turn (or more, per die) on X and Y with a small hop, stepped
 * every ~130ms from DiceOfferView so each die spins at its own speed. Keep it
 * snappy and linear — it is a step, not an easing curve.
 */
export const diceTumble: Transition = { duration: 0.13, ease: 'linear' };

/**
 * diceLanding — the spin-down when the server answers: one last full flip that
 * settles on the face the customer rolled, with a bounce and a short per-die
 * stagger so the dice come to rest one after another.
 */
export const diceLanding: Transition = { duration: 0.7, ease: EASE_BOUNCE };
