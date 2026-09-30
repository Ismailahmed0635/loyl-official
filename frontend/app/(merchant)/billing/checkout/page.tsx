'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckoutModal } from '@/components/billing/CheckoutModal';
import { PLANS, type BillingTier } from '@/lib/api/payments';

/**
 * /billing/checkout — standalone checkout entry (e.g. deep links with
 * ?tier=YEARLY). The modal opens immediately; closing returns to /billing.
 */
export default function CheckoutPage() {
  const router = useRouter();
  const [tier, setTier] = useState<BillingTier | null>(null);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('tier');
    setTier(PLANS.find((plan) => plan.tier === requested)?.tier ?? 'MONTHLY');
  }, []);

  return (
    <div>
      <h1 className="font-headline-md text-headline-md text-on-surface">Checkout</h1>
      <p className="mt-1 font-body-sm text-body-sm text-on-surface-variant">
        Submit a bKash/Nagad payment for manual verification.
      </p>
      <a
        href="/billing"
        className="mt-3 inline-block min-h-[44px] font-label-lg text-label-lg text-brand-green underline underline-offset-2 hover:text-brand-greenDark"
      >
        Back to billing
      </a>

      <CheckoutModal
        open={tier !== null}
        initialTier={tier ?? 'MONTHLY'}
        onClose={() => router.push('/billing')}
      />
    </div>
  );
}
