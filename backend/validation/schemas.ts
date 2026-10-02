import { z } from 'zod';
import {
  SCRATCH_COOLDOWN_DEFAULT_HOURS,
  SCRATCH_COOLDOWN_MIN_HOURS,
  SCRATCH_COOLDOWN_MAX_HOURS,
  MIN_DICE_COUNT,
  MAX_DICE_COUNT,
  MENU_SLUG_MAX,
  MENU_MAX_CATEGORIES,
  MENU_MAX_ITEMS_PER_CATEGORY,
  MENU_MAX_TITLE,
  MENU_MAX_CATEGORY_NAME,
  MENU_MAX_ITEM_NAME,
  MENU_MAX_DESCRIPTION,
  MENU_MAX_PRICE,
  MENU_MAX_MODIFIER_GROUPS_PER_ITEM,
  MENU_MAX_OPTIONS_PER_GROUP,
  MENU_MAX_MODIFIER_GROUP_NAME,
  MENU_MAX_MODIFIER_OPTION_NAME,
  MENU_MAX_MODIFIER_PRICE,
} from '@/lib/constants';

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^(?:\+88)?01[3-9]\d{8}$/, {
    message: 'Invalid Bangladeshi phone number format (e.g. 01712345678 or +8801712345678)',
  });

/** Phase 11: the customer's display name captured at check-in sign-in. */
export const customerNameSchema = z
  .string()
  .trim()
  .min(2, { message: 'Please enter your full name' })
  .max(60, { message: 'Name must be 60 characters or fewer' });

/**
 * Email/password session payload (the app's sign-in method).
 * The client signs in with the Firebase Web SDK and POSTs the ID token;
 * the server verifies it and mints `loyl_session` keyed on the verified
 * email. `.strict()` — this transport carries nothing else.
 */
export const emailSessionSchema = z
  .object({
    idToken: z
      .string()
      .trim()
      .min(20, { message: 'Sign-in token looks invalid' })
      .max(5000, { message: 'Sign-in token looks invalid' }),
  })
  .strict();

/**
 * Customer check-in identity (collected, never verified — there is no OTP
 * step). Name + BD phone mint a `role: 'customer'` session directly; the
 * merchant sees the name on the check-in before approving the stamp.
 */
export const customerSessionSchema = z
  .object({
    name: customerNameSchema,
    phoneNumber: phoneSchema,
  })
  .strict();

/**
 * Runtime shape of a verified `loyl_session` JWT (SEC-01/ST-01 follow-up).
 * `verifySessionToken` parses through this instead of casting — a token minted
 * by an older/newer code version (or a hand-rolled payload under a leaked
 * secret) with missing/mistyped claims is rejected at the trust boundary
 * instead of failing three hops away in a guard. `.passthrough()` because
 * jose adds numeric `iat`/`exp` claims we verify but never read as data.
 */
export const sessionPayloadSchema = z
  .object({
    userId: z.string().min(1),
    // Admin sessions carry phoneNumber: '' (no phone on a password login) —
    // presence as a string is required, non-empty is not.
    phoneNumber: z.string(),
    cognitoSub: z.string().optional(),
    firebaseUid: z.string().optional(),
    // Email/password identity (the app's sign-in method). Verified server-side
    // from the Firebase ID token — the client may never assert it directly.
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    role: z.enum(['merchant', 'customer', 'admin']).optional(),
    name: z.string().optional(),
    // RT-01: unique token id minted by createSessionToken; absent on
    // pre-revocation sessions, which keep working until they expire.
    jti: z.string().optional(),
  })
  .passthrough();

export const businessSetupSchema = z.object({
  businessName: z.string().trim().min(2, { message: 'Business name must be at least 2 characters' }),
  category: z.string().trim().min(1, { message: 'Please select a business category' }),
  phoneNumber: phoneSchema,
  logoUrl: z.string().url({ message: 'Invalid logo URL' }).optional().or(z.literal('')),
});

// --- Phase 2: Merchant Core -------------------------------------------------

export const REWARD_TYPE_VALUES = ['DISCOUNT', 'FREE_ITEM', 'CUSTOM'] as const;

