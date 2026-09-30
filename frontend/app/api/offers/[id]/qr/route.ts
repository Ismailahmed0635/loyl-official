import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/backend/api/response';
import { withMerchant } from '@/backend/api/handler';
import { db } from '@/backend/db';
import { buildScanUrl, generateQrDataUrl, resolveRequestOrigin } from '@/lib/poster';

// GET /api/offers/[id]/qr — Generates the printable QR payload for an offer
export const GET = withMerchant(async (req: NextRequest, session, merchant, { params }) => {
  try {
    const id = params?.id;
    if (!id) return apiError('Missing offer id', 'BAD_REQUEST', 400);

    const offer = await db.offer.findFirst({
      where: { id, merchantId: merchant.id, deletedAt: null },
      include: {
        scratchItems: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!offer) return apiError('Offer not found', 'NOT_FOUND', 404);

    const scanUrl = buildScanUrl(resolveRequestOrigin(req), offer.id);
    const qrDataUrl = await generateQrDataUrl(scanUrl);

    return apiSuccess({
      offer,
      merchant: {
        id: merchant.id,
        businessName: merchant.businessName,
        category: merchant.category,
        logoUrl: merchant.logoUrl,
        phoneNumber: merchant.phoneNumber,
      },
      scanUrl,
      qrDataUrl,
    });
  } catch (error) {
    console.error('Error generating offer QR:', error);
    return apiError('Failed to generate QR code', 'INTERNAL_ERROR', 500);
  }
});
