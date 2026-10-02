import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/backend/api/response';
import { withMerchant } from '@/backend/api/handler';
import { revokeMerchantDevice } from '@/backend/devices';
import { recordSecurityAlert } from '@/backend/alerts';

/**
 * DELETE /api/merchant/devices/[id] — revoke a registered device (Phase 10).
 *
 * The row is kept with status REVOKED rather than deleted, so past approvals
 * stay attributable. A revoked device can no longer sign an approval; a
 * re-registration with the same install id clears the revocation.
 */
export const DELETE = withMerchant(async (req: NextRequest, session, merchant, ctx) => {
  try {
    const { id } = await ctx.params;
    if (!id) return apiError('Missing device id', 'BAD_REQUEST', 400);

    const result = await revokeMerchantDevice(merchant.id, id);
    if (!result.ok) {
      return apiError(result.failure.message, result.failure.code, result.failure.status);
    }
    // RT-03: revoking is the merchant's own defensive act — record it so the
    // alert feed explains the gap between "device gone" and "nobody noticed".
    await recordSecurityAlert({
      merchantId: merchant.id,
      kind: 'DEVICE_REVOKED',
      deviceId: id,
      message: `App device revoked — it can no longer approve stamps.`,
    });
    return apiSuccess({ id, status: 'REVOKED' as const });
  } catch (error) {
    console.error('Error revoking merchant device:', error);
    return apiError('Failed to revoke this device', 'INTERNAL_ERROR', 500);
  }
});
