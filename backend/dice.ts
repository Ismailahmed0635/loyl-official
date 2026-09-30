/**
 * backend/dice.ts — Dice Roll offer engine.
 *
 * Pure helpers shared by the dice API routes and tests: rolling 1..5 standard
 * six-sided dice and mapping the outcome to a discount.
 *
 * The mapping is deliberately the simplest one that stays honest: **the roll
 * total IS the discount percent** (1 die → 1–6%, 5 dice → 5–30%). There is no
 * merchant-configurable curve to disagree with, so the number printed on the
 * customer's screen is the number the server computed.
 *
 * The one-time limit is not a window — it is a lifetime. `DiceRollResult` has a
 * `@@unique([offerId, customerPhone])` constraint, so a second roll is refused
 * by the database itself rather than by a check that could race. The state
 * below (`canRoll`) is only what the UI reads to decide which panel to show.
 *
 * No database access in the pure helpers — everything is injectable so tests
 * can drive deterministic sequences through `rand`.
 */
import { db } from '@/backend/db';
import {
  DEFAULT_DICE_COUNT,
  DIE_FACES,
  DIE_MIN,
  MAX_DICE_COUNT,
  MIN_DICE_COUNT,
  normalizeDiceCount,
  faceOrientation,
  landingRotation,
} from '@/lib/dice';

// Pure dice helpers live in `frontend/lib/dice.ts` so client components can
// clamp/display the same way the engine rolls; re-exported here so server
// callers only need this module.
export {
  DEFAULT_DICE_COUNT,
  DIE_FACES,
  DIE_MIN,
  MAX_DICE_COUNT,
  MIN_DICE_COUNT,
  normalizeDiceCount,
  faceOrientation,
  landingRotation,
};

/**
 * The discount a roll earns: the total, as a whole percent.
 * Clamped to 0–100 so no future mapping change could ever emit `250% off`.
 */
export function discountPercentFor(total: number): number {
  if (!Number.isFinite(total)) return 0;
  return Math.max(0, Math.min(100, Math.round(total)));
}

/** One roll: the dice as displayed, their sum, and the discount it earned. */
export interface DiceRoll {
  diceCount: number;
  /** Face value of each die, 1..6, in display order. */
  diceValues: number[];
  /** Sum of `diceValues`. */
  total: number;
  /** The discount the customer earns — `total`, as a percent. */
  discountPercent: number;
}

/**
 * Roll `count` dice with an injectable random source.
 *
 * The count is normalised first, so a caller cannot roll 0 dice (no roll, no
 * discount) or 10 million. `rand()` is clamped before use: `Math.random()`
 * never returns 1, but a test double or a buggy replacement might, and that
 * must not produce a face of 7.
 */
export function rollDice(count: unknown, rand: () => number = Math.random): DiceRoll {
  const diceCount = normalizeDiceCount(count);
  const diceValues: number[] = [];
  let total = 0;

  for (let i = 0; i < diceCount; i++) {
    const unit = Math.min(Math.max(rand(), 0), 0.9999999999);
    const face = DIE_MIN + Math.floor(unit * DIE_FACES);
    diceValues.push(face);
    total += face;
  }

  return { diceCount, diceValues, total, discountPercent: discountPercentFor(total) };
}

/** Minimal shape of a DiceRollResult row needed to build display state. */
export interface DiceRollRow {
  diceCount: number;
  diceValues: number[];
  total: number;
  discountPercent: number;
  rolledAt: Date;
}

/** JSON-safe snapshot of a customer's dice state for one offer. */
export interface DiceRollState {
  hasRoll: boolean;
  lastRoll: {
    diceValues: number[];
    total: number;
    discountPercent: number;
    rolledAt: string;
  } | null;
  /** True only while this customer has never rolled this offer. */
  canRoll: boolean;
}

/**
 * One-time entitlement state for one customer + one dice offer.
 * `canRoll` flips to false permanently after the first roll — there is no
 * cooldown to expire and re-arm it (unlike `buildScratchState`).
 */
export function buildDiceState(last: DiceRollRow | null): DiceRollState {
  return {
    hasRoll: !!last,
    lastRoll: last
      ? {
          diceValues: last.diceValues,
          total: last.total,
          discountPercent: last.discountPercent,
          rolledAt: last.rolledAt.toISOString(),
        }
      : null,
    canRoll: !last,
  };
}

/** Latest dice roll for one customer + offer, or null. */
export async function findLastDiceRoll(
  offerId: string,
  customerPhone: string
): Promise<DiceRollRow | null> {
  const row = await db.diceRollResult.findFirst({
    where: { offerId, customerPhone },
    orderBy: { rolledAt: 'desc' },
    select: {
      diceCount: true,
      diceValues: true,
      total: true,
      discountPercent: true,
      rolledAt: true,
    },
  });
  return row;
}
