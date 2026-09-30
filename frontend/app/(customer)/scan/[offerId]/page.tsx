'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import {
  AlertCircle,
  Gift,
  MapPin,
  QrCode,
  Sparkles,
  Store,
  Clock,
  BadgeCheck,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FadeUp } from '@/components/animations/FadeUp';
import { StampGrid } from '@/components/customer/StampGrid';
import { RewardModal } from '@/components/customer/RewardModal';
import { ScratchOfferView } from '@/components/customer/ScratchOfferView';
import { DiceOfferView } from '@/components/customer/DiceOfferView';
import { ShopLinks, ShopSocials } from '@/components/customer/ShopLinks';
import { useConfetti } from '@/components/animations/Confetti';
import { progressFill } from '@/lib/motion/variants';
import { getPosition } from '@/lib/location';
import { timeUntil } from '@/lib/format';
import { REWARD_LABELS } from '@/lib/constants';
import {
  getOfferContext,
  scanOffer,
  redeemOffer,
  reviewBonus,
  OfferContext,
  ScanResult,
  RedeemResult,
  ReviewResult,
} from '@/lib/api/customer';

/**
 * The QR landing page: `/scan/[offerId]` (phases.md Phase 3, TEST.md §3/§4).
 * Shop branding → collect stamp (GPS + cooldown enforced server-side) →
 * animated stamp fill → reward pop-up at the threshold → review bonus.
 */