export const offerSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, { message: 'Offer title must be at least 3 characters' })
    .max(80, { message: 'Offer title must be 80 characters or fewer' }),
  rewardType: z.enum(REWARD_TYPE_VALUES, {
    errorMap: () => ({ message: 'Please select a valid reward type' }),
  }),
  requiredStamps: z
    .number({ invalid_type_error: 'Required stamps must be a number' })
    .int({ message: 'Required stamps must be a whole number' })
    .min(2, { message: 'A stamp card needs at least 2 stamps' })
    .max(100, { message: 'Required stamps cannot exceed 100' }),
  durationDays: z
    .number({ invalid_type_error: 'Duration must be a number' })
    .int({ message: 'Duration must be a whole number of days' })
    .min(1, { message: 'Duration must be at least 1 day' })
    .max(365, { message: 'Duration cannot exceed 365 days' }),
  posterTemplateUrl: z
    .string()
    .trim()
    .url({ message: 'Invalid poster template URL' })
    .optional()
    .or(z.literal('')),
});

export const updateOfferSchema = offerSchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'No changes supplied',
  });

// --- Phase 3.5: Separated offer types (Stamp vs Scratch Card) ---------------

export const OFFER_TYPE_VALUES = ['STAMP', 'SCRATCH', 'DICE'] as const;
export const SCRATCH_MODE_VALUES = ['FIXED', 'RANDOM_POOL'] as const;

export const offerTypeSchema = z.enum(OFFER_TYPE_VALUES, {
  errorMap: () => ({ message: 'Please select a valid offer type' }),
});

const scratchRewardLabel = z
  .string()
  .trim()
  .min(1, { message: 'Reward name cannot be empty' })
  .max(60, { message: 'Reward name must be 60 characters or fewer' });

/**
 * Scratch Card offer payload shape — completely separate from offerSchema:
 * no rewardType/requiredStamps, just title, expiry, mode, and reward rows.
 * `.strict()` enforces the decoupling: stamp-only fields are a 422.
 */
const scratchOfferShape = z
  .object({
    offerType: z.literal('SCRATCH'),
    title: z
      .string()
      .trim()
      .min(3, { message: 'Offer title must be at least 3 characters' })
      .max(80, { message: 'Offer title must be 80 characters or fewer' }),
    durationDays: z
      .number({ invalid_type_error: 'Duration must be a number' })
      .int({ message: 'Duration must be a whole number of days' })
      .min(1, { message: 'Duration must be at least 1 day' })
      .max(365, { message: 'Duration cannot exceed 365 days' }),
    posterTemplateUrl: z
      .string()
      .trim()
      .url({ message: 'Invalid poster template URL' })
      .optional()
      .or(z.literal('')),
    scratchMode: z.enum(SCRATCH_MODE_VALUES, {
      errorMap: () => ({ message: 'Please select a valid scratch mode' }),
    }),
    /**
     * Per-offer reveal cooldown (Phase: configurable scratch cooldown).
     * Optional so existing clients keep sending 24h-free payloads; the column
     * default covers them. Range is clamped to the shared constants so the
     * merchant form and the server can never disagree.
     */
    scratchCooldownHours: z
      .number({ invalid_type_error: 'Cooldown must be a number' })
      .int({ message: 'Cooldown must be a whole number of hours' })
      .min(SCRATCH_COOLDOWN_MIN_HOURS, {
        message: `Cooldown must be at least ${SCRATCH_COOLDOWN_MIN_HOURS} hour`,
      })
      .max(SCRATCH_COOLDOWN_MAX_HOURS, {
        message: `Cooldown cannot exceed ${SCRATCH_COOLDOWN_MAX_HOURS} hours`,
      })
      .default(SCRATCH_COOLDOWN_DEFAULT_HOURS),
    items: z
      .array(scratchRewardLabel, { invalid_type_error: 'Each reward must be text' })
      .min(1, { message: 'Add at least one reward' })
      .max(20, { message: 'A scratch card can have at most 20 rewards' }),
  })
  .strict();

/**
 * Mode/item-count rules as a plain function so API routes can re-check a
 * partial update (e.g. items without a mode) against the stored offer.
 * Returns null when the combination is valid.
 */
export function scratchItemCountError(
  mode: 'FIXED' | 'RANDOM_POOL' | null | undefined,
  items: string[]
): string | null {
  if (mode === 'FIXED' && items.length !== 1) return 'Fixed mode needs exactly one reward';
  if (mode === 'RANDOM_POOL' && items.length < 2) {
    return 'Randomized pool mode needs at least 2 rewards';
  }
  return null;
}

