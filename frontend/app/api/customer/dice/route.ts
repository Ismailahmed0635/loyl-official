import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/backend/api/response';
import { withCustomer } from '@/backend/api/handler';
import { diceRollSchema } from '@/backend/validation/schemas';
import { gateCustomerAction } from '@/backend/subscription';
import { offerEnded, GEO_FENCE_RADIUS_M } from '@/backend/scan';
import {
  buildDiceState,
  findLastDiceRoll,
  normalizeDiceCount,
  rollDice,
} from '@/backend/dice';
import { findNearestBranch, isGeoRequired, GeoPoint } from '@/backend/geo';
import { db } from '@/backend/db';

/**
 * POST /api/customer/dice — one-time dice roll.
 *
 * Fully decoupled from the stamp and scratch engines: only DICE offers reach
 * it (`WRONG_OFFER_TYPE` 409 otherwise). Guard order mirrors /scan —
 * offer validity → type → paused/ended → GPS → one-time limit → roll + persist.
 *
 * The limit is a lifetime, not a window: `DiceRollResult` carries
 * `@@unique([offerId, customerPhone])`, so the pre-check below is a fast path
 * for the UI and the unique constraint is the actual authority under a race.
 * A losing racer gets `ALREADY_ROLLED` 409 with their existing roll attached,
 * so the client can render the true result instead of an error page.
 *
 * Discount mapping: the roll total IS the discount percent (see backend/dice.ts).
 */
export const POST = withCustomer(
  async (req: NextRequest, session, customerPhone) => {
  try {
    const body = await req.json().catch(() => null);
    const parsed = diceRollSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]?.message || 'Invalid input';
      return apiError(issue, 'VALIDATION_ERROR', 422);
    }
    const { offerId, latitude, longitude } = parsed.data;

    const offer = await db.offer.findFirst({
      where: { id: offerId, deletedAt: null },
      include: {
        merchant: { include: { branches: { where: { deletedAt: null } } } },
      },
    });
    if (!offer || offer.merchant.deletedAt) {
      return apiError('This offer is no longer available', 'NOT_FOUND', 404);
    }
    // Subscription gate (QR path): expired shop = code disabled until renewal.
    const sub = gateCustomerAction(offer.merchant);
    if (!sub.ok) return apiError(sub.message, sub.code, 403);
    if (offer.offerType !== 'DICE') {
      return apiError(
        offer.offerType === 'SCRATCH'
          ? 'This is a scratch card offer — scratch it instead'
          : 'This is a stamp offer — use the stamp check-in instead',
        'WRONG_OFFER_TYPE',
        409,
        { offerType: offer.offerType }
      );
    }

    const diceCount = normalizeDiceCount(offer.diceCount);

    // Existing roll (if any) — reused by every early return so the customer
    // always sees their true state, even on a refused request.
    const last = await findLastDiceRoll(offer.id, customerPhone);
    const before = buildDiceState(last);

    if (!offer.isActive) {
      return apiError('This offer is paused by the shop', 'OFFER_PAUSED', 409, {
        dice: before,
      });
    }
    if (offerEnded(offer)) {
      return apiError('This offer has ended', 'OFFER_ENDED', 409, { dice: before });
    }

    // --- GPS proximity (same fence as the stamp/scratch engines) ------------
    const branches = offer.merchant.branches;
    const geoRequired = isGeoRequired(branches);
    let nearest: { branch: { branchName: string }; distanceMeters: number } | null = null;

    if (geoRequired) {
      if (latitude == null || longitude == null) {
        return apiError(
          'Location access is required to verify your visit',
          'NEED_LOCATION',
          422,
          { dice: before }
        );
      }
      nearest = findNearestBranch(branches, { latitude, longitude } as GeoPoint);
      if (!nearest || nearest.distanceMeters > GEO_FENCE_RADIUS_M) {
        return apiError(
          'You are too far from this shop to roll',
          'LOCATION_OUT_OF_RANGE',
          403,
          {
            dice: before,
            radiusM: GEO_FENCE_RADIUS_M,
            distanceMeters: nearest ? Math.round(nearest.distanceMeters) : null,
            nearestBranch: nearest?.branch.branchName ?? null,
          }
        );
      }
    }

    // --- One-time limit: pre-check, then let the DB arbitrate a race --------
    if (!before.canRoll) {
      return apiError(
        'You have already rolled the dice for this offer',
        'ALREADY_ROLLED',
        409,
        { dice: before }
      );
    }

    const roll = rollDice(diceCount);

    let record;
    try {
      record = await db.diceRollResult.create({
        data: {
          offerId: offer.id,
          merchantId: offer.merchantId,
          customerPhone,
          // Same as ScratchResult: keep the sign-in name for the merchant list.
          customerName: session.name ?? null,
          diceCount: roll.diceCount,
          diceValues: roll.diceValues,
          total: roll.total,
          discountPercent: roll.discountPercent,
        },
      });
    } catch (error) {
      // Unique-constraint violation → a concurrent roll won the race.
      // Return their row so the UI renders the real outcome, not an error.
      const code = (error as { code?: string })?.code;
      if (code === 'P2002') {
        const winner = await findLastDiceRoll(offer.id, customerPhone);
        return apiError('You have already rolled the dice for this offer', 'ALREADY_ROLLED', 409, {
          dice: buildDiceState(winner),
        });
      }
      throw error;
    }

    const after = buildDiceState({
      diceCount: record.diceCount,
      diceValues: record.diceValues,
      total: record.total,
      discountPercent: record.discountPercent,
      rolledAt: record.rolledAt,
    });

    return apiSuccess({
      dice: after,
      roll: {
        diceCount: record.diceCount,
        diceValues: record.diceValues,
        total: record.total,
        discountPercent: record.discountPercent,
      },
      rolledAt: record.rolledAt.toISOString(),
      title: offer.title,
      merchantName: offer.merchant.businessName,
      nearestBranch: nearest
        ? {
            branchName: nearest.branch.branchName,
            distanceMeters: Math.round(nearest.distanceMeters),
          }
        : null,
    });
  } catch (error) {
    console.error('Error recording dice roll:', error);
    return apiError('Failed to roll the dice', 'INTERNAL_ERROR', 500);
  }
  },
  { requireName: true }
);
