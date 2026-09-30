import { describe, it, expect } from 'vitest';
import {
  drawScratchReward,
  buildScratchState,
  normalizeCooldownHours,
  cooldownMs,
  SCRATCH_COOLDOWN_MS,
  type ScratchItemRow,
} from './scratch';
import {
  SCRATCH_COOLDOWN_DEFAULT_HOURS,
  SCRATCH_COOLDOWN_MIN_HOURS,
  SCRATCH_COOLDOWN_MAX_HOURS,
} from '@/lib/constants';

const items: ScratchItemRow[] = [
  { id: 'i1', label: 'Free Drink', sortOrder: 0 },
  { id: 'i2', label: '20% Off', sortOrder: 1 },
  { id: 'i3', label: 'Free Dessert', sortOrder: 2 },
];

/** Deterministic PRNG so shuffles are reproducible in tests. */
function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('drawScratchReward — FIXED mode', () => {
  it('always returns the first item regardless of pool state', () => {
    const out = drawScratchReward({
      mode: 'FIXED',
      items,
      pool: { cursor: 2, order: ['i3', 'i1', 'i2'] },
      rand: seededRand(42),
    });
    expect(out.reward.id).toBe('i1');
    expect(out.reward.label).toBe('Free Drink');
  });

  it('returns null pool so rotation is never persisted', () => {
    const out = drawScratchReward({ mode: 'FIXED', items });
    expect(out.pool).toBeNull();
  });

  it('throws when the offer has no items', () => {
    expect(() => drawScratchReward({ mode: 'FIXED', items: [] })).toThrow();
  });
});

describe('drawScratchReward — RANDOM_POOL rotation', () => {
  it('covers every item exactly once per cycle', () => {
    let pool = { cursor: 0, order: [] as string[] };
    const seen: string[] = [];
    for (let i = 0; i < items.length; i++) {
      const out = drawScratchReward({
        mode: 'RANDOM_POOL',
        items,
        pool,
        rand: seededRand(1),
      });
      seen.push(out.reward.id);
      pool = out.pool!;
    }
    expect(new Set(seen).size).toBe(items.length);
    expect(pool.cursor).toBe(items.length);
  });

  it('starts a freshly shuffled cycle when the cursor wraps', () => {
    const firstCycleOrder = ['i1', 'i2', 'i3'];
    // Cursor at the end of a completed cycle → must reshuffle, not repeat i1.
    const out = drawScratchReward({
      mode: 'RANDOM_POOL',
      items,
      pool: { cursor: 3, order: firstCycleOrder },
      rand: seededRand(7),
    });
    expect(out.pool!.cursor).toBe(1);
    expect(out.pool!.order).toHaveLength(3);
    // New order is a permutation of all ids.
    expect([...out.pool!.order].sort()).toEqual(['i1', 'i2', 'i3']);
  });

  it('reshuffles when the stored order no longer matches the item set', () => {
    const added: ScratchItemRow[] = [
      ...items,
      { id: 'i4', label: 'Free Cookie', sortOrder: 3 },
    ];
    const out = drawScratchReward({
      mode: 'RANDOM_POOL',
      items: added,
      // Order references only 3 of 4 items → invalid.
      pool: { cursor: 1, order: ['i1', 'i2', 'i3'] },
      rand: seededRand(9),
    });
    expect(out.pool!.order).toHaveLength(4);
    expect([...out.pool!.order].sort()).toEqual(['i1', 'i2', 'i3', 'i4']);
    expect(out.pool!.cursor).toBe(1);
  });

  it('honours an injected rand (same seed → same order)', () => {
    const a = drawScratchReward({
      mode: 'RANDOM_POOL',
      items,
      pool: { cursor: 0, order: [] },
      rand: seededRand(123),
    });
    const b = drawScratchReward({
      mode: 'RANDOM_POOL',
      items,
      pool: { cursor: 0, order: [] },
      rand: seededRand(123),
    });
    expect(a.pool!.order).toEqual(b.pool!.order);
    expect(a.reward.id).toBe(b.reward.id);
  });

  it('draws every item across enough cycles (pool rotation works)', () => {
    let pool = { cursor: 0, order: [] as string[] };
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const out = drawScratchReward({
        mode: 'RANDOM_POOL',
        items,
        pool,
        rand: seededRand(i + 1),
      });
      seen.add(out.reward.id);
      pool = out.pool!;
    }
    expect(seen.size).toBe(items.length);
  });

  it('throws when the offer has no items', () => {
    expect(() =>
      drawScratchReward({ mode: 'RANDOM_POOL', items: [], rand: seededRand(1) })
    ).toThrow();
  });
});

