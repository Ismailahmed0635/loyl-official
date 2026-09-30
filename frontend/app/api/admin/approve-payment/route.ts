import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/backend/api/response';
import { withAdmin } from '@/backend/api/handler';
import { paymentActionSchema } from '@/backend/validation/schemas';
import { deleteScreenshot, subscriptionGrant } from '@/backend/billing';
import { db } from '@/backend/db';

// POST /api/admin/approve-payment — BUILD.md manual verification workflow,
// extended for Phase 7 tiers:
//   1. atomically flips PENDING → APPROVED,
//   2. grants the admin-selected tier (dropdown; defaults to the requested
//      tier): ACTIVE + tier + expiry (FREE never expires),
//   3. clears the screenshot pointer in the same transaction and unlinks the
//      stored file right after commit — reviewed screenshots never linger.
export const POST = withAdmin(async (req: NextRequest) => {
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
  const { paymentRequestId, tier } = parsed.data;

  let staleScreenshot: string | null = null;
  const result = await db.$transaction(async (tx) => {
    // Guarded update = atomic state transition (no check-then-set race).
    const claimed = await tx.paymentRequest.updateMany({
      where: { id: paymentRequestId, status: 'PENDING', deletedAt: null },
      data: { status: 'APPROVED' },
    });
    if (claimed.count === 0) return null;

    const payment = await tx.paymentRequest.findUnique({ where: { id: paymentRequestId } });
    if (!payment) return null;

    const grantedTier = tier ?? payment.requestedTier;
    const merchant = await tx.merchant.update({
      where: { id: payment.merchantId },
      data: subscriptionGrant(grantedTier),
      select: {
        id: true,
        businessName: true,
        subscriptionStatus: true,
        subscriptionTier: true,
        subscriptionExpiresAt: true,
      },
    });

    if (payment.screenshotPath) {
      staleScreenshot = payment.screenshotPath;
      await tx.paymentRequest.update({
        where: { id: payment.id },
        data: { screenshotPath: null },
      });
    }
    return { payment: { ...payment, screenshotPath: null }, merchant };
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

  // Storage cleanup (Phase 7): the DB no longer references the file.
  if (staleScreenshot) await deleteScreenshot(staleScreenshot);

  return apiSuccess({
    payment: { ...result.payment, amount: Number(result.payment.amount) },
    merchant: result.merchant,
    deletedScreenshot: staleScreenshot !== null,
  });
});
