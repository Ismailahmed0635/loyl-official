import { describe, it, expect } from 'vitest';
import {
  phoneSchema,
  emailSessionSchema,
  customerSessionSchema,
  businessSetupSchema,
  offerSchema,
  updateOfferSchema,
  branchSchema,
  updateBranchSchema,
  scanSchema,
  customerNameSchema,
  redeemSchema,
  reviewBonusSchema,
  createOfferSchema,
  scratchOfferSchema,
  updateScratchOfferSchema,
  scratchSchema,
  diceOfferSchema,
  updateDiceOfferSchema,
  diceRollSchema,
  analyticsQuerySchema,
  updateSettingsSchema,
  customerListQuerySchema,
  adminLoginSchema,
  adminMerchantListQuerySchema,
  adminMerchantActionSchema,
  adminPaymentListQuerySchema,
  adminActionListQuerySchema,
  paymentActionSchema,
  checkoutSchema,
  scanRequestListQuerySchema,
  saveMenuSchema,
  menuSlugSchema,
  visionDraftSchema,
} from './schemas';
import {
  SCRATCH_COOLDOWN_DEFAULT_HOURS,
  SCRATCH_COOLDOWN_MIN_HOURS,
  SCRATCH_COOLDOWN_MAX_HOURS,
  MENU_MAX_TITLE,
  MENU_MAX_ITEM_NAME,
  MENU_MAX_CATEGORIES,
  MENU_SLUG_MAX,
  MENU_MAX_MODIFIER_GROUPS_PER_ITEM,
  MENU_MAX_OPTIONS_PER_GROUP,
} from '@/lib/constants';

describe('Auth Validation Schemas', () => {
  it('validates Bangladeshi phone numbers correctly', () => {
    expect(phoneSchema.safeParse('01712345678').success).toBe(true);
    expect(phoneSchema.safeParse('+8801812345678').success).toBe(true);
    expect(phoneSchema.safeParse('12345').success).toBe(false);
  });

  it('accepts an email-session payload with a plausible ID token', () => {
    expect(emailSessionSchema.safeParse({ idToken: 'x'.repeat(64) }).success).toBe(true);
    expect(emailSessionSchema.safeParse({}).success).toBe(false);
    expect(emailSessionSchema.safeParse({ idToken: 'short' }).success).toBe(false);
    // .strict(): nothing travels beside the token.
    expect(emailSessionSchema.safeParse({ idToken: 'x'.repeat(64), role: 'customer' }).success).toBe(
      false
    );
  });

  it('accepts a customer session payload (name + phone, no code)', () => {
    expect(
      customerSessionSchema.safeParse({ name: 'Rahim Uddin', phoneNumber: '01712345678' }).success
    ).toBe(true);
    expect(customerSessionSchema.safeParse({ name: 'R', phoneNumber: '01712345678' }).success).toBe(
      false
    );
    expect(customerSessionSchema.safeParse({ name: 'Rahim Uddin', phoneNumber: '12345' }).success).toBe(
      false
    );
    expect(customerSessionSchema.safeParse({ name: 'Rahim Uddin' }).success).toBe(false);
  });

  it('validates business setup parameters', () => {
    const validData = {
      businessName: 'Crimson Cup Banani',
      category: 'Café & Bakery',
      phoneNumber: '01712345678',
    };
    expect(businessSetupSchema.safeParse(validData).success).toBe(true);

    const invalidData = {
      businessName: 'A',
      category: '',
      phoneNumber: 'invalid',
    };
    expect(businessSetupSchema.safeParse(invalidData).success).toBe(false);
  });
});

describe('Offer Validation Schemas', () => {
  const validOffer = {
    title: 'Buy 10 Get 1 Free',
    rewardType: 'FREE_ITEM' as const,
    requiredStamps: 10,
    durationDays: 90,
  };

  it('accepts a valid offer', () => {
    expect(offerSchema.safeParse(validOffer).success).toBe(true);
    expect(offerSchema.safeParse({ ...validOffer, posterTemplateUrl: 'https://example.com/p.png' }).success).toBe(true);
    expect(offerSchema.safeParse({ ...validOffer, posterTemplateUrl: '' }).success).toBe(true);
  });

  it('rejects invalid offers', () => {
    expect(offerSchema.safeParse({ ...validOffer, title: 'AB' }).success).toBe(false); // too short
    expect(offerSchema.safeParse({ ...validOffer, rewardType: 'CASH' }).success).toBe(false); // bad enum
    expect(offerSchema.safeParse({ ...validOffer, requiredStamps: 1 }).success).toBe(false); // min 2
    expect(offerSchema.safeParse({ ...validOffer, requiredStamps: 2.5 }).success).toBe(false); // int
    expect(offerSchema.safeParse({ ...validOffer, durationDays: 0 }).success).toBe(false); // min 1
    expect(offerSchema.safeParse({ ...validOffer, durationDays: 400 }).success).toBe(false); // max 365
    expect(offerSchema.safeParse({ ...validOffer, posterTemplateUrl: 'not-a-url' }).success).toBe(false);
    expect(offerSchema.safeParse({ ...validOffer, requiredStamps: '10' }).success).toBe(false); // strings not coerced
  });

  it('supports partial updates with at least one change', () => {
    expect(updateOfferSchema.safeParse({ title: 'New Title' }).success).toBe(true);
    expect(updateOfferSchema.safeParse({ isActive: false }).success).toBe(true);
    expect(updateOfferSchema.safeParse({}).success).toBe(false);
  });
});

