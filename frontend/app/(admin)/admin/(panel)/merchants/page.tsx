'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FadeUp } from '@/components/animations/FadeUp';
import { StatusPill } from '@/components/admin/StatusPill';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { Pagination } from '@/components/admin/Pagination';
import {
  ADMIN_SESSION_ERRORS,
  type AdminMerchantRow,
  type AdminMerchantsResponse,
  adminMerchantAction,
  isoDay,
  listAdminMerchants,
} from '@/lib/api/admin';
import { AlertCircle, Ban, RefreshCw, Search, Users } from 'lucide-react';

type StatusFilter = 'PENDING' | 'ACTIVE' | 'EXPIRED' | undefined;

const ACTION_NOTICES: Record<string, (m: AdminMerchantRow) => string> = {
  activate: (m) =>
    `Subscription activated until ${m.subscriptionExpiresAt ? isoDay(m.subscriptionExpiresAt) : '—'}.`,
  expire: () => 'Subscription marked expired.',
  revoke: () => 'Subscription revoked — merchant is back to pending.',
  suspend: () => 'Merchant suspended — their dashboard access is blocked.',
  restore: () => 'Merchant restored.',
};

/** /admin/merchants — directory + subscription/suspension controls. */
export default function AdminMerchantsPage() {
  const router = useRouter();
  const [data, setData] = useState<AdminMerchantsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>(undefined);
  const [page, setPage] = useState(1);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRow, setConfirmRow] = useState<AdminMerchantRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listAdminMerchants({ q: q || undefined, status, page, pageSize: 20 });
      if (!res?.success) {
        if (ADMIN_SESSION_ERRORS.includes(res?.error?.code)) {
          router.replace('/admin/login');
          return;
        }
        setError(res?.error?.message || 'Failed to load merchants');
        return;
      }
      setData(res.data);
    } catch {
      setError('Network error — try again.');
    } finally {
      setLoading(false);
    }
  }, [q, status, page, router]);

  useEffect(() => {
    load();
  }, [load]);

  async function runAction(row: AdminMerchantRow, action: string) {
    setBusyId(row.id);
    setActionError(null);
    setNotice(null);
    try {
      const res = await adminMerchantAction(row.id, action as Parameters<typeof adminMerchantAction>[1]);
      if (!res?.success) {
        if (ADMIN_SESSION_ERRORS.includes(res?.error?.code)) {
          router.replace('/admin/login');
          return;
        }
        setActionError(res?.error?.message || 'Action failed');
        return;
      }
      const updated: AdminMerchantRow = res.data.merchant;
      setNotice(ACTION_NOTICES[action]?.(updated) ?? 'Saved.');
      await load();
    } catch {
      setActionError('Network error — try again.');
    } finally {
      setBusyId(null);
      setConfirmRow(null);
    }
  }

  function applySearch(event: React.FormEvent) {
    event.preventDefault();
    setPage(1);
    setQ(query.trim());
  }

  function applyStatus(next: StatusFilter) {
    setPage(1);
    setStatus(next);
    setActionError(null);
    setNotice(null);
  }

  const byStatus = data?.stats.byStatus;
  const totalCount = byStatus ? byStatus.ACTIVE + byStatus.PENDING + byStatus.EXPIRED : 0;
  const pills: { label: string; value: StatusFilter; count: number }[] = [
    { label: 'All', value: undefined, count: totalCount },
    { label: 'Active', value: 'ACTIVE', count: byStatus?.ACTIVE ?? 0 },
    { label: 'Pending', value: 'PENDING', count: byStatus?.PENDING ?? 0 },
    { label: 'Expired', value: 'EXPIRED', count: byStatus?.EXPIRED ?? 0 },
  ];

  return (
    <FadeUp>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-headline-md text-headline-md text-on-surface">Merchants</h1>
          <p className="mt-1 font-body-md text-body-md text-on-surface-variant">
            Search the directory, manage subscriptions, suspend or restore accounts.
          </p>
        </div>
        {(data?.stats.suspended ?? 0) > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-pill bg-error-container px-3 py-1 font-label-sm text-label-sm text-on-error-container">
            <Ban size={13} /> {data?.stats.suspended} suspended
          </span>
        )}
      </div>

      <Card className="p-space-md">
        <form onSubmit={applySearch} className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <Input
              label="Search"
              placeholder="Business name or phone…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Button type="submit" variant="primary" size="md">
            <Search size={16} />
            <span className="ml-1.5">Search</span>
          </Button>
        </form>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {pills.map((pill) => (
            <button
              key={pill.label}
              type="button"
              onClick={() => applyStatus(pill.value)}
              aria-pressed={status === pill.value}
              className={`rounded-pill border px-3.5 py-1.5 font-label-lg text-label-lg transition-colors ${
                status === pill.value
                  ? 'border-brand-green bg-brand-green text-white shadow-inset-light'
                  : 'border-brand-border bg-white text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
              }`}
            >
              {pill.label} ({pill.count})
            </button>
          ))}
        </div>
      </Card>

      {(notice || actionError) && (
        <div className="mt-4">
          {notice && (
            <p
              role="status"
              className="rounded-input border border-hairline bg-primary-fixed px-4 py-2.5 font-body-md text-body-md font-medium text-on-primary-fixed"
            >
              {notice}
            </p>
          )}
          {actionError && (
            <p
              role="alert"
              className="mt-2 flex items-center gap-2 rounded-input border border-hairline bg-error-container px-4 py-2.5 font-body-md text-body-md font-medium text-on-error-container"
            >
              <AlertCircle size={15} /> {actionError}
            </p>
          )}
        </div>
      )}

      <Card className="mt-space-md p-0">
        {loading && (
          <p className="p-6 font-body-sm text-body-sm text-on-surface-variant">
            Loading merchants…
          </p>
        )}

        {!loading && error && (
          <div className="p-6">
            <p className="flex items-center gap-2 font-body-md text-body-md font-medium text-brand-red">
              <AlertCircle size={16} /> {error}
            </p>
            <Button className="mt-3" variant="outline" size="sm" onClick={load}>
              <RefreshCw size={14} />
              <span className="ml-1.5">Retry</span>
            </Button>
          </div>
        )}

        {!loading && !error && data && data.merchants.length === 0 && (
          <div className="p-10 text-center">
            <span className="mx-auto mb-3 inline-flex h-11 w-11 items-center justify-center rounded-input bg-surface-container-high text-on-surface-variant">
              <Users size={20} />
            </span>
            <p className="font-label-lg text-label-lg text-on-surface">
              {q || status ? 'No merchants match your filters' : 'No merchants yet'}
            </p>
            <p className="mt-1 font-body-sm text-body-sm text-on-surface-variant">
              {q || status ? 'Try a different search or filter.' : 'Sign-ups will appear here.'}
            </p>
          </div>
        )}

        {!loading && !error && data && data.merchants.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline bg-surface-container-low/70 text-left font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
                  <th className="px-6 py-3">Merchant</th>
                  <th className="px-3 py-3">Phone</th>
                  <th className="px-3 py-3">Subscription</th>
                  <th className="px-3 py-3">Activity</th>
                  <th className="px-3 py-3">Joined</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {data.merchants.map((row) => {
                  const busy = busyId === row.id;
                  return (
                    <tr
                      key={row.id}
                      className={`transition-colors hover:bg-surface-container-low/60 ${
                        row.suspended ? 'bg-error-container/30' : ''
                      }`}
                    >
                      <td className="px-6 py-4">
                        <p className="font-label-lg text-label-lg text-on-surface">
                          {row.businessName}
                        </p>
                        <p className="mt-0.5 font-body-sm text-body-sm text-on-surface-variant">
                          {row.category}
                        </p>
                      </td>
                      <td className="px-3 py-4 font-body-md text-body-md text-on-surface tabular-nums">
                        {row.phoneNumber}
                      </td>
                      <td className="px-3 py-4">
                        <span className="flex flex-wrap items-center gap-1.5">
                          {row.suspended && <StatusPill status="SUSPENDED" />}
                          <StatusPill status={row.subscriptionStatus} />
                        </span>
                        <p className="mt-1 font-body-sm text-body-sm text-on-surface-variant tabular-nums">
                          {row.subscriptionStatus === 'ACTIVE' && row.subscriptionExpiresAt
                            ? `until ${isoDay(row.subscriptionExpiresAt)}`
                            : row.subscriptionStatus === 'EXPIRED'
                              ? 'expired'
                              : 'no expiry'}
                        </p>
                      </td>
                      <td className="px-3 py-4 font-body-sm text-body-sm text-on-surface-variant tabular-nums">
                        {row._count?.offers ?? 0} offers · {row._count?.branches ?? 0} branches ·{' '}
                        {row._count?.customerStamps ?? 0} cards
                      </td>
                      <td className="px-3 py-4 font-body-sm text-body-sm text-on-surface-variant tabular-nums">
                        {isoDay(row.createdAt)}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {row.suspended ? (
                            <Button
                              size="sm"
                              variant="primary"
                              disabled={busy}
                              isLoading={busy}
                              onClick={() => runAction(row, 'restore')}
                            >
                              Restore
                            </Button>
                          ) : (
                            <>
                              {row.subscriptionStatus !== 'ACTIVE' && (
                                <Button
                                  size="sm"
                                  variant="primary"
                                  disabled={busy}
                                  onClick={() => runAction(row, 'activate')}
                                >
                                  Activate
                                </Button>
                              )}
                              {row.subscriptionStatus === 'ACTIVE' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() => runAction(row, 'expire')}
                                >
                                  Expire
                                </Button>
                              )}
                              {row.subscriptionStatus !== 'PENDING' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() => runAction(row, 'revoke')}
                                >
                                  Revoke
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="accent"
                                disabled={busy}
                                onClick={() => setConfirmRow(row)}
                              >
                                Suspend
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {!loading && !error && data && (
        <Pagination
          page={data.pagination.page}
          totalPages={data.pagination.totalPages}
          total={data.pagination.total}
          noun="merchants"
          busy={loading}
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => p + 1)}
        />
      )}

      <ConfirmDialog
        open={!!confirmRow}
        danger
        title={`Suspend ${confirmRow?.businessName ?? ''}?`}
        description="They lose dashboard access immediately; data stays intact and you can restore anytime."
        confirmLabel="Suspend merchant"
        isBusy={!!busyId}
        onConfirm={() => {
          if (confirmRow) runAction(confirmRow, 'suspend');
        }}
        onCancel={() => setConfirmRow(null)}
      />
    </FadeUp>
  );
}
