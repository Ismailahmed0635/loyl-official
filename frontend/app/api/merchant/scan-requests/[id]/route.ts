import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/backend/api/response';
import { withMerchantApp } from '@/backend/api/handler';
import { buildCardState, grantStamp } from '@/backend/scan';
import { recordActivity } from '@/backend/activity';
import { db } from '@/backend/db';

/**
 * POST /api/merchant/scan-requests/[id] — accept a customer's check-in and
 * apply their stamp (Phase 9).
 *
 * This is the ONLY decision endpoint: the merchant may accept or hold (do
 * nothing). There is deliberately no reject route, so a merchant can never
 * deny a customer a stamp.
 *
 * The status transition is an atomic guarded update, so a double-tap can only
 * ever award one stamp; the SCAN analytics event is written after the claim.
 *
 * Phase 10: this is an app-only action. `withMerchantApp` requires a signature
 * from an ACTIVE registered device bound to this request id, so the merchant web
 * dashboard receives 403 `APP_APPROVAL_REQUIRED` and can never approve.
 */
export const POST = withMerchantApp(async (req: NextRequest, session, merchant, device, ctx) => {
  try {
    const id = ctx.params?.id;
    if (!id) return apiError('Missing request id', 'BAD_REQUEST', 400);

    const request = await db.scanRequest.findFirst({
      where: { id, merchantId: merchant.id, deletedAt: null },
      include: {
        offer: {
          select: { id: true, title: true, offerType: true, requiredStamps: true },
        },
      },
    });
    if (!request) {
      return apiError('That stamp request was not found', 'NOT_FOUND', 404);
    }
    if (request.status === 'APPROVED') {
      return apiError(
        'This check-in was already approved',
        'REQUEST_ALREADY_APPROVED',
        409
      );
    }

    const required = request.offer?.requiredStamps ?? null;
    if (request.offer?.offerType !== 'STAMP' || required == null) {
      return apiError(
        'This request is not for a stamp card offer',
        'WRONG_OFFER_TYPE',
        409
      );
    }

    // Atomic claim + stamp in ONE transaction: only the first approval wins
    // (guards double-taps/retries), and the stamp lands in the same commit —
    // a grant failure rolls the claim back instead of orphaning an
    // APPROVED-without-stamp row. Clearing pendingKey releases the
    // one-pending-per-shop slot so the next check-in can open; history rows
    // keep NULL and never collide.
    const claimedAt = new Date();
    let stamped: Awaited<ReturnType<typeof grantStamp>>;
    try {
      stamped = await db.$transaction(async (tx) => {
        const claimed = await tx.scanRequest.updateMany({
          where: { id: request.id, merchantId: merchant.id, status: 'PENDING' },
          data: {
            status: 'APPROVED',
            decidedAt: claimedAt,
            pendingKey: null,
            // Phase 10 audit: which device signed for this approval.
            approvedByDeviceId: device.id,
          },
        });
        if (claimed.count === 0) throw new Error('CLAIM_LOST');
        // Granted only now — the customer's card is untouched until this point.
        // Phase 11: carry the verified name onto the card for the customer list.
        return grantStamp(merchant.id, request.customerPhone, required, request.customerName, tx);
      });
    } catch (txErr) {
      if (txErr instanceof Error && txErr.message === 'CLAIM_LOST') {
        return apiError(
          'This check-in was already approved',
          'REQUEST_ALREADY_APPROVED',
          409
        );
      }
      throw txErr;
    }
    const { row, at } = stamped;

    // Phase 4 analytics: a scan counts when it becomes a real stamp.
    await recordActivity({
      merchantId: merchant.id,
      offerId: request.offerId,
      customerPhone: request.customerPhone,
      type: 'SCAN',
      at,
    });

    const card = buildCardState(row, required);
    return apiSuccess({
      request: {
        id: request.id,
        status: 'APPROVED' as const,
        customerPhone: request.customerPhone,
        customerName: request.customerName,
        decidedAt: claimedAt.toISOString(),
        approvedByDeviceId: device.id,
      },
      offerTitle: request.offer?.title ?? null,
      card,
      complete: card.complete,
    });
  } catch (error) {
    console.error('Error approving scan request:', error);
    return apiError('Failed to approve this stamp request', 'INTERNAL_ERROR', 500);
  }
});
