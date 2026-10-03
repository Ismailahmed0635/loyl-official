import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/backend/api/response';
import { withCustomer } from '@/backend/api/handler';
import { redeemSchema } from '@/backend/validation/schemas';
import { gateCustomerAction } from '@/backend/subscription';
import { buildCardState, findStampCard } from '@/backend/scan';
import { recordActivity } from '@/backend/activity';
import { db } from '@/backend/db';

/**
 * POST /api/customer/redeem — TEST.md §4 reward trigger.
 * Requires stampsCollected >= requiredStamps; resets the card and bumps the
 * redeemed counter (merchant stats pick the sum up).
 */
export const POST = withCustomer(
  async (req: NextRequest, session, customerPhone) => {
  try {
    const body = await req.json().catch(() => null);
    const parsed = redeemSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]?.message || 'Invalid input';
      return apiError(issue, 'VALIDATION_ERROR', 422);
    }

    const offer = await db.offer.findFirst({
      where: { id: parsed.data.offerId, deletedAt: null },
      include: {
        merchant: {
          select: {
            id: true,
            businessName: true,
            deletedAt: true,
            // Subscription gate needs these three columns only.
            subscriptionTier: true,
            subscriptionExpiresAt: true,
            createdAt: true,
          },
        },
      },
    });
    if (!offer || offer.merchant.deletedAt) {
      return apiError('This offer is no longer available', 'NOT_FOUND', 404);
    }
    // Subscription gate (QR path): expired shop = code disabled until renewal.
    const sub = gateCustomerAction(offer.merchant);
    if (!sub.ok) return apiError(sub.message, sub.code, 403);
    if (offer.offerType !== 'STAMP') {
      return apiError(
        offer.offerType === 'DICE'
          ? 'This is a dice offer — your discount comes from the roll'
          : 'This is a scratch card offer — rewards are revealed by scratching',
        'WRONG_OFFER_TYPE',
        409,
        { offerType: offer.offerType }
      );
    }

    const card = await findStampCard(offer.merchantId, customerPhone);
    const required = offer.requiredStamps;
    const before = buildCardState(card, required);
    if (required === null) {
      return apiError('This offer is not configured yet', 'OFFER_NOT_CONFIGURED', 409, {
        card: before,
      });
    }
    if (!card || !before.complete) {
      return apiError('Reward is not ready yet — keep collecting stamps', 'REWARD_NOT_READY', 409, {
        card: before,
      });
    }

    // Atomic claim: only a still-complete card transitions. A concurrent
    // double-tap affects 0 rows instead of granting twice.
    const claimed = await db.customerStamp.updateMany({
      where: { id: card.id, stampsCollected: { gte: required } },
      data: { stampsCollected: 0, totalRedeemed: { increment: 1 } },
    });
    if (claimed.count === 0) {
      const fresh = await findStampCard(offer.merchantId, customerPhone);
      return apiError('Reward is not ready yet — keep collecting stamps', 'REWARD_NOT_READY', 409, {
        card: buildCardState(fresh, required),
      });
    }
    const saved = await db.customerStamp.findUniqueOrThrow({ where: { id: card.id } });

    // Phase 4 analytics: best-effort, never fails the redemption.
    await recordActivity({
      merchantId: offer.merchantId,
      offerId: offer.id,
      customerPhone,
      type: 'REDEEM',
    });

    return apiSuccess({
      card: buildCardState(saved, required),
      claimedAt: new Date().toISOString(),
      reward: {
        title: offer.title,
        rewardType: offer.rewardType,
        requiredStamps: required,
        merchantName: offer.merchant.businessName,
      },
    });
  } catch (error) {
    console.error('Error redeeming reward:', error);
    return apiError('Failed to redeem your reward', 'INTERNAL_ERROR', 500);
  }
  },
  { requireName: true }
);
