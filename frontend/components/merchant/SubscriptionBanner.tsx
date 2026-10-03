'use client';

import React from 'react';
import Link from 'next/link';
import { AlertTriangle, Clock, Sparkles } from 'lucide-react';
import type { Merchant } from '@prisma/client';
import { hoursUntilExpiry, subscriptionPhase, withinExpiryWarning } from '@/backend/subscription';

type SubscriptionFields = Pick<Merchant, 'subscriptionTier' | 'subscriptionExpiresAt' | 'createdAt'>;

/** "18h 5m" inside the last day, "3 days" beyond it, "expired" once past. */
function formatLeft(hours: number): string {
  if (hours <= 0) return 'expired';
  if (hours < 24) {
    const whole = Math.floor(hours);
    const mins = Math.max(1, Math.round((hours - whole) * 60));
    return `${whole}h ${mins}m`;
  }
  const days = Math.ceil(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

const shell =
  'flex items-start gap-3 rounded-card border p-3.5 shadow-hairline font-body-md text-body-md';
const linkClass =
  'font-label-sm text-label-sm underline underline-offset-2 tap-highlight min-h-[44px] inline-flex items-center';

/**
 * Subscription state shown on every merchant page (24h warning + trial
 * countdown + expired notice). Read-only: the gates live server-side, this
 * only tells the merchant what is happening and where to renew.
 */
export function SubscriptionBanner({ merchant }: { merchant: SubscriptionFields | null }) {
  if (!merchant) return null;

  const phase = subscriptionPhase(merchant);
  const hours = hoursUntilExpiry(merchant);

  if (phase === 'EXPIRED') {
    return (
      <div
        role="status"
        className={`${shell} border-red-200 bg-red-50 text-brand-red`}
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p className="flex-1">
          Your subscription has expired. Your QR codes are switched off and new offers or menu
          edits are paused — everything else still works.{' '}
          <Link href="/billing" className={linkClass}>
            Renew now
          </Link>
        </p>
      </div>
    );
  }

  if (withinExpiryWarning(merchant)) {
    return (
      <div
        role="status"
        className={`${shell} border-red-200 bg-red-50 text-brand-red`}
      >
        <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p className="flex-1">
          Your plan expires in {formatLeft(hours)} — your QR codes stop working then.{' '}
          <Link href="/billing" className={linkClass}>
            Renew now
          </Link>
        </p>
      </div>
    );
  }

  if (phase === 'TRIAL') {
    return (
      <div
        role="status"
        className={`${shell} border-hairline bg-surface-container-low text-on-surface-variant`}
      >
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p className="flex-1">
          Free trial — {formatLeft(hours)} left (scratch cards only).{' '}
          <Link href="/billing" className={linkClass}>
            Choose a plan
          </Link>
        </p>
      </div>
    );
  }

  return null;
}
