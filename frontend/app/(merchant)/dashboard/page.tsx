'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import type { Offer } from '@prisma/client';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { IconTile } from '@/components/ui/IconTile';
import { FadeUp } from '@/components/animations/FadeUp';
import { Stagger } from '@/components/animations/Stagger';
import { progressFill } from '@/lib/motion/variants';
import type { MerchantStats, StatsResponse, OfferWithItems } from '@/lib/api/merchant';
import { getMerchantStats, listOffers } from '@/lib/api/merchant';
import { useQuery } from '@/lib/api/cache';
import { REWARD_TYPES } from '@/lib/constants';
import { discountRange, normalizeDiceCount } from '@/lib/dice';
import {
  Tag,
  Store,
  Users,
  Stamp,
  Plus,
  MapPin,
  QrCode,
  Pencil,
  AlertCircle,
  BookOpen,
  BadgeCheck,
} from 'lucide-react';

// Re-exported animation wrappers live in components/animations (FadeUp, Stagger).

const REWARD_LABEL: Record<string, string> = Object.fromEntries(
  REWARD_TYPES.map((rt) => [rt.value, rt.label])
);

/** Resolved shape of the dashboard cache entry (`stats` + `offers` together). */
interface DashboardPayload {
  stats: MerchantStats;
  businessName: string;
  category: string;
  offers: OfferWithItems[];
}

function daysLeft(offer: Offer): number {
  const created = new Date(offer.createdAt).getTime();
  const expires = created + offer.durationDays * 24 * 60 * 60 * 1000;
  return Math.ceil((expires - Date.now()) / (24 * 60 * 60 * 1000));
}

/** Dashboard subtitle for a dice offer: count, discount window, duration. */
function diceSummary(offer: Pick<Offer, 'diceCount' | 'durationDays'>): string {
  const diceCount = normalizeDiceCount(offer.diceCount);
  const range = discountRange(diceCount);
  return `${diceCount} dice · ${range.min}–${range.max}% off · ${offer.durationDays} days`;
}

function timeProgress(offer: Offer): number {
  const total = offer.durationDays * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(total) || total <= 0) return 100;
  const elapsed = Date.now() - new Date(offer.createdAt).getTime();
  return Math.round(Math.min(100, Math.max(0, (elapsed / total) * 100)));
}

