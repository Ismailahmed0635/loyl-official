import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/backend/api/response';
import { withMerchant } from '@/backend/api/handler';
import { customerListQuerySchema } from '@/backend/validation/schemas';
import { db } from '@/backend/db';

const DEFAULT_PAGE_SIZE = 20;

/**
 * GET /api/merchant/customers — Phase 4 customer list for the signed-in
 * merchant: search by phone fragment (`?q=`), pagination (`?page=&pageSize=`).
 * Scoped to the owning merchant; customer sessions never reach it (withMerchant).
 */
export const GET = withMerchant(async (req: NextRequest, session, merchant) => {
  try {
    const params = req.nextUrl.searchParams;
    const parsed = customerListQuerySchema.safeParse({
      q: params.get('q') ?? undefined,
      page: params.get('page') ?? undefined,
      pageSize: params.get('pageSize') ?? undefined,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0]?.message || 'Invalid query';
      return apiError(issue, 'VALIDATION_ERROR', 422);
    }

    const q = parsed.data.q || '';
    const page = parsed.data.page ?? 1;
    const pageSize = parsed.data.pageSize ?? DEFAULT_PAGE_SIZE;

    const scope = { merchantId: merchant.id, deletedAt: null } as const;
    const where = q ? { ...scope, customerPhone: { contains: q } } : scope;

    const [total, totalCustomers, rows] = await Promise.all([
      db.customerStamp.count({ where }),
      db.customerStamp.count({ where: scope }),
      db.customerStamp.findMany({
        where,
        // Most recent visit first; createdAt breaks ties (same-second scans).
        orderBy: [{ lastScannedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          customerPhone: true,
          stampsCollected: true,
          totalRedeemed: true,
          lastScannedAt: true,
          lastReviewAt: true,
          createdAt: true,
        },
      }),
    ]);

    return apiSuccess({
      customers: rows,
      stats: { totalCustomers },
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    });
  } catch (error) {
    console.error('Error listing merchant customers:', error);
    return apiError('Failed to load customers', 'INTERNAL_ERROR', 500);
  }
});