describe('Scratch Card Offer Validation Schemas (Phase 3.5)', () => {
  const scratchFixed = {
    offerType: 'SCRATCH' as const,
    title: 'Scratch & Win Dessert',
    durationDays: 60,
    scratchMode: 'FIXED' as const,
    items: ['Free Dessert'],
  };

  const scratchPool = {
    offerType: 'SCRATCH' as const,
    title: 'Scratch & Win Combo',
    durationDays: 60,
    scratchMode: 'RANDOM_POOL' as const,
    items: ['Free Drink', '20% Off', 'Free Dessert'],
  };

  it('accepts a valid fixed scratch offer (exactly one reward)', () => {
    expect(scratchOfferSchema.safeParse(scratchFixed).success).toBe(true);
  });

  it('accepts a valid randomized-pool scratch offer (2-20 rewards)', () => {
    expect(scratchOfferSchema.safeParse(scratchPool).success).toBe(true);
    expect(
      scratchOfferSchema.safeParse({ ...scratchPool, items: ['A', 'B'] }).success
    ).toBe(true);
    expect(
      scratchOfferSchema.safeParse({
        ...scratchPool,
        items: Array.from({ length: 20 }, (_, i) => `Reward ${i + 1}`),
      }).success
    ).toBe(true);
  });

  it('rejects mode/item-count mismatches', () => {
    // Fixed with more than one reward.
    expect(
      scratchOfferSchema.safeParse({ ...scratchFixed, items: ['A', 'B'] }).success
    ).toBe(false);
    // Pool with a single reward.
    expect(
      scratchOfferSchema.safeParse({ ...scratchPool, items: ['Only One'] }).success
    ).toBe(false);
    // No rewards at all.
    expect(scratchOfferSchema.safeParse({ ...scratchPool, items: [] }).success).toBe(false);
    // More than 20 rewards.
    expect(
      scratchOfferSchema.safeParse({
        ...scratchPool,
        items: Array.from({ length: 21 }, (_, i) => `R${i}`),
      }).success
    ).toBe(false);
  });

  it('rejects bad reward labels and fields', () => {
    expect(scratchOfferSchema.safeParse({ ...scratchFixed, items: ['   '] }).success).toBe(false);
    expect(
      scratchOfferSchema.safeParse({ ...scratchFixed, items: ['x'.repeat(61)] }).success
    ).toBe(false);
    expect(scratchOfferSchema.safeParse({ ...scratchFixed, title: 'AB' }).success).toBe(false);
    expect(scratchOfferSchema.safeParse({ ...scratchFixed, durationDays: 0 }).success).toBe(false);
    expect(scratchOfferSchema.safeParse({ ...scratchFixed, durationDays: 400 }).success).toBe(false);
    expect(
      scratchOfferSchema.safeParse({ ...scratchFixed, scratchMode: 'SOMETIMES' }).success
    ).toBe(false);
    expect(scratchOfferSchema.safeParse({ ...scratchFixed, posterTemplateUrl: 'nope' }).success).toBe(
      false
    );
    // Stamp-only fields are not part of the scratch payload shape.
    expect(scratchOfferSchema.safeParse({ ...scratchFixed, requiredStamps: 5 }).success).toBe(false);
  });

  it('defaults the reveal cooldown to 24h for clients that omit it', () => {
    const parsed = scratchOfferSchema.safeParse(scratchFixed);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.scratchCooldownHours).toBe(SCRATCH_COOLDOWN_DEFAULT_HOURS);
    }
    // The create union fills the same default, so the column never lands null.
    const created = createOfferSchema.safeParse(scratchPool);
    expect(created.success).toBe(true);
    if (created.success && created.data.offerType === 'SCRATCH') {
      expect(created.data.scratchCooldownHours).toBe(SCRATCH_COOLDOWN_DEFAULT_HOURS);
    }
  });

  it('accepts cooldowns across the merchant-selectable range', () => {
    for (const hours of [
      SCRATCH_COOLDOWN_MIN_HOURS,
      6,
      12,
      24,
      72,
      SCRATCH_COOLDOWN_MAX_HOURS,
    ]) {
      expect(
        scratchOfferSchema.safeParse({ ...scratchFixed, scratchCooldownHours: hours }).success
      ).toBe(true);
    }
  });

  it('rejects cooldowns outside the range or of the wrong type', () => {
    // 0 would let a customer scratch in a loop; 169+ is an accidental lockout.
    for (const bad of [0, -1, SCRATCH_COOLDOWN_MAX_HOURS + 1, 24.5, '24', null, {}]) {
      expect(
        scratchOfferSchema.safeParse({ ...scratchFixed, scratchCooldownHours: bad }).success
      ).toBe(false);
    }
  });

  it('accepts a partial cooldown-only update on an existing scratch offer', () => {
    const partial = updateScratchOfferSchema.safeParse({ scratchCooldownHours: 6 });
    expect(partial.success).toBe(true);
    if (partial.success) expect(partial.data.scratchCooldownHours).toBe(6);

    expect(updateScratchOfferSchema.safeParse({ scratchCooldownHours: 999 }).success).toBe(
      false
    );

    // Unknown keys on PATCH are rejected (strict schemas): a stamp offer
    // can never gain a cooldown field. The route still 422s
    // (OFFER_TYPE_MISMATCH) on seeing the key, before it ever parses.
    const stampUpdate = updateOfferSchema.safeParse({
      title: 'Fresh title',
      scratchCooldownHours: 6,
    });
    expect(stampUpdate.success).toBe(false);
  });

  it('createOfferSchema discriminates by offerType and defaults to STAMP', () => {
    const stampBody = {
      title: 'Buy 10 Get 1 Free',
      rewardType: 'FREE_ITEM',
      requiredStamps: 10,
      durationDays: 90,
    };

    // Legacy stamp body (no offerType) → treated as STAMP.
    const legacy = createOfferSchema.safeParse(stampBody);
    expect(legacy.success).toBe(true);
    if (legacy.success) expect(legacy.data.offerType).toBe('STAMP');

    // Explicit stamp body.
    expect(createOfferSchema.safeParse({ ...stampBody, offerType: 'STAMP' }).success).toBe(true);
    // Explicit scratch body.
    expect(createOfferSchema.safeParse(scratchPool).success).toBe(true);
    // Unknown offer type.
    expect(
      createOfferSchema.safeParse({ ...scratchPool, offerType: 'Mystery' }).success
    ).toBe(false);
    // Scratch body with no discriminant is NOT created as a scratch offer —
    // it defaults to STAMP and then fails the stamp shape.
    expect(
      createOfferSchema.safeParse({
        title: 'Scratch & Win Combo',
        durationDays: 60,
        scratchMode: 'RANDOM_POOL',
        items: ['A', 'B'],
      }).success
    ).toBe(false);
    // Stamp-only validation still applies on the stamp branch.
    expect(createOfferSchema.safeParse({ ...stampBody, requiredStamps: 1 }).success).toBe(false);
    // Scratch mode/item rules apply on the scratch branch.
    expect(
      createOfferSchema.safeParse({ ...scratchPool, items: ['Only One'] }).success
    ).toBe(false);
  });

  it('validates scratch updates with at least one change', () => {
    expect(updateScratchOfferSchema.safeParse({ title: 'New Title' }).success).toBe(true);
    expect(updateScratchOfferSchema.safeParse({ isActive: false }).success).toBe(true);
    expect(updateScratchOfferSchema.safeParse({ items: ['A'] }).success).toBe(true);
    expect(updateScratchOfferSchema.safeParse({}).success).toBe(false);
    expect(updateScratchOfferSchema.safeParse({ scratchMode: 'NOPE' }).success).toBe(false);
    expect(updateScratchOfferSchema.safeParse({ requiredStamps: 5 }).success).toBe(false);
    // Strict: a valid field cannot smuggle an unknown one past PATCH.
    expect(
      updateScratchOfferSchema.safeParse({ title: 'New Title', requiredStamps: 5 }).success
    ).toBe(false);
    expect(updateOfferSchema.safeParse({ title: 'T', bogusField: 1 }).success).toBe(false);
  });

  it('scratchSchema mirrors the stamp scan payload', () => {
    expect(scratchSchema.safeParse({ offerId: 'ckx123' }).success).toBe(true);
    expect(
      scratchSchema.safeParse({ offerId: 'ckx123', latitude: 23.79, longitude: 90.4 }).success
    ).toBe(true);
    expect(scratchSchema.safeParse({}).success).toBe(false);
    expect(scratchSchema.safeParse({ offerId: 'x', latitude: 23.79 }).success).toBe(false);
  });
});

