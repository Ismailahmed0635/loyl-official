'use client';

import { ErrorState } from '@/components/ui/ErrorState';

/**
 * Phase 8 — route segment error boundary. The customer group layout has no
 * gate of its own, so this renders bare — the card centres itself.
 */
export default function CustomerError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState error={error} reset={reset} />;
}
