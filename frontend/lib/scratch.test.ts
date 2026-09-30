import { describe, expect, it } from 'vitest';
import {
  CLEARED_ALPHA,
  REVEAL_THRESHOLD,
  extractAlphas,
  isRevealed,
  revealedRatio,
} from '@/lib/scratch';

describe('scratch card reveal math', () => {
  describe('extractAlphas', () => {
    it('pulls every 4th byte (alpha channel) from an RGBA buffer', () => {
      // R,G,B,A pairs: red opaque, green half, blue cleared
      const rgba = [255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0];
      expect(Array.from(extractAlphas(rgba))).toEqual([255, 128, 0]);
    });

    it('returns an empty array for a non-RGBA-length buffer', () => {
      expect(extractAlphas([])).toHaveLength(0);
      expect(extractAlphas([1, 2, 3])).toHaveLength(0);
    });

    it('treats missing trailing alpha as 0 (cleared)', () => {
      // 5 bytes → floor(5/4) = 1 pixel; index 3 = 200
      expect(Array.from(extractAlphas([1, 2, 3, 200, 9]))).toEqual([200]);
    });
  });

  describe('revealedRatio', () => {
    it('is 0 when nothing is scratched (all opaque)', () => {
      expect(revealedRatio([255, 255, 255, 255])).toBe(0);
    });

    it('is 1 when everything is scratched (all alpha 0)', () => {
      expect(revealedRatio([0, 0, 0, 0])).toBe(1);
    });

    it('is 0.5 when half the pixels are scratched', () => {
      expect(revealedRatio([255, 0, 255, 0])).toBeCloseTo(0.5);
    });

    it('is 0 for an empty sample (never spuriously revealed)', () => {
      expect(revealedRatio([])).toBe(0);
    });

    it('treats alpha below CLEARED_ALPHA as scratched', () => {
      expect(revealedRatio([CLEARED_ALPHA - 1])).toBe(1);
      expect(revealedRatio([CLEARED_ALPHA])).toBe(0); // boundary is exclusive
      expect(revealedRatio([255])).toBe(0);
    });

    it('respects a custom cleared threshold', () => {
      expect(revealedRatio([100], 50)).toBe(0);
      expect(revealedRatio([100], 150)).toBe(1);
    });
  });

  describe('isRevealed', () => {
    it('reveals at exactly the default threshold', () => {
      expect(isRevealed(REVEAL_THRESHOLD)).toBe(true);
    });

    it('does not reveal below the threshold', () => {
      expect(isRevealed(REVEAL_THRESHOLD - 0.01)).toBe(false);
      expect(isRevealed(0)).toBe(false);
    });

    it('reveals above the threshold (fully scratched)', () => {
      expect(isRevealed(1)).toBe(true);
    });

    it('accepts a custom threshold', () => {
      expect(isRevealed(0.4, 0.3)).toBe(true);
      expect(isRevealed(0.4, 0.5)).toBe(false);
    });

    it('is NaN/infinity-safe (never reveals on bad data)', () => {
      expect(isRevealed(Number.NaN)).toBe(false);
      expect(isRevealed(Number.POSITIVE_INFINITY)).toBe(false);
    });
  });

  describe('integration: RGBA buffer → reveal', () => {
    it('a 70%-scratched foil passes the default threshold', () => {
      const total = 100;
      const rgba: number[] = [];
      for (let i = 0; i < total; i++) {
        const cleared = i < 70;
        rgba.push(0, 0, 0, cleared ? 0 : 255);
      }
      expect(isRevealed(revealedRatio(extractAlphas(rgba)))).toBe(true);
    });

    it('a 40%-scratched foil stays hidden', () => {
      const total = 100;
      const rgba: number[] = [];
      for (let i = 0; i < total; i++) {
        const cleared = i < 40;
        rgba.push(0, 0, 0, cleared ? 0 : 255);
      }
      expect(isRevealed(revealedRatio(extractAlphas(rgba)))).toBe(false);
    });
  });
});
