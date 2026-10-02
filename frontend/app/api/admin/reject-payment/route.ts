import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/backend/api/response';
import { withAdmin } from '@/backend/api/handler';
import { paymentActionSchema } from '@/backend/validation/schemas';
import { deleteScreenshot } from '@/backend/billing';
import { recordAdminAction } from '@/backend/adminAudit';
import { db } from '@/backend/db';

// POST /api/admin/reject-payment — marks the request REJECTED (PENDING only);
// the merchant's subscription is left untouched. Like approval, the stored
// screenshot is deleted the moment the decision is made (terminal state —
// keeping rejected screenshots would just waste storage).
export const POST = withAdmin(async (req: NextRequest, session) => {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const parsed = paymentActionSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]?.message || 'Invalid input';
    return apiError(issue, 'VALIDATION_ERROR', 422);
  }
  const { paymentRequestId } = parsed.data;

  let staleScreenshot: string | null = null;
  const result = await db.$transaction(async (tx) => {
    const claimed = await tx.paymentRequest.updateMany({
      where: { id: paymentRequestId, status: 'PENDING', deletedAt: null },
      data: { status: 'REJECTED' },
    });
    if (claimed.count === 0) return null;

    const payment = await tx.paymentRequest.findUnique({
      where: { id: paymentRequestId },
      include: {
        merchant: {
          select: {
            businessName: true,
            phoneNumber: true,
            subscriptionStatus: true,
            subscriptionTier: true,
          },
        },
      },
    });
    if (!payment) return null;

    if (payment.screenshotPath) {
      staleScreenshot = payment.screenshotPath;
      await tx.paymentRequest.update({
        where: { id: payment.id },
        data: { screenshotPath: null },
      });
    }
    // RT-02: audit row commits with the rejection — same transaction.
    await recordAdminAction(
      {
        action: 'REJECT_PAYMENT',
        targetType: 'PAYMENT_REQUEST',
        targetId: payment.id,
        actorId: session.userId,
        detail: {
          merchantId: payment.merchantId,
          requestedTier: payment.requestedTier,
          amount: Number(payment.amount),
        },
      },
      tx
    );
    return { ...payment, screenshotPath: null };
  });

  if (!result) {
    const payment = await db.paymentRequest.findUnique({ where: { id: paymentRequestId } });
    if (!payment || payment.deletedAt) {
      return apiError('Payment request not found', 'PAYMENT_NOT_FOUND', 404);
    }
    return apiError(
      `Payment request is already ${payment.status.toLowerCase()}`,
      'PAYMENT_NOT_PENDING',
      409,
      { status: payment.status }
    );
  }

  if (staleScreenshot) await deleteScreenshot(staleScreenshot);

  return apiSuccess({
    payment: { ...result, amount: Number(result.amount) },
    deletedScreenshot: staleScreenshot !== null,
  });
});