export default function ScanOfferPage() {
  const router = useRouter();
  const params = useParams<{ offerId: string }>();
  const offerId = params?.offerId || '';
  const shouldReduceMotion = useReducedMotion();
  const fireConfetti = useConfetti();

  const [ctx, setCtx] = useState<OfferContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [scanning, setScanning] = useState(false);

  const [rewardOpen, setRewardOpen] = useState(false);
  const [claimed, setClaimed] = useState<RedeemResult | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState('');

  const [mapsOpenedAt, setMapsOpenedAt] = useState<number | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewMsg, setReviewMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  // Minute ticker so cooldown countdowns stay fresh without a re-fetch.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((v) => v + 1), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const c = await getOfferContext(offerId);
      if (!c?.offer) {
        setError(c?.error?.message || 'This offer is no longer available.');
        setCtx(null);
        return;
      }
      setCtx(c);
      if (!c.authenticated) {
        router.replace(`/scan?offer=${encodeURIComponent(offerId)}`);
      }
    } catch {
      setError('Network error — check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [offerId, router]);

  useEffect(() => {
    if (offerId) load();
  }, [offerId, load]);

  const patchCard = (card: OfferContext['card']) =>
    setCtx((prev) => (prev ? { ...prev, card } : prev));

  // Phase 9: while a check-in waits on the shop, poll quietly for approval.
  const refreshSilently = useCallback(async () => {
    try {
      const c = await getOfferContext(offerId);
      if (c?.offer) setCtx(c);
    } catch {
      // Best-effort polling — the next tick retries.
    }
  }, [offerId]);

  const pending = !!ctx?.pendingRequest;

  useEffect(() => {
    if (!pending) return;
    const t = window.setInterval(refreshSilently, 5000);
    return () => window.clearInterval(t);
  }, [pending, refreshSilently]);

  // The merchant accepted → the stamp lands on the next poll: celebrate then,
  // and open the reward pop-up if the card is now complete.
  const prevStamps = useRef<number | null>(null);
  useEffect(() => {
    if (!ctx) return;
    const s = ctx.card?.stampsCollected ?? 0;
    if (prevStamps.current !== null && s > prevStamps.current) {
      fireConfetti();
      if (ctx.card?.complete) {
        setClaimed(null);
        setClaimError('');
        setRewardOpen(true);
      }
    }
    prevStamps.current = s;
  }, [ctx, fireConfetti]);

  // --- Collect stamp --------------------------------------------------------
  const handleScan = async () => {
    if (!ctx || scanning) return;
    setActionError('');
    setScanning(true);
    try {
      let latitude: number | null = null;
      let longitude: number | null = null;

      if (ctx.geoRequired) {
        try {
          const pos = await getPosition();
          latitude = pos.coords.latitude;
          longitude = pos.coords.longitude;
        } catch {
          setActionError(
            'This shop verifies your location. Please allow location access and try again.'
          );
          return;
        }
      }

      const res = await scanOffer({ offerId, latitude, longitude });
      if (res?.success) {
        const data = res.data as ScanResult;
        patchCard(data.card);
        // Phase 9: the scan opened a request — the shop confirms it before the
        // stamp lands, so there is nothing to celebrate yet.
        if (data.request) {
          setCtx((prev) => (prev ? { ...prev, pendingRequest: data.request } : prev));
        }
        setActionError('');
        return;
      }

      const code = res?.error?.code;
      const data = res?.data || {};
      if (code === 'CARD_COMPLETE') {
        setClaimed(null);
        setClaimError('');
        setRewardOpen(true);
      } else if (code === 'REQUEST_PENDING') {
        // Already waiting on the shop — surface the pending state, not an error.
        if (data.card) patchCard(data.card);
        if (data.request) {
          setCtx((prev) => (prev ? { ...prev, pendingRequest: data.request } : prev));
        }
        setActionError('');
      } else if (code === 'NEED_LOCATION') {
        setActionError('This shop verifies your location. Please allow location access.');
      } else if (code === 'LOCATION_OUT_OF_RANGE') {
        setActionError(
          `You are about ${data.distanceMeters ?? '?'} m away — you need to be within ${
            data.radiusM ?? ctx.geoRadiusM
          } m of ${data.nearestBranch ? `${ctx.merchant.businessName} (${data.nearestBranch})` : ctx.merchant.businessName}.`
        );
      } else if (code === 'COOLDOWN') {
        if (data.card) patchCard(data.card);
        setActionError(
          `You already checked in here recently — next stamp in ${timeUntil(
            data.nextScanAt || ctx.card?.nextScanAt
          )}.`
        );
      } else {
        setActionError(res?.error?.message || 'Check-in failed. Please try again.');
      }
    } catch {
      setActionError('Network error — check your connection and try again.');
    } finally {
      setScanning(false);
    }
  };

  // --- Claim reward ---------------------------------------------------------
  const handleClaim = async () => {
    if (!ctx || claiming) return;
    setClaiming(true);
    setClaimError('');
    try {
      const res = await redeemOffer(offerId);
      if (res?.success) {
        const data = res.data as RedeemResult;
        setClaimed(data);
        patchCard(data.card);
        fireConfetti();
      } else {
        setClaimError(res?.error?.message || 'Could not redeem your reward. Try again.');
      }
    } catch {
      setClaimError('Network error — check your connection and try again.');
    } finally {
      setClaiming(false);
    }
  };

  // --- Review engine (PRD 3.3) ---------------------------------------------
  const mapsUrl = ctx
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        `${ctx.merchant.businessName} ${ctx.merchant.category}`
      )}`
    : '';

  // Merchant Settings → social links (null until configured).
  const socials: ShopSocials = {
    websiteUrl: ctx?.merchant.websiteUrl ?? null,
    facebookUrl: ctx?.merchant.facebookUrl ?? null,
    instagramUrl: ctx?.merchant.instagramUrl ?? null,
  };

  const submitReview = useCallback(
    async (grantIfSeenMs = 0) => {
      if (!ctx || reviewBusy) return;
      if (grantIfSeenMs > 0 && mapsOpenedAt && Date.now() - mapsOpenedAt < grantIfSeenMs) return;
      setReviewBusy(true);
      setReviewMsg(null);
      try {
        const res = await reviewBonus(offerId);
        if (res?.success) {
          const data = res.data as ReviewResult;
          patchCard(data.card);
          setMapsOpenedAt(null);
          setReviewMsg({ tone: 'ok', text: 'Bonus stamp added — thanks for the review!' });
          fireConfetti();
          if (data.complete) {
            setClaimed(null);
            setClaimError('');
            setRewardOpen(true);
          }
        } else {
          setReviewMsg({
            tone: 'bad',
            text: res?.error?.message || 'Bonus not available right now.',
          });
        }
      } catch {
        setReviewMsg({ tone: 'bad', text: 'Network error — try again.' });
      } finally {
        setReviewBusy(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [ctx, reviewBusy, offerId, mapsOpenedAt, fireConfetti]
  );

  const handleReview = () => {
    setReviewMsg(null);
    window.open(mapsUrl, '_blank', 'noopener,noreferrer');
    setMapsOpenedAt(Date.now());
  };

  // Auto-claim when the window regains focus after the Maps hop
  // ("verifies return focus" — PRD 3.3), with a manual fallback button.
  useEffect(() => {
    if (mapsOpenedAt === null) return;
    const onFocus = () => submitReview(2000);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [mapsOpenedAt, submitReview]);

  // --- Derived UI state -----------------------------------------------------
  const isScratch = ctx?.offer.offerType === 'SCRATCH';
  const isDice = ctx?.offer.offerType === 'DICE';
  const card = ctx?.card ?? null;
  const required = ctx?.offer.requiredStamps ?? 0;
  const stamps = card?.stampsCollected ?? 0;
  const complete = !!card?.complete;
  const inCooldown = !!card && !card.canScan && !complete;
  const unavailable = !!ctx && (!ctx.offer.isActive || ctx.ended);
  const percent = required > 0 ? Math.round((stamps / required) * 100) : 0;
  const showReview =
    !!card?.exists && !complete && (card.canReviewBonus || mapsOpenedAt !== null);

  if (loading) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <div className="h-20 bg-surface-container-lowest rounded-xl border border-hairline shadow-hairline" />
        <div className="h-56 bg-surface-container-lowest rounded-xl border border-hairline shadow-hairline" />
        <div className="h-24 bg-surface-container-lowest rounded-xl border border-hairline shadow-hairline" />
      </div>
    );
  }

  if (error || !ctx) {
    return (
      <Card className="flex flex-col items-start gap-3">
        <div className="flex items-center gap-2 text-brand-red">
          <AlertCircle className="w-5 h-5" />
          <p className="font-body-sm text-body-sm font-medium">{error || 'Offer not found'}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="min-h-[44px] px-4 rounded-input bg-brand-green text-white font-label-lg text-label-lg shadow-inset-light hover:bg-brand-greenDark transition-colors"
          >
            Try again
          </button>
          <button
            onClick={() => router.push('/stamp-card')}
            className="min-h-[44px] px-4 rounded-input border border-hairline bg-surface-container-lowest font-label-lg text-label-lg text-on-surface hover:bg-surface-container-low transition-colors"
          >
            My stamp cards
          </button>
        </div>
      </Card>
    );
  }

  if (!ctx.authenticated) {
    return (
      <div
        className="py-10 text-center font-body-sm text-body-sm text-on-surface-variant"
        aria-busy="true"
      >
        Signing you in…
      </div>
    );
  }

  // Shared shop header (every offer type shows the same branding card).
  const shopHeader = (
    <FadeUp>
      <Card className="p-5 flex items-center gap-3">
        <span className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary-fixed text-brand-green shrink-0 overflow-hidden">
          {ctx.merchant.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={ctx.merchant.logoUrl}
              alt=""
              className="w-12 h-12 rounded-xl object-cover"
            />
          ) : (
            <Store className="w-6 h-6" />
          )}
        </span>
        <div className="min-w-0">
          <p className="font-headline-sm text-headline-sm text-on-surface truncate">
            {ctx.merchant.businessName}
          </p>
          <p className="font-body-sm text-body-sm text-on-surface-variant truncate">
            {ctx.merchant.category}
          </p>
        </div>
        <span className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-pill bg-primary-fixed text-on-primary-fixed font-label-sm text-label-sm uppercase tracking-wider shrink-0">
          <BadgeCheck className="w-3.5 h-3.5" aria-hidden="true" />
          Loyl Shop
        </span>
      </Card>
    </FadeUp>
  );

  // --- Scratch Card offer (Phase 3.5) — fully decoupled flow ---------------
  if (isScratch) {
    return (
      <div className="flex flex-col gap-5">
        {shopHeader}

        <ScratchOfferView ctx={ctx} offerId={offerId} />

        {/* Review + follow — same card as every other offer type */}
        <ShopLinks
          businessName={ctx.merchant.businessName}
          mapsUrl={mapsUrl}
          socials={socials}
        />

        {/* Footer link */}
        <div className="text-center">
          <button
            onClick={() => router.push('/stamp-card')}
            className="inline-flex items-center gap-1.5 min-h-[44px] font-label-lg text-label-lg text-brand-green hover:underline"
          >
            <QrCode className="w-3.5 h-3.5" /> View all my stamp cards
          </button>
        </div>
      </div>
    );
  }

  // --- Dice offer — one roll, ever ------------------------------------------
  if (isDice) {
    return (
      <div className="flex flex-col gap-5">
        {shopHeader}

        <DiceOfferView ctx={ctx} offerId={offerId} />

        {/* Review + follow — same card as every other offer type */}
        <ShopLinks
          businessName={ctx.merchant.businessName}
          mapsUrl={mapsUrl}
          socials={socials}
        />

        {/* Footer link */}
        <div className="text-center">
          <button
            onClick={() => router.push('/stamp-card')}
            className="inline-flex items-center gap-1.5 min-h-[44px] font-label-lg text-label-lg text-brand-green hover:underline"
          >
            <QrCode className="w-3.5 h-3.5" /> View all my stamp cards
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Shop header */}
      {shopHeader}

      {/* Stamp card — Sovereign Green pass panel */}
      <FadeUp>
        <div className="rounded-xl border border-hairline shadow-ambient overflow-hidden bg-surface-container-lowest">
          {/* Pass header banner */}
          <div className="bg-brand-green px-5 py-4 text-white">
            <h1 className="font-headline-sm text-headline-sm leading-snug text-white">
              {ctx.offer.title}
            </h1>
            <p className="font-body-sm text-body-sm text-primary-fixed mt-0.5">
              {REWARD_LABELS[ctx.offer.rewardType] || 'Reward'} · collect {required} stamps
            </p>
          </div>

          {/* Perforated tear line with pass notches */}
          <div className="relative flex items-center" aria-hidden="true">
            <span className="absolute -left-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-brand-bg" />
            <span className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-brand-bg" />
            <span className="flex-1 border-t-2 border-dashed border-brand-border mx-3" />
          </div>

          <div className="p-5 flex flex-col gap-4">
            <StampGrid total={required} filled={stamps} />

            {/* progressFill recipe: width 0→N%, 800ms ease-out */}
            <div>
              <motion.div
                className="h-2 rounded-pill bg-surface-container-high overflow-hidden"
                initial={shouldReduceMotion ? false : 'hidden'}
                animate="visible"
              >
                <motion.div
                  className="h-full rounded-pill bg-brand-green"
                  variants={progressFill(percent)}
                />
              </motion.div>
              <div className="flex items-center justify-between mt-1.5 gap-2">
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  <span className="font-bold text-on-surface tabular-nums">{stamps}</span> of{' '}
                  {required} stamps
                </p>
                {complete && (
                  <span className="px-2.5 py-0.5 rounded-pill bg-brand-amber/15 text-brand-amber font-label-sm text-label-sm uppercase tracking-wider">
                    Reward unlocked!
                  </span>
                )}
                {inCooldown && (
                  <p className="font-body-sm text-body-sm text-on-surface-variant">
                    Next stamp in {timeUntil(card?.nextScanAt)}
                  </p>
                )}
              </div>
            </div>

            {unavailable && (
              <div className="flex items-start gap-2 rounded-input bg-surface-container-low border border-hairline px-3 py-2.5">
                <Clock className="w-4 h-4 text-on-surface-variant shrink-0 mt-0.5" />
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  {ctx.ended
                    ? 'This offer has ended — the shop may post a new one soon.'
                    : 'This offer is paused by the shop right now.'}
                </p>
              </div>
            )}

            {actionError && (
              <div className="flex items-start gap-2 rounded-input bg-brand-red/5 border border-brand-red/25 px-3 py-2.5">
                <AlertCircle className="w-4 h-4 text-brand-red shrink-0 mt-0.5" />
                <p className="font-body-sm text-body-sm text-brand-red">{actionError}</p>
              </div>
            )}

            {pending ? (
              <div className="flex items-start gap-2 rounded-input bg-surface-container-low border border-hairline px-3 py-2.5">
                <Clock className="w-4 h-4 text-on-surface-variant shrink-0 mt-0.5" />
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  Waiting for {ctx.merchant.businessName} to confirm — your stamp appears here as
                  soon as they accept.
                </p>
              </div>
            ) : unavailable ? (
              <Button variant="outline" className="w-full min-h-[52px]" disabled>
                Check-in unavailable
              </Button>
            ) : complete ? (
              <Button
                variant="accent"
                className="w-full min-h-[52px]"
                onClick={() => {
                  setClaimed(null);
                  setClaimError('');
                  setActionError('');
                  setRewardOpen(true);
                }}
              >
                <Gift className="w-4 h-4 mr-1.5" /> Claim Reward
              </Button>
            ) : inCooldown ? (
              <Button variant="outline" className="w-full min-h-[52px]" disabled>
                <Clock className="w-4 h-4 mr-1.5" /> Next stamp in {timeUntil(card?.nextScanAt)}
              </Button>
            ) : (
              <Button
                variant="primary"
                className="w-full min-h-[52px]"
                disabled={scanning}
                onClick={handleScan}
              >
                <Sparkles className="w-4 h-4 mr-1.5" />
                {scanning
                  ? ctx.geoRequired
                    ? 'Verifying your location…'
                    : 'Checking in…'
                  : 'Collect Stamp'}
              </Button>
            )}

            {ctx.geoRequired && !unavailable && (
              <p className="font-body-sm text-body-sm text-on-surface-variant flex items-center gap-1 -mt-1">
                <MapPin className="w-3.5 h-3.5" /> Location check: within {ctx.geoRadiusM} m of the
                shop
              </p>
            )}
          </div>
        </div>
      </FadeUp>

      {/* Review + follow (PRD 3.3) — every offer type shows it; on stamp
          offers the button drives the bonus-stamp flow, elsewhere it is a
          plain Google Maps link. */}
      <ShopLinks
        businessName={ctx.merchant.businessName}
        mapsUrl={mapsUrl}
        socials={socials}
        bonusEligible={showReview}
        mapsOpened={mapsOpenedAt !== null}
        busy={reviewBusy}
        message={reviewMsg}
        onOpenMaps={handleReview}
        onClaim={() => submitReview()}
      />

      {/* Footer link */}
      <div className="text-center">
        <button
          onClick={() => router.push('/stamp-card')}
          className="inline-flex items-center gap-1.5 min-h-[44px] font-label-lg text-label-lg text-brand-green hover:underline"
        >
          <QrCode className="w-3.5 h-3.5" /> View all my stamp cards
        </button>
      </div>

      {/* Reward pop-up (2x2 celebration → claim → receipt) */}
      <RewardModal
        open={rewardOpen}
        mode={claimed ? 'claimed' : 'ready'}
        businessName={ctx.merchant.businessName}
        rewardTitle={claimed?.reward.title || ctx.offer.title}
        rewardLabel={REWARD_LABELS[(claimed?.reward.rewardType || ctx.offer.rewardType) as string] || ''}
        requiredStamps={required}
        claiming={claiming}
        error={claimed ? null : claimError}
        claimedAt={claimed?.claimedAt ?? null}
        onClaim={handleClaim}
        onClose={() => {
          setRewardOpen(false);
          setClaimed(null);
          setClaimError('');
        }}
      />
    </div>
  );
}