describe('Dice Roll Offer Validation Schemas', () => {
  const diceOffer = {
    offerType: 'DICE' as const,
    title: 'Roll & Win 10% Off',
    durationDays: 60,
    diceCount: 3,
  };

  it('accepts a valid dice offer', () => {
    expect(diceOfferSchema.safeParse(diceOffer).success).toBe(true);
  });

  it('accepts every merchant-selectable dice count (1..5)', () => {
    for (const diceCount of [1, 2, 3, 4, 5]) {
      expect(diceOfferSchema.safeParse({ ...diceOffer, diceCount }).success).toBe(true);
    }
  });

  it('rejects a dice count outside 1..5 or of the wrong type', () => {
    // 0 dice is an unplayable page; 6+ exceeds the 5-die maximum.
    for (const bad of [0, -1, 6, 12, 2.5, '3', null, {}, undefined]) {
      expect(diceOfferSchema.safeParse({ ...diceOffer, diceCount: bad }).success).toBe(false);
    }
  });

  it('rejects missing, short, oversized and bad-shaped dice payloads', () => {
    expect(diceOfferSchema.safeParse({ ...diceOffer, diceCount: undefined }).success).toBe(false);
    expect(diceOfferSchema.safeParse({ ...diceOffer, title: 'AB' }).success).toBe(false);
    expect(diceOfferSchema.safeParse({ ...diceOffer, durationDays: 0 }).success).toBe(false);
    expect(diceOfferSchema.safeParse({ ...diceOffer, durationDays: 400 }).success).toBe(false);
    expect(
      diceOfferSchema.safeParse({ ...diceOffer, posterTemplateUrl: 'nope' }).success
    ).toBe(false);
    // Stamp-only and scratch-only fields are not part of the dice shape.
    expect(diceOfferSchema.safeParse({ ...diceOffer, requiredStamps: 5 }).success).toBe(false);
    expect(diceOfferSchema.safeParse({ ...diceOffer, scratchMode: 'FIXED' }).success).toBe(false);
    expect(diceOfferSchema.safeParse({ ...diceOffer, items: ['A'] }).success).toBe(false);
    // Unknown keys are rejected outright, never silently stored.
    expect(diceOfferSchema.safeParse({ ...diceOffer, bonus: 10 }).success).toBe(false);
  });

  it('discriminates dice offers as their own branch of the create union', () => {
    const parsed = createOfferSchema.safeParse(diceOffer);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.offerType).toBe('DICE');

    // A dice body with no discriminant defaults to STAMP, then fails stamp rules.
    expect(
      createOfferSchema.safeParse({
        title: 'Roll & Win 10% Off',
        durationDays: 60,
        diceCount: 3,
      }).success
    ).toBe(false);
    // Stamp-only validation still applies on the stamp branch.
    expect(
      createOfferSchema.safeParse({
        offerType: 'STAMP',
        title: 'Buy 10 Get 1',
        rewardType: 'DISCOUNT',
        requiredStamps: 5,
        durationDays: 30,
        diceCount: 3,
      }).success
    ).toBe(false);
  });

  it('validates dice updates with at least one change', () => {
    expect(updateDiceOfferSchema.safeParse({ diceCount: 5 }).success).toBe(true);
    expect(updateDiceOfferSchema.safeParse({ title: 'New Title' }).success).toBe(true);
    expect(updateDiceOfferSchema.safeParse({ isActive: false }).success).toBe(true);
    expect(updateDiceOfferSchema.safeParse({}).success).toBe(false);
    expect(updateDiceOfferSchema.safeParse({ diceCount: 6 }).success).toBe(false);
    expect(updateDiceOfferSchema.safeParse({ diceCount: 0 }).success).toBe(false);
    // Stamp-only and scratch-only fields stay out of the dice update shape.
    expect(updateDiceOfferSchema.safeParse({ requiredStamps: 5 }).success).toBe(false);
    expect(updateDiceOfferSchema.safeParse({ scratchCooldownHours: 6 }).success).toBe(false);
  });

  it('diceRollSchema mirrors the stamp scan payload', () => {
    expect(diceRollSchema.safeParse({ offerId: 'ckx123' }).success).toBe(true);
    expect(
      diceRollSchema.safeParse({ offerId: 'ckx123', latitude: 23.79, longitude: 90.4 }).success
    ).toBe(true);
    expect(diceRollSchema.safeParse({}).success).toBe(false);
    expect(diceRollSchema.safeParse({ offerId: 'x', latitude: 23.79 }).success).toBe(false);
  });
});

