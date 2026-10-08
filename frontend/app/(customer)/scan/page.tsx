'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import { QrCode, Sparkles, Stamp, Gift } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { FadeUp } from '@/components/animations/FadeUp';
import { CustomerSignIn } from '@/components/customer/CustomerSignIn';
import { slideUp } from '@/lib/motion/variants';
import { getAuthMe } from '@/lib/api/client';
import { getOfferContext, OfferContext } from '@/lib/api/customer';
import { REWARD_LABELS } from '@/lib/constants';
import { normalizeDiceCount } from '@/lib/dice';

/**
 * Customer sign-in for the check-in flow (phases.md Phase 3).
 *
 * Reached by scanning a QR poster → `/scan/[offerId]` redirects here when
 * signed out (with `?offer=`), or directly as `/scan?next=…` from gated pages.
 */
function ScanContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const shouldReduceMotion = useReducedMotion();

  const offerId = searchParams.get('offer');
  const next = searchParams.get('next');
  const [status, setStatus] = useState<'loading' | 'in' | 'out'>('loading');
  const [ctx, setCtx] = useState<OfferContext | null>(null);

  const target = offerId
    ? `/scan/${encodeURIComponent(offerId)}`
    : next && next.startsWith('/') && !next.startsWith('//')
      ? next
      : '/stamp-card';

  useEffect(() => {
    let alive = true;
    (async () => {
      const [me, context] = await Promise.all([
        getAuthMe().catch(() => null),
        offerId ? getOfferContext(offerId).catch(() => null) : Promise.resolve(null),
      ]);
      if (!alive) return;
      if (context?.offer) setCtx(context);
      if (me?.data?.authenticated) {
        // Already signed in: continue to the offer (or the ready panel).
        setStatus('in');
        if (offerId) router.replace(target);
      } else {
        setStatus('out');
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === 'loading') {
    return (
      <div
        className="py-10 text-center font-body-sm text-body-sm text-on-surface-variant"
        aria-busy="true"
      >
        Checking your session…
      </div>
    );
  }

  if (status === 'in') {
    if (offerId) {
      return (
        <div
          className="py-10 text-center font-body-sm text-body-sm text-on-surface-variant"
          aria-busy="true"
        >
          Opening {ctx?.merchant.businessName || 'the offer'}…
        </div>
      );
    }

    // Signed in, no offer attached: explain how scanning works + shortcuts.
    return (
      <div className="flex flex-col gap-4">
        <FadeUp>
          <Card className="p-6 text-center flex flex-col items-center gap-3">
            <span className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-surface-container text-primary">
              <QrCode className="w-7 h-7" />
            </span>
            <h1 className="font-headline-md text-headline-md text-on-surface">
              Ready to collect stamps
            </h1>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              Point your camera at a Loyl QR poster and the stamp card opens right here — no app
              download needed.
            </p>
            <div className="grid grid-cols-2 gap-3 w-full mt-2">
              <button
                onClick={() => router.push('/stamp-card')}
                className="min-h-[44px] flex items-center justify-center gap-2 px-4 rounded-card bg-primary-fixed border border-hairline text-brand-green font-label-lg text-label-lg hover:bg-primary-fixed/70 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-green"
              >
                <Stamp className="w-4 h-4" /> My Cards
              </button>
              <button
                onClick={() => router.push('/reward')}
                className="min-h-[44px] flex items-center justify-center gap-2 px-4 rounded-card bg-surface-container-low border border-hairline text-on-surface font-label-lg text-label-lg hover:bg-surface-container transition-colors focus:outline-none focus:ring-2 focus:ring-brand-green"
              >
                <Gift className="w-4 h-4" /> Rewards
              </button>
            </div>
          </Card>
        </FadeUp>
      </div>
    );
  }

  // Signed out → customer sign-in, optionally wrapped in the shop's branding.
  return (
    <div className="flex flex-col gap-4">
      {ctx && (
        <motion.div
          initial={shouldReduceMotion ? false : 'hidden'}
          animate="visible"
          variants={slideUp}
        >
          <Card className="p-5 flex items-center gap-3">
            <span className="inline-flex items-center justify-center w-11 h-11 rounded-input bg-surface-container text-primary shrink-0">
              {ctx.merchant.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={ctx.merchant.logoUrl}
                  alt=""
                  className="w-11 h-11 rounded-input object-cover"
                />
              ) : (
                <Sparkles className="w-5 h-5" />
              )}
            </span>
            <div className="min-w-0">
              <p className="font-label-lg text-label-lg text-on-surface truncate">
                {ctx.merchant.businessName}
              </p>
              <p className="font-body-sm text-body-sm text-on-surface-variant truncate">
                {ctx.offer.offerType === 'SCRATCH'
                  ? `${ctx.offer.title} · ${ctx.offer.itemCount} rewards · scratch to reveal`
                  : ctx.offer.offerType === 'DICE'
                    ? `${ctx.offer.title} · roll ${normalizeDiceCount(
                        ctx.offer.diceCount
                      )} dice → discount %`
                    : `${ctx.offer.title} · ${ctx.offer.requiredStamps} stamps → ${
                        REWARD_LABELS[ctx.offer.rewardType] || 'reward'
                      }`}
              </p>
            </div>
          </Card>
        </motion.div>
      )}

      <CustomerSignIn
        onVerified={() => router.replace(target)}
        heading={offerId ? 'Sign in to check in' : undefined}
        subheading={
          offerId
            ? ctx?.offer.offerType === 'SCRATCH'
              ? `Add your name and phone number to scratch a reward at ${ctx?.merchant.businessName || 'this shop'}.`
              : ctx?.offer.offerType === 'DICE'
                ? `Add your name and phone number to roll the dice at ${ctx?.merchant.businessName || 'this shop'}.`
                : `Add your name and phone number to collect stamps at ${ctx?.merchant.businessName || 'this shop'}.`
            : undefined
        }
        cta={
          offerId
            ? ctx?.offer.offerType === 'SCRATCH'
              ? 'Continue & Reveal Reward'
              : ctx?.offer.offerType === 'DICE'
                ? 'Continue & Roll Dice'
                : 'Continue & Collect Stamps'
            : undefined
        }
      />
    </div>
  );
}

export default function ScanEntryPage() {
  return (
    <Suspense
      fallback={
        <div className="py-10 text-center font-body-sm text-body-sm text-on-surface-variant">
          Loading…
        </div>
      }
    >
      <ScanContent />
    </Suspense>
  );
}
