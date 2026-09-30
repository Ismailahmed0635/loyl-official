import { Skeleton } from '@/components/ui/Skeleton';

/**
 * Phase 8 — route segment loading state for customer pages (stamp card,
 * reward, profile). A single centred card keeps the phone-width rhythm of
 * these screens while their content loads.
 */
export default function CustomerLoading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-60" />
      </div>

      <Skeleton className="h-56 rounded-panel" />

      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-20 rounded-card" />
        <Skeleton className="h-20 rounded-card" />
      </div>
    </div>
  );
}
