'use client';

import React from 'react';

// Sovereign Green chip tones: light-green for positive/verified, neutral
// container-high for awaiting action, error-container for negative states.
// bKash keeps the secondary (rose) fixed tint so the two wallet methods stay
// tellable apart at a glance without a bespoke hex.
const TONES: Record<string, string> = {
  ACTIVE: 'bg-primary-fixed text-on-primary-fixed',
  PENDING: 'bg-surface-container-high text-on-surface-variant',
  EXPIRED: 'bg-error-container text-on-error-container',
  APPROVED: 'bg-primary-fixed text-on-primary-fixed',
  REJECTED: 'bg-error-container text-on-error-container',
  SUSPENDED: 'bg-error-container text-on-error-container',
  BKASH: 'bg-secondary-fixed text-on-secondary-fixed',
  NAGAD: 'bg-surface-container-high text-on-surface-variant',
};

/** Casing overrides the generic capitalize routine can't produce. */
const LABELS: Record<string, string> = {
  BKASH: 'bKash',
  NAGAD: 'Nagad',
};

function defaultLabel(status: string): string {
  if (LABELS[status]) return LABELS[status];
  return status.charAt(0) + status.slice(1).toLowerCase();
}

/** Rounded status/method chip used across the admin tables. */
export function StatusPill({ status, label }: { status: string; label?: string }) {
  const tone = TONES[status] || 'bg-surface-container-high text-on-surface-variant';
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-pill px-2.5 py-1 font-label-sm text-label-sm ${tone}`}
    >
      {label || defaultLabel(status)}
    </span>
  );
}
