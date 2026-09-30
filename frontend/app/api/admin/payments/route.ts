import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { apiError, apiSuccess } from '@/backend/api/response';
import { withAdmin } from '@/backend/api/handler';
import { adminPaymentListQuerySchema } from '@/backend/validation/schemas';
import { groupByCount } from '@/backend/admin';
import { db } from '@/backend/db';

// GET /api/admin/payments — the BUILD.md payment verification table.
// Defaults to PENDING; `status=ALL` disables the status filter.
export const GET = withAdmin(async (req: NextRequest) => {
  const url = new URL(req.url);
  const parsed = adminPaymentListQuerySchema.safeParse({
    status: url.searchParams.get('status') || undefined,
    q: url.searchParams.get('q') || undefined,
    page: url.searchParams.get('page') || undefined,
    pageSize: url.searchParams.get('pageSize') || undefined,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0]?.message || 'Invalid query';
    return apiError(issue, 'VALIDATION_ERROR', 422);
  }

  const statusFilter = parsed.data.status ?? 'PENDING';
  const q = parsed.data.q || undefined;
  const page = parsed.data.page || 1;
  const pageSize = parsed.data.pageSize || 20;

  const where: Prisma.PaymentRequestWhereInput = { deletedAt: null };
  if (statusFilter !== 'ALL') where.status = statusFilter;
  if (q) {
    where.OR = [
      { trxId: { contains: q, mode: 'insensitive' } },
      { senderNumber: { contains: q } },
      { merchant: { businessName: { contains: q, mode: 'insensitive' } } },
      { merchant: { phoneNumber: { contains: q } } },
    ];
  }

  const [rows, total, statusGroups, pendingAgg] = await db.$transaction([
    db.paymentRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        merchant: {
          select: { businessName: true, phoneNumber: true, subscriptionStatus: true },
        },
      },
    }),
    db.paymentRequest.count({ where }),
    db.paymentRequest.groupBy({
      by: ['status'],
      _count: { _all: true },
      orderBy: { status: 'asc' },
      where: { deletedAt: null },
    }),
    db.paymentRequest.aggregate({
      where: { status: 'PENDING', deletedAt: null },
      _sum: { amount: true },
    }),
  ]);

  const counts: Record<string, number> = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
  for (const group of statusGroups) counts[group.status] = groupByCount(group._count);

  return apiSuccess({
    payments: rows.map((p) => {
      const { screenshotPath, ...rest } = p;
      return { ...rest, amount: Number(rest.amount), hasScreenshot: screenshotPath !== null };
    }),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
    stats: { counts, pendingAmount: Number(pendingAgg._sum.amount ?? 0) },
  });
});
