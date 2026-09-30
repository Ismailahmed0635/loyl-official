import { describe, it, expect } from 'vitest';
import {
  rollDice,
  buildDiceState,
  discountPercentFor,
  normalizeDiceCount,
  faceOrientation,
  landingRotation,
  type DiceRollRow,
} from './dice';
import { MAX_DICE_COUNT, MIN_DICE_COUNT, DEFAULT_DICE_COUNT } from '@/lib/constants';

/** Deterministic PRNG so rolls are reproducible in tests. */
function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Always returns the same face in [0,1) — the 1-based face it maps to. */
function constRand(unit: number): () => number {
  return () => unit;
}

describe('normalizeDiceCount', () => {
  it('passes a valid count through unchanged', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      expect(normalizeDiceCount(n)).toBe(n);
    }
  });

  it('clamps out-of-range counts instead of throwing', () => {
    expect(normalizeDiceCount(0)).toBe(MIN_DICE_COUNT);
    expect(normalizeDiceCount(-3)).toBe(MIN_DICE_COUNT);
    expect(normalizeDiceCount(99)).toBe(MAX_DICE_COUNT);
  });

  it('rounds fractional counts to a whole number of dice', () => {
    expect(normalizeDiceCount(3.4)).toBe(3);
    expect(normalizeDiceCount(3.6)).toBe(4);
  });

  it('falls back to the default count for unusable input', () => {
    expect(normalizeDiceCount(Number.NaN)).toBe(DEFAULT_DICE_COUNT);
    expect(normalizeDiceCount(undefined)).toBe(DEFAULT_DICE_COUNT);
    expect(normalizeDiceCount(null)).toBe(DEFAULT_DICE_COUNT);
    expect(normalizeDiceCount('not a number')).toBe(DEFAULT_DICE_COUNT);
  });

  it('accepts a numeric string (a count that travelled through JSON/query)', () => {
    expect(normalizeDiceCount('4')).toBe(4);
  });
});

describe('discountPercentFor', () => {
  it('maps the roll total straight to the discount percent', () => {
    expect(discountPercentFor(1)).toBe(1);
    expect(discountPercentFor(17)).toBe(17);
    expect(discountPercentFor(30)).toBe(30);
  });

  it('rounds to a whole percent', () => {
    expect(discountPercentFor(7.6)).toBe(8);
    expect(discountPercentFor(7.2)).toBe(7);
  });

  it('clamps into 0–100 so no mapping can ever emit a nonsense discount', () => {
    expect(discountPercentFor(-5)).toBe(0);
    expect(discountPercentFor(250)).toBe(100);
    expect(discountPercentFor(Number.NaN)).toBe(0);
  });
});

describe('rollDice', () => {
  it('rolls exactly the requested number of dice', () => {
    for (const count of [1, 2, 3, 4, 5]) {
      const roll = rollDice(count, seededRand(7));
      expect(roll.diceCount).toBe(count);
      expect(roll.diceValues).toHaveLength(count);
    }
  });

  it('keeps every face inside 1–6 for many random rolls', () => {
    const rand = seededRand(1234);
    for (let i = 0; i < 2000; i++) {
      const roll = rollDice(5, rand);
      for (const face of roll.diceValues) {
        expect(face).toBeGreaterThanOrEqual(1);
        expect(face).toBeLessThanOrEqual(6);
      }
      expect(roll.total).toBeGreaterThanOrEqual(5);
      expect(roll.total).toBeLessThanOrEqual(30);
    }
  });

  it('is deterministic for an injected rand (0 -> lowest face, just under 1 -> 6)', () => {
    const lowest = rollDice(3, constRand(0));
    expect(lowest.diceValues).toEqual([1, 1, 1]);
    expect(lowest.total).toBe(3);

    const highest = rollDice(3, constRand(0.999999));
    expect(highest.diceValues).toEqual([6, 6, 6]);
    expect(highest.total).toBe(18);
  });

  it('never produces a face above 6 when rand() returns exactly 1', () => {
    const roll = rollDice(4, constRand(1));
    expect(roll.diceValues).toEqual([6, 6, 6, 6]);
  });

  it('never produces a face below 1 when rand() returns a negative value', () => {
    const roll = rollDice(2, () => -0.5);
    expect(roll.diceValues).toEqual([1, 1]);
  });

  it('reports the total as the discount percent', () => {
    const roll = rollDice(5, constRand(0.5)); // every face 1 + floor(0.5*6)=3 -> 4
    expect(roll.diceValues).toEqual([4, 4, 4, 4, 4]);
    expect(roll.total).toBe(20);
    expect(roll.discountPercent).toBe(20);
  });

  it('normalises a bad count rather than rolling nothing', () => {
    expect(rollDice(0, constRand(0)).diceValues).toEqual([1]);
    expect(rollDice(99, constRand(0)).diceValues).toHaveLength(MAX_DICE_COUNT);
    expect(rollDice(Number.NaN, constRand(0)).diceValues).toHaveLength(DEFAULT_DICE_COUNT);
  });

  it('sums the dice values exactly', () => {
    const rand = seededRand(99);
    for (let i = 0; i < 200; i++) {
      const roll = rollDice(4, rand);
      const sum = roll.diceValues.reduce((a, b) => a + b, 0);
      expect(roll.total).toBe(sum);
      expect(roll.discountPercent).toBe(sum);
    }
  });
});