/** Mode/item-count rules shared by create + update scratch payloads. */
function scratchModeRules(
  data: { scratchMode?: 'FIXED' | 'RANDOM_POOL'; items?: string[] },
  ctx: z.RefinementCtx
): void {
  if (!data.scratchMode || !data.items) return;
  const message = scratchItemCountError(data.scratchMode, data.items);
  if (message) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message });
  }
}

/** Scratch Card offer create schema (strict shape + mode/item rules). */
export const scratchOfferSchema = scratchOfferShape.superRefine(scratchModeRules);

// --- Dice Roll Offer (third offer type) --------------------------------------

/**
 * Dice Roll offer payload shape — separate from both branches beside it: no
 * rewardType/requiredStamps (the roll IS the reward) and no scratch mode or
 * reward rows. `.strict()` enforces that decoupling the same way
 * `scratchOfferShape` does: stamp- or scratch-only fields are a 422.
 *
 * `diceCount` is the whole of the merchant's configuration — how many dice sit
 * on the plate when a customer scans (1..5, bounded by the shared constants so
 * the form and the server can never disagree).
 */
const diceOfferShape = z
  .object({
    offerType: z.literal('DICE'),
    title: z
      .string()
      .trim()
      .min(3, { message: 'Offer title must be at least 3 characters' })
      .max(80, { message: 'Offer title must be 80 characters or fewer' }),
    durationDays: z
      .number({ invalid_type_error: 'Duration must be a number' })
      .int({ message: 'Duration must be a whole number of days' })
      .min(1, { message: 'Duration must be at least 1 day' })
      .max(365, { message: 'Duration cannot exceed 365 days' }),
    posterTemplateUrl: z
      .string()
      .trim()
      .url({ message: 'Invalid poster template URL' })
      .optional()
      .or(z.literal('')),
    diceCount: z
      .number({ invalid_type_error: 'Dice count must be a number' })
      .int({ message: 'Dice count must be a whole number' })
      .min(MIN_DICE_COUNT, { message: `A dice offer needs at least ${MIN_DICE_COUNT} die` })
      .max(MAX_DICE_COUNT, { message: `A dice offer can show at most ${MAX_DICE_COUNT} dice` }),
  })
  .strict();

/** Dice Roll offer create schema (bounds live on the shape itself). */
export const diceOfferSchema = diceOfferShape;

/**
 * Stamp branch of the create union — offerSchema plus its literal type.
 * `.strict()` mirrors scratchOfferShape: scratch-only fields (`scratchMode`,
 * `items`) and dice-only fields (`diceCount`) are a 422 on a stamp offer
 * instead of being silently dropped.
 */
const stampCreateSchema = offerSchema
  .extend({
    offerType: z.literal('STAMP'),
  })
  .strict();

/**
 * POST /api/offers payload. Bodies without `offerType` default to STAMP so
 * existing stamp clients keep working unchanged; anything else must match
 * exactly one branch of the discriminated union.
 */
export const createOfferSchema = z
  .preprocess(
    (body) =>
      body && typeof body === 'object' && !('offerType' in body)
        ? { ...(body as Record<string, unknown>), offerType: 'STAMP' }
        : body,
    z.discriminatedUnion('offerType', [stampCreateSchema, scratchOfferShape, diceOfferShape])
  )
  .superRefine((data, ctx) => {
    if (data.offerType === 'SCRATCH') scratchModeRules(data, ctx);
  });

/** PATCH payload for scratch offers (offer type is immutable after create). */
export const updateScratchOfferSchema = scratchOfferShape
  .omit({ offerType: true })
  .partial()
  .extend({
    offerType: z.literal('SCRATCH').optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    scratchModeRules(data, ctx);
    const hasChange = Object.keys(data).some(
      (key) => key !== 'offerType' && data[key as keyof typeof data] !== undefined
    );
    if (!hasChange) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'No changes supplied',
      });
    }
  });

/** PATCH payload for dice offers (offer type is immutable after create). */
export const updateDiceOfferSchema = diceOfferShape
  .omit({ offerType: true })
  .partial()
  .extend({
    offerType: z.literal('DICE').optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const hasChange = Object.keys(data).some(
      (key) => key !== 'offerType' && data[key as keyof typeof data] !== undefined
    );
    if (!hasChange) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'No changes supplied',
      });
    }
  });

