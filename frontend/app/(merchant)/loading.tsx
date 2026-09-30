import { Skeleton } from '@/components/ui/Skeleton';

/**
 * Phase 8 — route segment loading state. Shown while a merchant page's data
 * fetches inside the shell (nav is already rendered by the group layout).
 * Mirrors the dashboard's KPI-cards + list shape so the swap reads as one
 * motion, not a layout jump.
 */
export default function MerchantLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Skeleton className="h-24 rounded-card" />
        <Skeleton className="h-24 rounded-card" />
        <Skeleton className="h-24 rounded-card col-span-2 md:col-span-1" />
      </div>

      <Skeleton className="h-40 rounded-card" />

      <div className="flex flex-col gap-3">
        <Skeleton className="h-14 rounded-card" />
        <Skeleton className="h-14 rounded-card" />
        <Skeleton className="h-14 rounded-card" />
      </div>
    </div>
  );
}
