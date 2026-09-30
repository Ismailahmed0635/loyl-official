import type { ActivityType } from '@prisma/client';
import { db } from './db';

export interface ActivityInput {
  merchantId: string;
  /** Kept as a plain id — history survives offer deletion. */
  offerId: string | null;
  customerPhone: string;
  type: ActivityType;
  /** Defaults to now; the scan route passes its own `now` for consistency. */
  at?: Date;
}

/**
 * Best-effort analytics event write (Phase 4). Analytics must never break the
 * customer flow: a failed insert is logged and swallowed.
 *
 * Scratch reveals are NOT recorded here — `ScratchResult` already is their
 * event log; the analytics route unions both sources.
 */
export async function recordActivity(input: ActivityInput): Promise<void> {
  try {
    await db.activityEvent.create({
      data: {
        merchantId: input.merchantId,
        offerId: input.offerId,
        customerPhone: input.customerPhone,
        type: input.type,
        ...(input.at ? { createdAt: input.at } : {}),
      },
    });
  } catch (err) {
    console.warn('ActivityEvent write failed (analytics only, ignored):', err);
  }
}