export type CreateOfferInput = z.infer<typeof createOfferSchema>;
export type ScratchOfferInput = z.infer<typeof scratchOfferSchema>;
export type UpdateScratchOfferInput = z.infer<typeof updateScratchOfferSchema>;
export type DiceOfferInput = z.infer<typeof diceOfferSchema>;
export type UpdateDiceOfferInput = z.infer<typeof updateDiceOfferSchema>;

// --- Phase 12: Digital Menu Card --------------------------------------------

/**
 * Raw vision-model output. Unlike a client request this is UPSTREAM data, so
 * unknown keys are stripped (never rejected) and every leaf falls back through
 * `.catch()` — one odd value from the model must not fail the whole
 * extraction. `toMenuDraft` in backend/menu.ts applies the size caps after.
 */
export const visionDraftSchema = z.object({
  title: z.string().nullish().catch(null),
  categories: z
    .array(
      z.object({
        name: z.string().catch(''),
        items: z
          .array(
            z.object({
              name: z.string().catch(''),
              description: z.string().nullish().catch(null),
              price: z.string().nullish().catch(null),
            })
          )
          .catch([]),
      })
    )
    .catch([]),
});

export type VisionDraft = z.infer<typeof visionDraftSchema>;

/**
 * The cleaned draft handed to the editor — source of truth for BOTH the server
 * (`backend/menu.ts` fills it) and the client (`lib/api/merchant.ts` reads it),
 * so the two ends can never disagree about what an extraction returns.
 */
export interface MenuDraftItem {
  name: string;
  description: string | null;
  price: string | null;
}

export interface MenuDraftCategory {
  name: string;
  items: MenuDraftItem[];
}

export interface MenuDraft {
  title: string | null;
  categories: MenuDraftCategory[];
}

/** One choice inside a modifier group: "Small +৳0", "Large +৳60", "Free". */
const menuModifierOptionShape = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { message: 'Option name cannot be empty' })
      .max(MENU_MAX_MODIFIER_OPTION_NAME, {
        message: `Option names must be ${MENU_MAX_MODIFIER_OPTION_NAME} characters or fewer`,
      }),
    price: z
      .string()
      .trim()
      .max(MENU_MAX_MODIFIER_PRICE, {
        message: `Option prices must be ${MENU_MAX_MODIFIER_PRICE} characters or fewer`,
      })
      .optional()
      .or(z.literal('')),
    isDefault: z.boolean().optional(),
  })
  .strict();

/**
 * One modifier group on an item: "Size" (SINGLE, may be required) or "Extra
 * toppings" (MULTI, always optional — the superRefine below enforces that
 * pairing as product policy rather than letting a required checkbox list
 * render as dead UI on the public page).
 */
const menuModifierGroupShape = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { message: 'Modifier group name cannot be empty' })
      .max(MENU_MAX_MODIFIER_GROUP_NAME, {
        message: `Modifier group names must be ${MENU_MAX_MODIFIER_GROUP_NAME} characters or fewer`,
      }),
    selectionType: z.enum(['SINGLE', 'MULTI']),
    isRequired: z.boolean().optional(),
    options: z
      .array(menuModifierOptionShape)
      .min(1, { message: 'A modifier group needs at least one option' })
      .max(MENU_MAX_OPTIONS_PER_GROUP, {
        message: `A modifier group can hold at most ${MENU_MAX_OPTIONS_PER_GROUP} options`,
      }),
  })
  .strict()
  .superRefine((group, ctx) => {
    if (group.selectionType === 'MULTI' && group.isRequired) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['isRequired'],
        message: 'A pick-many group is always optional',
      });
    }
  });

/** One menu row: name plus an optional display price ("৳250", "Market price"). */
const menuItemShape = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { message: 'Item name cannot be empty' })
      .max(MENU_MAX_ITEM_NAME, {
        message: `Item name must be ${MENU_MAX_ITEM_NAME} characters or fewer`,
      }),
    description: z
      .string()
      .trim()
      .max(MENU_MAX_DESCRIPTION, {
        message: `Description must be ${MENU_MAX_DESCRIPTION} characters or fewer`,
      })
      .optional()
      .or(z.literal('')),
    price: z
      .string()
      .trim()
      .max(MENU_MAX_PRICE, { message: `Price must be ${MENU_MAX_PRICE} characters or fewer` })
      .optional()
      .or(z.literal('')),
    isAvailable: z.boolean().optional(),
    modifierGroups: z
      .array(menuModifierGroupShape)
      .max(MENU_MAX_MODIFIER_GROUPS_PER_ITEM, {
        message: `An item can hold at most ${MENU_MAX_MODIFIER_GROUPS_PER_ITEM} modifier groups`,
      })
      .optional(),
  })
  .strict();

