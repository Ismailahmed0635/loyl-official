import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/backend/api/response';
import { withMerchant } from '@/backend/api/handler';
import { checkRateLimit, recordHit, MUTATION_MERCHANT } from '@/backend/rateLimit';
import { deviceRegisterSchema } from '@/backend/validation/schemas';
import { registerMerchantDevice, toDeviceSummary } from '@/backend/devices';
import { db } from '@/backend/db';

/**
 * GET /api/merchant/devices — the merchant's registered app installations.
 *
 * Phase 10: only these devices can approve a check-in, so the app shows this
 * list for the "manage devices / revoke" screen. Never returns key material.
 */
export const GET = withMerchant(async (req: NextRequest, session, merchant) => {
  try {
    const rows = await db.merchantDevice.findMany({
      where: { merchantId: merchant.id, deletedAt: null },
      orderBy: { registeredAt: 'desc' },
      select: {
        id: true,
        deviceName: true,
        status: true,
        registeredAt: true,
        lastSeenAt: true,
        revokedAt: true,
      },
    });

    return apiSuccess({
      devices: rows.map(toDeviceSummary),
      activeCount: rows.filter((r) => r.status === 'ACTIVE').length,
    });
  } catch (error) {
    console.error('Error listing merchant devices:', error);
    return apiError('Failed to load devices', 'INTERNAL_ERROR', 500);
  }
});

/**
 * POST /api/merchant/devices — register this app installation.
 *
 * Called once on first run (and again after a reinstall) with the public half of
 * a locally generated Ed25519 keypair. Passing the same `installId` rotates the
 * stored public key instead of creating a duplicate device.
 */
export const POST = withMerchant(async (req: NextRequest, session, merchant) => {
  const gate = checkRateLimit(`devices:${merchant.id}`, MUTATION_MERCHANT);
  if (!gate.allowed) {
    return apiError('Too many attempts. Please wait a few minutes and try again.', 'RATE_LIMITED', 429, {
      retryAfterMs: gate.retryAfterMs,
    });
  }
  recordHit(`devices:${merchant.id}`, MUTATION_MERCHANT);

  try {
    const body = await req.json().catch(() => null);
    const parsed = deviceRegisterSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]?.message || 'Invalid device registration';
      return apiError(issue, 'VALIDATION_ERROR', 422);
    }

    const result = await registerMerchantDevice({
      merchantId: merchant.id,
      deviceName: parsed.data.deviceName,
      publicKeyJwk: parsed.data.publicKey,
      installId: parsed.data.installId ?? null,
    });
    if (!result.ok) {
      return apiError(result.failure.message, result.failure.code, result.failure.status);
    }

    return apiSuccess({ device: result.device }, 201);
  } catch (error) {
    console.error('Error registering merchant device:', error);
    return apiError('Failed to register this device', 'INTERNAL_ERROR', 500);
  }
});