describe('Branch Validation Schemas', () => {
  const validBranch = {
    branchName: 'Banani Branch',
    address: 'Road 11, Banani, Dhaka',
    latitude: 23.7937,
    longitude: 90.4066,
  };

  it('accepts a valid branch (with and without GPS)', () => {
    expect(branchSchema.safeParse(validBranch).success).toBe(true);
    expect(branchSchema.safeParse({ branchName: 'Dhanmondi Branch' }).success).toBe(true);
    expect(branchSchema.safeParse({ ...validBranch, latitude: null, longitude: null }).success).toBe(true);
  });

  it('rejects invalid branches', () => {
    expect(branchSchema.safeParse({ ...validBranch, branchName: 'X' }).success).toBe(false);
    expect(branchSchema.safeParse({ ...validBranch, latitude: 999 }).success).toBe(false);
    expect(branchSchema.safeParse({ ...validBranch, longitude: -200 }).success).toBe(false);
    expect(branchSchema.safeParse({ ...validBranch, address: 'a'.repeat(201) }).success).toBe(false);
    expect(branchSchema.safeParse({ ...validBranch, latitude: '23.7' }).success).toBe(false);
  });

  it('supports partial updates with at least one change', () => {
    expect(updateBranchSchema.safeParse({ address: 'New address' }).success).toBe(true);
    expect(updateBranchSchema.safeParse({}).success).toBe(false);
  });
});

describe('Phase 3 Customer Validation Schemas', () => {
  it('mints the customer session from name + phone directly', () => {
    expect(
      customerSessionSchema.safeParse({ name: 'Rahim Uddin', phoneNumber: '01712345678' }).success
    ).toBe(true);
    // Name is mandatory — the merchant sees it on the check-in.
    expect(customerSessionSchema.safeParse({ phoneNumber: '01712345678' }).success).toBe(false);
    expect(customerSessionSchema.safeParse({ name: 'Rahim Uddin' }).success).toBe(false);
  });

  it('validates scan payloads (offer id + optional coordinate pair)', () => {
    expect(scanSchema.safeParse({ offerId: 'ckx123' }).success).toBe(true);
    expect(scanSchema.safeParse({ offerId: 'ckx123', latitude: 23.79, longitude: 90.4 }).success).toBe(true);
    expect(scanSchema.safeParse({}).success).toBe(false); // missing offerId
    expect(scanSchema.safeParse({ offerId: '' }).success).toBe(false);
    expect(scanSchema.safeParse({ offerId: 'x', latitude: 23.79 }).success).toBe(false); // half a pair
    expect(scanSchema.safeParse({ offerId: 'x', latitude: 999, longitude: 90.4 }).success).toBe(false);
    expect(scanSchema.safeParse({ offerId: 'x', latitude: 23.7, longitude: '90.4' }).success).toBe(false);
  });

  it('validates redeem and review payloads', () => {
    expect(redeemSchema.safeParse({ offerId: 'ckx123' }).success).toBe(true);
    expect(redeemSchema.safeParse({ offerId: '' }).success).toBe(false);
    expect(reviewBonusSchema.safeParse({ offerId: 'ckx123' }).success).toBe(true);
    expect(reviewBonusSchema.safeParse({}).success).toBe(false);
  });

  it('requires the customer name on the session payload itself', () => {
    expect(
      customerSessionSchema.safeParse({
        name: 'Rahim Uddin',
        phoneNumber: '01712345678',
      }).success
    ).toBe(true);
    // A name of only whitespace is trimmed to nothing and rejected.
    expect(
      customerSessionSchema.safeParse({ name: '  ', phoneNumber: '01712345678' }).success
    ).toBe(false);
  });

  it('rejects names that are too short or too long', () => {
    expect(customerNameSchema.safeParse('A').success).toBe(false);
    expect(customerNameSchema.safeParse('  ').success).toBe(false);
    expect(customerNameSchema.safeParse('Rahim Uddin').success).toBe(true);
    expect(customerNameSchema.safeParse('x'.repeat(61)).success).toBe(false);
  });

  it('trims a supplied name', () => {
    const parsed = customerNameSchema.safeParse('  Rahim Uddin  ');
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toBe('Rahim Uddin');
  });
});

