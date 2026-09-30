'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminNav } from '@/components/admin/AdminNav';
import { Card } from '@/components/ui/Card';
import { ADMIN_SESSION_ERRORS, getAdminSession } from '@/lib/api/admin';
import { Monitor } from 'lucide-react';

/**
 * Shell for all admin panel pages (/admin, /admin/merchants, /admin/billing).
 * Gate: requires a valid admin session — anything else bounces to /admin/login.
 * Desktop-only (phases.md note): screens < 1024px get a notice instead.
 */
export default function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await getAdminSession();
        if (!alive) return;
        if (!res?.success) {
          if (!res?.error || ADMIN_SESSION_ERRORS.includes(res.error.code)) {
            router.replace('/admin/login');
            return;
          }
          // Unexpected API shape: render the shell and let pages surface errors.
          setReady(true);
          return;
        }
        setReady(true);
      } catch (err) {
        // Network hiccup: render the shell; pages show their own errors.
        console.warn('Admin session check failed', err);
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  if (!ready) {
    return (
      <main className="grid min-h-screen place-items-center bg-surface">
        <p className="font-body-sm text-body-sm text-on-surface-variant">Loading Loyl…</p>
      </main>
    );
  }

  return (
    <>
      <div className="hidden min-h-screen flex-col bg-surface lg:flex">
        <AdminNav />
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 pt-8 pb-16">{children}</main>
      </div>

      {/* Desktop-only note (phases.md Phase 5) — shown below lg. */}
      <div className="grid min-h-screen place-items-center bg-surface px-6 lg:hidden">
        <Card className="max-w-sm p-8 text-center shadow-ambient">
          <span className="mx-auto mb-3 inline-flex h-11 w-11 items-center justify-center rounded-input bg-surface-container-high text-on-surface-variant">
            <Monitor size={20} />
          </span>
          <h1 className="font-headline-sm text-headline-sm text-on-surface">
            Desktop only for now
          </h1>
          <p className="mt-2 font-body-md text-body-md text-on-surface-variant">
            The Loyl admin panel needs a screen at least 1024px wide. Open it on a laptop or
            desktop browser.
          </p>
        </Card>
      </div>
    </>
  );
}
