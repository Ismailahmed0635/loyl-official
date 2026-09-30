'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { Home, RotateCcw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

/**
 * Shared crash screen for every `error.tsx` boundary (Phase 8).
 *
 * Renders inside the route group's layout where one exists, so the merchant
 * keeps their nav and the admin keeps theirs — the crash is scoped to the
 * page, not the shell. The boundary's `reset()` retries the failed segment;
 * the digest (Next's server-side correlation id, when present) is shown for
 * support, mirroring the 404 page's incident-code pattern.
 */
export function ErrorState({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Diagnostics only in dev — production consoles stay clean; the digest
    // below is the support correlation id (server errors strip messages).
    if (process.env.NODE_ENV !== 'production') console.error('Unhandled UI error:', error);
  }, [error]);

  return (
    <div className="min-h-[60vh] grid place-items-center px-4 py-10">
      <Card className="w-full max-w-md text-center shadow-ambient">
        <span className="mx-auto mb-4 inline-flex h-11 w-11 items-center justify-center rounded-input bg-secondary-fixed text-on-secondary-fixed">
          <TriangleAlert size={20} aria-hidden="true" />
        </span>
        <h1 className="font-headline-sm text-headline-sm text-on-surface">
          Something went wrong
        </h1>
        <p className="mt-2 font-body-md text-body-md text-on-surface-variant">
          This screen hit an unexpected error. Retrying usually fixes it — your
          data is safe.
        </p>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 mt-6">
          <Button variant="primary" onClick={reset}>
            <RotateCcw className="w-4 h-4 mr-2" aria-hidden="true" />
            Try again
          </Button>
          <Link
            href="/welcome"
            className="inline-flex items-center justify-center min-h-[44px] px-4 rounded-input border border-brand-border bg-white font-semibold text-brand-textMain hover:bg-primary-container/[0.04] transition-colors"
          >
            <Home className="w-4 h-4 mr-2" aria-hidden="true" />
            Return home
          </Link>
        </div>

        {error.digest && (
          <p className="mt-6 pt-4 border-t border-hairline font-body-sm text-body-sm text-on-surface-variant">
            Error ID: <span className="tnum font-semibold text-brand-green">{error.digest}</span>
          </p>
        )}
      </Card>
    </div>
  );
}