/** Sovereign Green progress badge: 11px uppercase, deep-tinted fill. */
function OfferStatusPill({ offer }: { offer: Offer }) {
  const left = daysLeft(offer);
  if (!offer.isActive) {
    return (
      <Badge tone="neutral" uppercase>
        Paused
      </Badge>
    );
  }
  if (left <= 0) {
    return (
      <Badge tone="wine" uppercase>
        Ended
      </Badge>
    );
  }
  return (
    <Badge tone="success" uppercase dot>
      Live
    </Badge>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const shouldReduceMotion = useReducedMotion();

  // Stale-while-revalidate: revisit /dashboard and the previous numbers paint
  // immediately while the two requests revalidate behind them (lib/api/cache).
  const { data, error, isLoading, refetch } = useQuery<DashboardPayload>(
    'dashboard',
    async () => {
      const [statsRes, offersRes] = await Promise.all([getMerchantStats(), listOffers()]);
      if (!statsRes?.success) {
        throw new Error(statsRes?.error?.message || 'Failed to load dashboard');
      }
      const payload = statsRes.data as StatsResponse;
      return {
        stats: payload.stats,
        businessName: payload.merchant.businessName,
        category: payload.merchant.category,
        offers: offersRes?.success ? (offersRes.data.offers as OfferWithItems[]) : [],
      };
    },
    { ttl: 15_000 }
  );

  const stats = data?.stats ?? null;
  const businessName = data?.businessName ?? '';
  const category = data?.category ?? '';
  const offers = data?.offers ?? [];
  const loading = isLoading;
  const load = refetch;

  if (loading) {
    return (
        <div className="flex flex-col gap-space-lg" aria-busy="true">
          <div className="h-24 bg-surface-container-lowest rounded-xl border border-hairline shadow-sm" />
        <div className="grid grid-cols-2 gap-space-sm">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 bg-surface-container-lowest rounded-card border border-hairline shadow-sm" />
          ))}
        </div>
        <div className="h-32 bg-surface-container-lowest rounded-card border border-hairline shadow-sm" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="flex flex-col items-start gap-3">
        <div className="flex items-center gap-2 text-brand-red">
          <AlertCircle className="w-5 h-5" />
          <p className="text-sm font-medium">{error instanceof Error ? error.message : String(error)}</p>
        </div>
        <button
          onClick={load}
          className="min-h-[44px] px-4 rounded-input bg-brand-green text-white text-sm font-semibold"
        >
          Try again
        </button>
      </Card>
    );
  }

  const statCards = [
    { label: 'Active Offers', value: stats?.activeOfferCount ?? 0, sub: `of ${stats?.offerCount ?? 0} total`, icon: Tag, tone: 'text-brand-amber bg-brand-amber/10', pill: 'success' as const, pillLabel: 'Live' },
    { label: 'Branches', value: stats?.branchCount ?? 0, sub: 'locations', icon: Store, tone: '', pill: 'neutral' as const, pillLabel: 'Hub' },
    { label: 'Customers', value: stats?.customerCount ?? 0, sub: 'card holders', icon: Users, tone: '', pill: 'success' as const, pillLabel: 'Growing' },
    { label: 'Stamps Collected', value: stats?.stampsCollected ?? 0, sub: `${stats?.totalRedeemed ?? 0} redeemed`, icon: Stamp, tone: '', pill: 'neutral' as const, pillLabel: 'Ready' },
  ];

  return (
    <div className="flex flex-col gap-space-lg">
      {/* Store greeting card */}
      <FadeUp>
        <div className="relative overflow-hidden rounded-xl bg-surface-container-lowest p-space-md shadow-ambient border border-hairline">
          <div
            aria-hidden="true"
            className="absolute -right-10 -bottom-10 w-36 h-36 rounded-full bg-primary-fixed/40 blur-2xl pointer-events-none"
          />
          <div className="relative z-10 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h1 className="font-headline-sm text-headline-sm text-on-surface truncate">
                  {businessName}
                </h1>
                <BadgeCheck className="w-5 h-5 shrink-0 text-brand-green" aria-hidden="true" />
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-1 truncate">
                {category}
              </p>
            </div>
          </div>
        </div>
      </FadeUp>

      {/* Stats — Stitch KPI anatomy: icon tile + pill, metric, footer */}
      <Stagger className="grid grid-cols-2 gap-space-sm">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.label} className="p-3.5 flex flex-col justify-between gap-3">
              <div className="flex items-start justify-between gap-2">
                <IconTile className={card.tone}>
                  <Icon size={18} />
                </IconTile>
                <Badge tone={card.pill}>{card.pillLabel}</Badge>
              </div>
              <div>
                <div className="flex items-baseline gap-2">
                  <p className="font-metric-num text-metric-num text-on-surface tabular-nums leading-none">
                    {card.value}
                  </p>
                </div>
                <p className="font-label-md text-label-md text-on-surface-variant mt-1.5">
                  {card.label}
                </p>
                <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">
                  {card.sub}
                </p>
              </div>
            </Card>
          );
        })}
      </Stagger>

      {/* Quick actions */}
      <FadeUp>
        <div className="grid grid-cols-2 gap-space-sm">
          <button
            onClick={() => router.push('/offers/new')}
            className="min-h-[48px] flex items-center justify-center gap-2 px-4 rounded-lg bg-brand-red text-white text-sm font-semibold hover:brightness-110 active:brightness-90 transition focus:outline-none focus:ring-2 focus:ring-brand-red"
          >
            <Plus className="w-4 h-4" /> Create Offer
          </button>
          <button
            onClick={() => router.push('/branches?new=1')}
            className="min-h-[48px] flex items-center justify-center gap-2 px-4 rounded-lg bg-surface-container-lowest border border-brand-border text-on-surface text-sm font-semibold hover:bg-primary-container/[0.04] transition-colors focus:outline-none focus:ring-2 focus:ring-brand-green"
          >
            <MapPin className="w-4 h-4" /> Add Branch
          </button>
          <button
            onClick={() => router.push('/menu')}
            className="col-span-2 min-h-[44px] flex items-center justify-center gap-2 px-4 rounded-lg bg-surface-container-low text-on-surface-variant text-sm font-semibold hover:bg-surface-container transition-colors focus:outline-none focus:ring-2 focus:ring-brand-green"
          >
            <BookOpen className="w-4 h-4" /> Digital Menu
          </button>
        </div>
      </FadeUp>

      {/* Offers */}
      <FadeUp>
        <section className="flex flex-col gap-space-sm" aria-labelledby="offers-heading">
          <div className="flex items-center justify-between">
            <h2 id="offers-heading" className="font-headline-sm text-headline-sm text-on-surface">
              Your Offers
            </h2>
            <button
              onClick={() => router.push('/offers/new')}
              className="min-h-[44px] px-3.5 rounded-pill bg-surface-container-low border border-brand-border font-label-lg text-label-lg text-brand-green hover:bg-primary-container/[0.06] transition-colors"
            >
              + New Offer
            </button>
          </div>

          {offers.length === 0 ? (
            <Card className="flex flex-col items-start gap-2 bg-surface-container-low border-hairline">
              <p className="font-label-lg text-label-lg text-on-surface">No offers yet</p>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Create your first stamp-card offer and get a printable QR poster in seconds.
              </p>
              <button
                onClick={() => router.push('/offers/new')}
                className="min-h-[44px] px-4 rounded-lg bg-brand-green text-white text-sm font-semibold shadow-inset-light hover:bg-brand-greenDark transition-colors"
              >
                Create Offer
              </button>
            </Card>
          ) : (
            <div className="flex flex-col gap-space-sm">
              {offers.map((offer) => {
                const left = daysLeft(offer);
                const pct = timeProgress(offer);
                return (
                  <Card key={offer.id} className="p-4 flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-label-lg text-label-lg text-on-surface truncate">
                          {offer.title}
                        </p>
                        <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
                          {offer.offerType === 'SCRATCH'
                            ? `${offer.scratchItems.length} rewards · Scratch card · ${offer.durationDays} days`
                            : offer.offerType === 'DICE'
                              ? diceSummary(offer)
                              : `${REWARD_LABEL[offer.rewardType] || offer.rewardType} · ${
                                  offer.requiredStamps ?? '?'
                                } stamps · ${offer.durationDays} days`}
                        </p>
                      </div>
                      <OfferStatusPill offer={offer} />
                    </div>

                    {/* Time left — progressFill recipe (width 0→N%, 800ms) */}
                    <div>
                      <motion.div
                        className="h-1.5 rounded-pill bg-surface-container-high overflow-hidden"
                        initial={shouldReduceMotion ? false : 'hidden'}
                        animate="visible"
                      >
                        <motion.div
                          className={`h-full rounded-pill ${
                            offer.isActive && left > 7
                              ? 'bg-brand-green'
                              : offer.isActive && left > 0
                                ? 'bg-brand-amber'
                                : 'bg-brand-red'
                          }`}
                          variants={progressFill(pct)}
                        />
                      </motion.div>
                      <p
                        className={`font-body-sm text-body-sm mt-1.5 ${
                          offer.isActive && left > 0 && left <= 7 ? 'text-brand-red font-semibold' : 'text-on-surface-variant'
                        }`}
                      >
                        {left > 0 ? `${left} day${left === 1 ? '' : 's'} left` : 'Offer ended'}
                      </p>
                    </div>

                    <div className="flex items-center gap-1 border-t border-hairline pt-1">
                      <button
                        onClick={() => router.push(`/offers/${offer.id}/qr`)}
                        className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg text-xs font-semibold text-brand-green hover:bg-primary-container/[0.06]"
                      >
                        <QrCode className="w-4 h-4" /> QR Poster
                      </button>
                      <button
                        onClick={() => router.push(`/offers/${offer.id}`)}
                        className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg text-xs font-semibold text-on-surface-variant hover:bg-surface-container-low"
                      >
                        <Pencil className="w-4 h-4" /> Edit
                      </button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      </FadeUp>
    </div>
  );
}
