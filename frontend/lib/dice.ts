/**
 * Dice-offer helpers that are safe to import from the client (pure — no db).
 *
 * The server engine lives in `backend/dice.ts` and re-exports the normaliser
 * from here so the merchant form, the QR poster, and the customer page all
 * clamp a stored count exactly the way the roll engine will.
 */
import {
  DEFAULT_DICE_COUNT,
  DIE_FACES,
  MAX_DICE_COUNT,
  MIN_DICE_COUNT,
} from '@/lib/constants';

export { DEFAULT_DICE_COUNT, DIE_FACES, MAX_DICE_COUNT, MIN_DICE_COUNT };

/** Lowest face value on a standard die. */
export const DIE_MIN = 1;

/**
 * Normalises a stored/imputed dice count to a whole number inside
 * MIN_DICE_COUNT–MAX_DICE_COUNT. Out-of-range values are clamped rather than
 * rejected: a corrupt row must never render 0 dice (an unplayable page) or 100
 * dice (a broken layout). Non-finite input falls back to the default count.
 */
export function normalizeDiceCount(count: unknown): number {
  const n = typeof count === 'number' ? count : Number(count);
  if (!Number.isFinite(n)) return DEFAULT_DICE_COUNT;
  const rounded = Math.round(n);
  if (rounded < MIN_DICE_COUNT) return MIN_DICE_COUNT;
  if (rounded > MAX_DICE_COUNT) return MAX_DICE_COUNT;
  return rounded;
}

/**
 * The discount window a roll can produce: `count` six-sided dice sum to
 * `count`–`count * DIE_FACES`, and that total IS the discount percent.
 */
export function discountRange(count: unknown): { min: number; max: number } {
  const diceCount = normalizeDiceCount(count);
  return { min: diceCount * DIE_MIN, max: diceCount * DIE_FACES };
}

/**
 * The rotation that brings a given pip count to the front of the 3D die.
 *
 * The die is a cube of six plates (see `DIE_PLATES` in DiceOfferView): face 1
 * faces the viewer, 6 is its opposite, 3/4 are the sides and 2/5 the top and
 * bottom — so opposite plates always sum to 7, like a real die. Each plate is
 * drawn with `rotate*(a) translateZ(half)`, and the orientation returned here
 * is the exact inverse rotation `a` (applied to the cube), which lands that
 * plate square to the camera.
 */
export function faceOrientation(face: number): { rotateX: number; rotateY: number } {
  switch (face) {
    case 2:
      return { rotateX: 90, rotateY: 0 }; // top plate (drawn at rotateX(-90))
    case 3:
      return { rotateX: 0, rotateY: -90 }; // right plate (rotateY(90))
    case 4:
      return { rotateX: 0, rotateY: 90 }; // left plate (rotateY(-90))
    case 5:
      return { rotateX: -90, rotateY: 0 }; // bottom plate (rotateX(90))
    case 6:
      return { rotateX: 0, rotateY: 180 }; // back plate (rotateY(180))
    default:
      return { rotateX: 0, rotateY: 0 }; // face 1 (and any unknown value)
  }
}

/**
 * The spin-down target for one axis while the die lands: the orientation that
 * shows `target`, plus whole turns so the die always travels *forward* past
 * wherever the tumble left it (at least one extra full flip, never a rewind).
 * Adding/subtracting 360 never changes which plate faces the camera, so the
 * landing stays visually correct for any accumulated spin.
 */
export function landingRotation(current: number, target: number): number {
  let turns = Math.ceil((current - target) / 360);
  if (turns < 1) turns = 1;
  if (target + 360 * turns <= current) turns += 1;
  return target + 360 * turns;
}
