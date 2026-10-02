import type { SecurityAlertKind } from '@prisma/client';
import { db } from './db';
import { logger } from './logger';

/**
 * RT-03: merchant-facing security signals (stolen-device detection).
 *
 * The merchant's phone can be stolen while it still holds a registered
 * approval key — the server cannot stop that, but it can tell the merchant
 * something abnormal happened:
 *
 * - APPROVAL_BURST   too many check-in approvals in a short window
 *                    (someone is mass-approving while the phone is gone),
 * - DEVICE_REGISTERED a new installation registered its public key,
 * - DEVICE_REVOKED    a device was revoked.
 *
 * Detection itself is pure (`isApprovalBurst`) so it is unit-testable; the
 * write is best-effort like `recordActivity` — an alert is a notification,
 * never a reason to fail the action that triggered it.
 */

/** Window the approval-velocity rule looks at. */
export const APPROVAL_BURST_WINDOW_MS = 5 * 60 * 1000;
/** Approvals inside the window that make the shop worth a warning. */
export const APPROVAL_BURST_THRESHOLD = 10;
/** Keep at most this many timestamp probes per check (threshold + margin). */
export const APPROVAL_PROBE_LIMIT = 50;

/**
 * True when `decidedAt` timestamps contain at least APPROVAL_BURST_THRESHOLD
 * entries inside [now - WINDOW, now]. Timestamps outside the window (or in
 * the future by more than a minute of clock skew) do not count.
 */
export function isApprovalBurst(
  decidedAtTimestamps: readonly number[],
  now: number = Date.now(),
  opts?: { windowMs?: number; threshold?: number }
): boolean {
  const windowMs = opts?.windowMs ?? APPROVAL_BURST_WINDOW_MS;
  const threshold = opts?.threshold ?? APPROVAL_BURST_THRESHOLD;
  const from = now - windowMs;
  // 1 minute of future-skew tolerance so a slightly fast device clock can
  // never hide approvals from the count.
  const to = now + 60_000;
  let inWindow = 0;
  for (const ts of decidedAtTimestamps) {
    if (ts >= from && ts <= to) {
      inWindow += 1;
      if (inWindow >= threshold) return true;
    }
  }
  return false;
}

/** PII-free one-line alert message (counts only — no phones, no names). */
export function approvalBurstMessage(count: number, windowMs: number): string {
  const minutes = Math.max(1, Math.round(windowMs / 60_000));
  return `${count} stamp approvals in ${minutes} minutes — if this wasn't you, revoke the app device in Settings.`;
}

export interface SecurityAlertInput {
  merchantId: string;
  kind: SecurityAlertKind;
  deviceId?: string | null;
  message: string;
  count?: number | null;
}

/**
 * Best-effort alert write: logs through the PII-scrubbed logger and swallows
 * failures so a notification can never break approvals or device management.
 */
export async function recordSecurityAlert(input: SecurityAlertInput): Promise<void> {
  try {
    await db.securityAlert.create({
      data: {
        merchantId: input.merchantId,
        kind: input.kind,
        deviceId: input.deviceId ?? null,
        message: input.message,
        count: input.count ?? null,
      },
    });
    logger.warn('Security alert raised', {
      kind: input.kind,
      merchantId: input.merchantId,
      deviceId: input.deviceId ?? undefined,
      count: input.count ?? undefined,
    });
  } catch (err) {
    logger.warn('Security alert write failed (notification only, ignored)', {
      kind: input.kind,
      merchantId: input.merchantId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
