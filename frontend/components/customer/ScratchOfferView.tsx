'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { AlertCircle, Clock, Gift, MapPin, Sparkles } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ScratchCard } from '@/components/customer/ScratchCard';
import { useConfetti } from '@/components/animations/Confetti';
import { getPosition } from '@/lib/location';
import { timeUntil } from '@/lib/format';
import { useCountdown, useLockOpened } from '@/components/ui/Countdown';
import {
  scratchOffer,
  OfferContext,
  ScratchRevealResult,
  ScratchState,
} from '@/lib/api/customer';

interface ScratchOfferViewProps {
  ctx: OfferContext;
  offerId: string;
}

/**
 * The customer scratch flow for SCRATCH offers (Phase 3.5) — fully decoupled
 * from the stamp card. Shows one of: unavailable notice → mystery-foil card
 * (scratch to reveal) → revealing… → revealed reward panel → 24h cooldown
 * panel with the last reward.
 */
export const ScratchOfferView: React.FC<ScratchOfferViewProps> = ({ ctx, offerId }) => {
  const shouldReduceMotion = useReducedMotion();
  const fireConfetti = useConfetti();

  const [scratch, setScratch] = useState<ScratchState | null>(ctx.scratch);
  const [result, setResult] = useState<ScratchRevealResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Bumping the key remounts ScratchCard so the foil repaints after a failure.
  const [foilKey, setFoilKey] = useState(0);

  // Context refreshes (e.g. re-mount after OTP redirect) re-sync local state.
  const ctxScratchRef = useRef(ctx.scratch);
  useEffect(() => {
    if (ctx.scratch !== ctxScratchRef.current) {
      ctxScratchRef.current = ctx.scratch;
      setScratch(ctx.scratch);
    }
  }, [ctx.scratch]);

  const unavailable = !ctx.offer.isActive || ctx.ended;

  // --- Per-offer cooldown countdown -----------------------------------------
  // Both the just-revealed panel and the "come back later" panel key off the
  // same lock timestamp, so one countdown drives both. When it hits zero the
  // foil is handed straight back — no refetch, no dead button.
  const lockIso = result?.nextScratchAt ?? scratch?.nextScratchAt ?? null;
  const { text: lockText, done: lockDone } = useCountdown(lockIso);
  const locked = !!lockIso && !lockDone;

  // Cooldown finished → drop the reveal confirmation and re-arm the card.
  useEffect(() => {
    if (!result || !lockDone) return;
    setResult(null);
    setScratch((prev) => (prev ? { ...prev, canScratch: true } : prev));
  }, [result, lockDone]);

  // A COOLDOWN error is only true while the lock holds — clear it on expiry
  // so the reopened card never opens with a stale refusal above it.
  useLockOpened(!locked, () => setError(''));

  const doScratch = useCallback(async () => {
    if (busy || unavailable) return;
    setError('');
    setBusy(true);
    try {
      let latitude: number | null = null;
      let longitude: number | null = null;

      if (ctx.geoRequired) {
        try {
          const pos = await getPosition();
          latitude = pos.coords.latitude;
          longitude = pos.coords.longitude;
        } catch {
          setError(
            'This shop verifies your location. Please allow location access and try again.'
          );
          setFoilKey((k) => k + 1);
          return;
        }
      }

      const res = await scratchOffer({ offerId, latitude, longitude });
      if (res?.success) {
        const data = res.data as ScratchRevealResult;
        setResult(data);
        setScratch(data.scratch);
        fireConfetti();
        return;
      }

      const code = res?.error?.code;
      const data = res?.data || {};
      if (code === 'NEED_LOCATION') {
        setError('This shop verifies your location. Please allow location access.');
      } else if (code === 'LOCATION_OUT_OF_RANGE') {
        setError(
          `You are about ${data.distanceMeters ?? '?'} m away — you need to be within ${
            data.radiusM ?? ctx.geoRadiusM
          } m of the shop to scratch.`
        );
      } else if (code === 'COOLDOWN') {
        if (data.scratch) setScratch(data.scratch as ScratchState);
        setError(
          `You already revealed a reward here — next scratch in ${timeUntil(
            data.nextScratchAt || scratch?.nextScratchAt
          )}.`
        );
      } else if (code === 'WRONG_OFFER_TYPE') {
        setError('This is a stamp offer — collect stamps instead.');
      } else {
        setError(res?.error?.message || 'Could not reveal your reward. Please try again.');
      }
      // Foil comes back so the customer can scratch again.
      setFoilKey((k) => k + 1);
    } catch {
      setError('Network error — check your connection and try again.');
      setFoilKey((k) => k + 1);
    } finally {
      setBusy(false);
    }
  }, [busy, unavailable, ctx.geoRequired, ctx.geoRadiusM, offerId, scratch?.nextScratchAt, fireConfetti]);

  // --- Just revealed (and still inside the offer's cooldown window) ---------
  if (result && locked) {
    return (
      <Card className="p-5 flex flex-col gap-4 border-brand-amber/30 bg-brand-amber/5">
        <div className="flex items-start gap-2.5">
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-input bg-brand-amber/15 text-brand-amber shrink-0">
            <Gift size={20} />
          </span>
          <div className="min-w-0">
            <p className="font-body-sm text-body-sm text-on-surface-variant">You revealed</p>
            <p className="font-headline-md text-headline-md text-on-surface leading-tight break-words">
              {result.reward.label}
            </p>
            <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5 truncate">
              {result.reward.merchantName} · {new Date(result.scratchedAt).toLocaleString()}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 rounded-input bg-surface-container-lowest border border-brand-amber/30 px-3 py-2.5">
          <span className="font-label-lg text-label-lg text-on-surface flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-brand-amber" /> Reward unlocked!
          </span>
          <span className="font-label-sm text-label-sm uppercase tracking-wider text-brand-amber tabular-nums">
            {lockText}
          </span>
        </div>

        <p className="font-body-sm text-body-sm text-on-surface-variant">
          Show this screen at the counter. Your next scratch unlocks in{' '}
          <span className="font-semibold text-on-surface tabular-nums">{lockText}</span>.
        </p>
      </Card>
    );
  }

  // --- Cooldown: last reward still within this card's window ----------------
  if (!result && scratch && scratch.lastResult && locked) {
    const hours = scratch.cooldownHours ?? 24;
    return (
      <Card className="p-5 flex flex-col gap-4">
        <div className="flex items-start gap-2.5">
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-input bg-brand-amber/15 text-brand-amber shrink-0">
            <Gift size={20} />
          </span>
          <div className="min-w-0">
            <p className="font-body-sm text-body-sm text-on-surface-variant">Your last reward</p>
            <p className="font-headline-sm text-headline-sm text-on-surface leading-tight break-words">
              {scratch.lastResult.rewardLabel}
            </p>
            <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
              Revealed {new Date(scratch.lastResult.scratchedAt).toLocaleString()}
            </p>
          </div>
        </div>

        <div className="min-h-[44px] w-full flex items-center justify-center gap-2 rounded-pill border border-hairline bg-surface-container-low px-4 font-label-lg text-label-lg text-on-surface">
          <Clock className="w-4 h-4 text-brand-amber" />
          <span className="tabular-nums">{lockText}</span>
          <span className="font-body-sm text-body-sm font-normal text-on-surface-variant">
            until your next scratch
          </span>
        </div>

        <p className="font-body-sm text-body-sm text-on-surface-variant">
          This card can be scratched once every {hours} {hours === 1 ? 'hour' : 'hours'}.
        </p>
      </Card>
    );
  }

  // --- Unavailable ----------------------------------------------------------
  if (unavailable) {
    return (
      <Card className="p-5 flex flex-col gap-4">
        <div className="flex items-start gap-2 rounded-input bg-surface-container-low border border-hairline px-3 py-2.5">
          <Clock className="w-4 h-4 text-on-surface-variant shrink-0 mt-0.5" />
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            {ctx.ended
              ? 'This offer has ended — the shop may post a new one soon.'
              : 'This offer is paused by the shop right now.'}
          </p>
        </div>
        <Button variant="outline" className="w-full" disabled>
          Scratch unavailable
        </Button>
      </Card>
    );
  }

  // --- Mystery foil ---------------------------------------------------------
  return (
    <Card className="p-5 flex flex-col gap-4">
      <div>
        <h1 className="font-headline-sm text-headline-sm text-on-surface leading-snug">
          {ctx.offer.title}
        </h1>
        <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
          {ctx.offer.scratchMode === 'FIXED'
            ? 'Scratch the panel to reveal your reward'
            : `${ctx.offer.itemCount} rewards in the pool — scratch to reveal yours`}
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-input bg-brand-red/5 border border-brand-red/25 px-3 py-2.5">
          <AlertCircle className="w-4 h-4 text-brand-red shrink-0 mt-0.5" />
          <p className="font-body-sm text-body-sm text-brand-red">{error}</p>
        </div>
      )}

      {busy ? (
        <div
          className="rounded-card bg-brand-amber/5 border border-brand-amber/30 px-4 py-8 text-center"
          aria-busy="true"
        >
          <Sparkles className="w-5 h-5 text-brand-amber mx-auto animate-pulse" />
          <p className="font-label-lg text-label-lg text-on-surface mt-2">Revealing…</p>
        </div>
      ) : shouldReduceMotion ? (
        <Button variant="primary" className="w-full" onClick={doScratch}>
          <Gift className="w-4 h-4 mr-1.5" /> Reveal my reward
        </Button>
      ) : (
        <ScratchCard
          key={foilKey}
          onReveal={doScratch}
          hint="Scratch to reveal your reward"
          className="border border-brand-amber/30"
        >
          <div className="rounded-card bg-brand-amber/5 px-4 py-8 text-center select-none">
            <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-brand-amber/15 text-brand-amber">
              <Gift size={20} />
            </span>
            <p className="font-label-lg text-label-lg text-on-surface mt-2">
              🎁 Mystery reward inside
            </p>
            <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
              Scratch with your finger or cursor
            </p>
          </div>
        </ScratchCard>
      )}

      {ctx.geoRequired && (
        <p className="font-body-sm text-body-sm text-on-surface-variant flex items-center gap-1 -mt-1">
          <MapPin className="w-3.5 h-3.5" /> Location check: within {ctx.geoRadiusM} m of the shop
        </p>
      )}
    </Card>
  );
};
