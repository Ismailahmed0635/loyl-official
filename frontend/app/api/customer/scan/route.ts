import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/backend/api/response';
import { withCustomer } from '@/backend/api/handler';
import { scanSchema } from '@/backend/validation/schemas';
import {
  buildCardState,
  findStampCard,
  findPendingScanRequest,
  offerEnded,
  GEO_FENCE_RADIUS_M,
  SCAN_COOLDOWN_HOURS,
} from '@/backend/scan';
import { findNearestBranch, isGeoRequired, GeoPoint } from '@/backend/geo';
import { db } from '@/backend/db';

/**
 * POST /api/customer/scan — TEST.md §4 stamp engine, Phase 9 approval gate.
 *
 * Order of guards: verified name → offer validity → GPS proximity →
 * reward-complete → 24h cooldown → one open request per shop.
 *
 * Phase 9: the scan does NOT grant a stamp. It opens a PENDING ScanRequest and
 * the merchant accepts it from their Requests page; only then does the stamp
 * land on the card. The merchant can accept or hold — never reject.
 */
export const POST = withCustomer(
  async (req: NextRequest, session, customerPhone) => {
  try {
    const body = await req.json().catch(() => null);
    const parsed = scanSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]?.message || 'Invalid input';
      return apiError(issue, 'VALIDATION_ERROR', 422);
    }
    const { offerId, latitude, longitude } = parsed.data;

    // Phase 11: the NAME_REQUIRED gate lives in withCustomer (requireName) —
    // no check-in is ever created for a nameless session.
    const customerName = (session.name || '').trim();

    const offer = await db.offer.findFirst({
      where: { id: offerId, deletedAt: null },
      include: {
        merchant: { include: { branches: { where: { deletedAt: null } } } },
      },
    });
    if (!offer || offer.merchant.deletedAt) {
      return apiError('This offer is no longer available', 'NOT_FOUND', 404);
    }
    if (offer.offerType !== 'STAMP') {
      return apiError(
        offer.offerType === 'DICE'
          ? 'This is a dice offer — roll the dice instead'
          : 'This is a scratch card offer — scratch it instead',
        'WRONG_OFFER_TYPE',
        409,
        { offerType: offer.offerType }
      );
    }
    if (!offer.isActive) {
      return apiError('This offer is paused by the shop', 'OFFER_PAUSED', 409, {
        card: buildCardState(await findStampCard(offer.merchantId, customerPhone), offer.requiredStamps),
      });
    }
    if (offerEnded(offer)) {
      return apiError('This offer has ended', 'OFFER_ENDED', 409, {
        card: buildCardState(await findStampCard(offer.merchantId, customerPhone), offer.requiredStamps),
      });
    }

    // --- GPS proximity (TEST.md §4: valid vs. out-of-range coordinates) -----
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
        return apiError('You are too far from this shop to check in', 'LOCATION_OUT_OF_RANGE', 403, {
          radiusM: GEO_FENCE_RADIUS_M,
          distanceMeters: nearest ? Math.round(nearest.distanceMeters) : null,
          nearestBranch: nearest?.branch.branchName ?? null,
        });
      }
    }

    // --- Card state: complete → cooldown ------------------------------------
    const required = offer.requiredStamps;
    if (required == null) {
      // Stamp offers always carry a threshold; defensive only.
      return apiError(
        'This offer is not configured correctly',
        'OFFER_NOT_CONFIGURED',
        409,
        {
          card: buildCardState(await findStampCard(offer.merchantId, customerPhone), required),
        }
      );
    }
    const existing = await findStampCard(offer.merchantId, customerPhone);
    const before = buildCardState(existing, required);
    if (before.complete) {
      return apiError('Card complete — claim your reward first', 'CARD_COMPLETE', 409, {
        card: before,
      });
    }
    if (!before.canScan) {
      return apiError(
        `You already checked in here within the last ${SCAN_COOLDOWN_HOURS} hours`,
        'COOLDOWN',
        429,
        { card: before, nextScanAt: before.nextScanAt, cooldownHours: SCAN_COOLDOWN_HOURS }
      );
    }

    // --- Phase 9: open a request instead of stamping ------------------------
    // The merchant confirms before the stamp lands. A repeat scan while one
    // check-in is already waiting just returns that SAME check-in as a normal
    // success — we never block or error the customer, we only avoid stacking
    // duplicate requests. (The 24h cooldown after an approval is what stops a
    // customer from finishing the whole card in a single day.)
    const existingPending = await findPendingScanRequest(offer.merchantId, customerPhone);
    let request = existingPending;
    let alreadyPending = !!existingPending;
    if (!request) {
      try {
        request = await db.scanRequest.create({
          data: {
            merchantId: offer.merchantId,
            offerId: offer.id,
            customerPhone,
            customerName,
            pendingKey: `${offer.merchantId}:${customerPhone}`,
            distanceMeters: nearest ? Math.round(nearest.distanceMeters) : null,
            branchName: nearest?.branch.branchName ?? null,
          },
        });
      } catch (createErr) {
        // Lost a concurrent double-scan: the winner holds our pendingKey.
        if (
          typeof createErr === 'object' &&
          createErr !== null &&
          (createErr as { code?: string }).code === 'P2002'
        ) {
          request =
            (await db.scanRequest.findUnique({
              where: { pendingKey: `${offer.merchantId}:${customerPhone}` },
            })) ?? (await findPendingScanRequest(offer.merchantId, customerPhone));
          alreadyPending = true;
        } else {
          throw createErr;
        }
      }
      if (!request) throw new Error('Scan request claim failed');
    }

    // No stamp yet — analytics counts the SCAN when the merchant approves it.
    return apiSuccess({
      requested: true,
      // True when this scan matched a check-in that was already waiting.
      alreadyPending,
      // Card is returned unchanged so the customer sees their real progress.
      card: before,
      stamped: before.stampsCollected,
      complete: false,
      nextScanAt: null,
      request: {
        id: request.id,
        status: request.status,
        customerName: request.customerName ?? customerName,
        createdAt: request.createdAt.toISOString(),
      },
      nearestBranch: nearest
        ? { branchName: nearest.branch.branchName, distanceMeters: Math.round(nearest.distanceMeters) }
        : null,
      reward: {
        title: offer.title,
        rewardType: offer.rewardType,
        requiredStamps: required,
        merchantName: offer.merchant.businessName,
      },
    });
  } catch (error) {
    console.error('Error recording scan:', error);
    return apiError('Failed to record your check-in', 'INTERNAL_ERROR', 500);
  }
  },
  { requireName: true }
);
