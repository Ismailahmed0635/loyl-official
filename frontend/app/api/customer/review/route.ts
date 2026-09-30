import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/backend/api/response';
import { withCustomer } from '@/backend/api/handler';
import { reviewBonusSchema } from '@/backend/validation/schemas';
import { buildCardState, findStampCard, REVIEW_COOLDOWN_HOURS, REVIEW_COOLDOWN_MS } from '@/backend/scan';
import { recordActivity } from '@/backend/activity';
import { db } from '@/backend/db';

/**
 * POST /api/customer/review — PRD 3.3 review engine.
 *
 * The client opens the shop in Google Maps and calls back when the window
 * regains focus ("return focus" verification); the server enforces that a card
 * exists, the card isn't already complete, and only one bonus lands per window
 * (so a refresh-loop can't farm stamps).
 */
export const POST = withCustomer(
  async (req: NextRequest, session, customerPhone) => {
  try {
    const body = await req.json().catch(() => null);
    const parsed = reviewBonusSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]?.message || 'Invalid input';
      return apiError(issue, 'VALIDATION_ERROR', 422);
    }

    const offer = await db.offer.findFirst({
      where: { id: parsed.data.offerId, deletedAt: null },
      include: { merchant: { select: { id: true, deletedAt: true } } },
    });
    if (!offer || offer.merchant.deletedAt) {
      return apiError('This offer is no longer available', 'NOT_FOUND', 404);
    }
    if (offer.offerType !== 'STAMP') {
      return apiError(
        offer.offerType === 'DICE'
          ? 'This is a dice offer — review bonus does not apply'
          : 'This is a scratch card offer — review bonus does not apply',
        'WRONG_OFFER_TYPE',
        409,
        { offerType: offer.offerType }
      );
    }

    const required = offer.requiredStamps;
    const card = await findStampCard(offer.merchantId, customerPhone);
    if (!card) {
      return apiError('Collect your first stamp before leaving a review', 'SCAN_FIRST', 409, {
        card: null,
      });
    }

    const before = buildCardState(card, required);
    if (required === null) {
      return apiError('This offer is not configured yet', 'OFFER_NOT_CONFIGURED', 409, {
        card: before,
      });
    }
    if (before.complete) {
      return apiError('Card complete — claim your reward first', 'CARD_COMPLETE', 409, {
        card: before,
      });
    }
    if (!before.canReviewBonus) {
      return apiError(
        `Review bonus already claimed within the last ${REVIEW_COOLDOWN_HOURS} hours`,
        'REVIEW_COOLDOWN',
        429,
        { card: before, nextReviewAt: before.nextReviewAt, cooldownHours: REVIEW_COOLDOWN_HOURS }
      );
    }

    // Atomic grant: the row transitions only if the bonus window is still
    // open and the card is still incomplete. A parallel double-POST affects
    // 0 rows instead of farming a second stamp.
    const cutoff = new Date(Date.now() - REVIEW_COOLDOWN_MS);
    const granted = await db.customerStamp.updateMany({
      where: {
        id: card.id,
        stampsCollected: { lt: required },
        OR: [{ lastReviewAt: null }, { lastReviewAt: { lte: cutoff } }],
      },
      data: {
        stampsCollected: { increment: 1 },
        lastReviewAt: new Date(),
      },
    });
    if (granted.count === 0) {
      const fresh = await findStampCard(offer.merchantId, customerPhone);
      const state = buildCardState(fresh, required);
      if (!fresh) {
        return apiError('Collect your first stamp before leaving a review', 'SCAN_FIRST', 409, {
          card: state,
        });
      }
      if (state.complete) {
        return apiError('Card complete — claim your reward first', 'CARD_COMPLETE', 409, {
          card: state,
        });
      }
      return apiError(
        `Review bonus already claimed within the last ${REVIEW_COOLDOWN_HOURS} hours`,
        'REVIEW_COOLDOWN',
        429,
        { card: state, nextReviewAt: state.nextReviewAt, cooldownHours: REVIEW_COOLDOWN_HOURS }
      );
    }
    const saved = await db.customerStamp.findUniqueOrThrow({ where: { id: card.id } });

    // Phase 4 analytics: best-effort, never fails the bonus.
    await recordActivity({
      merchantId: offer.merchantId,
      offerId: offer.id,
      customerPhone,
      type: 'REVIEW_BONUS',
    });

    const state = buildCardState(saved, required);
    return apiSuccess({
      card: state,
      stamped: state.stampsCollected,
      complete: state.complete,
      bonus: true,
      reward: {
        title: offer.title,
        rewardType: offer.rewardType,
        requiredStamps: required,
      },
    });
  } catch (error) {
    console.error('Error granting review bonus:', error);
    return apiError('Failed to record your review', 'INTERNAL_ERROR', 500);
  }
  },
  { requireName: true }
);