/** A menu section. At least one item: an empty section renders as dead space. */
const menuCategoryShape = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { message: 'Section name cannot be empty' })
      .max(MENU_MAX_CATEGORY_NAME, {
        message: `Section name must be ${MENU_MAX_CATEGORY_NAME} characters or fewer`,
      }),
    items: z
      .array(menuItemShape)
      .min(1, { message: 'Add at least one item to this section, or delete the section' })
      .max(MENU_MAX_ITEMS_PER_CATEGORY, {
        message: `A section can hold at most ${MENU_MAX_ITEMS_PER_CATEGORY} items`,
      }),
  })
  .strict();

/**
 * PUT /api/merchant/menu — the whole menu in one payload (the merchant owns
 * exactly one), so there is no partial-update schema to reason about.
 * `publish: true` on the first save is what creates the public page.
 */
export const saveMenuSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(2, { message: 'Menu title must be at least 2 characters' })
      .max(MENU_MAX_TITLE, {
        message: `Menu title must be ${MENU_MAX_TITLE} characters or fewer`,
      }),
    // 3- or 6-digit are both accepted (the editor normalises to 6 on the way
    // in, so the column always stores #RRGGBB).
    backgroundHex: z
      .string()
      .trim()
      .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
        message: 'Background must be a hex colour such as #FFF7ED',
      }),
    categories: z
      .array(menuCategoryShape)
      .min(1, { message: 'Add at least one section to your menu' })
      .max(MENU_MAX_CATEGORIES, {
        message: `A menu can hold at most ${MENU_MAX_CATEGORIES} sections`,
      }),
    publish: z.boolean().optional(),
  })
  .strict();

/**
 * The public route param: the slug is the only thing standing between an
 * anonymous visitor and a merchant's menu, so it is matched against a strict
 * shape before it ever reaches the database.
 */
export const menuSlugSchema = z
  .string()
  .trim()
  .min(1, { message: 'Menu link is required' })
  .max(MENU_SLUG_MAX, { message: 'Menu link is too long' })
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'Menu link is invalid' });

export type SaveMenuInput = z.infer<typeof saveMenuSchema>;
export type MenuSlugInput = z.infer<typeof menuSlugSchema>;

/** One modifier option as the API persists it (price trimmed by the schema). */
export interface MenuModifierOptionInput {
  name: string;
  price?: string;
  isDefault?: boolean;
}

/** One modifier group as the API persists it. */
export interface MenuModifierGroupInput {
  name: string;
  selectionType: 'SINGLE' | 'MULTI';
  isRequired?: boolean;
  options: MenuModifierOptionInput[];
}

export const branchSchema = z.object({
  branchName: z
    .string()
    .trim()
    .min(2, { message: 'Branch name must be at least 2 characters' })
    .max(60, { message: 'Branch name must be 60 characters or fewer' }),
  address: z
    .string()
    .trim()
    .max(200, { message: 'Address must be 200 characters or fewer' })
    .optional()
    .or(z.literal('')),
  latitude: z
    .number({ invalid_type_error: 'Latitude must be a number' })
    .min(-90, { message: 'Latitude must be between -90 and 90' })
    .max(90, { message: 'Latitude must be between -90 and 90' })
    .nullable()
    .optional(),
  longitude: z
    .number({ invalid_type_error: 'Longitude must be a number' })
    .min(-180, { message: 'Longitude must be between -180 and 180' })
    .max(180, { message: 'Longitude must be between -180 and 180' })
    .nullable()
    .optional(),
});

export const updateBranchSchema = branchSchema.partial().refine((data) => Object.keys(data).length > 0, {
  message: 'No changes supplied',
});

export type EmailSessionInput = z.infer<typeof emailSessionSchema>;
export type CustomerSessionInput = z.infer<typeof customerSessionSchema>;
export type BusinessSetupInput = z.infer<typeof businessSetupSchema>;
export type OfferInput = z.infer<typeof offerSchema>;
export type UpdateOfferInput = z.infer<typeof updateOfferSchema>;
export type BranchInput = z.infer<typeof branchSchema>;
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;

