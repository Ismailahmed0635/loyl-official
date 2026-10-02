import type { Prisma } from '@prisma/client';
import { db } from './db';

/**
 * RT-02: append-only admin audit trail.
 *
 * Every state-changing admin action writes one row here, inside the same
 * transaction as the change itself — if the action commits, its audit row
 * commits with it; if the action rolls back, no phantom audit row survives.
 *
 * Rules:
 * - Only `create` exists. The app never updates or deletes an AdminAction,
 *   so the history cannot be rewritten through the product.
 * - `detail` holds safe context only (ids, tiers, amounts, action names).
 *   Phone numbers, tokens and passwords never go in here — the same PII
 *   posture as `backend/logger.ts`.
 * - Plain string ids, no relations: the trail survives deletion of the row
 *   it references (same pattern as `ActivityEvent.offerId`).
 */

/** Stable action names (SCREAMING_SNAKE, like the API error codes). */
export const ADMIN_ACTIONS = [
  'APPROVE_PAYMENT',
  'REJECT_PAYMENT',
  'MERCHANT_ACTIVATE',
  'MERCHANT_EXPIRE',
  'MERCHANT_REVOKE',
  'MERCHANT_SUSPEND',
  'MERCHANT_RESTORE',
] as const;

export type AdminActionName = (typeof ADMIN_ACTIONS)[number];

/** What the action targeted (plain strings — no FK to outlive). */
export type AdminTargetType = 'PAYMENT_REQUEST' | 'MERCHANT';

/** Detail values must stay JSON-primitive; no nested objects or arrays. */
// `undefined` is allowed and dropped at serialize time (see serializeActionDetail).
export type AdminActionDetail = Record<string, string | number | boolean | null | undefined>;

export interface AdminActionInput {
  action: AdminActionName;
  targetType: AdminTargetType;
  targetId?: string | null;
  /** Admin session userId (`admin`) — a stable pseudonymous actor id. */
  actorId: string;
  detail?: AdminActionDetail;
}

const DETAIL_MAX_BYTES = 2000;

/**
 * Serializes the safe-detail blob, refusing anything that would not fit.
 * Returns null for an empty object so the column stays NULL instead of `{}`.
 */
export function serializeActionDetail(detail?: AdminActionDetail): string | null {
  if (!detail) return null;
  const entries = Object.entries(detail).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return null;
  const json = JSON.stringify(Object.fromEntries(entries));
  if (json.length > DETAIL_MAX_BYTES) {
    throw new Error('AdminAction detail too large — record facts, not payloads.');
  }
  return json;
}

/**
 * Writes one audit row. Pass the surrounding transaction so the audit row and
 * the action share a commit (see module doc). Outside a transaction it runs
 * standalone, which is what the single-statement routes use.
 */
export async function recordAdminAction(
  input: AdminActionInput,
  tx?: Prisma.TransactionClient
): Promise<void> {
  const client = tx ?? db;
  await client.adminAction.create({
    data: {
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      actorId: input.actorId,
      detail: serializeActionDetail(input.detail),
    },
  });
}

/** Maps a merchant-management action to its audit name. */
export function merchantActionName(action: string): AdminActionName {
  const name = `MERCHANT_${action.toUpperCase()}`;
  if ((ADMIN_ACTIONS as readonly string[]).includes(name)) return name as AdminActionName;
  throw new Error(`Unknown merchant action: ${action}`);
}
