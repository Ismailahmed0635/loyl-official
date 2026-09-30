/**
 * backend/scan.ts — Phase 3 customer scan engine.
 *
 * Pure state-building helpers shared by the customer API routes:
 * cooldown windows (TEST.md §4), reward completion (TEST.md §4 reward trigger),
 * and the review-engine bonus window (PRD 3.3).
 */
import { db } from '@/backend/db';
import {
  SCAN_COOLDOWN_HOURS,
  REVIEW_COOLDOWN_HOURS,
  GEO_FENCE_RADIUS_M,
} from '@/lib/constants';

export { GEO_FENCE_RADIUS_M, SCAN_COOLDOWN_HOURS, REVIEW_COOLDOWN_HOURS };

const HOUR_MS = 60 * 60 * 1000;
export const SCAN_COOLDOWN_MS = SCAN_COOLDOWN_HOURS * HOUR_MS;
export const REVIEW_COOLDOWN_MS = REVIEW_COOLDOWN_HOURS * HOUR_MS;

/** Prisma CustomerStamp subset needed to compute card state. */
export interface CardRow {
  stampsCollected: number;
  totalRedeemed: number;
  lastScannedAt: Date | null;
  lastReviewAt: Date | null;
}

/** JSON-safe snapshot of a customer's stamp card — returned by every API. */
export interface CardState {
  exists: boolean;
  stampsCollected: number;
  totalRedeemed: number;
  lastScannedAt: string | null;
  lastReviewAt: string | null;
  /** null when the merchant's offers are unknown (no offer rows yet). */
  requiredStamps: number | null;
  complete: boolean;
  canScan: boolean;
  /** When the scan cooldown expires (null when a scan is allowed now). */
  nextScanAt: string | null;
  canReviewBonus: boolean;
  nextReviewAt: string | null;
}

function plusHours(from: Date | null, hours: number): string | null {
  return from ? new Date(from.getTime() + hours * HOUR_MS).toISOString() : null;
}

/**
 * Builds the client-facing card state.
 * - `card === null` → the customer has never scanned this shop (scan allowed).
 * - `required === null` → no offer rows exist, so completion can't be computed.
 */
export function buildCardState(card: CardRow | null, required: number | null): CardState {
  const now = Date.now();
  const stamps = card?.stampsCollected ?? 0;
  const complete = required !== null && stamps >= required;

  const lastScan = card?.lastScannedAt ?? null;
  const lastReview = card?.lastReviewAt ?? null;
  const scanWindowOver = !lastScan || now - lastScan.getTime() >= SCAN_COOLDOWN_MS;
  const reviewWindowOver = !lastReview || now - lastReview.getTime() >= REVIEW_COOLDOWN_MS;

  const canScan = !complete && scanWindowOver;
  const canReviewBonus = !!card && !complete && reviewWindowOver;

  return {
    exists: !!card,
    stampsCollected: stamps,
    totalRedeemed: card?.totalRedeemed ?? 0,
    lastScannedAt: lastScan ? lastScan.toISOString() : null,
    lastReviewAt: lastReview ? lastReview.toISOString() : null,
    requiredStamps: required,
    complete,
    canScan,
    // Only set while the cooldown is the active blocker (a complete card
    // needs to be claimed, not waited out).
    nextScanAt: !complete && !scanWindowOver ? plusHours(lastScan, SCAN_COOLDOWN_HOURS) : null,
    canReviewBonus,
    nextReviewAt: !complete && !reviewWindowOver
      ? plusHours(lastReview, REVIEW_COOLDOWN_HOURS)
      : null,
  };
}

/** Offer validity for customer-facing actions (scanning, context, redeem). */
export function offerEnded(offer: { createdAt: Date; durationDays: number }): boolean {
  return Date.now() > new Date(offer.createdAt).getTime() + offer.durationDays * 24 * HOUR_MS;
}

/** Customer stamp-card row lookup (unique on merchantId + customerPhone). */
export function findStampCard(merchantId: string, customerPhone: string) {
  return db.customerStamp.findUnique({
    where: { merchantId_customerPhone: { merchantId, customerPhone } },
  });
}

// --- Phase 9: merchant-approved stamps --------------------------------------

/**
 * The customer's open check-in at this shop, if any. A pending request blocks
 * a second scan the same way the cooldown does, so one scan = one request.
 */
export function findPendingScanRequest(merchantId: string, customerPhone: string) {
  return db.scanRequest.findFirst({
    where: { merchantId, customerPhone, status: 'PENDING', deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Applies one stamp to a card (atomic upsert, clamped to `required`) and
 * refreshes `lastScannedAt` so the 24h cooldown starts on approval, not scan.
 * Called by the merchant approval route — the scan route never stamps directly.
 *
 * Phase 11: `customerName` (the name verified at web sign-in) is written onto
 * the card so the merchant's customer list shows a person, not a bare number.
 */
export async function grantStamp(
  merchantId: string,
  customerPhone: string,
  required: number,
  customerName?: string | null,
  // Injectable client so callers can run the upsert + clamp inside their own
  // transaction (the approval route claims + stamps atomically). Defaults to
  // the shared client for the standalone path.
  client: Pick<typeof db, 'customerStamp'> = db
) {
  const now = new Date();
  const name = (customerName || '').trim();
  const row = await client.customerStamp.upsert({
    where: { merchantId_customerPhone: { merchantId, customerPhone } },
    update: {
      stampsCollected: { increment: 1 },
      lastScannedAt: now,
      ...(name ? { customerName: name } : {}),
    },
    create: {
      merchantId,
      customerPhone,
      stampsCollected: 1,
      lastScannedAt: now,
      ...(name ? { customerName: name } : {}),
    },
  });
  const saved =
    row.stampsCollected > required
      ? await client.customerStamp.update({
          where: { id: row.id },
          data: { stampsCollected: required },
        })
      : row;
  return { row: saved, at: now };
}
