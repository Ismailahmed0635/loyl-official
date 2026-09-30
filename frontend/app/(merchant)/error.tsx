'use client';

import { ErrorState } from '@/components/ui/ErrorState';

/**
 * Phase 8 — route segment error boundary (client component by contract).
 * Catches render/data errors in the merchant group; the group layout keeps
 * the nav shell around this card.
 */
export default function MerchantError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState error={error} reset={reset} />;
}
