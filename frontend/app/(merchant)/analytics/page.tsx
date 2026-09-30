'use client';

import React, { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { FadeUp } from '@/components/animations/FadeUp';
import { Stagger } from '@/components/animations/Stagger';
import { AnalyticsChart } from '@/components/merchant/AnalyticsChart';
import type { AnalyticsResponse, OfferPerformance } from '@/lib/api/merchant';
import { analyticsCsvUrl, getAnalytics } from '@/lib/api/merchant';
import { useQuery } from '@/lib/api/cache';
import {
  AlertCircle,
  Download,
  Gift,
  QrCode,
  RefreshCw,
  Users,
} from 'lucide-react';

const DAY_MS = 24 * 60 * 60 * 1000;
const PRESET_DAYS = [7, 30, 90] as const;
const MAX_RANGE_DAYS = 366;

type SeriesKey = 'scans' | 'newCustomers' | 'redeems' | 'scratchReveals' | 'diceRolls';

// Bar fills are SVG colours, so they carry the token values directly:
// Royal Green, on-surface-variant, surface-tint — matching the design legend.
// Amber stays reserved for scratch, and dice keeps its own hue so the two
// never blur.
const SERIES_OPTIONS: { key: SeriesKey; label: string; color: string }[] = [
  { key: 'scans', label: 'Scans', color: '#0D472A' },
  { key: 'newCustomers', label: 'New customers', color: '#414942' },
  { key: 'redeems', label: 'Rewards redeemed', color: '#336949' },
  { key: 'diceRolls', label: 'Dice rolls', color: '#4F46E5' },
  { key: 'scratchReveals', label: 'Scratch reveals', color: '#F59E0B' },
];

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function presetRange(days: number): { from: string; to: string } {
  const to = new Date();
  return { from: dateKey(new Date(to.getTime() - (days - 1) * DAY_MS)), to: dateKey(to) };
}

function rangeErrorOf(range: { from: string; to: string }): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(range.from) || !/^\d{4}-\d{2}-\d{2}$/.test(range.to)) {
    return 'Pick both dates';
  }
  if (range.from > range.to) return 'From must be on or before To';
  const days =
    Math.floor((Date.parse(`${range.to}T00:00:00.000Z`) - Date.parse(`${range.from}T00:00:00.000Z`)) / DAY_MS) + 1;
  if (days > MAX_RANGE_DAYS) return `Range cannot exceed ${MAX_RANGE_DAYS} days`;
  return null;
}

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  sub: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  tone: string;
}) {
  return (
    <Card className="p-4 flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-2">
        <p className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
          {label}
        </p>
        <span
          className={`inline-flex items-center justify-center w-9 h-9 rounded-lg shrink-0 ${tone}`}
        >
          <Icon size={18} />
        </span>
      </div>
      <p className="font-metric-num text-metric-num text-brand-green tabular-nums leading-none">
        {value}
      </p>
      <p className="font-body-sm text-body-sm text-on-surface-variant">{sub}</p>
    </Card>
  );
}

/**
 * Dice offers only ever produce rolls, so their card shows the two numbers
 * that matter instead of three zeros — the grid switches with it.
 */
function offerStats(offer: OfferPerformance): { label: string; value: number }[] {
  if (offer.offerType === 'DICE') {
    return [
      { label: 'Rolled', value: offer.diceRolls },
      { label: 'Visitors', value: offer.uniqueVisitors },
    ];
  }
  return [
    { label: 'Scans', value: offer.scans },
    { label: 'Redeemed', value: offer.redeems },
    { label: 'Scratched', value: offer.scratchReveals },
    { label: 'Visitors', value: offer.uniqueVisitors },
  ];
}

const OFFER_TYPE_PILL: Record<OfferPerformance['offerType'], { label: string; className: string }> = {
  STAMP: { label: 'Stamp', className: 'bg-primary-fixed text-on-primary-fixed' },
  SCRATCH: { label: 'Scratch', className: 'bg-amber-50 text-amber-700' },
  DICE: { label: 'Dice', className: 'bg-indigo-50 text-indigo-700' },
};

