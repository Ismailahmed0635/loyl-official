'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { PageHeader } from '@/components/ui/PageHeader';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { FadeUp } from '@/components/animations/FadeUp';
import { Stagger } from '@/components/animations/Stagger';
import type { CustomerListResponse } from '@/lib/api/merchant';
import { listCustomers } from '@/lib/api/merchant';
import { useQuery } from '@/lib/api/cache';
import { AlertCircle, ChevronLeft, ChevronRight, Gift, QrCode, Search, Stamp, Users } from 'lucide-react';

const PAGE_SIZE = 20;

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toISOString().slice(0, 10);
}

export default function CustomersPage() {
  const router = useRouter();

  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [page, setPage] = useState(1);

  // Keyed by search + page: paging back to a page you already saw paints it
  // instantly instead of re-querying, and a new search only fetches its own key.
  const searchKey = `${submittedQuery}|${page}`;
  const { data, error, isLoading, refetch } = useQuery<CustomerListResponse>(
    `customers:${searchKey}`,
    async () => {
      const res = await listCustomers({
        q: submittedQuery || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      if (!res?.success) throw new Error(res?.error?.message || 'Failed to load customers');
      return res.data as CustomerListResponse;
    },
    { ttl: 20_000 }
  );

  const loading = isLoading;
  const rows = data?.customers ?? [];
  const errorText = error instanceof Error ? error.message : error ? String(error) : '';
  const errorShown = error != null;

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSubmittedQuery(query.trim().slice(0, 20));
  };

  const pagination = data?.pagination;
  const showEmpty = !loading && !errorShown && rows.length === 0;

  return (
    <div className="flex flex-col gap-space-lg">
      <FadeUp>
        <PageHeader
          title="Customers"
          eyebrow={
            data ? (
              <Badge tone="success">
                {data.stats.totalCustomers} customer{data.stats.totalCustomers === 1 ? '' : 's'}
              </Badge>
            ) : undefined
          }
          meta={
            data
              ? `${data.stats.totalCustomers} customer${data.stats.totalCustomers === 1 ? ' has' : 's have'} checked in at your shop${
                  submittedQuery ? ` · showing matches for “${submittedQuery}”` : ''
                }`
              : 'Everyone who checked in at your shop, by name and scan count.'
          }
        />
      </FadeUp>

      {/* Search */}
      <FadeUp>
        <form onSubmit={search} className="flex gap-2" role="search">
          <Input
            label="Search by name or phone"
            placeholder="e.g. 01712 or Rahim"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={40}
            className="flex-1"
          />
          <Button type="submit" variant="primary" size="md" isLoading={loading} className="self-end">
            <Search className="w-4 h-4 mr-1.5" /> Search
          </Button>
        </form>
      </FadeUp>

      {errorShown && (
        <p
          className="font-body-sm text-body-sm text-brand-red font-medium flex items-center gap-1.5"
          role="alert"
        >
          <AlertCircle className="w-4 h-4" /> {errorText}
        </p>
      )}

      {loading && (
        <div className="flex flex-col gap-space-sm" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-24 bg-surface-container-lowest rounded-card border border-hairline shadow-sm"
            />
          ))}
        </div>
      )}

      {showEmpty && (
        <Card className="flex flex-col items-start gap-2 bg-surface-container-low border-hairline">
          <p className="font-label-lg text-label-lg text-on-surface">
            {submittedQuery ? 'No customers match that search' : 'No customers yet'}
          </p>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            {submittedQuery
              ? 'Try a different phone fragment.'
              : 'Create an offer, print its QR poster, and customers appear here after their first scan.'}
          </p>
          {!submittedQuery && (
            <Button size="sm" variant="primary" onClick={() => router.push('/offers/new')}>
              Create Offer
            </Button>
          )}
        </Card>
      )}

      {!loading && rows.length > 0 && (
        <>
          <Stagger className="flex flex-col gap-space-sm">
            {rows.map((customer) => (
              <Card key={customer.id} className="p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-9 h-9 rounded-full bg-surface-container text-primary grid place-items-center shrink-0">
                      <Users size={18} />
                    </span>
                    <div className="min-w-0">
                      {/* Phase 12: the name the customer gave at check-in. Cards
                          granted before name capture (or a customer who never
                          supplied one) fall back to the phone alone rather than
                          pretending they have a name. */}
                      <p className="font-label-lg text-label-lg text-on-surface truncate">
                        {customer.customerName || 'Unnamed customer'}
                      </p>
                      <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5 tabular-nums truncate">
                        {customer.customerPhone}
                      </p>
                      <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5 tabular-nums">
                        First visit {formatDate(customer.createdAt)} · Last visit{' '}
                        {formatDate(customer.lastScannedAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    {/* Phase 12: a check-in waiting on the merchant is surfaced
                        on the customer so it cannot be missed from either list. */}
                    {customer.pendingCount > 0 && (
                      <Badge tone="wine">
                        {customer.pendingCount} waiting
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 border-t border-hairline pt-2.5">
                  <span className="inline-flex items-center gap-1.5 font-label-lg text-label-lg text-on-surface">
                    <QrCode className="w-4 h-4 text-primary" />
                    <span className="tabular-nums">
                      {customer.scanCount} scan{customer.scanCount === 1 ? '' : 's'}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-label-lg text-label-lg text-on-surface justify-center">
                    <Stamp className="w-4 h-4 text-brand-green" />
                    <span className="tabular-nums">
                      {customer.stampsCollected} stamp{customer.stampsCollected === 1 ? '' : 's'}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-label-lg text-label-lg text-on-surface justify-end">
                    <Gift className="w-4 h-4 text-brand-red" />
                    <span className="tabular-nums">
                      {customer.totalRedeemed} reward{customer.totalRedeemed === 1 ? '' : 's'}
                    </span>
                  </span>
                </div>
              </Card>
            ))}
          </Stagger>

          {pagination && pagination.totalPages > 1 && (
            <nav className="flex items-center justify-between" aria-label="Customer pages">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="w-4 h-4 mr-1" /> Prev
              </Button>
              <span className="font-body-sm text-body-sm text-on-surface-variant tabular-nums">
                Page {pagination.page} of {pagination.totalPages} · {pagination.total} total
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
