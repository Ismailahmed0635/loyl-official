import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/backend/api/response';
import { withMerchant } from '@/backend/api/handler';
import { revokeMerchantDevice } from '@/backend/devices';

/**
 * DELETE /api/merchant/devices/[id] — revoke a registered device (Phase 10).
 *
 * The row is kept with status REVOKED rather than deleted, so past approvals
 * stay attributable. A revoked device can no longer sign an approval; a
 * re-registration with the same install id clears the revocation.
 */
export const DELETE = withMerchant(async (req: NextRequest, session, merchant, ctx) => {
  try {
    const id = ctx.params?.id;
    if (!id) return apiError('Missing device id', 'BAD_REQUEST', 400);

    const result = await revokeMerchantDevice(merchant.id, id);
    if (!result.ok) {
      return apiError(result.failure.message, result.failure.code, result.failure.status);
    }
    return apiSuccess({ id, status: 'REVOKED' as const });
  } catch (error) {
    console.error('Error revoking merchant device:', error);
    return apiError('Failed to revoke this device', 'INTERNAL_ERROR', 500);
  }
});
