'use client';

import React from 'react';
import { AlertCircle } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { MenuEditor } from '@/components/merchant/MenuEditor';
import { getDigitalMenu } from '@/lib/api/merchant';
import type { MenuResponse } from '@/lib/api/merchant';
import { useQuery } from '@/lib/api/cache';

/**
 * Digital Menu (Phase 12) — merchant side.
 *
 * Thin shell: it loads the merchant's menu once and hands it to the editor,
 * which owns every subsequent mutation (upload, read, save, publish).
 *
 * The Branch Page camera icon (LOYLS §5) shoots and uploads the photo before
 * routing here, because a file chooser opened after a navigation carries no
 * user gesture and Chrome will not raise it — see branches/page.tsx.
 */
export default function DigitalMenuPage() {
  // The editor below owns writes; this key is what it re-reads after a save.
  const { data, error, refetch } = useQuery<MenuResponse>(
    'menu',
    async () => {
      const res = await getDigitalMenu();
      if (!res?.success) throw new Error(res?.error?.message || 'Could not load your menu.');
      return res.data as MenuResponse;
    },
    { ttl: 20_000 }
  );

  const errorMessage = error instanceof Error ? error.message : error ? String(error) : null;

  if (error != null && !data) {
    return (
      <Card className="flex flex-col items-start gap-3">
        <div className="flex items-center gap-2 text-brand-red">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p className="font-body-md text-body-md font-medium">{errorMessage}</p>
        </div>
        <button
          onClick={() => refetch()}
          className="min-h-[44px] rounded-input bg-brand-green px-4 text-label-lg text-white shadow-inset-light transition-colors hover:bg-brand-greenDark focus:outline-none focus:ring-2 focus:ring-brand-green"
        >
          Try again
        </button>
      </Card>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-space-lg" aria-busy="true">
        <div className="h-28 rounded-card border border-hairline bg-surface-container-lowest shadow-sm" />
        <div className="h-56 rounded-card border border-hairline bg-surface-container-lowest shadow-sm" />
        <div className="h-72 rounded-card border border-hairline bg-surface-container-lowest shadow-sm" />
      </div>
    );
  }

  return <MenuEditor initial={data.menu} businessName={data.businessName} />;
}
