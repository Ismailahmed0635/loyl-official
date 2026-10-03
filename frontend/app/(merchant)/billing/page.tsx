'use client';

import React, { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FadeUp } from '@/components/animations/FadeUp';
import { StatusPill } from '@/components/admin/StatusPill';
import { CheckoutModal } from '@/components/billing/CheckoutModal';
import {
  PLANS,
  TIER_LABELS,
  getBilling,
  type BillingResponse,
  type BillingTier,
} from '@/lib/api/payments';
import { isoDay } from '@/lib/api/admin';
import { useQuery } from '@/lib/api/cache';
import { AlertCircle, Clock, CreditCard, RefreshCw, Sparkles } from 'lucide-react';

/** /billing — Phase 7 subscription overview, plans, and request history. */
export default function BillingPage() {
  const [modalTier, setModalTier] = useState<BillingTier | null>(null);

  // Cached: reopening /billing (e.g. after the checkout modal redirects back)
  // shows the last known plan immediately instead of an empty skeleton.
  const { data, error, isLoading, refetch } = useQuery<BillingResponse>(
    'billing',
    async () => {
      const res = await getBilling();
      if (!res?.success) throw new Error(res?.error?.message || 'Failed to load billing state');
      if (!res.data) throw new Error('Failed to load billing state');
      return res.data as BillingResponse;
    },
    { ttl: 30_000 }
  );

  const loading = isLoading;
  const load = refetch;

  const sub = data?.subscription;

  function subLine(): string {
    if (!sub) return '';
    const end = sub.endsAt || sub.expiresAt;
    // Phase first: the stored status never flips on its own, so an expired
    // plan would otherwise still read "Active until <date in the past>".
    if (sub.phase === 'EXPIRED') return end ? `Expired on ${isoDay(end)}.` : 'Expired.';
    if (sub.phase === 'TRIAL') {
      return end
        ? `Free trial — ends ${isoDay(end)} (scratch cards only).`
        : 'Free trial (scratch cards only).';
    }
    if (sub.status === 'PENDING') return 'Not active yet — request access below.';
    return end ? `Active until ${isoDay(end)}.` : 'Active — no expiry (free tier).';
  }

  return (
    <FadeUp>
      <div className="mb-6">
        <h1 className="font-headline-md text-headline-md text-on-surface">
          Billing &amp; Subscription
        </h1>
        <p className="mt-1 font-body-sm text-body-sm text-on-surface-variant">
          Pay with bKash or Nagad — every transfer is verified manually before your subscription
          activates.
        </p>
      </div>

      {error != null && (
        <p
          role="alert"
          className="mb-4 flex items-center gap-2 rounded-input border border-error-container bg-error-container/50 px-4 py-2.5 font-body-md text-body-md font-medium text-on-error-container"
        >
          <AlertCircle size={15} /> {error instanceof Error ? error.message : String(error)}{' '}
          <button type="button" onClick={load} className="underline underline-offset-2">
            Retry
          </button>
        </p>
      )}

      {/* Subscription status */}
      <Card className="p-space-md">
        {loading && !data && (
          <p className="font-body-sm text-body-sm text-on-surface-variant">Loading…</p>
        )}
        {data && sub && (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <span className="font-headline-sm text-headline-sm text-on-surface">
                  {TIER_LABELS[sub.tier]} plan
                </span>
                <StatusPill status={sub.status} />
              </div>
              <p className="mt-1 font-body-sm text-body-sm text-on-surface-variant">{subLine()}</p>
            </div>
            <Button variant="primary" size="md" onClick={() => setModalTier('MONTHLY')}>
              <CreditCard size={16} className="mr-1.5" /> Upgrade
            </Button>
          </div>
        )}
      </Card>

      {/* Pending request notice */}
      {data?.pending && (
        <Card className="mt-4 border-primary-fixed bg-primary-fixed/40 p-4">
          <p className="flex items-center gap-2 font-label-lg text-label-lg text-on-primary-fixed">
            <Clock size={15} /> Request under review
          </p>
          <p className="mt-1 font-body-sm text-body-sm text-on-primary-fixed-variant">
            {TIER_LABELS[data.pending.requestedTier]} request submitted{' '}
            {isoDay(data.pending.createdAt)}
            {data.pending.hasScreenshot ? ' with screenshot' : ' (no screenshot)'} — we usually
            respond within 24 hours.
          </p>
        </Card>
      )}

      {/* Plans */}
      <div className="mt-6 grid gap-space-md sm:grid-cols-2 lg:grid-cols-4">
        {PLANS.map((plan) => {
          const current = sub?.status === 'ACTIVE' && sub.tier === plan.tier;
          return (
            <Card
              key={plan.tier}
              className={`p-space-md flex flex-col ${
                current ? 'border-brand-green ring-1 ring-brand-green' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-label-lg text-label-lg text-on-surface">{plan.name}</span>
                {plan.tier === 'PREMIUM' && <Sparkles size={15} className="text-brand-red" />}
              </div>
              <p className="mt-2 font-metric-num text-metric-num text-brand-green tabular-nums leading-none">
                {plan.priceBdt === 0 ? 'Free' : `৳${plan.priceBdt.toLocaleString('en-US')}`}
              </p>
              <p className="mt-1 font-body-sm text-body-sm text-on-surface-variant">
                {plan.durationDays ? `${plan.durationDays} days` : 'No expiry'}
              </p>
              <p className="mt-3 flex-1 font-body-sm text-body-sm leading-relaxed text-on-surface-variant">
                {plan.blurb}
              </p>
              <Button
                className="mt-4"
                size="sm"
                variant={current ? 'outline' : 'primary'}
                onClick={() => setModalTier(plan.tier)}
              >
                {current ? 'Current plan' : plan.tier === 'FREE' ? 'Request free access' : 'Choose'}
              </Button>
            </Card>
          );
        })}
      </div>

      {/* History */}
      <Card className="mt-6 p-0">
        <div className="border-b border-hairline px-5 py-4">
          <h2 className="font-headline-sm text-headline-sm text-on-surface">Request history</h2>
        </div>
        {!loading && data && data.requests.length === 0 && (
          <div className="p-8 text-center">
            <p className="font-label-lg text-label-lg text-on-surface">No requests yet</p>
            <p className="mt-1 font-body-sm text-body-sm text-on-surface-variant">
              Pick a plan above to submit your first payment request.
            </p>
          </div>
        )}
        {data && data.requests.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
                  <th className="px-5 py-3">Plan</th>
                  <th className="px-3 py-3">Payment</th>
                  <th className="px-3 py-3">Amount</th>
                  <th className="px-3 py-3">Submitted</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.requests.map((row) => (
                  <tr key={row.id} className="border-b border-hairline last:border-0">
                    <td className="px-5 py-3.5 font-label-lg text-label-lg text-on-surface">
                      {TIER_LABELS[row.requestedTier]}
                    </td>
                    <td className="px-3 py-3.5 text-on-surface-variant">
                      {row.trxId ? (
                        <>
                          <span className="text-on-surface">
                            {row.paymentMethod === 'BKASH' ? 'bKash' : 'Nagad'}
                          </span>{' '}
                          <span className="font-mono text-xs">{row.trxId}</span>
                        </>
                      ) : (
                        <span className="text-xs">Free tier — no transfer</span>
                      )}
                    </td>
                    <td className="px-3 py-3.5 font-label-lg text-label-lg text-on-surface tabular-nums">
                      ৳{row.amount.toLocaleString('en-US')}
                    </td>
                    <td className="px-3 py-3.5 font-body-sm text-body-sm text-on-surface-variant tabular-nums">
                      {isoDay(row.createdAt)}
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusPill status={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && data && data.requests.length > 0 && (
          <p className="border-t border-hairline px-5 py-3 font-body-sm text-body-sm text-on-surface-variant tabular-nums">
            Showing your latest {data.requests.length} request{data.requests.length === 1 ? '' : 's'}.
          </p>
        )}
      </Card>

      {loading && data && (
        <p className="mt-3 flex items-center gap-1.5 font-body-sm text-body-sm text-on-surface-variant">
          <RefreshCw size={12} className="animate-spin" /> Refreshing…
        </p>
      )}

      <CheckoutModal
        open={modalTier !== null}
        initialTier={modalTier ?? 'MONTHLY'}
        onClose={() => setModalTier(null)}
        onSubmitted={load}
      />
    </FadeUp>
  );
}
