import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/backend/api/response';
import { withMerchant } from '@/backend/api/handler';
import {
  updateOfferSchema,
  updateScratchOfferSchema,
  updateDiceOfferSchema,
  scratchItemCountError,
} from '@/backend/validation/schemas';
import { db } from '@/backend/db';
import type { Prisma } from '@prisma/client';

// Every lookup is scoped by merchantId, so a foreign offer id 404s
// without leaking whether it exists.

const scratchItemsInclude = { scratchItems: { orderBy: { sortOrder: 'asc' as const } } };

// GET /api/offers/[id] — Fetches a single offer (Offer Edit page), including
// the scratch reward rows when the offer is a scratch card.
export const GET = withMerchant(async (req: NextRequest, session, merchant, { params }) => {
  try {
    const { id } = await params;
    if (!id) return apiError('Missing offer id', 'BAD_REQUEST', 400);

    const offer = await db.offer.findFirst({
      where: { id, merchantId: merchant.id, deletedAt: null },
      include: scratchItemsInclude,
    });
    if (!offer) return apiError('Offer not found', 'NOT_FOUND', 404);

    return apiSuccess({ offer });
  } catch (error) {
    console.error('Error fetching offer:', error);
    return apiError('Failed to load offer', 'INTERNAL_ERROR', 500);
  }
});

