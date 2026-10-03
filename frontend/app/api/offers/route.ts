import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/backend/api/response';
import { withMerchant } from '@/backend/api/handler';
import { createOfferSchema } from '@/backend/validation/schemas';
import { gateOfferCreate } from '@/backend/subscription';
import { db } from '@/backend/db';

/** Reward rows are always returned ordered so both UIs render deterministically. */
const scratchItemsInclude = { scratchItems: { orderBy: { sortOrder: 'asc' as const } } };

// GET /api/offers — Lists the merchant's offers (newest first), each with its
// type-specific configuration: stamp offers carry requiredStamps, scratch
// offers carry scratchMode + scratchItems.
export const GET = withMerchant(async (req: NextRequest, session, merchant) => {
  try {
    const offers = await db.offer.findMany({
      where: { merchantId: merchant.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: scratchItemsInclude,
    });
    return apiSuccess({ offers });
  } catch (error) {
    console.error('Error listing offers:', error);
    return apiError('Failed to load offers', 'INTERNAL_ERROR', 500);
  }
});

// POST /api/offers — Creates one offer from exactly one branch of the
// discriminated union (STAMP vs SCRATCH vs DICE); the payloads never overlap.
export const POST = withMerchant(async (req: NextRequest, session, merchant) => {
  try {
    // T-01: malformed JSON is a 422 (Zod rejects the null), never a 500.
    const body = await req.json().catch(() => null);
    const validation = createOfferSchema.safeParse(body);

    if (!validation.success) {
      const issue = validation.error.issues[0]?.message || 'Invalid input';
      return apiError(issue, 'VALIDATION_ERROR', 422);
    }
    const data = validation.data;

    // Subscription gate: expired = no creation at all; free trial = scratch only.
    const gate = gateOfferCreate(merchant, data.offerType);
    if (!gate.ok) return apiError(gate.message, gate.code, 403);

    // Shared by every branch: the non-type-specific columns. Type-only columns
    // are set explicitly (or left null) below so a column can never carry a
    // value that belongs to a different offer type.
    const common = {
      merchantId: merchant.id,
      title: data.title,
      durationDays: data.durationDays,
      posterTemplateUrl: data.posterTemplateUrl || null,
    };

    let offer;
    if (data.offerType === 'SCRATCH') {
      offer = await db.offer.create({
        data: {
          ...common,
          offerType: 'SCRATCH',
          scratchMode: data.scratchMode,
          // Stamp + dice fields stay null on scratch offers (schema decoupling).
          requiredStamps: null,
          diceCount: null,
          scratchCooldownHours: data.scratchCooldownHours,
          scratchItems: {
            create: data.items.map((label, sortOrder) => ({ label, sortOrder })),
          },
        },
        include: scratchItemsInclude,
      });
    } else if (data.offerType === 'DICE') {
      offer = await db.offer.create({
        data: {
          ...common,
          offerType: 'DICE',
          diceCount: data.diceCount,
          // Stamp + scratch fields stay null on dice offers (schema decoupling).
          requiredStamps: null,
          scratchMode: null,
        },
        include: scratchItemsInclude,
      });
    } else {
      offer = await db.offer.create({
        data: {
          ...common,
          offerType: 'STAMP',
          rewardType: data.rewardType,
          requiredStamps: data.requiredStamps,
          // Scratch + dice fields stay null on stamp offers (schema decoupling).
          diceCount: null,
        },
        include: scratchItemsInclude,
      });
    }

    return apiSuccess({ offer }, 201);
  } catch (error) {
    console.error('Error creating offer:', error);
    return apiError('Failed to create offer', 'INTERNAL_ERROR', 500);
  }
});
