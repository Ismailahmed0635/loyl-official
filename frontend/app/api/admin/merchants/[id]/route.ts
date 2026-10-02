import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/backend/api/response';
import { withAdmin, RouteContext } from '@/backend/api/handler';
import { adminMerchantActionSchema } from '@/backend/validation/schemas';
import { applySubscriptionAction } from '@/backend/admin';
import { merchantActionName, recordAdminAction } from '@/backend/adminAudit';
import { db } from '@/backend/db';

const MERCHANT_ROW_SELECT = {
  id: true,
  businessName: true,
  category: true,
  phoneNumber: true,
  subscriptionStatus: true,
  subscriptionExpiresAt: true,
  createdAt: true,
  deletedAt: true,
} as const;

// PATCH /api/admin/merchants/[id] — one management action per request:
// activate (ACTIVE +30d) | expire | revoke | suspend (soft delete) | restore.
export const PATCH = withAdmin(async (req: NextRequest, session, ctx: RouteContext) => {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const parsed = adminMerchantActionSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]?.message || 'Invalid input';
    return apiError(issue, 'VALIDATION_ERROR', 422);
  }

  const { id } = await ctx.params;
  if (!id) {
    return apiError('Merchant id is required', 'VALIDATION_ERROR', 422);
  }

  const existing = await db.merchant.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    return apiError('Merchant not found', 'MERCHANT_NOT_FOUND', 404);
  }

  // RT-02: the audit row commits with the state change (one transaction).
  const merchant = await db.$transaction(async (tx) => {
    const updated = await tx.merchant.update({
      where: { id },
      data: applySubscriptionAction(parsed.data.action),
      select: MERCHANT_ROW_SELECT,
    });
    await recordAdminAction(
      {
        action: merchantActionName(parsed.data.action),
        targetType: 'MERCHANT',
        targetId: id,
        actorId: session.userId,
        detail: {
          merchantId: id,
          merchantAction: parsed.data.action,
          subscriptionStatus: updated.subscriptionStatus,
        },
      },
      tx
    );
    return updated;
  });

  return apiSuccess({ merchant: { ...merchant, suspended: !!merchant.deletedAt } });
});
