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
  type AdminPaymentRow,
  type AdminPaymentsResponse,
  type AdminTier,
  approvePayment,
  fetchPaymentScreenshot,
  formatBdt,
  isoDay,
  listAdminPayments,
  rejectPayment,
} from '@/lib/api/admin';
import { TIER_LABELS, planFor } from '@/lib/api/payments';
import { AlertCircle, Eye, Receipt, RefreshCw, Search } from 'lucide-react';

type StatusTab = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL';

const TABS: { label: string; value: StatusTab }[] = [
  { label: 'Pending', value: 'PENDING' },
  { label: 'Approved', value: 'APPROVED' },
  { label: 'Rejected', value: 'REJECTED' },
  { label: 'All', value: 'ALL' },
];

const TIER_OPTIONS: AdminTier[] = ['FREE', 'MONTHLY', 'YEARLY', 'PREMIUM'];

/** /admin/billing — BUILD.md payment verification table (bKash/Nagad). */
export default function AdminBillingPage() {
  const router = useRouter();
  const [data, setData] = useState<AdminPaymentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusTab>('PENDING');
  const [page, setPage] = useState(1);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [shotLoadingId, setShotLoadingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'approve' | 'reject'; row: AdminPaymentRow } | null>(
    null
  );
  /** Tier the admin assigns when confirming an approval (Phase 7). */
  const [tierChoice, setTierChoice] = useState<AdminTier>('MONTHLY');
  const [lightbox, setLightbox] = useState<{ url: string; title: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listAdminPayments({ status, q: q || undefined, page, pageSize: 20 });
      if (!res?.success) {
        if (ADMIN_SESSION_ERRORS.includes(res?.error?.code)) {
          router.replace('/admin/login');
          return;
        }
        setError(res?.error?.message || 'Failed to load payments');
        return;
      }
      setData(res.data);
    } catch {
      setError('Network error — try again.');
    } finally {
      setLoading(false);
    }
  }, [status, q, page, router]);

  useEffect(() => {
    load();
  }, [load]);

  function openConfirm(kind: 'approve' | 'reject', row: AdminPaymentRow) {
    setTierChoice(row.requestedTier);
    setConfirm({ kind, row });
  }

  async function runDecision(kind: 'approve' | 'reject', row: AdminPaymentRow) {
    setBusyId(row.id);
    setActionError(null);
    setNotice(null);
    try {
      const res =
        kind === 'approve' ? await approvePayment(row.id, tierChoice) : await rejectPayment(row.id);
      if (!res?.success) {
        if (ADMIN_SESSION_ERRORS.includes(res?.error?.code)) {
          router.replace('/admin/login');
          return;
        }
        setActionError(res?.error?.message || 'Action failed');
        return;
      }
      if (kind === 'approve') {
        const until = res.data.merchant?.subscriptionExpiresAt;
        const granted = TIER_LABELS[tierChoice];
        setNotice(
          `Payment approved — ${res.data.merchant?.businessName ?? 'merchant'} granted ${granted} ${
            until ? `until ${isoDay(until)}.` : '(no expiry).'
          }${res.data.deletedScreenshot ? ' Screenshot deleted.' : ''}`
        );
      } else {
        setNotice(
          `Payment rejected.${res.data.deletedScreenshot ? ' Screenshot deleted.' : ''} The subscription was not changed.`
        );
      }
      await load();
    } catch {
      setActionError('Network error — try again.');
    } finally {
      setBusyId(null);
      setConfirm(null);
    }
  }

  async function viewScreenshot(row: AdminPaymentRow) {
    setShotLoadingId(row.id);
    setActionError(null);
    try {
      const blob = await fetchPaymentScreenshot(row.id);
      if (!blob) {
        setActionError('Screenshot unavailable (it may already be reviewed).');
        return;
      }
      setLightbox({
        url: URL.createObjectURL(blob),
        title: `${row.merchant.businessName} — ${row.trxId ?? 'free tier request'}`,
      });
    } catch {
      setActionError('Screenshot unavailable.');
    } finally {
      setShotLoadingId(null);
    }
  }

  function closeLightbox() {
    if (lightbox) URL.revokeObjectURL(lightbox.url);
    setLightbox(null);
  }

  function applySearch(event: React.FormEvent) {
    event.preventDefault();
    setPage(1);
    setQ(query.trim());
  }

  function applyStatus(next: StatusTab) {
    setPage(1);
    setStatus(next);
    setActionError(null);
    setNotice(null);
  }

  const counts = data?.stats.counts;
  const totalCount = counts ? (counts.PENDING ?? 0) + (counts.APPROVED ?? 0) + (counts.REJECTED ?? 0) : 0;
  const confirmPlan = confirm ? planFor(tierChoice) : null;

  return (
    <FadeUp>
      <div className="mb-6">
        <h1 className="font-headline-md text-headline-md text-on-surface">Billing</h1>
        <p className="mt-1 font-body-md text-body-md text-on-surface-variant">
          Verify bKash/Nagad transfers — approving grants the tier you select and deletes the
          uploaded screenshot.
        </p>
      </div>

      <Card className="p-space-md">
        <form onSubmit={applySearch} className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <Input
              label="Search"
              placeholder="Trx ID, sender number, or merchant…"
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
          {TABS.map((tab) => {
            const count =
              tab.value === 'ALL'
                ? totalCount
                : counts?.[tab.value] ?? 0;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => applyStatus(tab.value)}
                aria-pressed={status === tab.value}
                className={`rounded-pill border px-3.5 py-1.5 font-label-lg text-label-lg transition-colors ${
                  status === tab.value
                    ? 'border-brand-green bg-brand-green text-white shadow-inset-light'
                    : 'border-brand-border bg-white text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
                }`}
              >
                {tab.label} ({count})
              </button>
            );
          })}
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
            Loading payments…
          </p>
        )}

        {!loading && error && (
          <div className="p-6">
            <p className="flex items-center gap-2 font-body-md text-body-md font-semibold text-brand-red">
              <AlertCircle size={16} /> {error}
            </p>
            <Button className="mt-3" variant="outline" size="sm" onClick={load}>
              <RefreshCw size={14} />
              <span className="ml-1.5">Retry</span>
            </Button>
          </div>
        )}

        {!loading && !error && data && data.payments.length === 0 && (
          <div className="p-10 text-center">
            <span className="mx-auto mb-3 inline-flex h-11 w-11 items-center justify-center rounded-input bg-surface-container-high text-on-surface-variant">
              <Receipt size={20} />
            </span>
            <p className="font-label-lg text-label-lg text-on-surface">
              {q || status !== 'PENDING' ? 'No payments match this view' : 'No pending payments'}
            </p>
            <p className="mt-1 font-body-sm text-body-sm text-on-surface-variant">
              {q || status !== 'PENDING'
                ? 'Try a different search or tab.'
                : 'New bKash/Nagad requests will appear here for review.'}
            </p>
          </div>
        )}

        {!loading && !error && data && data.payments.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline bg-surface-container-low/70 text-left font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
                  <th className="px-5 py-3">Merchant</th>
                  <th className="px-3 py-3">Tier</th>
                  <th className="px-3 py-3">Method</th>
                  <th className="px-3 py-3">Payment</th>
                  <th className="px-3 py-3">Amount</th>
                  <th className="px-3 py-3">Screenshot</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {data.payments.map((row) => {
                  const busy = busyId === row.id;
                  return (
                    <tr
                      key={row.id}
                      className="transition-colors hover:bg-surface-container-low/60"
                    >
                      <td className="px-5 py-4">
                        <p className="font-label-lg text-label-lg text-on-surface">
                          {row.merchant.businessName}
                        </p>
                        <p className="mt-0.5 font-body-sm text-body-sm text-on-surface-variant tabular-nums">
                          {row.merchant.phoneNumber} · {isoDay(row.createdAt)}
                        </p>
                      </td>
                      <td className="px-3 py-4">
                        <span className="inline-block rounded-pill border border-hairline bg-surface-container-high px-2.5 py-1 font-label-sm text-label-sm text-on-surface">
                          {TIER_LABELS[row.requestedTier]}
                        </span>
                      </td>
                      <td className="px-3 py-4">
                        <StatusPill
                          status={row.paymentMethod}
                          label={row.paymentMethod === 'BKASH' ? 'bKash' : 'Nagad'}
                        />
                      </td>
                      <td className="px-3 py-4 text-on-surface-variant">
                        {row.trxId ? (
                          <>
                            <p className="font-body-sm text-body-sm tabular-nums">
                              {row.senderNumber}
                            </p>
                            <p className="font-mono text-xs text-on-surface-variant">{row.trxId}</p>
                          </>
                        ) : (
                          <span className="font-body-sm text-body-sm">Free tier — no transfer</span>
                        )}
                      </td>
                      <td className="px-3 py-4 font-label-lg text-label-lg text-on-surface tabular-nums">
                        {formatBdt(row.amount)}
                      </td>
                      <td className="px-3 py-4">
                        {row.hasScreenshot ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={shotLoadingId === row.id}
                            onClick={() => viewScreenshot(row)}
                          >
                            <Eye size={13} className="mr-1" />
                            {shotLoadingId === row.id ? '…' : 'View'}
                          </Button>
                        ) : (
                          <span className="font-body-sm text-body-sm text-on-surface-variant">—</span>
                        )}
                      </td>
                      <td className="px-3 py-4">
                        <StatusPill status={row.status} />
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-1.5">
                          {row.status === 'PENDING' ? (
                            <>
                              <Button
                                size="sm"
                                variant="primary"
                                disabled={busy}
                                onClick={() => openConfirm('approve', row)}
                              >
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="accent"
                                disabled={busy}
                                onClick={() => openConfirm('reject', row)}
                              >
                                Reject
                              </Button>
                            </>
                          ) : (
                            <span className="font-body-sm text-body-sm text-on-surface-variant">
                              Reviewed
                            </span>
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
          noun="payment requests"
          busy={loading}
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => p + 1)}
        />
      )}

      <ConfirmDialog
        open={!!confirm}
        danger={confirm?.kind === 'reject'}
        title={
          confirm
            ? `${confirm.kind === 'approve' ? 'Approve' : 'Reject'} payment from ${confirm.row.merchant.businessName}?`
            : ''
        }
        description={
          confirm
            ? confirm.kind === 'approve'
              ? `Confirms the ${formatBdt(confirm.row.amount)} ${
                  confirm.row.paymentMethod === 'BKASH' ? 'bKash' : 'Nagad'
                } payment (Trx ${confirm.row.trxId ?? '—'}) and grants ${TIER_LABELS[tierChoice]} access${
                  confirmPlan?.durationDays
                    ? ` for ${confirmPlan.durationDays} days`
                    : ' with no expiry'
                }. Any uploaded screenshot is deleted.`
              : `Marks the ${formatBdt(confirm.row.amount)} payment as rejected. The subscription stays unchanged, the screenshot is deleted, and this cannot be undone.`
            : ''
        }
        confirmLabel={confirm?.kind === 'approve' ? 'Approve & grant tier' : 'Reject payment'}
        isBusy={!!busyId}
        onConfirm={() => {
          if (confirm) runDecision(confirm.kind, confirm.row);
        }}
        onCancel={() => setConfirm(null)}
      >
        {confirm?.kind === 'approve' && (
          <div>
            <label
              htmlFor="approve-tier"
              className="font-label-lg text-label-lg text-on-surface"
            >
              Assign tier
            </label>
            <select
              id="approve-tier"
              value={tierChoice}
              onChange={(event) => setTierChoice(event.target.value as AdminTier)}
              className="mt-1.5 w-full min-h-[44px] px-3 py-2.5 bg-white border border-brand-border rounded-input font-body-md text-body-md text-on-surface focus:outline-none focus:border-brand-green focus:ring-1 focus:ring-brand-green"
            >
              {TIER_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {TIER_LABELS[value]}
                  {value !== 'FREE' ? ` — ৳${planFor(value).priceBdt.toLocaleString('en-US')}` : ''}
                </option>
              ))}
            </select>
          </div>
        )}
      </ConfirmDialog>

      {/* Screenshot lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-inverse-surface/70 p-4"
          onClick={closeLightbox}
        >
          <div
            className="w-full max-w-2xl overflow-hidden rounded-xl bg-surface-container-lowest p-4 shadow-ambient border border-hairline"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 pb-3">
              <p className="truncate font-headline-sm text-headline-sm text-on-surface">
                {lightbox.title}
              </p>
              <Button size="sm" variant="secondary" onClick={closeLightbox}>
                Close
              </Button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightbox.url}
              alt="Uploaded transaction screenshot"
              className="mx-auto max-h-[72vh] rounded-input"
            />
          </div>
        </div>
      )}
    </FadeUp>
  );
}