export default function AnalyticsPage() {
  const [range, setRange] = useState(() => presetRange(30));
  const [preset, setPreset] = useState<number | null>(30);
  const [rangeError, setRangeError] = useState('');
  const [seriesKey, setSeriesKey] = useState<SeriesKey>('scans');

  // Keyed by range: switching back to a preset you already viewed repaints the
  // previous series instantly instead of re-reading the endpoint.
  const rangeKey = `${range.from}:${range.to}`;
  const { data, error, isLoading, refetch } = useQuery<AnalyticsResponse>(
    `analytics:${rangeKey}`,
    async () => {
      const res = await getAnalytics(range);
      if (!res?.success) {
        throw new Error(res?.error?.message || 'Failed to load analytics');
      }
      return res.data as AnalyticsResponse;
    },
    { ttl: 30_000 }
  );

  const loading = isLoading;
  const load = refetch;

  const applyPreset = (days: number) => {
    setPreset(days);
    setRangeError('');
    setRange(presetRange(days));
  };

  const applyCustom = (field: 'from' | 'to', value: string) => {
    const next = { ...range, [field]: value };
    const problem = rangeErrorOf(next);
    setRangeError(problem || '');
    if (problem) return;
    setPreset(null);
    setRange(next);
  };

  const seriesOption = SERIES_OPTIONS.find((opt) => opt.key === seriesKey) || SERIES_OPTIONS[0];
  const totals = data?.totals;
  const hasActivity =
    !!totals &&
    totals.scans +
      totals.redeems +
      totals.scratchReveals +
      totals.diceRolls +
      totals.newCustomers +
      totals.reviewBonuses >
      0;

  return (
    <div className="flex flex-col gap-space-lg">
      <FadeUp>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-headline-md text-headline-md text-on-surface">Analytics</h1>
            <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
              Scans, new vs. returning customers, and reward performance over time.
            </p>
          </div>
          <a
            href={analyticsCsvUrl(range)}
            download
            className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-lg bg-surface-container-lowest border border-hairline shadow-hairline text-on-surface font-label-lg text-label-lg hover:bg-surface-container-low transition-colors focus:outline-none focus:ring-2 focus:ring-brand-green"
            aria-label="Export the selected range as CSV"
          >
            <Download className="w-4 h-4 text-on-surface-variant" /> Export CSV
          </a>
        </div>
      </FadeUp>

      {/* Date range filter: presets + custom from/to */}
      <FadeUp>
        <Card className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant mr-1">
              Date range
            </span>
            {PRESET_DAYS.map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => applyPreset(days)}
                aria-pressed={preset === days}
                className={`min-h-[44px] px-4 rounded-pill font-label-md text-label-md border transition-colors focus:outline-none focus:ring-2 focus:ring-brand-green ${
                  preset === days
                    ? 'bg-brand-green text-white border-brand-green shadow-inset-light'
                    : 'bg-surface-container-lowest text-on-surface-variant border-hairline hover:bg-surface-container-low'
                }`}
              >
                {days} days
              </button>
            ))}
            {preset === null && (
              <span className="px-2.5 py-1 rounded-pill font-label-sm text-label-sm uppercase bg-primary-fixed text-on-primary-fixed">
                Custom
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="From"
              type="date"
              value={range.from}
              max={range.to || undefined}
              onChange={(e) => applyCustom('from', e.target.value)}
            />
            <Input
              label="To"
              type="date"
              value={range.to}
              min={range.from || undefined}
              onChange={(e) => applyCustom('to', e.target.value)}
            />
          </div>
          {rangeError && (
            <p className="font-body-sm text-body-sm text-brand-red font-medium" role="alert">
              {rangeError}
            </p>
          )}
        </Card>
      </FadeUp>

      {error != null && (
        <Card className="flex flex-col items-start gap-3">
          <div className="flex items-center gap-2 text-brand-red">
            <AlertCircle className="w-5 h-5" />
            <p className="font-body-md text-body-md font-medium">
              {error instanceof Error ? error.message : String(error)}
            </p>
          </div>
          <button
            onClick={() => refetch()}
            className="min-h-[44px] px-4 rounded-input bg-brand-green text-white text-sm font-semibold shadow-inset-light hover:bg-brand-greenDark transition-colors"
          >
            Try again
          </button>
        </Card>
      )}

      {loading && !error && (
        <div className="grid grid-cols-2 gap-space-sm" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 bg-surface-container-lowest rounded-card border border-hairline shadow-hairline" />
          ))}
          <div className="col-span-2 h-56 bg-surface-container-lowest rounded-card border border-hairline shadow-hairline" />
        </div>
      )}

      {!loading && !error && totals && (
        <>
          {/* KPI cards (LOYLS §2 dashboard metrics) */}
          <Stagger className="grid grid-cols-2 gap-space-sm">
            <StatCard
              label="Scans"
              value={totals.scans}
              sub={`${totals.reviewBonuses} review bonuses`}
              icon={QrCode}
              tone="text-brand-green bg-primary-fixed/60"
            />
            <StatCard
              label="New Customers"
              value={totals.newCustomers}
              sub={`${totals.uniqueVisitors} unique visitors`}
              icon={Users}
              tone="text-brand-green bg-primary-fixed/60"
            />
            <StatCard
              label="Returning"
              value={totals.returningCustomers}
              sub="active before this range"
              icon={RefreshCw}
              tone="text-on-surface-variant bg-surface-container-high"
            />
            <StatCard
              label="Rewards Redeemed"
              value={totals.redeems}
              sub={`${totals.redemptionRate}% redemption rate`}
              icon={Gift}
              tone="text-brand-green bg-primary-fixed/60"
            />
          </Stagger>

          {/* Daily chart */}
          <FadeUp>
            <section className="flex flex-col gap-3" aria-labelledby="chart-heading">
              <div className="flex items-center justify-between gap-2">
                <h2 id="chart-heading" className="font-headline-sm text-headline-sm text-on-surface">
                  Daily activity
                </h2>
                <span className="font-label-sm text-label-sm text-on-surface-variant tabular-nums">
                  {data?.range.from} → {data?.range.to}
                </span>
              </div>
              <Card className="flex flex-col gap-4">
                <div className="flex flex-wrap gap-2" role="group" aria-label="Chart series">
                  {SERIES_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setSeriesKey(opt.key)}
                      aria-pressed={seriesKey === opt.key}
                      className={`inline-flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-pill font-label-md text-label-md border transition-colors focus:outline-none focus:ring-2 focus:ring-brand-green ${
                        seriesKey === opt.key
                          ? 'bg-surface-container-high text-on-surface border-hairline'
                          : 'bg-surface-container-lowest text-on-surface-variant border-hairline hover:bg-surface-container-low'
                      }`}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: opt.color }}
                        aria-hidden="true"
                      />
                      {opt.label}
                    </button>
                  ))}
                </div>
                <AnalyticsChart
                  points={(data?.series || []).map((point) => ({
                    date: point.date,
                    value: point[seriesOption.key],
                  }))}
                  seriesLabel={seriesOption.label}
                  color={seriesOption.color}
                />
              </Card>
            </section>
          </FadeUp>

          {/* Offer performance */}
          <FadeUp>
            <section className="flex flex-col gap-3" aria-labelledby="offers-perf-heading">
              <div className="flex items-center justify-between gap-2">
                <h2 id="offers-perf-heading" className="font-headline-sm text-headline-sm text-on-surface">
                  Offer performance
                </h2>
              </div>
              {data && data.offers.length === 0 ? (
                <Card className="flex flex-col items-start gap-2 bg-amber-50/50 border-amber-200">
                  <p className="font-label-lg text-label-lg text-on-surface">No activity in this range</p>
                  <p className="font-body-sm text-body-sm text-on-surface-variant">
                    {hasActivity
                      ? 'Try a wider date range to see per-offer numbers.'
                      : 'Print a QR poster and share it — scans will show up here within minutes.'}
                  </p>
                </Card>
              ) : (
                <Stagger className="flex flex-col gap-space-sm">
                  {(data?.offers || []).map((offer) => {
                    const pill = OFFER_TYPE_PILL[offer.offerType];
                    const stats = offerStats(offer);
                    return (
                      <Card key={offer.offerId} className="p-4 flex flex-col gap-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-headline-sm text-headline-sm text-on-surface truncate">
                            {offer.title}
                          </p>
                          <span
                            className={`px-2.5 py-1 rounded-pill font-label-sm text-label-sm uppercase shrink-0 ${pill.className}`}
                          >
                            {pill.label}
                          </span>
                        </div>
                        <div
                          className={`grid gap-2 text-center bg-surface-container-low rounded-lg p-3 ${
                            stats.length > 2 ? 'grid-cols-4' : 'grid-cols-2'
                          }`}
                        >
                          {stats.map((stat) => (
                            <div key={stat.label}>
                              <p className="font-metric-num text-metric-num text-on-surface tabular-nums leading-tight">
                                {stat.value}
                              </p>
                              <p className="font-label-sm text-label-sm text-on-surface-variant mt-0.5">
                                {stat.label}
                              </p>
                            </div>
                          ))}
                        </div>
                      </Card>
                    );
                  })}
                </Stagger>
              )}
            </section>
          </FadeUp>
        </>
      )}
    </div>
  );
}
