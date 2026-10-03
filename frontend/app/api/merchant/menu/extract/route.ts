import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/backend/api/response';
import { withMerchant } from '@/backend/api/handler';
import { checkRateLimit, recordHit, EXTRACT_MERCHANT } from '@/backend/rateLimit';
import { gateMenuWrite } from '@/backend/subscription';
import {
  VisionError,
  VisionNotConfiguredError,
  extractMenuDraft,
  menuPhotoAsBase64,
} from '@/backend/menu';
import { db } from '@/backend/db';

/**
 * POST /api/merchant/menu/extract — reads the stored photo through the vision
 * model and returns a draft.
 *
 * Nothing is persisted here on purpose: extraction is advisory. The merchant
 * reviews, corrects and re-orders the result in the editor, and only their
 * Save/Publish writes content to the public page. That ordering is what makes
 * a bad OCR read a visible draft instead of a silently wrong menu.
 *
 * Errors: 404 NO_MENU_PHOTO (nothing stored), 503 VISION_NOT_CONFIGURED (no
 * GROQ_API_KEY nor OPENAI_API_KEY — the manual editor is the supported fallback), 502
 * VISION_FAILED (transport/auth/parse failure).
 */
export const POST = withMerchant(async (_req: NextRequest, _session, merchant) => {
  const gate = checkRateLimit(`extract:${merchant.id}`, EXTRACT_MERCHANT);
  if (!gate.allowed) {
    return apiError('Too many extraction attempts. Please wait a few minutes and try again.', 'RATE_LIMITED', 429, {
      retryAfterMs: gate.retryAfterMs,
    });
  }
  recordHit(`extract:${merchant.id}`, EXTRACT_MERCHANT);

  // Subscription gate: extraction is part of building the menu (and costs
  // model spend, so it must not run for a tier that cannot save the result).
  const sub = gateMenuWrite(merchant);
  if (!sub.ok) return apiError(sub.message, sub.code, 403);

  try {
    const menu = await db.digitalMenu.findUnique({
      where: { merchantId: merchant.id },
      select: { photoPath: true },
    });
    if (!menu?.photoPath) {
      return apiError('Upload a menu photo first.', 'NO_MENU_PHOTO', 404);
    }

    const photo = await menuPhotoAsBase64(menu.photoPath);
    if (!photo) {
      return apiError(
        'That menu photo is no longer available. Upload it again.',
        'NO_MENU_PHOTO',
        404
      );
    }

    const draft = await extractMenuDraft({
      base64: photo.base64,
      contentType: photo.contentType,
      businessName: merchant.businessName,
    });

    return apiSuccess({ draft, photoUrl: '/api/merchant/menu/photo' });
  } catch (err) {
    if (err instanceof VisionNotConfiguredError) {
      return apiError(err.message, err.code, 503);
    }
    if (err instanceof VisionError) {
      return apiError(err.message, err.code, 502);
    }
    console.error('Menu extraction failed:', err);
    return apiError('Menu recognition failed.', 'INTERNAL_ERROR', 500);
  }
});
