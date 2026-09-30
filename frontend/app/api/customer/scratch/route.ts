import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/backend/api/response';
import { withCustomer } from '@/backend/api/handler';
import { scratchSchema } from '@/backend/validation/schemas';
import { offerEnded, GEO_FENCE_RADIUS_M } from '@/backend/scan';
import {
  buildScratchState,
  drawScratchReward,
  findLastScratchResult,
} from '@/backend/scratch';
import { findNearestBranch, isGeoRequired, GeoPoint } from '@/backend/geo';
import { db } from '@/backend/db';

/**
 * POST /api/customer/scratch — Phase 3.5 scratch reveal engine.
 *
 * Fully decoupled from the stamp engine: only SCRATCH offers reach it
 * (WRONG_OFFER_TYPE 409 otherwise). Guard order mirrors /scan —
 * offer validity → type → paused/ended → GPS → per-offer cooldown → draw + persist.
 *
 * The cooldown length is the merchant's `Offer.scratchCooldownHours` setting
 * (24h by default), normalised by `buildScratchState`.
 */
export const POST = withCustomer(
  async (req: NextRequest, session, customerPhone) => {
  try {
    const body = await req.json().catch(() => null);
    const parsed = scratchSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]?.message || 'Invalid input';
      return apiError(issue, 'VALIDATION_ERROR', 422);
    }
    const { offerId, latitude, longitude } = parsed.data;

    const offer = await db.offer.findFirst({
      where: { id: offerId, deletedAt: null },
      include: {
        merchant: { include: { branches: { where: { deletedAt: null } } } },
        scratchItems: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!offer || offer.merchant.deletedAt) {
      return apiError('This offer is no longer available', 'NOT_FOUND', 404);
    }
    if (offer.offerType !== 'SCRATCH') {
      return apiError(
        offer.offerType === 'DICE'
          ? 'This is a dice offer — roll the dice instead'
          : 'This is a stamp offer — use the stamp check-in instead',
        'WRONG_OFFER_TYPE',
        409,
        { offerType: offer.offerType }
      );
    }

    const last = await findLastScratchResult(offer.id, customerPhone);
    // Per-offer window: the merchant's setting decides the lock, so the same
    // normalisation the rest of the engine uses applies here too.
    const cooldownHours = offer.scratchCooldownHours;
    const before = buildScratchState(last, cooldownHours);

    if (!offer.isActive) {
      return apiError('This offer is paused by the shop', 'OFFER_PAUSED', 409, {
        scratch: before,
      });
    }
    if (offerEnded(offer)) {
      return apiError('This offer has ended', 'OFFER_ENDED', 409, { scratch: before });
    }

    // --- GPS proximity (same fence as the stamp engine) ----------------------
    const branches = offer.merchant.branches;
    const geoRequired = isGeoRequired(branches);
    let nearest: { branch: { branchName: string }; distanceMeters: number } | null = null;

    if (geoRequired) {
      if (latitude == null || longitude == null) {
        return apiError(
          'Location access is required to verify your visit',
          'NEED_LOCATION',
          422
        );
      }
      nearest = findNearestBranch(branches, { latitude, longitude } as GeoPoint);
      if (!nearest || nearest.distanceMeters > GEO_FENCE_RADIUS_M) {
        return apiError('You are too far from this shop to scratch', 'LOCATION_OUT_OF_RANGE', 403, {
          radiusM: GEO_FENCE_RADIUS_M,
          distanceMeters: nearest ? Math.round(nearest.distanceMeters) : null,
          nearestBranch: nearest?.branch.branchName ?? null,
        });
      }
    }

    // --- Per-offer cooldown window ------------------------------------------
    if (!before.canScratch) {
      return apiError(
        `You already revealed a reward here within the last ${before.cooldownHours} hours`,
        'COOLDOWN',
        429,
        { scratch: before, nextScratchAt: before.nextScratchAt, cooldownHours: before.cooldownHours }
      );
    }

    // --- Draw the reward (pool rotation persisted with the reveal) -----------
    const mode = offer.scratchMode ?? 'FIXED';
    if (offer.scratchItems.length === 0) {
      return apiError('This scratch card has no rewards yet', 'OFFER_NOT_CONFIGURED', 409, {
        scratch: before,
      });
    }

    const needsPool = mode === 'RANDOM_POOL';

    // Serialize concurrent reveals per offer: the row touch takes a write
    // lock, so a double-tap waits, then re-sees the first tap's committed
    // result (cooldown) and fresh pool cursor (no lost update) instead of
    // drawing twice from a stale snapshot.
    const outcome = await db.$transaction(async (tx) => {
      const locked = await tx.offer.update({
        where: { id: offer.id },
        data: { updatedAt: new Date() },
        select: { scratchCursor: true, scratchOrder: true },
      });
      const latest = await tx.scratchResult.findFirst({
        where: { offerId: offer.id, customerPhone },
        orderBy: { scratchedAt: 'desc' },
        select: { rewardLabel: true, scratchedAt: true },
      });
      const fresh = buildScratchState(latest, cooldownHours);
      if (!fresh.canScratch) return { ok: false as const, state: fresh };
      const drawFresh = drawScratchReward({
        mode,
        items: offer.scratchItems,
        pool: needsPool ? { cursor: locked.scratchCursor, order: locked.scratchOrder } : undefined,
      });
      if (needsPool && drawFresh.pool) {
        await tx.offer.update({
          where: { id: offer.id },
          data: { scratchCursor: drawFresh.pool.cursor, scratchOrder: drawFresh.pool.order },
        });
      }
      const record = await tx.scratchResult.create({
        data: {
          offerId: offer.id,
          merchantId: offer.merchantId,
          customerPhone,
          rewardLabel: drawFresh.reward.label,
          mode,
        },
      });
      return { ok: true as const, record };
    });
    if (!outcome.ok) {
      const state = outcome.state;
      return apiError(
        `You already revealed a reward here within the last ${state.cooldownHours} hours`,
        'COOLDOWN',
        429,
        { scratch: state, nextScratchAt: state.nextScratchAt, cooldownHours: state.cooldownHours }
      );
    }
    const record = outcome.record;

    const after = buildScratchState(
      { rewardLabel: record.rewardLabel, scratchedAt: record.scratchedAt },
      cooldownHours
    );
    return apiSuccess({
      scratch: after,
      reward: {
        label: record.rewardLabel,
        mode: record.mode,
        title: offer.title,
        merchantName: offer.merchant.businessName,
      },
      scratchedAt: record.scratchedAt.toISOString(),
      nextScratchAt: after.nextScratchAt,
      cooldownHours: after.cooldownHours,
      nearestBranch: nearest
        ? { branchName: nearest.branch.branchName, distanceMeters: Math.round(nearest.distanceMeters) }
        : null,
    });
  } catch (error) {
    console.error('Error recording scratch:', error);
    return apiError('Failed to reveal your reward', 'INTERNAL_ERROR', 500);
  }
  },
  { requireName: true }
);
