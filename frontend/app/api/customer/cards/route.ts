import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/backend/api/response';
import { withCustomer } from '@/backend/api/handler';
import { buildCardState, CardState } from '@/backend/scan';
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
          select: { id: true, businessName: true, category: true, logoUrl: true, deletedAt: true },
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
        logoUrl: row.merchant.logoUrl,
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

    return apiSuccess({
      cards,
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
