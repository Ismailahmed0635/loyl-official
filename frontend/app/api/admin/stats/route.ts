import { NextRequest } from 'next/server';
import { apiSuccess } from '@/backend/api/response';
import { withAdmin } from '@/backend/api/handler';
import { groupByCount } from '@/backend/admin';
import { db } from '@/backend/db';

const DAY_MS = 24 * 60 * 60 * 1000;

// GET /api/admin/stats — platform overview for the admin dashboard.
export const GET = withAdmin(async (_req: NextRequest) => {
  const since = new Date(Date.now() - 7 * DAY_MS);

  const [
    subscriptionGroups,
    totalMerchants,
    suspendedCount,
    offerCount,
    branchCount,
    customerCount,
    scansLast7d,
    signupsLast7d,
    paymentGroups,
    pendingAgg,
    approvedAgg,
    recentMerchants,
    recentPayments,
  ] = await db.$transaction([
    db.merchant.groupBy({
      by: ['subscriptionStatus'],
      _count: { _all: true },
      orderBy: { subscriptionStatus: 'asc' },
    }),
    db.merchant.count(),
    db.merchant.count({ where: { deletedAt: { not: null } } }),
    db.offer.count({ where: { deletedAt: null } }),
    db.branch.count({ where: { deletedAt: null } }),
    db.customerStamp.count({ where: { deletedAt: null } }),
    db.activityEvent.count({ where: { type: 'SCAN', createdAt: { gte: since } } }),
    db.merchant.count({ where: { createdAt: { gte: since } } }),
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
    db.paymentRequest.aggregate({
      where: { status: 'APPROVED', deletedAt: null },
      _sum: { amount: true },
    }),
    db.merchant.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        businessName: true,
        category: true,
        phoneNumber: true,
        subscriptionStatus: true,
        subscriptionExpiresAt: true,
        createdAt: true,
        deletedAt: true,
      },
    }),
    db.paymentRequest.findMany({
      where: { status: 'PENDING', deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { merchant: { select: { businessName: true, phoneNumber: true } } },
    }),
  ]);

  const subscriptions: Record<string, number> = { PENDING: 0, ACTIVE: 0, EXPIRED: 0 };
  for (const group of subscriptionGroups) subscriptions[group.subscriptionStatus] = groupByCount(group._count);

  const paymentCounts: Record<string, number> = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
  for (const group of paymentGroups) paymentCounts[group.status] = groupByCount(group._count);

  return apiSuccess({
    merchants: {
      total: totalMerchants,
      suspended: suspendedCount,
      subscriptions,
      signupsLast7d,
    },
    platform: {
      offers: offerCount,
      branches: branchCount,
      customerCards: customerCount,
      scansLast7d,
    },
    payments: {
      counts: paymentCounts,
      pendingAmount: Number(pendingAgg._sum.amount ?? 0),
      approvedAmount: Number(approvedAgg._sum.amount ?? 0),
    },
    recentMerchants: recentMerchants.map((m) => ({ ...m, suspended: !!m.deletedAt })),
    recentPayments: recentPayments.map((p) => ({ ...p, amount: Number(p.amount) })),
  });
});
