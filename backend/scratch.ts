/**
 * backend/scratch.ts — Phase 3.5 scratch-offer engine.
 *
 * Pure helpers shared by the scratch API routes and tests:
 * draw logic for the two merchant-chosen scratch modes (LOYLS_APP_REQUIREMENTS §3),
 * plus the per-offer reveal cooldown (mirrors buildCardState in backend/scan.ts).
 *
 * The cooldown window is a merchant setting on the offer (24h by default),
 * normalised through `normalizeCooldownHours` so a bad stored value can never
 * lock a customer out or open the window early.
 *
 * No database access in the pure helpers — everything is injectable so tests
 * can drive deterministic sequences through `rand`.
 */
import { db } from '@/backend/db';
import {
  SCAN_COOLDOWN_HOURS,
  SCRATCH_COOLDOWN_DEFAULT_HOURS,
  SCRATCH_COOLDOWN_MIN_HOURS,
  SCRATCH_COOLDOWN_MAX_HOURS,
} from '@/lib/constants';

export { SCAN_COOLDOWN_HOURS };

/** Fallback when an offer carries no usable cooldown (legacy/bad rows). */
export const DEFAULT_SCRATCH_COOLDOWN_HOURS = SCRATCH_COOLDOWN_DEFAULT_HOURS;
/** Lower bound of the merchant-selectable window. */
export const MIN_SCRATCH_COOLDOWN_HOURS = SCRATCH_COOLDOWN_MIN_HOURS;
/** Upper bound of the merchant-selectable window (7 days). */
export const MAX_SCRATCH_COOLDOWN_HOURS = SCRATCH_COOLDOWN_MAX_HOURS;

const HOUR_MS = 60 * 60 * 1000;
export const SCRATCH_COOLDOWN_MS = SCAN_COOLDOWN_HOURS * HOUR_MS;

export type ScratchMode = 'FIXED' | 'RANDOM_POOL';

/**
 * Normalises a stored/imputed cooldown to a whole number of hours inside
 * MIN_SCRATCH_COOLDOWN_HOURS–MAX_SCRATCH_COOLDOWN_HOURS. Out-of-range or
 * non-finite input falls back to the default rather than throwing: a bad
 * stored value must never lock a customer out forever.
 */
export function normalizeCooldownHours(hours: unknown): number {
  const n = typeof hours === 'number' ? hours : Number(hours);
  if (!Number.isFinite(n)) return DEFAULT_SCRATCH_COOLDOWN_HOURS;
  const rounded = Math.round(n);
  if (rounded < MIN_SCRATCH_COOLDOWN_HOURS || rounded > MAX_SCRATCH_COOLDOWN_HOURS) {
    return DEFAULT_SCRATCH_COOLDOWN_HOURS;
  }
  return rounded;
}

/** Whole hours → milliseconds, after normalisation. */
export function cooldownMs(hours: unknown): number {
  return normalizeCooldownHours(hours) * HOUR_MS;
}

/** Minimal shape of a ScratchItem row needed to draw. */
export interface ScratchItemRow {
  id: string;
  label: string;
  sortOrder: number;
}

/** Rotation state persisted on the Offer row (RANDOM_POOL only). */
export interface PoolState {
  cursor: number;
  /** Shuffled ScratchItem ids for the current cycle. */
  order: string[];
}

export interface DrawInput {
  mode: ScratchMode;
  items: ScratchItemRow[];
  /** Required for RANDOM_POOL; ignored for FIXED. */
  pool?: PoolState;
  /** Injectable randomness — defaults to Math.random. */
  rand?: () => number;
}

export interface DrawOutput {
  reward: ScratchItemRow;
  /** Next pool state to persist (null for FIXED — never persists rotation). */
  pool: PoolState | null;
}

function shuffle<T>(values: T[], rand: () => number): T[] {
  const out = values.slice();
  // Fisher–Yates
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/**
 * Draw the reward for one scratch reveal.
 *
 * - FIXED: always items[0] — the merchant's single predetermined reward.
 * - RANDOM_POOL: round-robin over a shuffled cycle of every item, so each
 *   reward appears exactly once per cycle; the cycle reshuffles when it wraps
 *   or when the item set changed since the order was stored.
 */
export function drawScratchReward(input: DrawInput): DrawOutput {
  const { mode, items } = input;

  if (mode === 'FIXED') {
    const reward = items[0];
    if (!reward) throw new Error('Scratch offer has no reward items');
    return { reward, pool: null };
  }

  if (items.length === 0) throw new Error('Scratch offer has no reward items');

  const rand = input.rand ?? Math.random;
  const byId = new Map(items.map((item) => [item.id, item]));

  // A stored order is only usable while it references exactly the current set.
  const stored = input.pool;
  const orderValid =
    !!stored &&
    stored.order.length === items.length &&
    stored.order.every((id) => byId.has(id));

  let order: string[];
  let cursor: number;

  if (orderValid && stored) {
    order = stored.order;
    cursor = stored.cursor;
    // Wrap or stale cursor → start a freshly shuffled cycle.
    if (cursor < 0 || cursor >= order.length) {
      cursor = 0;
      order = shuffle(
        items.map((i) => i.id),
        rand
      );
    }
  } else {
    cursor = 0;
    order = shuffle(
      items.map((i) => i.id),
      rand
    );
  }

  const reward = byId.get(order[cursor])!;
  return { reward, pool: { cursor: cursor + 1, order } };
}

/** Prisma ScratchResult subset needed to compute reveal state. */
export interface ScratchResultRow {
  rewardLabel: string;
  scratchedAt: Date;
}

/** JSON-safe snapshot of a customer's scratch state for one offer. */
export interface ScratchState {
  hasResult: boolean;
  lastResult: { rewardLabel: string; scratchedAt: string } | null;
  canScratch: boolean;
  /** The offer's configured window (hours) this state was computed with. */
  cooldownHours: number;
  nextScratchAt: string | null;
}

/**
 * Cooldown state for one customer + one scratch offer (TEST.md §4 window).
 * Mirrors buildCardState: a result within the offer's cooldown window blocks
 * the next reveal until nextScratchAt.
 *
 * `cooldownHours` is the PER-OFFER setting (`Offer.scratchCooldownHours`);
 * omitting it keeps the historical 24h default. The value is normalised so a
 * corrupt stored row can never produce a zero or runaway window.
 */
export function buildScratchState(
  last: ScratchResultRow | null,
  cooldownHours: unknown = DEFAULT_SCRATCH_COOLDOWN_HOURS
): ScratchState {
  const hours = normalizeCooldownHours(cooldownHours);
  const windowMs = hours * HOUR_MS;
  const now = Date.now();
  const withinWindow = !!last && now - last.scratchedAt.getTime() < windowMs;

  return {
    hasResult: !!last,
    lastResult: last
      ? { rewardLabel: last.rewardLabel, scratchedAt: last.scratchedAt.toISOString() }
      : null,
    canScratch: !withinWindow,
    cooldownHours: hours,
    nextScratchAt: withinWindow && last
      ? new Date(last.scratchedAt.getTime() + windowMs).toISOString()
      : null,
  };
}

/** Latest scratch result for one customer + offer, or null. */
export async function findLastScratchResult(
  offerId: string,
  customerPhone: string
): Promise<ScratchResultRow | null> {
  const row = await db.scratchResult.findFirst({
    where: { offerId, customerPhone },
    orderBy: { scratchedAt: 'desc' },
    select: { rewardLabel: true, scratchedAt: true },
  });
  return row;
}