// --- Phase 3: Customer Experience -------------------------------------------

const offerIdSchema = z
  .string()
  .trim()
  .min(1, { message: 'Offer id is required' })
  .max(64, { message: 'Offer id looks malformed' });

const coordinateShape = z.object({
  latitude: z
    .number({ invalid_type_error: 'Latitude must be a number' })
    .min(-90, { message: 'Latitude must be between -90 and 90' })
    .max(90, { message: 'Latitude must be between -90 and 90' })
    .nullable()
    .optional(),
  longitude: z
    .number({ invalid_type_error: 'Longitude must be a number' })
    .min(-180, { message: 'Longitude must be between -180 and 180' })
    .max(180, { message: 'Longitude must be between -180 and 180' })
    .nullable()
    .optional(),
});

export const scanSchema = coordinateShape
  .extend({ offerId: offerIdSchema })
  .refine((c) => (c.latitude == null) === (c.longitude == null), {
    message: 'Latitude and longitude must be provided together',
  });

export const redeemSchema = z.object({ offerId: offerIdSchema });

export const reviewBonusSchema = z.object({ offerId: offerIdSchema });

/** POST /api/customer/scratch — same payload shape as a stamp scan. */
export const scratchSchema = scanSchema;

/** POST /api/customer/dice — same payload shape as a stamp scan. */
export const diceRollSchema = scanSchema;

export type ScanInput = z.infer<typeof scanSchema>;
export type RedeemInput = z.infer<typeof redeemSchema>;
export type ReviewBonusInput = z.infer<typeof reviewBonusSchema>;
export type ScratchInput = z.infer<typeof scratchSchema>;
export type DiceRollInput = z.infer<typeof diceRollSchema>;

// --- Phase 4: Analytics & Settings ------------------------------------------

const MAX_RANGE_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

const isoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date must be YYYY-MM-DD' })
  .refine((key) => {
    const ms = Date.parse(`${key}T00:00:00.000Z`);
    if (Number.isNaN(ms)) return false;
    // Rejects impossible calendar dates (2026-02-31 rolls over in Date.parse).
    return new Date(ms).toISOString().slice(0, 10) === key;
  }, { message: 'Not a real calendar date' });

/**
 * GET /api/merchant/analytics query. Both dates are optional but must arrive
 * together; the route falls back to the default last-30-days window.
 */