describe('Phase 4 Analytics Query Schema', () => {
  it('accepts no dates (route default) and a full valid range', () => {
    expect(analyticsQuerySchema.safeParse({}).success).toBe(true);
    expect(analyticsQuerySchema.safeParse({ from: '2026-09-01', to: '2026-09-24' }).success).toBe(true);
    expect(analyticsQuerySchema.safeParse({ from: '2026-09-01', to: '2026-09-24', format: 'csv' }).success).toBe(true);
    expect(analyticsQuerySchema.safeParse({ format: 'json' }).success).toBe(true);
  });

  it('requires both dates together', () => {
    expect(analyticsQuerySchema.safeParse({ from: '2026-09-01' }).success).toBe(false);
    expect(analyticsQuerySchema.safeParse({ to: '2026-09-01' }).success).toBe(false);
  });

  it('rejects reversed ranges and ranges over 366 days', () => {
    expect(analyticsQuerySchema.safeParse({ from: '2026-09-24', to: '2026-09-01' }).success).toBe(false);
    expect(analyticsQuerySchema.safeParse({ from: '2025-01-01', to: '2026-01-02' }).success).toBe(false); // 366+1 days
    // Exactly 366 days is allowed.
    expect(analyticsQuerySchema.safeParse({ from: '2025-01-01', to: '2026-01-01' }).success).toBe(true);
  });

  it('rejects malformed dates and unknown formats', () => {
    expect(analyticsQuerySchema.safeParse({ from: '09/01/2026', to: '2026-09-24' }).success).toBe(false);
    expect(analyticsQuerySchema.safeParse({ from: '2026-02-31', to: '2026-03-01' }).success).toBe(false);
    expect(analyticsQuerySchema.safeParse({ from: '2026-09-01', to: '2026-09-24', format: 'xml' }).success).toBe(false);
  });
});

describe('Phase 4 Settings Schema', () => {
  it('accepts partial updates and valid social links', () => {
    expect(updateSettingsSchema.safeParse({ businessName: 'Crimson Cup' }).success).toBe(true);
    expect(updateSettingsSchema.safeParse({ category: 'Salon & Spa' }).success).toBe(true);
    expect(updateSettingsSchema.safeParse({ websiteUrl: 'https://example.com' }).success).toBe(true);
    expect(updateSettingsSchema.safeParse({ websiteUrl: '' }).success).toBe(true); // clears the field
    expect(
      updateSettingsSchema.safeParse({
        businessName: 'Crimson Cup',
        category: 'Café & Bakery',
        facebookUrl: 'https://facebook.com/crimsoncup',
        instagramUrl: 'https://instagram.com/crimsoncup',
      }).success
    ).toBe(true);
    // Logo moved to file upload — a stray logoUrl is stripped, not stored.
    expect(
      updateSettingsSchema.safeParse({ businessName: 'Crimson Cup', logoUrl: 'https://cdn.example.com/logo.png' }).success
    ).toBe(true);
  });

  it('rejects an empty body and invalid values', () => {
    expect(updateSettingsSchema.safeParse({}).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ businessName: 'A' }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ businessName: '  ' }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ category: '' }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ websiteUrl: 'not-a-url' }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ instagramUrl: 'ftp://example.com' }).success).toBe(false);
  });
});

