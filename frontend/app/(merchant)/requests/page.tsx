'use client';

import React, { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { FadeUp } from '@/components/animations/FadeUp';
import { Stagger } from '@/components/animations/Stagger';
import type { ScanRequestListResponse, ScanRequestRow } from '@/lib/api/merchant';
import { listScanRequests, approveScanRequest } from '@/lib/api/merchant';
import { useQuery } from '@/lib/api/cache';
import {
  AlertCircle,
  BellRing,
  Check,
  MapPin,
  Phone,
  RefreshCw,
  Smartphone,
  Tag,
  User,
} from 'lucide-react';

type Tab = 'PENDING' | 'APPROVED';

/** "just now" / "4m ago" / "2h ago" / "3d ago" for a request timestamp. */
function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Stamp Requests (Phase 9). Every customer QR scan opens a check-in here; the
 * merchant accepts it to grant the stamp, or leaves it (hold) — a merchant can
 * never reject a customer, so there is no reject control on this page.
 */
export default function RequestsPage() {
  const [tab, setTab] = useState<Tab>('PENDING');
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  /**
   * Phase 10: approving requires a signed proof from a registered device, so the
   * browser cannot do it. Once the API says so we stop offering the button
   * rather than letting the merchant retry a request that can never succeed.
   */
  const [needsApp, setNeedsApp] = useState(false);

  // One cache entry per tab: flipping Waiting <-> Approved and back repaints
  // the previous list instantly, then revalidates behind it.
  const { data, error, isLoading, refetch } = useQuery<ScanRequestListResponse>(
    `scan-requests:${tab}`,
    async () => {
      const res = await listScanRequests({ status: tab, pageSize: 50 });
      if (!res?.success) {
        throw new Error(res?.error?.message || 'Failed to load stamp requests');
      }
      return res.data as ScanRequestListResponse;
    },
    { ttl: 8_000 }
  );

  const loading = isLoading;
  const rows = data?.requests ?? [];
  const errorText = error instanceof Error ? error.message : error ? String(error) : '';
  /** Legacy call sites (`load(tab, silent)`) map onto a plain revalidate. */
  const load = async (..._args: unknown[]) => {
    await refetch();
  };
  // Poll the open queue so a new scan shows up without a manual refresh.
  // Only while the Waiting tab is what's on screen — the Approved list does not
  // need an 8s timer.
  useEffect(() => {
    if (tab !== 'PENDING') return;
    const t = window.setInterval(() => refetch(), 8_000);
    return () => window.clearInterval(t);
  }, [tab, refetch]);

  const approve = async (row: ScanRequestRow) => {
    if (approvingId) return;
    setApprovingId(row.id);
    setFlash(null);
    try {
      const res = await approveScanRequest(row.id);
      if (res?.success) {
        setFlash({
          tone: 'ok',
          text: `Stamp given to ${row.customerName || row.customerPhone}${
            res.data?.offerTitle ? ` · ${res.data.offerTitle}` : ''
          }`,
        });
        await load(tab, true);
      } else {
        const err = res?.error;
        const requiresApp =
          err?.code === 'APP_APPROVAL_REQUIRED' || err?.code === 'DEVICE_REVOKED';
        if (requiresApp) setNeedsApp(true);
        setFlash({
          tone: 'bad',
          text:
            err?.message ||
            'Could not approve that request.',
        });
        await load(tab, true);
      }
    } catch {
      setFlash({ tone: 'bad', text: 'Network error — try again.' });
    } finally {
      setApprovingId(null);
    }
  };

  const pendingCount = data?.pendingCount ?? 0;
  const showEmpty = !loading && !error && rows.length === 0;

  return (
    <div className="flex flex-col gap-space-lg">
      <FadeUp>
        <PageHeader
          title="Stamp Requests"
          meta="Every scan waits here for your confirmation. Accept it to give the stamp — or just hold it. You can never reject a customer."
          actions={
            pendingCount > 0 ? (
              <Badge tone="wine" uppercase>
                <BellRing className="w-3.5 h-3.5" />
                {pendingCount} waiting
              </Badge>
            ) : undefined
          }
        />
      </FadeUp>

      {/* Tabs + manual refresh */}
      <FadeUp>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-pill border border-hairline bg-surface-container-lowest p-1">
            {(['PENDING', 'APPROVED'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                className={`min-h-[44px] px-4 rounded-pill font-label-lg text-label-lg transition-colors ${
                  tab === value
                    ? 'bg-brand-green text-white shadow-inset-light'
                    : 'text-on-surface-variant hover:bg-surface-container-low'
                }`}
              >
                {value === 'PENDING' ? 'Waiting' : 'Approved'}
                {value === 'PENDING' && pendingCount > 0 ? ` (${pendingCount})` : ''}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => load(tab)}
            className="inline-flex items-center justify-center w-11 h-11 rounded-input text-on-surface-variant hover:bg-surface-container-high"
            aria-label="Refresh requests"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </FadeUp>

      {flash && (
        <p
          className={`font-body-sm text-body-sm font-medium flex items-center gap-1.5 ${
            flash.tone === 'ok' ? 'text-brand-green' : 'text-brand-red'
          }`}
          role="status"
        >
          {flash.tone === 'ok' ? (
            <Check className="w-4 h-4" />
          ) : (
            <AlertCircle className="w-4 h-4" />
          )}
          {flash.text}
        </p>
      )}

      {error != null && (
        <p
          className="font-body-sm text-body-sm text-brand-red font-medium flex items-center gap-1.5"
          role="alert"
        >
          <AlertCircle className="w-4 h-4" /> {errorText}
        </p>
      )}

      {/* Phase 10: approval is app-only, so the dashboard explains it instead
          of leaving a button that always fails. */}
      {needsApp && (
        <Card className="flex items-start gap-3 bg-surface-container-low border-hairline">
          <span className="w-9 h-9 rounded-full grid place-items-center bg-surface-container-lowest text-brand-green shrink-0">
            <Smartphone size={18} />
          </span>
          <div>
            <p className="font-label-lg text-label-lg text-on-surface">
              Approve stamps in the Loyl merchant app
            </p>
            <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
              Giving a stamp needs the registered device, so it can&apos;t be done from this
              dashboard. Open the app on your registered phone or tablet to accept these
              check-ins — you can still review and hold them here.
            </p>
          </div>
        </Card>
      )}

      {loading && (
        <div className="flex flex-col gap-space-sm" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-28 bg-surface-container-lowest rounded-card border border-hairline shadow-sm"
            />
          ))}
        </div>
      )}

      {showEmpty && (
        <Card className="flex flex-col items-start gap-2 bg-surface-container-low border-hairline">
          <p className="font-label-lg text-label-lg text-on-surface">
            {tab === 'PENDING' ? 'Nothing waiting right now' : 'No approvals yet'}
          </p>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            {tab === 'PENDING'
              ? 'When a customer scans your QR poster it appears here instantly, and you decide whether to give the stamp.'
              : 'Accepted check-ins show up here with the time you confirmed them.'}
          </p>
        </Card>
      )}

      {!loading && rows.length > 0 && (
        <Stagger className="flex flex-col gap-space-sm">
          {rows.map((row) => (
            <Card key={row.id} className="p-4 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`w-9 h-9 rounded-full grid place-items-center shrink-0 ${
                      row.status === 'PENDING'
                        ? 'bg-surface-container text-on-surface-variant'
                        : 'bg-primary-fixed text-on-primary-fixed'
                    }`}
                  >
                    {row.status === 'PENDING' ? <BellRing size={18} /> : <Check size={18} />}
                  </span>
                  <div className="min-w-0">
                    <p className="font-label-lg text-label-lg text-on-surface truncate flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-on-surface-variant shrink-0" />
                      <span className="truncate">{row.customerName || row.customerPhone}</span>
                    </p>
                    <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5 flex items-center gap-1.5 min-w-0">
                      {row.customerName && (
                        <span className="inline-flex items-center gap-1 shrink-0 tabular-nums">
                          <Phone className="w-3 h-3" />
                          {row.customerPhone}
                        </span>
                      )}
                      <span className="truncate">
                        {row.customerName ? '· ' : ''}
                        {row.status === 'PENDING' ? 'Scanned' : 'Approved'}{' '}
                        {timeAgo(
                          row.status === 'PENDING' ? row.createdAt : row.decidedAt || row.createdAt
                        )}
                        {row.branchName ? ` · ${row.branchName}` : ''}
                      </span>
                    </p>
                  </div>
                </div>
                {row.status === 'PENDING' ? (
                  <span className="px-2.5 py-1 rounded-pill font-label-sm text-label-sm uppercase bg-surface-container-high text-on-surface-variant shrink-0">
                    Waiting
                  </span>
                ) : (
                  <span className="px-2.5 py-1 rounded-pill font-label-sm text-label-sm uppercase bg-primary-fixed text-on-primary-fixed shrink-0">
                    Stamped
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 border-t border-hairline pt-2.5">
                <span className="inline-flex items-center gap-1.5 font-label-lg text-label-lg text-on-surface min-w-0">
                  <Tag className="w-4 h-4 text-brand-green shrink-0" />
                  <span className="truncate">{row.offer?.title || 'Stamp offer'}</span>
                </span>
                <span className="inline-flex items-center gap-1.5 font-body-sm text-body-sm text-on-surface-variant justify-end tabular-nums">
                  <MapPin className="w-4 h-4 shrink-0" />
                  {row.distanceMeters != null ? `${row.distanceMeters} m away` : 'No GPS check'}
                </span>
              </div>

              {row.status === 'PENDING' && (
                <Button
                  variant="primary"
                  className="w-full"
                  isLoading={approvingId === row.id}
                  disabled={approvingId !== null || needsApp}
                  onClick={() => approve(row)}
                >
                  {needsApp ? (
                    <>
                      <Smartphone className="w-4 h-4 mr-1.5" /> Approve in the Loyl app
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4 mr-1.5" /> Give stamp
                    </>
                  )}
                </Button>
              )}
            </Card>
          ))}
        </Stagger>
      )}
    </div>
  );
}
