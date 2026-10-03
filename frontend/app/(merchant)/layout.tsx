'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Merchant } from '@prisma/client';
import { MerchantNav } from '@/components/merchant/MerchantNav';
import { SubscriptionBanner } from '@/components/merchant/SubscriptionBanner';
import { getAuthMe } from '@/lib/api/client';

/**
 * Shell for all merchant pages: auth gate + navigation.
 * Mobile: bottom-nav with a movable (draggable) quick-menu button.
 * Desktop: top-nav with a "New Offer" action.
 */
export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [merchant, setMerchant] = useState<Merchant | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await getAuthMe();
        if (!alive) return;
        if (!res?.data?.authenticated) {
          router.replace('/welcome');
          return;
        }
        if (!res?.data?.merchant) {
          // Phase 5: an admin session belongs in the admin panel, never onboarding.
          if (res?.data?.session?.role === 'admin') {
            router.replace('/admin');
            return;
          }
          // Phase 3: a customer session must go back to the scan flow,
          // never into merchant onboarding.
          if (res?.data?.session?.role === 'customer') {
            router.replace('/scan');
            return;
          }
          const phone = res?.data?.session?.phoneNumber || '';
          router.replace(`/business-setup?phone=${encodeURIComponent(phone)}`);
          return;
        }
        setMerchant(res.data.merchant);
      } catch (err) {
        // Network hiccup: render the shell and let pages surface their own errors.
        console.warn('Session check failed in merchant layout', err);
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  if (!ready) {
    return (
      <main className="min-h-screen grid place-items-center bg-brand-bg">
        <p className="text-sm text-brand-textMuted">Loading Loyl…</p>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-brand-bg">
      <MerchantNav businessName={merchant?.businessName} logoUrl={merchant?.logoUrl} />
      <main className="max-w-md mx-auto md:max-w-2xl lg:max-w-6xl px-4 pt-6 pb-32 md:pb-16">
        <SubscriptionBanner merchant={merchant} />
        {children}
      </main>
    </div>
  );
}
