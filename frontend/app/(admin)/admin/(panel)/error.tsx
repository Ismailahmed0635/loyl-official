'use client';

import { ErrorState } from '@/components/ui/ErrorState';

/**
 * Phase 8 — route segment error boundary for the authenticated admin panel
 * (login is outside this group). The panel layout keeps the AdminNav around
 * this card on desktop.
 */
export default function AdminPanelError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState error={error} reset={reset} />;
}