export const analyticsQuerySchema = z
  .object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    format: z.enum(['json', 'csv']).optional(),
  })
  .superRefine((query, ctx) => {
    const hasFrom = query.from !== undefined;
    const hasTo = query.to !== undefined;
    if (hasFrom !== hasTo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide both from and to dates',
      });
      return;
    }
    if (!hasFrom || !hasTo) return;
    if (query.from! > query.to!) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'from must be on or before to' });
      return;
    }
    const days =
      Math.floor((Date.parse(`${query.to!}T00:00:00.000Z`) - Date.parse(`${query.from!}T00:00:00.000Z`)) / DAY_MS) + 1;
    if (days > MAX_RANGE_DAYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Range cannot exceed ${MAX_RANGE_DAYS} days`,
      });
    }
  });

/** Optional social/profile updates — at least one key required (422 otherwise). */
const optionalUrlSchema = z
  .string()
  .url({ message: 'Invalid URL' })
  .max(300, { message: 'URL must be 300 characters or fewer' })
  .refine((value) => /^https?:\/\//i.test(value), {
    message: 'URL must use http:// or https://',
  })
  .optional()
  .or(z.literal(''));

export const updateSettingsSchema = z
  .object({
    businessName: z
      .string()
      .trim()
      .min(2, { message: 'Business name must be at least 2 characters' })
      .max(80, { message: 'Business name must be 80 characters or fewer' })
      .optional(),
    category: z
      .string()
      .trim()
      .min(1, { message: 'Please select a business category' })
      .max(60, { message: 'Category must be 60 characters or fewer' })
      .optional(),
    logoUrl: optionalUrlSchema,
    websiteUrl: optionalUrlSchema,
    facebookUrl: optionalUrlSchema,
    instagramUrl: optionalUrlSchema,
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'No changes supplied',
  });

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

/** GET /api/merchant/customers — q search + simple pagination. */
export const customerListQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(20, { message: 'Search must be 20 characters or fewer' })
    .optional(),
  page: z.coerce.number({ invalid_type_error: 'Page must be a number' }).int().min(1).max(100000).optional(),
  pageSize: z.coerce
    .number({ invalid_type_error: 'Page size must be a number' })
    .int()
    .min(1, { message: 'Page size must be at least 1' })
    .max(100, { message: 'Page size cannot exceed 100' })
    .optional(),
});

export type AnalyticsQueryInput = z.infer<typeof analyticsQuerySchema>;
export type CustomerListInput = z.infer<typeof customerListQuerySchema>;

// --- Phase 5: Admin Panel ----------------------------------------------------

/** POST /api/admin/login — the password itself lives in the ADMIN_PASSWORD env var. */
export const adminLoginSchema = z.object({
  password: z
    .string()
    .min(8, { message: 'Password must be at least 8 characters' })
    .max(128, { message: 'Password must be 128 characters or fewer' }),
});

export const ADMIN_SUBSCRIPTION_STATUSES = ['PENDING', 'ACTIVE', 'EXPIRED'] as const;
export const ADMIN_PAYMENT_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;

/** Admin merchant-management actions (see backend/admin.ts applySubscriptionAction). */
export const MERCHANT_ACTIONS = ['activate', 'expire', 'revoke', 'suspend', 'restore'] as const;

/** Coerced pagination fields shared by the admin list endpoints. */
const adminPageField = z.coerce
  .number({ invalid_type_error: 'Page must be a number' })
  .int()
  .min(1)
  .max(100000)
  .optional();

const adminPageSizeField = z.coerce
  .number({ invalid_type_error: 'Page size must be a number' })
  .int()
  .min(1, { message: 'Page size must be at least 1' })
  .max(100, { message: 'Page size cannot exceed 100' })
  .optional();

/** GET /api/admin/merchants — text search + subscription filter + pagination. */
export const adminMerchantListQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(20, { message: 'Search must be 20 characters or fewer' })
    .optional(),
  status: z
    .enum(ADMIN_SUBSCRIPTION_STATUSES, {
      errorMap: () => ({ message: 'Unknown subscription status' }),
    })
    .optional(),
  page: adminPageField,
  pageSize: adminPageSizeField,
});

/** PATCH /api/admin/merchants/[id] — one management action per request. */
export const adminMerchantActionSchema = z.object({
  action: z.enum(MERCHANT_ACTIONS, {
    errorMap: () => ({ message: 'Unknown merchant action' }),
  }),
});

/**
 * GET /api/admin/payments — status filter (route defaults to PENDING;
 * `ALL` disables the filter) plus a trx/phone/name search.
 */
export const adminPaymentListQuerySchema = z.object({
  status: z
    .enum([...ADMIN_PAYMENT_STATUSES, 'ALL'] as const, {
      errorMap: () => ({ message: 'Unknown payment status' }),
    })
    .optional(),
  q: z
    .string()
    .trim()
    .max(30, { message: 'Search must be 30 characters or fewer' })
    .optional(),
  page: adminPageField,
  pageSize: adminPageSizeField,
});

/**
 * GET /api/admin/actions — the RT-02 audit trail feed. Optional filters:
 * a specific action name and/or target type, plus the shared pagination.
 */
export const adminActionListQuerySchema = z.object({
  action: z
    .string()
    .trim()
    .max(50, { message: 'Action filter looks malformed' })
    .optional(),
  targetType: z
    .enum(['PAYMENT_REQUEST', 'MERCHANT'], {
      errorMap: () => ({ message: 'Unknown target type' }),
    })
    .optional(),
  page: adminPageField,
  pageSize: adminPageSizeField,
});

/** Phase 7: every tier an approval can grant (admin dropdown + checkout request). */
export const SUBSCRIPTION_TIERS = ['FREE', 'MONTHLY', 'YEARLY', 'PREMIUM'] as const;

export const subscriptionTierSchema = z.enum(SUBSCRIPTION_TIERS, {
  errorMap: () => ({ message: 'Unknown subscription tier' }),
});

/**
 * POST /api/admin/approve-payment + POST /api/admin/reject-payment.
 * `tier` (approve only): the tier the admin assigns — defaults to the
 * tier the merchant requested at checkout.
 */
export const paymentActionSchema = z.object({
  paymentRequestId: z
    .string()
    .trim()
    .min(1, { message: 'Payment request id is required' })
    .max(64, { message: 'Payment request id looks malformed' }),
  tier: subscriptionTierSchema.optional(),
});

export type AdminLoginInput = z.infer<typeof adminLoginSchema>;
export type AdminMerchantListInput = z.infer<typeof adminMerchantListQuerySchema>;
export type AdminMerchantActionInput = z.infer<typeof adminMerchantActionSchema>;
export type AdminPaymentListInput = z.infer<typeof adminPaymentListQuerySchema>;
export type AdminActionListInput = z.infer<typeof adminActionListQuerySchema>;
export type PaymentActionInput = z.infer<typeof paymentActionSchema>;

// --- Phase 7: Payments & Billing -------------------------------------------

/**
 * POST /api/billing/checkout — multipart fields (the screenshot File is
 * validated by backend/billing.ts before anything touches disk).
 * FREE requests carry no payment details; paid tiers need all four fields.
 * The route drops payment fields entirely for FREE before parsing.
 */
export const checkoutSchema = z
  .object({
    requestedTier: subscriptionTierSchema,
    paymentMethod: z.enum(['BKASH', 'NAGAD']).optional(),
    senderNumber: z
      .string()
      .trim()
      .regex(/^\+?[0-9][0-9\s-]{4,19}$/, { message: 'Sender number looks invalid' })
      .optional(),
    trxId: z
      .string()
      .trim()
      .min(3, { message: 'Trx ID is required' })
      .max(40, { message: 'Trx ID must be 40 characters or fewer' })
      .regex(/^[A-Za-z0-9-]+$/, {
        message: 'Trx ID may only contain letters, numbers and dashes',
      })
      .optional(),
    amount: z.coerce
      .number({ invalid_type_error: 'Amount must be a number' })
      .positive({ message: 'Amount must be greater than zero' })
      .max(1_000_000, { message: 'Amount cannot exceed 1,000,000 BDT' })
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.requestedTier === 'FREE') return;
    if (!data.paymentMethod) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['paymentMethod'],
        message: 'Payment method is required',
      });
    }
    if (!data.senderNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['senderNumber'],
        message: 'Sender number is required',
      });
    }
    if (!data.trxId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['trxId'], message: 'Trx ID is required' });
    }
    if (data.amount === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['amount'],
        message: 'Amount is required',
      });
    }
  });

export type CheckoutInput = z.infer<typeof checkoutSchema>;

// --- Phase 9: Merchant-approved stamps (ScanRequest) ------------------------

/** `ALL` disables the filter; the route defaults to PENDING. */
export const SCAN_REQUEST_STATUSES = ['PENDING', 'APPROVED', 'ALL'] as const;

/** GET /api/merchant/scan-requests — status filter + pagination. */
export const scanRequestListQuerySchema = z.object({
  status: z
    .enum(SCAN_REQUEST_STATUSES, {
      errorMap: () => ({ message: 'Unknown request status' }),
    })
    .optional(),
  page: adminPageField,
  pageSize: adminPageSizeField,
});

export type ScanRequestListInput = z.infer<typeof scanRequestListQuerySchema>;

// --- Phase 10: device-bound approval (MerchantDevice) -----------------------

/**
 * POST /api/merchant/devices — the app registers the Ed25519 public key it just
 * generated.
 *
 * `.strict()` is load-bearing: it rejects `d` (private material) and any other
 * unknown field, so an app cannot hand the server a key it could later be used
 * to forge approvals with. `backend/devices.ts` re-checks the same invariant.
 */
export const deviceRegisterSchema = z
  .object({
    deviceName: z
      .string()
      .trim()
      .min(2, { message: 'Device name must be at least 2 characters' })
      .max(60, { message: 'Device name must be 60 characters or fewer' }),
    installId: z
      .string()
      .trim()
      .min(1, { message: 'Install id cannot be empty' })
      .max(128, { message: 'Install id must be 128 characters or fewer' })
      .optional(),
    publicKey: z
      .object({
        kty: z.literal('OKP', { errorMap: () => ({ message: 'Key must be an OKP key' }) }),
        crv: z.literal('Ed25519', {
          errorMap: () => ({ message: 'Key must use the Ed25519 curve' }),
        }),
        x: z
          .string()
          .min(1, { message: 'Key material is required' })
          .max(120, { message: 'Key material is malformed' }),
      })
      .strict(),
  })
  .strict();

export type DeviceRegisterInput = z.infer<typeof deviceRegisterSchema>;
