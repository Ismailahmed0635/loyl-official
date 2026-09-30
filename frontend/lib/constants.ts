export const APP_NAME = 'Loyl';
export const APP_SLOGAN = 'Digital Loyalty & Stamp Cards for Bangladesh Merchants';

export const BUSINESS_CATEGORIES = [
  'Café & Bakery',
  'Restaurant & Fast Food',
  'Salon & Spa',
  'Gym & Fitness',
  'Retail & Clothing',
  'Electronics & Gadgets',
  'Other Local Business',
] as const;

export const REWARD_TYPES = [
  { value: 'DISCOUNT', label: 'Percentage / Flat Discount' },
  { value: 'FREE_ITEM', label: 'Free Product / Item' },
  { value: 'CUSTOM', label: 'Custom Voucher / Gift' },
] as const;

/** Short reward labels for customer-facing screens (Phase 3). */
export const REWARD_LABELS: Record<string, string> = {
  DISCOUNT: 'Discount reward',
  FREE_ITEM: 'Free item reward',
  CUSTOM: 'Custom reward',
};

export const DEFAULT_STAMP_COUNTS = [5, 10, 15, 20];

// --- Phase 3.5: Separated offer types (Stamp vs Scratch Card) ---------------

export const OFFER_TYPES = [
  { value: 'STAMP', label: 'Stamp Offer' },
  { value: 'SCRATCH', label: 'Scratch Card Offer' },
  { value: 'DICE', label: 'Dice Roll Offer' },
] as const;

export const SCRATCH_MODES = [
  {
    value: 'FIXED',
    label: 'Fixed reward',
    description: 'Every scratch reveals the same reward',
  },
  {
    value: 'RANDOM_POOL',
    label: 'Randomized pool',
    description: 'Rewards rotate randomly as customers scratch',
  },
] as const;

/** Max reward rows a merchant can add to one scratch card. */
export const MAX_SCRATCH_REWARDS = 20;
/** Randomized-pool mode needs at least this many rewards. */
export const MIN_POOL_REWARDS = 2;

// --- Dice Roll Offer ---------------------------------------------------------

/** Standard six-sided die: face values run 1..6. */
export const DIE_FACES = 6;
/** Merchant-selectable floor for the dice shown on the offer page. */
export const MIN_DICE_COUNT = 1;
/** Merchant-selectable ceiling: 5 dice max on one offer page. */
export const MAX_DICE_COUNT = 5;
/** Every selectable dice count, in order (the Offer Generator's chips). */
export const DICE_COUNT_OPTIONS = [1, 2, 3, 4, 5] as const;
/** Dice count a missing/unusable stored value falls back to. */
export const DEFAULT_DICE_COUNT = 1;

// --- Phase 3: Customer scan engine ------------------------------------------

/** A customer can scan the same shop once per window (TEST.md §4 cooldown). */
export const SCAN_COOLDOWN_HOURS = 24;

/** Bonus stamp after a Google Maps review is allowed once per window (PRD 3.3). */
export const REVIEW_COOLDOWN_HOURS = 24;

/** When a merchant branch has GPS, the customer must be within this radius. */
export const GEO_FENCE_RADIUS_M = 200;

// --- Phase 3.5: Scratch card reveal cooldown --------------------------------

/** Default hours a customer waits after a reveal before scratching again. */
export const SCRATCH_COOLDOWN_DEFAULT_HOURS = 24;
/** Merchant-selectable floor for the per-offer scratch cooldown. */
export const SCRATCH_COOLDOWN_MIN_HOURS = 1;
/** Merchant-selectable ceiling: 7 days. */
export const SCRATCH_COOLDOWN_MAX_HOURS = 168;

// --- Phase 12: Digital Menu Card --------------------------------------------

/** Longest public menu handle (`/menu/{slug}`); also bounds the route param. */
export const MENU_SLUG_MAX = 60;
/** Slug used when the business name yields no usable ASCII at all. */
export const MENU_SLUG_FALLBACK = 'menu';

/**
 * Size caps for menu content. These live here, not in one module, because the
 * vision draft (`backend/menu.ts`) and the save schema
 * (`backend/validation/schemas.ts`) must never disagree: a draft the model is
 * allowed to produce has to be a payload the merchant is allowed to save.
 */
export const MENU_MAX_CATEGORIES = 30;
export const MENU_MAX_ITEMS_PER_CATEGORY = 100;
export const MENU_MAX_TITLE = 80;
export const MENU_MAX_CATEGORY_NAME = 60;
export const MENU_MAX_ITEM_NAME = 80;
export const MENU_MAX_DESCRIPTION = 200;
export const MENU_MAX_PRICE = 40;

// --- Phase 12.5: Menu modifiers (add-ons & variants) -------------------------

/**
 * Size caps for per-item modifier groups ("Size", "Extra toppings"). Same rule
 * as the item caps above: the save schema, the editor's client-side mirror and
 * the persistence layer must never disagree about what fits.
 */
export const MENU_MAX_MODIFIER_GROUPS_PER_ITEM = 5;
export const MENU_MAX_OPTIONS_PER_GROUP = 15;
export const MENU_MAX_MODIFIER_GROUP_NAME = 60;
export const MENU_MAX_MODIFIER_OPTION_NAME = 60;
/** Option prices are short display deltas ("+৳60", "Free") — tighter than items. */
export const MENU_MAX_MODIFIER_PRICE = 20;
