import type { PaymentRequest } from '@prisma/client';
import { apiSuccess } from '@/backend/api/response';
import { withMerchant } from '@/backend/api/handler';
import { accessEndsAt, subscriptionPhase } from '@/backend/subscription';
import { db } from '@/backend/db';

/** Row shape sent to the merchant — storage paths never leave the server. */
function serialize(row: PaymentRequest) {
  const { screenshotPath, ...rest } = row;
  return { ...rest, amount: Number(rest.amount), hasScreenshot: screenshotPath !== null };
}

// GET /api/billing — the merchant's Phase 7 billing state: subscription
// (status/tier/expiry), their latest requests, and the pending one (if any).
export const GET = withMerchant(async (_req, _session, merchant) => {
  const requests = await db.paymentRequest.findMany({
    where: { merchantId: merchant.id, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  const pendingRow = requests.find((row) => row.status === 'PENDING') ?? null;

  return apiSuccess({
    subscription: {
      status: merchant.subscriptionStatus,
      tier: merchant.subscriptionTier,
      expiresAt: merchant.subscriptionExpiresAt,
      // Derived, so the UI never has to re-implement the trial clock:
      // endsAt is always a real date (free trial included), phase is
      // ACTIVE / TRIAL / EXPIRED as of now.
      endsAt: accessEndsAt(merchant),
      phase: subscriptionPhase(merchant),
    },
    pending: pendingRow ? serialize(pendingRow) : null,
    requests: requests.map(serialize),
  });
});
