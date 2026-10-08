'use client';

import { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Home, RouteOff, Copy, Check, Store, ScanLine, ShieldCheck, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';

/**
 * Sovereign Green 404 — ported from Stitch screen "07 - Page Not Found".
 *
 * Every destination below is a route that really exists (middleware guards
 * bounce the wrong session type to the right sign-in flow), so nothing here is
 * decorative. The incident-code row copies the requested path for support.
 */
const DESTINATIONS = [
  {
    href: '/dashboard',
    title: 'Merchant Console',
    description: 'Run offers, branches, scan requests and the redemption ledger.',
    icon: Store,
  },
  {
    href: '/scan',
    title: 'Customer Passbook',
    description: 'Scan a stamp card, collect stamps and redeem rewards.',
    icon: ScanLine,
  },
  {
    href: '/admin/login',
    title: 'Admin Console',
    description: 'Review merchants, payments and platform operations.',
    icon: ShieldCheck,
  },
];

export default function NotFound() {
  const router = useRouter();
  const pathname = usePathname();
  const [copied, setCopied] = useState(false);

  const incidentCode = `UNK_ROUTE_${(pathname || '/unknown').replace(/[^a-zA-Z0-9]/g, '_').toUpperCase() || 'ROOT'}`;

  const copyIncidentCode = async () => {
    try {
      await navigator.clipboard.writeText(`${incidentCode} · ${pathname}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be unavailable (insecure context) — fail silently.
    }
  };

  return (
    <main className="min-h-screen bg-surface-container-lowest flex flex-col items-center justify-center px-gutter-sm py-space-xl">
      <div className="w-full max-w-2xl">
        <div className="bg-surface-container-lowest rounded-panel border border-hairline shadow-ambient p-space-md sm:p-space-lg">
          {/* Status chip */}
          <div className="flex justify-center">
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-pill bg-surface-container-low border border-hairline">
              <span className="w-2 h-2 rounded-full bg-brand-red" aria-hidden="true" />
              <span className="font-label-sm text-label-sm uppercase tracking-wider text-brand-green">
                Status 404 · Ledger Route Not Found
              </span>
            </span>
          </div>

          {/* 4 0 4 with the severed-route badge in the middle */}
          <div className="flex items-center justify-center gap-3 sm:gap-5 mt-space-lg" aria-hidden="true">
            <span className="font-display-lg text-display-lg text-outline-variant select-none">4</span>
            <span className="flex flex-col items-center justify-center w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-surface-container-low border border-hairline shadow-sm">
              <RouteOff className="w-5 h-5 text-brand-green" strokeWidth={1.75} />
              <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant mt-0.5">
                Null Route
              </span>
            </span>
            <span className="font-display-lg text-display-lg text-outline-variant select-none">4</span>
          </div>
          <div className="flex justify-center -mt-1.5" aria-hidden="true">
            <span className="w-3 h-3 rounded-full bg-brand-green" />
          </div>

          <div className="text-center mt-space-md">
            <h1 className="font-headline-lg-mobile sm:font-headline-lg text-headline-lg-mobile sm:text-headline-lg text-on-surface tracking-tight">
              This page slipped through the ledger
            </h1>
            <p className="font-body-md text-body-md text-on-surface-variant mt-3 max-w-md mx-auto">
              The URL you requested does not exist, has expired, or has been moved to another passbook
              partition. Verify the address or return to the main hub.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 mt-space-lg">
            <Button variant="primary" onClick={() => router.push('/welcome')}>
              <Home className="w-4 h-4 mr-2" />
              Return Home
            </Button>
            <Button variant="outline" onClick={() => router.back()}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Go Back
            </Button>
          </div>

          {/* Incident telemetry row */}
          <div className="flex flex-wrap items-center justify-between gap-3 mt-space-lg pt-space-md border-t border-hairline">
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              Partition Code:{' '}
              <span className="tnum font-semibold text-brand-green">{incidentCode}</span>
            </p>
            <button
              type="button"
              onClick={copyIncidentCode}
              className="inline-flex items-center gap-1.5 font-label-md text-label-md uppercase tracking-wide text-on-surface-variant hover:text-brand-green transition-colors min-h-[44px] px-1"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-brand-green" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              {copied ? 'Copied' : 'Copy Incident Telemetry'}
            </button>
          </div>
        </div>

        {/* Verified destination routes */}
        <div className="mt-space-lg">
          <p className="font-label-sm text-label-sm uppercase tracking-widest text-on-surface-variant mb-3">
            Verified Destination Routes
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {DESTINATIONS.map((destination) => (
              <Link
                key={destination.href}
                href={destination.href}
                className="group flex flex-col gap-1.5 p-4 rounded-card bg-surface-container-lowest border border-hairline shadow-sm hover:shadow-ambient hover:border-primary-fixed-dim transition-shadow min-h-[44px]"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-label-lg text-label-lg text-on-surface">
                    <destination.icon className="w-4 h-4 text-brand-green" strokeWidth={1.75} />
                    {destination.title}
                  </span>
                  <ArrowUpRight
                    className="w-4 h-4 text-on-surface-variant group-hover:text-brand-green transition-colors"
                    strokeWidth={1.75}
                  />
                </span>
                <span className="font-body-sm text-body-sm text-on-surface-variant">
                  {destination.description}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
