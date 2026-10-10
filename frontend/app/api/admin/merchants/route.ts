import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { apiError, apiSuccess } from '@/backend/api/response';
import { withAdmin } from '@/backend/api/handler';
import { adminMerchantListQuerySchema } from '@/backend/validation/schemas';
import { groupByCount } from '@/backend/admin';
import { merchantLogoUrl } from '@/backend/logo';
import { db } from '@/backend/db';

/** Public merchant fields (no cognitoSub) returned to the admin. */
const MERCHANT_ROW_SELECT = {
  id: true,
  businessName: true,
  category: true,
  phoneNumber: true,
  logoUrl: true,
  logoPath: true,
  websiteUrl: true,
  subscriptionStatus: true,
  subscriptionExpiresAt: true,
  createdAt: true,
  deletedAt: true,
} satisfies Prisma.MerchantSelect;

// GET /api/admin/merchants — searchable merchant directory with per-merchant
// activity counts. Suspended (soft-deleted) rows stay listed, flagged.
export const GET = withAdmin(async (req: NextRequest) => {
  const url = new URL(req.url);
  const parsed = adminMerchantListQuerySchema.safeParse({
    q: url.searchParams.get('q') || undefined,
    status: url.searchParams.get('status') || undefined,
    page: url.searchParams.get('page') || undefined,
    pageSize: url.searchParams.get('pageSize') || undefined,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0]?.message || 'Invalid query';
    return apiError(issue, 'VALIDATION_ERROR', 422);
  }

  const { status } = parsed.data;
  const q = parsed.data.q || undefined;
  const page = parsed.data.page || 1;
  const pageSize = parsed.data.pageSize || 20;

  const where: Prisma.MerchantWhereInput = {};
  if (q) {
    where.OR = [
      { businessName: { contains: q, mode: 'insensitive' } },
      { phoneNumber: { contains: q } },
    ];
  }
  if (status) where.subscriptionStatus = status;

  const [rows, total, statusGroups, suspendedCount] = await db.$transaction([
    db.merchant.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        ...MERCHANT_ROW_SELECT,
        _count: {
          select: {
            offers: { where: { deletedAt: null } },
            branches: { where: { deletedAt: null } },
            customerStamps: { where: { deletedAt: null } },
            paymentRequests: true,
          },
        },
      },
    }),
    db.merchant.count({ where }),
    db.merchant.groupBy({
      by: ['subscriptionStatus'],
      _count: { _all: true },
      orderBy: { subscriptionStatus: 'asc' },
    }),
    db.merchant.count({ where: { deletedAt: { not: null } } }),
  ]);

  const byStatus: Record<string, number> = { PENDING: 0, ACTIVE: 0, EXPIRED: 0 };
  for (const group of statusGroups) byStatus[group.subscriptionStatus] = groupByCount(group._count);

  return apiSuccess({
    merchants: rows.map((m) => ({ ...m, logoUrl: merchantLogoUrl(m), suspended: !!m.deletedAt })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
    stats: { total, byStatus, suspended: suspendedCount },
  });
});
