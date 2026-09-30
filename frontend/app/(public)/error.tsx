'use client';

import { ErrorState } from '@/components/ui/ErrorState';

/**
 * Phase 8 — route segment error boundary for the (public) group. Menu pages
 * are server components hitting the DB; this keeps a merchant's public menu
 * from showing the raw Next error screen if that query ever fails.
 */
export default function PublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState error={error} reset={reset} />;
}
