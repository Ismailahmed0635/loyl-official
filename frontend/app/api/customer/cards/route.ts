import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/backend/api/response';
import { withCustomer } from '@/backend/api/handler';
import { buildCardState, CardState } from '@/backend/scan';
import { merchantLogoUrl } from '@/backend/logo';
import { db } from '@/backend/db';

interface OfferSummary {
  id: string;
  title: string;
  rewardType: string;
  requiredStamps: number | null;
}

export interface CustomerCardItem {
  merchantId: string;
  businessName: string;
  category: string;
  logoUrl: string | null;
  offer: OfferSummary | null;
  state: CardState;
}

/**
 * A check-in that is waiting for the shop to approve it. The stamp row does
 * not exist until approval, so this is the customer's only visibility into a
 * pending visit (Phase 9 flow surfaced as a real-user complaint).
 */
export interface CustomerPendingItem {
  requestId: string;
  merchantId: string;
  businessName: string;
  category: string;
  logoUrl: string | null;
  offerTitle: string;
  requestedAt: string;
}

const offerSelect = {
  id: true,
  title: true,
  rewardType: true,
  requiredStamps: true,
  isActive: true,
  createdAt: true,
} as const;

/**
 * GET /api/customer/cards — every stamp card the signed-in phone holds,
 * with the shop's best-matching offer (latest active, else latest overall).
 */
export const GET = withCustomer(async (req: NextRequest, session, customerPhone) => {
  try {
    const rows = await db.customerStamp.findMany({
      where: { customerPhone, deletedAt: null },
      include: {
        merchant: {
          select: { id: true, businessName: true, category: true, logoUrl: true, logoPath: true, deletedAt: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const cards: CustomerCardItem[] = [];
    for (const row of rows) {
      if (row.merchant.deletedAt) continue;

      const offer =
        (await db.offer.findFirst({
          where: {
            merchantId: row.merchantId,
            deletedAt: null,
            isActive: true,
            // Stamp cards only ever pair with stamp offers (Phase 3.5).
            offerType: 'STAMP',
          },
          orderBy: { createdAt: 'desc' },
          select: offerSelect,
        })) ??
        (await db.offer.findFirst({
          where: { merchantId: row.merchantId, deletedAt: null, offerType: 'STAMP' },
          orderBy: { createdAt: 'desc' },
          select: offerSelect,
        }));

      cards.push({
        merchantId: row.merchantId,
        businessName: row.merchant.businessName,
        category: row.merchant.category,
        logoUrl: merchantLogoUrl(row.merchant),
        offer: offer
          ? {
              id: offer.id,
              title: offer.title,
              rewardType: offer.rewardType,
              requiredStamps: offer.requiredStamps,
            }
          : null,
        state: buildCardState(row, offer?.requiredStamps ?? null),
      });
    }

    // Pending check-ins: one row per open request (pendingKey is unique per
    // merchant, so this list has at most one entry per shop).
    const pendingRows = await db.scanRequest.findMany({
      where: { customerPhone, status: 'PENDING', deletedAt: null },
      include: {
        merchant: {
          select: { id: true, businessName: true, category: true, logoUrl: true, logoPath: true, deletedAt: true },
        },
        offer: { select: { title: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const pendingRequests: CustomerPendingItem[] = [];
    for (const row of pendingRows) {
      if (row.merchant.deletedAt) continue;
      pendingRequests.push({
        requestId: row.id,
        merchantId: row.merchantId,
        businessName: row.merchant.businessName,
        category: row.merchant.category,
        logoUrl: merchantLogoUrl(row.merchant),
        offerTitle: row.offer.title,
        requestedAt: row.createdAt.toISOString(),
      });
    }

    return apiSuccess({
      cards,
      pendingRequests,
      totals: {
        cards: cards.length,
        stampsCollected: cards.reduce((sum, c) => sum + c.state.stampsCollected, 0),
        totalRedeemed: cards.reduce((sum, c) => sum + c.state.totalRedeemed, 0),
      },
    });
  } catch (error) {
    console.error('Error listing customer cards:', error);
    return apiError('Failed to load your stamp cards', 'INTERNAL_ERROR', 500);
  }
});