describe('buildScratchState — 24h per-offer cooldown', () => {
  const now = new Date();

  it('allows the first scratch (no prior result)', () => {
    const state = buildScratchState(null);
    expect(state.hasResult).toBe(false);
    expect(state.canScratch).toBe(true);
    expect(state.nextScratchAt).toBeNull();
    expect(state.lastResult).toBeNull();
  });

  it('blocks a second scratch within the window', () => {
    const state = buildScratchState({
      rewardLabel: 'Free Drink',
      scratchedAt: new Date(now.getTime() - 60 * 60 * 1000),
    });
    expect(state.canScratch).toBe(false);
    expect(state.lastResult?.rewardLabel).toBe('Free Drink');
    expect(state.nextScratchAt).toBeTruthy();
    const next = new Date(state.nextScratchAt!).getTime();
    expect(next).toBeGreaterThan(now.getTime());
    expect(next).toBeLessThanOrEqual(now.getTime() + SCRATCH_COOLDOWN_MS);
  });

  it('allows a scratch once the window has passed', () => {
    const state = buildScratchState({
      rewardLabel: '20% Off',
      scratchedAt: new Date(now.getTime() - SCRATCH_COOLDOWN_MS - 1000),
    });
    expect(state.canScratch).toBe(true);
    expect(state.hasResult).toBe(true);
    expect(state.nextScratchAt).toBeNull();
    expect(state.lastResult?.rewardLabel).toBe('20% Off');
  });
});

describe('normalizeCooldownHours', () => {
  it('returns the default for missing or non-numeric input', () => {
    for (const bad of [undefined, null, '', 'soon', NaN, Infinity, -Infinity, {}, []]) {
      expect(normalizeCooldownHours(bad)).toBe(SCRATCH_COOLDOWN_DEFAULT_HOURS);
    }
  });

  it('accepts the merchant-selectable bounds', () => {
    expect(normalizeCooldownHours(SCRATCH_COOLDOWN_MIN_HOURS)).toBe(
      SCRATCH_COOLDOWN_MIN_HOURS
    );
    expect(normalizeCooldownHours(SCRATCH_COOLDOWN_MAX_HOURS)).toBe(
      SCRATCH_COOLDOWN_MAX_HOURS
    );
    expect(normalizeCooldownHours(24)).toBe(24);
    expect(normalizeCooldownHours(6)).toBe(6);
  });

  it('clamps out-of-range values back to the default, not to the bound', () => {
    // A 0/negative window would let a customer scratch in a loop; a runaway
    // one would lock them out. Both fall back to 24h rather than being trusted.
    expect(normalizeCooldownHours(0)).toBe(SCRATCH_COOLDOWN_DEFAULT_HOURS);
    expect(normalizeCooldownHours(-3)).toBe(SCRATCH_COOLDOWN_DEFAULT_HOURS);
    expect(normalizeCooldownHours(169)).toBe(SCRATCH_COOLDOWN_DEFAULT_HOURS);
    expect(normalizeCooldownHours(100_000)).toBe(SCRATCH_COOLDOWN_DEFAULT_HOURS);
  });

  it('rounds fractional hours to whole hours', () => {
    expect(normalizeCooldownHours(6.4)).toBe(6);
    expect(normalizeCooldownHours(6.6)).toBe(7);
    expect(normalizeCooldownHours('12')).toBe(12);
  });
});

describe('cooldownMs', () => {
  it('converts normalised hours to milliseconds', () => {
    expect(cooldownMs(24)).toBe(24 * 60 * 60 * 1000);
    expect(cooldownMs(1)).toBe(60 * 60 * 1000);
    expect(cooldownMs('garbage')).toBe(SCRATCH_COOLDOWN_DEFAULT_HOURS * 60 * 60 * 1000);
  });
});

describe('buildScratchState — configurable per-offer window', () => {
  const now = Date.now();
  const HOUR = 60 * 60 * 1000;

  it('honours a shorter window than the 24h default', () => {
    const last = { rewardLabel: 'Free Drink', scratchedAt: new Date(now - 3 * HOUR) };

    // 6h offer: 3h elapsed is still locked…
    const sixHour = buildScratchState(last, 6);
    expect(sixHour.canScratch).toBe(false);
    expect(sixHour.cooldownHours).toBe(6);
    const sixHourNext = new Date(sixHour.nextScratchAt!).getTime();
    expect(sixHourNext).toBeGreaterThan(now + 3 * HOUR - 5000);
    expect(sixHourNext).toBeLessThanOrEqual(now + 3 * HOUR + 5000);

    // …but the same row on a 2h offer has been open for an hour.
    const twoHour = buildScratchState(last, 2);
    expect(twoHour.canScratch).toBe(true);
    expect(twoHour.nextScratchAt).toBeNull();
    expect(twoHour.cooldownHours).toBe(2);
  });

  it('applies the same window to a no-history customer', () => {
    expect(buildScratchState(null, 48)).toEqual(
      expect.objectContaining({ canScratch: true, cooldownHours: 48, nextScratchAt: null })
    );
  });

  it('falls back to the default when the stored value is unusable', () => {
    const last = { rewardLabel: '20% Off', scratchedAt: new Date(now - 5 * HOUR) };
    for (const bad of [0, -1, 9999, undefined, null, 'nonsense']) {
      const state = buildScratchState(last, bad);
      expect(state.cooldownHours).toBe(SCRATCH_COOLDOWN_DEFAULT_HOURS);
      expect(state.canScratch).toBe(false); // 5h ago is inside a 24h window
    }
  });

  it('keeps the minimum window meaningful (1h blocks at 30 minutes)', () => {
    const last = { rewardLabel: 'Free Dessert', scratchedAt: new Date(now - 30 * 60 * 1000) };
    const min = buildScratchState(last, SCRATCH_COOLDOWN_MIN_HOURS);
    expect(min.canScratch).toBe(false);
    expect(min.cooldownHours).toBe(1);
    expect(min.nextScratchAt).toBeTruthy();
  });
});
