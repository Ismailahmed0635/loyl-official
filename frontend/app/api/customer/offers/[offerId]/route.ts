import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/backend/api/response';
import { getSession } from '@/backend/auth';
import { RouteContext } from '@/backend/api/handler';
import {
  buildCardState,
  findStampCard,
  findPendingScanRequest,
  offerEnded,
  GEO_FENCE_RADIUS_M,
} from '@/backend/scan';
import { buildScratchState, findLastScratchResult } from '@/backend/scratch';
import { buildDiceState, findLastDiceRoll, normalizeDiceCount } from '@/backend/dice';
import { isGeoRequired } from '@/backend/geo';
import { db } from '@/backend/db';

/**
 * GET /api/customer/offers/[offerId] — Scan-page context.
 *
 * Public branding (offer + shop) is returned pre-auth so the sign-in screen can
 * show who is welcoming the customer; card state is only included when a
 * session exists.
 */
export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const { offerId } = await ctx.params;
    if (!offerId) return apiError('Missing offer id', 'BAD_REQUEST', 400);

    const offer = await db.offer.findFirst({
      where: { id: offerId, deletedAt: null },
      include: {
        merchant: { include: { branches: { where: { deletedAt: null } } } },
        scratchItems: { select: { id: true } },
      },
    });
    if (!offer || offer.merchant.deletedAt) {
      return apiError('This offer is no longer available', 'NOT_FOUND', 404);
    }

    const session = await getSession();
    const customerPhone = (session?.phoneNumber || '').replace(/^\+88/, '');

    const isScratch = offer.offerType === 'SCRATCH';
    const isDice = offer.offerType === 'DICE';

    // Stamp offers expose card state; scratch offers expose scratch state;
    // dice offers expose their one-time roll — never more than one (the flows
    // are fully decoupled).
    let card = null;
    let scratch = null;
    let dice = null;
    let pendingRequest = null;
    if (customerPhone) {
      if (isScratch) {
        const last = await findLastScratchResult(offer.id, customerPhone);
        scratch = buildScratchState(last, offer.scratchCooldownHours);
      } else if (isDice) {
        const last = await findLastDiceRoll(offer.id, customerPhone);
        dice = buildDiceState(last);
      } else {
        const row = await findStampCard(offer.merchantId, customerPhone);
        card = buildCardState(row, offer.requiredStamps);

        // Phase 9: an open check-in means the customer is waiting on the shop.
        const pending = await findPendingScanRequest(offer.merchantId, customerPhone);
        if (pending) {
          pendingRequest = {
            id: pending.id,
            status: pending.status,
            createdAt: pending.createdAt.toISOString(),
          };
        }
      }
    }

    return apiSuccess({
      authenticated: !!customerPhone,
      geoRequired: isGeoRequired(offer.merchant.branches),
      geoRadiusM: GEO_FENCE_RADIUS_M,
      ended: offerEnded(offer),
      offer: {
        id: offer.id,
        title: offer.title,
        offerType: offer.offerType,
        rewardType: offer.rewardType,
        requiredStamps: offer.requiredStamps,
        scratchMode: offer.scratchMode,
        // Reveal cooldown for this card — the UI quotes it, the server enforces it.
        scratchCooldownHours: offer.scratchCooldownHours,
        // Count only — reward labels stay a surprise until the reveal.
        itemCount: isScratch ? offer.scratchItems.length : 0,
        // Dice offers only — how many dice the merchant configured (1..5).
        diceCount: isDice ? normalizeDiceCount(offer.diceCount) : null,
        durationDays: offer.durationDays,
        isActive: offer.isActive,
        createdAt: offer.createdAt,
      },
      merchant: {
        id: offer.merchant.id,
        businessName: offer.merchant.businessName,
        category: offer.merchant.category,
        logoUrl: offer.merchant.logoUrl,
        // Public marketing links (Settings → social links): the offer page
        // shows them so a customer can follow the shop after their roll/scratch.
        websiteUrl: offer.merchant.websiteUrl,
        facebookUrl: offer.merchant.facebookUrl,
        instagramUrl: offer.merchant.instagramUrl,
      },
      card,
      scratch,
      dice,
      pendingRequest,
    });
  } catch (error) {
    console.error('Error building scan context:', error);
    return apiError('Failed to load this offer', 'INTERNAL_ERROR', 500);
  }
}
