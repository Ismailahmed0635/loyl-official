import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/backend/api/response';
import { withMerchant } from '@/backend/api/handler';
import { db } from '@/backend/db';

// GET /api/merchant/stats — Dashboard aggregates for the signed-in merchant
export const GET = withMerchant(async (req: NextRequest, session, merchant) => {
  try {
    const where = { merchantId: merchant.id, deletedAt: null };

    const [offerCount, activeOfferCount, branchCount, customerCount, stampAgg] =
      await Promise.all([
        db.offer.count({ where }),
        db.offer.count({ where: { ...where, isActive: true } }),
        db.branch.count({ where }),
        db.customerStamp.count({ where }),
        db.customerStamp.aggregate({
          where,
          _sum: { stampsCollected: true, totalRedeemed: true },
        }),
      ]);

    return apiSuccess({
      merchant,
      stats: {
        offerCount,
        activeOfferCount,
        branchCount,
        customerCount,
        stampsCollected: stampAgg._sum.stampsCollected ?? 0,
        totalRedeemed: stampAgg._sum.totalRedeemed ?? 0,
      },
    });
  } catch (error) {
    console.error('Error computing merchant stats:', error);
    return apiError('Failed to load dashboard stats', 'INTERNAL_ERROR', 500);
  }
});
