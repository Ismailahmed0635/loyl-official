'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FadeUp } from '@/components/animations/FadeUp';
import { StatusPill } from '@/components/admin/StatusPill';
import {
  ADMIN_SESSION_ERRORS,
  type AdminStats,
  formatBdt,
  getAdminStats,
  isoDay,
} from '@/lib/api/admin';
import {
  AlertCircle,
  Ban,
  CreditCard,
  RefreshCw,
  ScanLine,
  Store,
  Ticket,
  Users,
  Wallet,
} from 'lucide-react';

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string | number;
  sub: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  tone: string;
}) {
  return (
    <Card className="p-4">
      <div className={`mb-3 inline-flex h-9 w-9 items-center justify-center rounded-input ${tone}`}>
        <Icon size={18} />
      </div>
      <p className="font-metric-num text-metric-num text-on-surface tabular-nums leading-none">
        {value}
      </p>
      <p className="mt-2 font-label-lg text-label-lg text-on-surface">{label}</p>
      <p className="mt-0.5 font-body-sm text-body-sm text-on-surface-variant">{sub}</p>
    </Card>
  );
}

/** /admin — platform overview: subscriptions, payments, and activity. */
export default function AdminDashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getAdminStats();
      if (!res?.success) {
        if (ADMIN_SESSION_ERRORS.includes(res?.error?.code)) {
          router.replace('/admin/login');
          return;
        }
        setError(res?.error?.message || 'Failed to load platform stats');
        return;
      }
      setStats(res.data);
    } catch {
      setError('Network error — try again.');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <FadeUp>
      <div className="mb-6">
        <h1 className="font-headline-md text-headline-md text-on-surface">Platform Overview</h1>
        <p className="mt-1 font-body-md text-body-md text-on-surface-variant">
          Merchants, subscriptions, and payment activity at a glance.
        </p>
      </div>

      {loading && (
        <p className="font-body-sm text-body-sm text-on-surface-variant">Loading platform stats…</p>
      )}

      {!loading && error && (
        <Card className="p-6">
          <div className="flex items-center justify-between gap-4">
            <p className="flex items-center gap-2 font-body-md text-body-md font-medium text-brand-red">
              <AlertCircle size={16} /> {error}
            </p>
            <Button variant="outline" size="sm" onClick={load}>
              <RefreshCw size={14} />
              <span className="ml-1.5">Retry</span>
            </Button>
          </div>
        </Card>
      )}

      {!loading && !error && stats && (
        <>
          <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2 xl:grid-cols-3">
            <StatCard
              label="Merchants"
              value={stats.merchants.total}
              sub={`${stats.merchants.subscriptions.ACTIVE} active · ${stats.merchants.subscriptions.PENDING} pending · ${stats.merchants.subscriptions.EXPIRED} expired`}
              icon={Store}
              tone="bg-primary-fixed text-on-primary-fixed"
            />
            <StatCard
              label="Suspended"
              value={stats.merchants.suspended}
              sub="accounts with access blocked"
              icon={Ban}
              tone="bg-error-container text-on-error-container"
            />
            <StatCard
              label="Pending payments"
              value={stats.payments.counts.PENDING ?? 0}
              sub={`${formatBdt(stats.payments.pendingAmount)} awaiting review`}
              icon={Wallet}
              tone="bg-surface-container-high text-on-surface-variant"
            />
            <StatCard
              label="Approved revenue"
              value={formatBdt(stats.payments.approvedAmount)}
              sub="lifetime collected"
              icon={CreditCard}
              tone="bg-primary-fixed text-on-primary-fixed"
            />
            <StatCard
              label="Live offers"
              value={stats.platform.offers}
              sub={`${stats.platform.branches} branches`}
              icon={Ticket}
              tone="bg-brand-amber/15 text-brand-amber"
            />
            <StatCard
              label="Customer cards"
              value={stats.platform.customerCards}
              sub={`${stats.platform.scansLast7d} scans last 7 days`}
              icon={Users}
              tone="bg-surface-container-high text-on-surface-variant"
            />
          </div>

          <div className="mt-space-md grid grid-cols-1 gap-space-md lg:grid-cols-2">
            <Card>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-headline-sm text-headline-sm text-on-surface">
                  Recent merchants
                </h2>
                <Button variant="ghost" size="sm" onClick={() => router.push('/admin/merchants')}>
                  View all
                </Button>
              </div>
              {stats.recentMerchants.length === 0 ? (
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  No merchants yet.
                </p>
              ) : (
                <ul className="divide-y divide-hairline">
                  {stats.recentMerchants.map((merchant) => (
                    <li key={merchant.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate font-label-lg text-label-lg text-on-surface">
                          {merchant.businessName}
                        </p>
                        <p className="mt-0.5 font-body-sm text-body-sm text-on-surface-variant tabular-nums">
                          {merchant.phoneNumber} · joined {isoDay(merchant.createdAt)}
                        </p>
                      </div>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {merchant.suspended && <StatusPill status="SUSPENDED" />}
                        <StatusPill status={merchant.subscriptionStatus} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-headline-sm text-headline-sm text-on-surface">
                  Pending payments
                </h2>
                <Button variant="ghost" size="sm" onClick={() => router.push('/admin/billing')}>
                  Review
                </Button>
              </div>
              {stats.recentPayments.length === 0 ? (
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  No pending payment requests. 🎉
                </p>
              ) : (
                <ul className="divide-y divide-hairline">
                  {stats.recentPayments.map((payment) => (
                    <li key={payment.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate font-label-lg text-label-lg text-on-surface">
                          {payment.merchant.businessName}
                        </p>
                        <p className="mt-0.5 font-body-sm text-body-sm text-on-surface-variant tabular-nums">
                          {payment.trxId ? `Trx ${payment.trxId}` : 'Free tier request'} ·{' '}
                          {isoDay(payment.createdAt)}
                        </p>
                      </div>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <StatusPill status={payment.paymentMethod} />
                        <span className="font-label-lg text-label-lg text-on-surface tabular-nums">
                          {formatBdt(payment.amount)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <p className="mt-6 flex items-center gap-1.5 font-label-sm text-label-sm text-on-surface-variant">
            <ScanLine size={13} />
            {stats.merchants.signupsLast7d} merchant signups in the last 7 days.
          </p>
        </>
      )}
    </FadeUp>
  );
}
