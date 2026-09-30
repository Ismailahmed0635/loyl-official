import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/backend/api/response';
import { withMerchant } from '@/backend/api/handler';
import { scanRequestListQuerySchema } from '@/backend/validation/schemas';
import { db } from '@/backend/db';

const DEFAULT_PAGE_SIZE = 20;

/**
 * GET /api/merchant/scan-requests — Phase 9 stamp check-ins awaiting this
 * merchant's confirmation, newest first. `?status=PENDING|APPROVED|ALL`
 * (default PENDING) plus `?page=&pageSize=`; `pendingCount` always reports the
 * open queue so the nav badge stays correct on any tab.
 */
export const GET = withMerchant(async (req: NextRequest, session, merchant) => {
  try {
    const params = req.nextUrl.searchParams;
    const parsed = scanRequestListQuerySchema.safeParse({
      status: params.get('status') ?? undefined,
      page: params.get('page') ?? undefined,
      pageSize: params.get('pageSize') ?? undefined,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0]?.message || 'Invalid query';
      return apiError(issue, 'VALIDATION_ERROR', 422);
    }

    const statusFilter = parsed.data.status ?? 'PENDING';
    const page = parsed.data.page ?? 1;
    const pageSize = parsed.data.pageSize ?? DEFAULT_PAGE_SIZE;

    const scope = { merchantId: merchant.id, deletedAt: null };
    const where = {
      ...scope,
      ...(statusFilter === 'ALL' ? {} : { status: statusFilter }),
    };

    const [pendingCount, total, rows] = await Promise.all([
      db.scanRequest.count({ where: { ...scope, status: 'PENDING' } }),
      db.scanRequest.count({ where }),
      db.scanRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { offer: { select: { id: true, title: true } } },
      }),
    ]);

    return apiSuccess({
      requests: rows.map((r) => ({
        id: r.id,
        customerPhone: r.customerPhone,
        customerName: r.customerName,
        status: r.status,
        distanceMeters: r.distanceMeters,
        branchName: r.branchName,
        createdAt: r.createdAt.toISOString(),
        decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
        offer: r.offer ? { id: r.offer.id, title: r.offer.title } : null,
      })),
      pendingCount,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    });
  } catch (error) {
    console.error('Error listing scan requests:', error);
    return apiError('Failed to load stamp requests', 'INTERNAL_ERROR', 500);
  }
});