describe('buildDiceState', () => {
  const now = new Date('2026-09-26T10:00:00.000Z');
  const row: DiceRollRow = {
    diceCount: 3,
    diceValues: [2, 5, 6],
    total: 13,
    discountPercent: 13,
    rolledAt: now,
  };

  it('arms the roll when the customer has never rolled', () => {
    expect(buildDiceState(null)).toEqual({
      hasRoll: false,
      lastRoll: null,
      canRoll: true,
    });
  });

  it('disarms the roll permanently once a result exists', () => {
    const state = buildDiceState(row);
    expect(state.hasRoll).toBe(true);
    expect(state.canRoll).toBe(false);
    expect(state.lastRoll?.diceValues).toEqual([2, 5, 6]);
    expect(state.lastRoll?.total).toBe(13);
    expect(state.lastRoll?.discountPercent).toBe(13);
  });

  it('serialises rolledAt as an ISO string', () => {
    const state = buildDiceState(row);
    expect(state.lastRoll?.rolledAt).toBe('2026-09-26T10:00:00.000Z');
  });
});

describe('faceOrientation (3D die landing)', () => {
  it('gives every face a distinct orientation', () => {
    const seen = new Set(
      [1, 2, 3, 4, 5, 6].map((f) => {
        const o = faceOrientation(f);
        return `${o.rotateX},${o.rotateY}`;
      })
    );
    expect(seen.size).toBe(6);
  });

  it('puts opposite faces 180° apart (opposite plates sum to 7)', () => {
    const pairs: Array<[number, number]> = [
      [1, 6],
      [2, 5],
      [3, 4],
    ];
    for (const [a, b] of pairs) {
      const oa = faceOrientation(a);
      const ob = faceOrientation(b);
      const dx = Math.abs(ob.rotateX - oa.rotateX);
      const dy = Math.abs(ob.rotateY - oa.rotateY);
      expect((dx === 180 && dy === 0) || (dy === 180 && dx === 0)).toBe(true);
    }
  });

  it('falls back to the front for unknown faces', () => {
    expect(faceOrientation(0)).toEqual({ rotateX: 0, rotateY: 0 });
    expect(faceOrientation(99)).toEqual(faceOrientation(1));
  });
});

describe('landingRotation (spin-down never rewinds)', () => {
  it('always moves forward past wherever the tumble left it', () => {
    for (const current of [0, 45, 360, 1000, 5000]) {
      for (const target of [0, 90, -90, 180, -180]) {
        expect(landingRotation(current, target)).toBeGreaterThan(current);
      }
    }
  });

  it('keeps the requested orientation (whole turns apart)', () => {
    const r = landingRotation(1400, -90);
    expect((r - -90) % 360).toBe(0);
    expect(r).toBeGreaterThan(1400);
  });

  it('still flips at least once when already on the target', () => {
    expect(landingRotation(90, -90)).toBe(270); // one extra turn forward
    expect(landingRotation(270, -90)).toBe(630); // exact hit → bumped a turn
  });
});
