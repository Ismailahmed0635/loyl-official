'use client';

import React, { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { CustomerNav } from '@/components/customer/CustomerNav';
import { getAuthMe } from '@/lib/api/client';

/**
 * Shell for all customer pages (Phase 3).
 *
 * `/scan` and `/scan/[offerId]` are the sign-in entry points, so they render
 * without a gate (the page itself decides whether to show sign-in or the scan UI).
 * Every other customer page requires a session and bounces to /scan?next=…
 */
export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isEntry = pathname === '/scan' || pathname.startsWith('/scan/');
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await getAuthMe();
        if (!alive) return;
        // Phase 5: an admin session belongs in the admin panel, not the scan flow.
        if (res?.data?.authenticated && res?.data?.session?.role === 'admin') {
          router.replace('/admin');
          return;
        }
        const ok = !!res?.data?.authenticated;
        setAuthed(ok);
        if (!ok && !isEntry) {
          router.replace(`/scan?next=${encodeURIComponent(pathname)}`);
        }
      } catch (err) {
        // Network hiccup: keep the shell and let pages surface their errors.
        console.warn('Session check failed in customer layout', err);
        if (alive) setAuthed(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [pathname, isEntry, router]);

  return (
    <div className="min-h-screen bg-brand-bg">
      {authed && <CustomerNav />}
      <main
        className={
          authed
            ? 'max-w-md mx-auto md:max-w-2xl lg:max-w-6xl px-4 pt-6 pb-28 md:pb-16'
            : 'max-w-md mx-auto md:max-w-2xl lg:max-w-6xl px-4 py-8 md:py-12'
        }
      >
        {children}
      </main>
    </div>
  );
}
