import { Skeleton } from '@/components/ui/Skeleton';

/**
 * Phase 8 — route segment loading state for the admin panel. Mirrors the
 * dashboard's KPI row + table shape; the AdminNav is already rendered by the
 * panel layout.
 */
export default function AdminPanelLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <Skeleton className="h-8 w-56" />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Skeleton className="h-24 rounded-card" />
        <Skeleton className="h-24 rounded-card" />
        <Skeleton className="h-24 rounded-card col-span-2 lg:col-span-1" />
      </div>

      <Skeleton className="h-72 rounded-card" />
    </div>
  );
}
