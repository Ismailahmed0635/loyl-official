import { apiSuccess } from '@/backend/api/response';
import { withMerchant } from '@/backend/api/handler';
import { db } from '@/backend/db';

/** How many recent alerts the merchant feed shows (notification, not a log UI). */
const FEED_LIMIT = 20;

/**
 * GET /api/merchant/alerts — RT-03 security signals for this shop.
 *
 * Approval bursts and device registrations/revocations (stolen-phone
 * detection): the merchant sees "something abnormal happened" without the
 * server having to prove a compromise it cannot see. PII-free by
 * construction — messages carry counts and device labels only.
 */
export const GET = withMerchant(async (_req, _session, merchant) => {
  const rows = await db.securityAlert.findMany({
    where: { merchantId: merchant.id },
    orderBy: { createdAt: 'desc' },
    take: FEED_LIMIT,
    select: {
      id: true,
      kind: true,
      deviceId: true,
      message: true,
      count: true,
      createdAt: true,
    },
  });

  return apiSuccess({ alerts: rows });
});