describe('Phase 4 Customer List Query Schema', () => {
  it('accepts omitted params and defaults page/pageSize', () => {
    const parsed = customerListQuerySchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.page).toBeUndefined();
      expect(parsed.data.pageSize).toBeUndefined();
    }
  });

  it('coerces numeric query strings', () => {
    const parsed = customerListQuerySchema.safeParse({ q: '01712', page: '2', pageSize: '50' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual({ q: '01712', page: 2, pageSize: 50 });
  });

  it('rejects out-of-range pagination and overlong searches', () => {
    expect(customerListQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(customerListQuerySchema.safeParse({ page: 'abc' }).success).toBe(false);
    expect(customerListQuerySchema.safeParse({ pageSize: '0' }).success).toBe(false);
    expect(customerListQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
    // Phase 12: the cap follows names, not just phone fragments — 41 is over.
    expect(customerListQuerySchema.safeParse({ q: 'x'.repeat(41) }).success).toBe(false);
    expect(customerListQuerySchema.safeParse({ q: 'x'.repeat(40) }).success).toBe(true);
  });

  it('accepts a name fragment, not only digits', () => {
    const parsed = customerListQuerySchema.safeParse({ q: 'Rahim Chowdhury' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.q).toBe('Rahim Chowdhury');
  });
});

describe('Phase 5 Admin Login Schema', () => {
  it('accepts an 8–128 char password', () => {
    expect(adminLoginSchema.safeParse({ password: 'short7ch' }).success).toBe(true);
    expect(adminLoginSchema.safeParse({ password: 'x'.repeat(128) }).success).toBe(true);
  });

  it('rejects short, long, missing, and non-string passwords', () => {
    expect(adminLoginSchema.safeParse({ password: 'short7' }).success).toBe(false);
    expect(adminLoginSchema.safeParse({ password: 'x'.repeat(129) }).success).toBe(false);
    expect(adminLoginSchema.safeParse({}).success).toBe(false);
    expect(adminLoginSchema.safeParse({ password: 12345678 }).success).toBe(false);
  });
});

describe('Phase 5 Admin Merchant List Query Schema', () => {
  it('accepts omitted params', () => {
    const parsed = adminMerchantListQuerySchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual({});
  });

  it('accepts search + subscription status + coerced pagination', () => {
    const parsed = adminMerchantListQuerySchema.safeParse({
      q: 'crimson',
      status: 'ACTIVE',
      page: '2',
      pageSize: '10',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({ q: 'crimson', status: 'ACTIVE', page: 2, pageSize: 10 });
    }
  });

  it('rejects unknown statuses, bad pagination, and overlong search', () => {
    expect(adminMerchantListQuerySchema.safeParse({ status: 'CANCELLED' }).success).toBe(false);
    expect(adminMerchantListQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(adminMerchantListQuerySchema.safeParse({ page: 'abc' }).success).toBe(false);
    expect(adminMerchantListQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
    expect(adminMerchantListQuerySchema.safeParse({ q: 'x'.repeat(21) }).success).toBe(false);
  });
});

describe('Phase 5 Admin Merchant Action Schema', () => {
  it('accepts each documented action', () => {
    for (const action of ['activate', 'expire', 'revoke', 'suspend', 'restore']) {
      expect(adminMerchantActionSchema.safeParse({ action }).success).toBe(true);
    }
  });

  it('rejects unknown, missing, or non-string actions', () => {
    expect(adminMerchantActionSchema.safeParse({ action: 'delete' }).success).toBe(false);
    expect(adminMerchantActionSchema.safeParse({}).success).toBe(false);
    expect(adminMerchantActionSchema.safeParse({ action: 42 }).success).toBe(false);
  });
});

describe('Phase 5 Admin Payment List Query Schema', () => {
  it('accepts each status incl. ALL plus search and pagination', () => {
    for (const status of ['PENDING', 'APPROVED', 'REJECTED', 'ALL']) {
      expect(adminPaymentListQuerySchema.safeParse({ status }).success).toBe(true);
    }
    const parsed = adminPaymentListQuerySchema.safeParse({ q: 'TRX123', page: '3', pageSize: '5' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual({ q: 'TRX123', page: 3, pageSize: 5 });
  });

  it('rejects unknown statuses and invalid pagination', () => {
    expect(adminPaymentListQuerySchema.safeParse({ status: 'REFUNDED' }).success).toBe(false);
    expect(adminPaymentListQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(adminPaymentListQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
    expect(adminPaymentListQuerySchema.safeParse({ q: 'x'.repeat(31) }).success).toBe(false);
  });
});

describe('Phase 5 Payment Action Schema', () => {
  it('accepts a bounded payment request id', () => {
    expect(paymentActionSchema.safeParse({ paymentRequestId: 'cmuf1v3d7000pukly00gnngs8' }).success).toBe(true);
  });

  it('rejects empty, overlong, missing, and non-string ids', () => {
    expect(paymentActionSchema.safeParse({ paymentRequestId: '' }).success).toBe(false);
    expect(paymentActionSchema.safeParse({ paymentRequestId: 'x'.repeat(65) }).success).toBe(false);
    expect(paymentActionSchema.safeParse({}).success).toBe(false);
    expect(paymentActionSchema.safeParse({ paymentRequestId: 123 }).success).toBe(false);
  });

  it('accepts an optional Phase 7 tier override and rejects unknown tiers', () => {
    expect(paymentActionSchema.safeParse({ paymentRequestId: 'abc123', tier: 'PREMIUM' }).success).toBe(true);
    expect(paymentActionSchema.safeParse({ paymentRequestId: 'abc123', tier: 'LIFETIME' }).success).toBe(false);
  });
});

describe('Phase 7 Checkout Schema', () => {
  it('accepts a FREE request without any payment details', () => {
    expect(checkoutSchema.safeParse({ requestedTier: 'FREE' }).success).toBe(true);
  });

  it('accepts a fully detailed paid request and coerces the amount', () => {
    const parsed = checkoutSchema.safeParse({
      requestedTier: 'MONTHLY',
      paymentMethod: 'BKASH',
      senderNumber: '01712345678',
      trxId: '9H7BXK2EF',
      amount: '500',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.amount).toBe(500);
  });

  it('rejects paid requests missing any required field', () => {
    const base = { requestedTier: 'MONTHLY', paymentMethod: 'BKASH', senderNumber: '01712345678', trxId: 'TRX123', amount: 500 };
    expect(checkoutSchema.safeParse({ requestedTier: 'MONTHLY' }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, amount: undefined }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, trxId: undefined }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, senderNumber: undefined }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, paymentMethod: undefined }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, paymentMethod: 'WECHAT' }).success).toBe(false);
  });

  it('rejects unknown tiers, bad amounts and malformed trx ids', () => {
    const base = { requestedTier: 'MONTHLY', paymentMethod: 'BKASH', senderNumber: '01712345678', trxId: 'TRX123', amount: 500 };
    expect(checkoutSchema.safeParse({ ...base, requestedTier: 'LIFETIME' }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, amount: 0 }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, amount: 2_000_000 }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, trxId: 'bad trx!!' }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, trxId: 'x'.repeat(41) }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, senderNumber: 'not-a-phone' }).success).toBe(false);
  });
});

describe('Phase 9 Scan Request List Schema', () => {
  it('accepts an empty query (route defaults to the PENDING queue)', () => {
    expect(scanRequestListQuerySchema.safeParse({}).success).toBe(true);
  });

  it('accepts every status filter and coerces pagination', () => {
    const parsed = scanRequestListQuerySchema.safeParse({
      status: 'APPROVED',
      page: '2',
      pageSize: '50',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.page).toBe(2);
      expect(parsed.data.pageSize).toBe(50);
    }
    expect(scanRequestListQuerySchema.safeParse({ status: 'ALL' }).success).toBe(true);
    expect(scanRequestListQuerySchema.safeParse({ status: 'PENDING' }).success).toBe(true);
  });

  it('rejects an unknown status, a zero page size and an oversized page size', () => {
    expect(scanRequestListQuerySchema.safeParse({ status: 'REJECTED' }).success).toBe(false);
    expect(scanRequestListQuerySchema.safeParse({ pageSize: '0' }).success).toBe(false);
    expect(scanRequestListQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
  });
});

describe('Digital Menu validation (Phase 12)', () => {
  const validMenu = {
    title: 'Cafe Corner Menu',
    backgroundHex: '#FFF7ED',
    categories: [
      {
        name: 'Coffee',
        items: [
          { name: 'Latte', description: 'Hot', price: '৳250', isAvailable: true },
          { name: 'Americano', description: '', price: '', isAvailable: false },
        ],
      },
      {
        name: 'Bakery',
        items: [{ name: 'Croissant', price: '৳180' }],
      },
    ],
    publish: true,
  };

  it('accepts a full payload', () => {
    expect(saveMenuSchema.safeParse(validMenu).success).toBe(true);
  });

  it('accepts publish omitted — that is the draft save', () => {
    const { publish, ...draft } = validMenu;
    expect(publish).toBe(true);
    expect(saveMenuSchema.safeParse(draft).success).toBe(true);
  });

  it('is strict: unknown fields are rejected, not silently dropped', () => {
    expect(saveMenuSchema.safeParse({ ...validMenu, extra: 'nope' }).success).toBe(false);
    expect(
      saveMenuSchema.safeParse({
        ...validMenu,
        categories: [{ ...validMenu.categories[0], bogus: 1 }],
      }).success
    ).toBe(false);
  });

  it('enforces title and item-name bounds', () => {
    expect(saveMenuSchema.safeParse({ ...validMenu, title: 'A' }).success).toBe(false);
    expect(
      saveMenuSchema.safeParse({ ...validMenu, title: 'x'.repeat(MENU_MAX_TITLE + 1) }).success
    ).toBe(false);

    const longName = 'x'.repeat(MENU_MAX_ITEM_NAME + 1);
    expect(
      saveMenuSchema.safeParse({
        ...validMenu,
        categories: [{ name: 'Coffee', items: [{ name: longName }] }],
      }).success
    ).toBe(false);
  });

  it('accepts 3- and 6-digit hex, rejects anything else', () => {
    expect(saveMenuSchema.safeParse({ ...validMenu, backgroundHex: '#abc' }).success).toBe(true);
    for (const backgroundHex of ['red', 'rgb(0,0,0)', '#12345', 'javascript:alert(1)', '']) {
      expect(saveMenuSchema.safeParse({ ...validMenu, backgroundHex }).success).toBe(false);
    }
  });

  it('requires at least one section, and at least one item per section', () => {
    expect(saveMenuSchema.safeParse({ ...validMenu, categories: [] }).success).toBe(false);
    expect(
      saveMenuSchema.safeParse({
        ...validMenu,
        categories: [{ name: 'Coffee', items: [] }],
      }).success
    ).toBe(false);
    expect(
      saveMenuSchema.safeParse({
        ...validMenu,
        categories: [
          { name: 'Coffee', items: [{ name: 'Latte' }] },
          { name: '   ', items: [{ name: 'Latte' }] },
        ],
      }).success
    ).toBe(false);
  });

  it('caps the number of sections', () => {
    const tooMany = Array.from({ length: MENU_MAX_CATEGORIES + 1 }, (_, i) => ({
      name: `Section ${i}`,
      items: [{ name: 'Item' }],
    }));
    expect(saveMenuSchema.safeParse({ ...validMenu, categories: tooMany }).success).toBe(false);
  });

  it('accepts items carrying modifier groups (add-ons & variants)', () => {
    const withModifiers = {
      ...validMenu,
      categories: [
        {
          name: 'Coffee',
          items: [
            {
              name: 'Latte',
              price: '৳250',
              modifierGroups: [
                {
                  name: 'Size',
                  selectionType: 'SINGLE',
                  isRequired: true,
                  options: [
                    { name: 'Regular', price: '+৳0', isDefault: true },
                    { name: 'Large', price: '+৳60' },
                  ],
                },
                {
                  name: 'Extra toppings',
                  selectionType: 'MULTI',
                  options: [
                    { name: 'Extra shot', price: '+৳40' },
                    { name: 'Oat milk', price: 'Free' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const parsed = saveMenuSchema.safeParse(withModifiers);
    expect(parsed.success).toBe(true);
    // Trimmed the way the schema promises, so the payload round-trips.
    if (parsed.success) {
      expect(parsed.data.categories[0].items[0].modifierGroups?.[0]).toEqual({
        name: 'Size',
        selectionType: 'SINGLE',
        isRequired: true,
        options: [
          { name: 'Regular', price: '+৳0', isDefault: true },
          { name: 'Large', price: '+৳60' },
        ],
      });
    }
  });

  it('accepts modifierGroups omitted — existing payloads keep validating', () => {
    expect(saveMenuSchema.safeParse(validMenu).success).toBe(true);
  });

  it('rejects an empty modifier group, an unknown selection type and unknown group fields', () => {
    const item = { name: 'Latte', price: '৳250' };
    const wrap = (modifierGroups: unknown[]) =>
      saveMenuSchema.safeParse({
        ...validMenu,
        categories: [{ name: 'Coffee', items: [{ ...item, modifierGroups }] }],
      });

    expect(wrap([{ name: 'Size', selectionType: 'SINGLE', options: [] }]).success).toBe(false);
    expect(
      wrap([{ name: 'Size', selectionType: 'PICK_ONE', options: [{ name: 'S' }] }]).success
    ).toBe(false);
    expect(
      wrap([{ name: 'Size', selectionType: 'SINGLE', options: [{ name: 'S' }], bogus: 1 }]).success
    ).toBe(false);
  });

  it('enforces the modifier caps: groups per item, options per group', () => {
    const item = { name: 'Latte', price: '৳250' };
    const tooManyGroups = Array.from({ length: MENU_MAX_MODIFIER_GROUPS_PER_ITEM + 1 }, (_, i) => ({
      name: `Group ${i}`,
      selectionType: 'SINGLE',
      options: [{ name: 'A' }],
    }));
    expect(
      saveMenuSchema.safeParse({
        ...validMenu,
        categories: [{ name: 'Coffee', items: [{ ...item, modifierGroups: tooManyGroups }] }],
      }).success
    ).toBe(false);

    const tooManyOptions = Array.from({ length: MENU_MAX_OPTIONS_PER_GROUP + 1 }, (_, i) => ({
      name: `Option ${i}`,
    }));
    expect(
      saveMenuSchema.safeParse({
        ...validMenu,
        categories: [
          {
            name: 'Coffee',
            items: [
              {
                ...item,
                modifierGroups: [
                  { name: 'Toppings', selectionType: 'MULTI', options: tooManyOptions },
                ],
              },
            ],
          },
        ],
      }).success
    ).toBe(false);
  });

  it('MULTI groups cannot be required — a pick-many choice is always optional', () => {
    const body = (isRequired: boolean) =>
      saveMenuSchema.safeParse({
        ...validMenu,
        categories: [
          {
            name: 'Coffee',
            items: [
              {
                name: 'Latte',
                modifierGroups: [
                  {
                    name: 'Toppings',
                    selectionType: 'MULTI',
                    isRequired,
                    options: [{ name: 'Extra shot' }],
                  },
                ],
              },
            ],
          },
        ],
      });
    expect(body(true).success).toBe(false);
    expect(body(false).success).toBe(true);
  });

  it('requires a modifier option name and bounds option/group name lengths', () => {
    const wrap = (group: unknown) =>
      saveMenuSchema.safeParse({
        ...validMenu,
        categories: [
          { name: 'Coffee', items: [{ name: 'Latte', modifierGroups: [group] }] },
        ],
      });

    expect(wrap({ name: 'Size', selectionType: 'SINGLE', options: [{ name: '   ' }] }).success).toBe(
      false
    );
    expect(
      wrap({ name: 'x'.repeat(MENU_MAX_ITEM_NAME + 1), selectionType: 'SINGLE', options: [{ name: 'S' }] })
        .success
    ).toBe(false);
    expect(
      wrap({
        name: 'Size',
        selectionType: 'SINGLE',
        options: [{ name: 'x'.repeat(MENU_MAX_ITEM_NAME + 1) }],
      }).success
    ).toBe(false);
  });

  describe('menuSlugSchema — the public route param', () => {
    it('accepts generated handles', () => {
      expect(menuSlugSchema.safeParse('cafe-corner').success).toBe(true);
      expect(menuSlugSchema.safeParse('cafe-corner-12').success).toBe(true);
    });

    it('rejects traversal, spaces, case and oversized input before it reaches the DB', () => {
      for (const bad of [
        '..',
        '../admin',
        'Cafe Corner',
        'cafe corner',
        'cafe/',
        'CAFE-CORNER',
        '',
        'a'.repeat(MENU_SLUG_MAX + 1),
      ]) {
        expect(menuSlugSchema.safeParse(bad).success).toBe(false);
      }
    });
  });

  describe('visionDraftSchema — upstream, not a client request', () => {
    it('strips unknown model keys instead of failing', () => {
      const parsed = visionDraftSchema.safeParse({
        title: 'Menu',
        categories: [{ name: 'Coffee', items: [{ name: 'Latte', confidence: 0.97 }], extra: 1 }],
        usage: { tokens: 10 },
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data).toEqual({
          title: 'Menu',
          categories: [{ name: 'Coffee', items: [{ name: 'Latte' }] }],
        });
      }
    });

    it('never lets one malformed leaf fail the whole extraction', () => {
      const parsed = visionDraftSchema.safeParse({
        title: 42,
        categories: [{ name: 'Coffee', items: 'nope' }],
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.title).toBeNull();
        expect(parsed.data.categories[0].items).toEqual([]);
      }
    });

    it('parses an empty object into an empty draft', () => {
      const parsed = visionDraftSchema.safeParse({});
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.categories).toEqual([]);
    });
  });
});

describe('Email Session Schema', () => {
  it('accepts an ID-token payload', async () => {
    const { emailSessionSchema } = await import('./schemas');
    expect(emailSessionSchema.safeParse({ idToken: 'x'.repeat(64) }).success).toBe(true);
  });

  it('rejects short tokens and extra fields', async () => {
    const { emailSessionSchema } = await import('./schemas');
    expect(emailSessionSchema.safeParse({ idToken: 'short' }).success).toBe(false);
    expect(
      emailSessionSchema.safeParse({
        idToken: 'x'.repeat(64),
        email: 'shop@example.com',
      }).success
    ).toBe(false);
  });
});

describe('RT-02 admin action list query (GET /api/admin/actions)', () => {
  it('accepts an empty query (defaults live in the route)', () => {
    expect(adminActionListQuerySchema.safeParse({}).success).toBe(true);
  });

  it('accepts filters + coerced pagination', () => {
    const parsed = adminActionListQuerySchema.safeParse({
      action: 'APPROVE_PAYMENT',
      targetType: 'PAYMENT_REQUEST',
      page: '2',
      pageSize: '50',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toMatchObject({ action: 'APPROVE_PAYMENT', page: 2, pageSize: 50 });
    }
  });

  it('rejects an unknown target type', () => {
    expect(
      adminActionListQuerySchema.safeParse({ targetType: 'CUSTOMER' }).success
    ).toBe(false);
  });

  it('rejects out-of-range pagination', () => {
    expect(adminActionListQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(adminActionListQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
    expect(adminActionListQuerySchema.safeParse({ pageSize: 'x' }).success).toBe(false);
  });
});