// PATCH /api/offers/[id] — Updates offer fields / toggles isActive.
// The payload schema is chosen from the STORED offer type: stamp offers accept
// stamp fields only, scratch offers accept scratch fields only, and the type
// itself is immutable after creation.
export const PATCH = withMerchant(async (req: NextRequest, session, merchant, { params }) => {
  try {
    const { id } = await params;
    if (!id) return apiError('Missing offer id', 'BAD_REQUEST', 400);

    // T-01: malformed JSON is a 422 (schemas below reject the null), never a 500.
    const body = await req.json().catch(() => null);

    const existing = await db.offer.findFirst({
      where: { id, merchantId: merchant.id, deletedAt: null },
      include: scratchItemsInclude,
    });
    if (!existing) return apiError('Offer not found', 'NOT_FOUND', 404);

    // Offer type is fixed at creation — a stamp offer can never become a
    // scratch card (and vice versa).
    if (body && typeof body === 'object' && 'offerType' in body && body.offerType !== undefined) {
      if (body.offerType !== existing.offerType) {
        return apiError('Offer type cannot be changed after creation', 'OFFER_TYPE_IMMUTABLE', 422);
      }
    }

    const data: Prisma.OfferUpdateInput = {};

    if (existing.offerType === 'STAMP') {
      if (
        body &&
        typeof body === 'object' &&
        ('scratchMode' in body || 'items' in body || 'scratchCooldownHours' in body || 'diceCount' in body)
      ) {
        return apiError(
          'Scratch and dice settings only exist on their own offer types',
          'OFFER_TYPE_MISMATCH',
          422
        );
      }

      const validation = updateOfferSchema.safeParse(body);
      if (!validation.success) {
        const issue = validation.error.issues[0]?.message || 'Invalid input';
        return apiError(issue, 'VALIDATION_ERROR', 422);
      }
      const b = validation.data;

      if ('title' in b && b.title !== undefined) data.title = b.title;
      if ('rewardType' in b && b.rewardType !== undefined) data.rewardType = b.rewardType;
      if ('requiredStamps' in b && b.requiredStamps !== undefined)
        data.requiredStamps = b.requiredStamps;
      if ('durationDays' in b && b.durationDays !== undefined) data.durationDays = b.durationDays;
      if ('posterTemplateUrl' in b && b.posterTemplateUrl !== undefined)
        data.posterTemplateUrl = b.posterTemplateUrl || null;
      if ('isActive' in b && b.isActive !== undefined) data.isActive = b.isActive;
    } else if (existing.offerType === 'SCRATCH') {
      if (
        body &&
        typeof body === 'object' &&
        ('requiredStamps' in body || 'rewardType' in body || 'diceCount' in body)
      ) {
        return apiError(
          'Stamp and dice settings only exist on their own offer types',
          'OFFER_TYPE_MISMATCH',
          422
        );
      }

      const validation = updateScratchOfferSchema.safeParse(body);
      if (!validation.success) {
        const issue = validation.error.issues[0]?.message || 'Invalid input';
        return apiError(issue, 'VALIDATION_ERROR', 422);
      }
      const b = validation.data;

      // Cross-check mode vs. reward rows even when only one of them was sent:
      // the other half comes from the stored offer.
      const countError = scratchItemCountError(
        b.scratchMode ?? existing.scratchMode,
        b.items ?? nextLabels(existing)
      );
      if (countError) return apiError(countError, 'VALIDATION_ERROR', 422);

      if ('title' in b && b.title !== undefined) data.title = b.title;
      if ('durationDays' in b && b.durationDays !== undefined) data.durationDays = b.durationDays;
      if ('scratchCooldownHours' in b && b.scratchCooldownHours !== undefined) {
        data.scratchCooldownHours = b.scratchCooldownHours;
      }
      if ('posterTemplateUrl' in b && b.posterTemplateUrl !== undefined)
        data.posterTemplateUrl = b.posterTemplateUrl || null;
      if ('isActive' in b && b.isActive !== undefined) data.isActive = b.isActive;
      if (b.scratchMode !== undefined) data.scratchMode = b.scratchMode;
      if (b.items !== undefined) {
        // Full replace keeps sortOrder authoritative and invalidates the stored
        // pool rotation (drawScratchReward reshuffles stale orders anyway).
        data.scratchItems = {
          deleteMany: {},
          create: b.items.map((label, sortOrder) => ({ label, sortOrder })),
        };
        data.scratchCursor = 0;
        data.scratchOrder = { set: [] };
      }
    } else {
      // DICE offer — its own strict shape, and it accepts nothing that belongs
      // to the other two types.
      if (
        body &&
        typeof body === 'object' &&
        ('requiredStamps' in body ||
          'rewardType' in body ||
          'scratchMode' in body ||
          'items' in body ||
          'scratchCooldownHours' in body)
      ) {
        return apiError(
          'Stamp and scratch settings only exist on their own offer types',
          'OFFER_TYPE_MISMATCH',
          422
        );
      }

      const validation = updateDiceOfferSchema.safeParse(body);
      if (!validation.success) {
        const issue = validation.error.issues[0]?.message || 'Invalid input';
        return apiError(issue, 'VALIDATION_ERROR', 422);
      }
      const b = validation.data;

      if ('title' in b && b.title !== undefined) data.title = b.title;
      if ('durationDays' in b && b.durationDays !== undefined) data.durationDays = b.durationDays;
      if ('posterTemplateUrl' in b && b.posterTemplateUrl !== undefined)
        data.posterTemplateUrl = b.posterTemplateUrl || null;
      if ('isActive' in b && b.isActive !== undefined) data.isActive = b.isActive;
      if (b.diceCount !== undefined) data.diceCount = b.diceCount;
    }

    const offer = await db.offer.update({
      where: { id: existing.id },
      data,
      include: scratchItemsInclude,
    });
    return apiSuccess({ offer });
  } catch (error) {
    console.error('Error updating offer:', error);
    return apiError('Failed to update offer', 'INTERNAL_ERROR', 500);
  }
});

/** Stored reward labels in merchant order (for partial-update cross-checks). */
function nextLabels(existing: { scratchItems: { label: string }[] }): string[] {
  return existing.scratchItems.map((item) => item.label);
}

// DELETE /api/offers/[id] — Soft-deletes an offer (deletedAt set)
export const DELETE = withMerchant(async (req: NextRequest, session, merchant, { params }) => {
  try {
    const { id } = await params;
    if (!id) return apiError('Missing offer id', 'BAD_REQUEST', 400);

    const existing = await db.offer.findFirst({
      where: { id, merchantId: merchant.id, deletedAt: null },
    });
    if (!existing) return apiError('Offer not found', 'NOT_FOUND', 404);

    await db.offer.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });

    return apiSuccess({ deleted: true, id: existing.id });
  } catch (error) {
    console.error('Error deleting offer:', error);
    return apiError('Failed to delete offer', 'INTERNAL_ERROR', 500);
  }
});
