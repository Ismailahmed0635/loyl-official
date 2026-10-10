import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/backend/api/response';
import { withMerchant } from '@/backend/api/handler';
import { updateSettingsSchema } from '@/backend/validation/schemas';
import { db } from '@/backend/db';

/** Empty string clears an optional URL column (stored as null). */
function urlOrNull(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** GET /api/merchant/settings — current merchant profile (LOYLS §6). */
export const GET = withMerchant(async (req: NextRequest, session, merchant) => {
  return apiSuccess({ merchant });
});

/**
 * PATCH /api/merchant/settings — profile + social-link edits.
 * At least one field required (422 VALIDATION_ERROR otherwise). The phone
 * number is collected contact data and is never editable here.
 */
export const PATCH = withMerchant(async (req: NextRequest, session, merchant) => {
  try {
    const body = await req.json().catch(() => null);
    const parsed = updateSettingsSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]?.message || 'Invalid input';
      return apiError(issue, 'VALIDATION_ERROR', 422);
    }

    const { businessName, category, websiteUrl, facebookUrl, instagramUrl } = parsed.data;
    const data: Record<string, string | null> = {};
    if (businessName !== undefined) data.businessName = businessName;
    if (category !== undefined) data.category = category;
    const urls = { websiteUrl, facebookUrl, instagramUrl };
    for (const [key, value] of Object.entries(urls)) {
      const next = urlOrNull(value);
      if (next !== undefined) data[key] = next;
    }

    const updated = await db.merchant.update({ where: { id: merchant.id }, data });
    return apiSuccess({ merchant: updated });
  } catch (error) {
    console.error('Error updating merchant settings:', error);
    return apiError('Failed to save settings', 'INTERNAL_ERROR', 500);
  }
});
