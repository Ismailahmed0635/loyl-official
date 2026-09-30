/**
 * Scratch-card reveal math (pure helpers — unit-tested in node).
 *
 * The foil is an RGBA canvas layer painted over the prize; scratching draws
 * with `destination-out`, so cleared pixels drop to alpha 0. Reveal happens
 * once enough of the foil has been scratched away.
 */

/** Fraction (0–1) of the foil that must be cleared before the prize reveals. */
export const REVEAL_THRESHOLD = 0.6;

/** A pixel counts as scratched once its alpha falls below this (0–255). */
export const CLEARED_ALPHA = 128;

/** Pull the alpha channel out of an RGBA ImageData-style buffer. */
export function extractAlphas(rgba: ArrayLike<number>): Uint8Array {
  const count = Math.floor(rgba.length / 4);
  const alphas = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    alphas[i] = rgba[i * 4 + 3] ?? 0;
  }
  return alphas;
}

/** Ratio (0–1) of scratched pixels within a list of alpha samples. */
export function revealedRatio(
  alphas: ArrayLike<number>,
  clearedAlpha: number = CLEARED_ALPHA
): number {
  if (alphas.length === 0) return 0;
  let cleared = 0;
  for (let i = 0; i < alphas.length; i++) {
    if (alphas[i] < clearedAlpha) cleared++;
  }
  return cleared / alphas.length;
}

/** True once the revealed ratio reaches the threshold (NaN-safe). */
export function isRevealed(ratio: number, threshold: number = REVEAL_THRESHOLD): boolean {
  return Number.isFinite(ratio) && ratio >= threshold;
}
