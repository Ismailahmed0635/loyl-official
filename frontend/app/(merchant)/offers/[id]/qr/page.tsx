'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import { popIn } from '@/lib/motion/variants';
import type { OfferQrResponse } from '@/lib/api/merchant';
import { getOfferQr } from '@/lib/api/merchant';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FadeUp } from '@/components/animations/FadeUp';
import {
  ArrowLeft,
  Copy,
  Download,
  Gift,
  Printer,
  Pencil,
  CheckCircle2,
  AlertCircle,
  Stamp,
  Dices,
} from 'lucide-react';
import { discountRange, normalizeDiceCount } from '@/lib/dice';

const MAX_STAMP_DOTS = 20;

// QR Result — Phase 2. Shows the printable QR poster for an offer.
export default function OfferQrPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const shouldReduceMotion = useReducedMotion();
  const id = params?.id;

  const [data, setData] = useState<OfferQrResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    (async () => {
      try {
        const res = await getOfferQr(id);
        if (!alive) return;
        if (res?.success) setData(res.data as OfferQrResponse);
        else setNotFound(true);
      } catch {
        if (alive) setNotFound(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const handleCopy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.scanUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the URL is visible on screen anyway */
    }
  };

  if (loading) {
    return <p className="text-sm text-brand-textMuted">Generating your QR poster…</p>;
  }

  if (notFound || !data) {
    return (
      <Card className="flex flex-col items-start gap-3">
        <div className="flex items-center gap-2 text-brand-red">
          <AlertCircle className="w-5 h-5" />
          <p className="text-sm font-medium">Offer not found — it may have been deleted.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => router.push('/dashboard')}>
          <ArrowLeft className="w-4 h-4 mr-1.5" /> Back to Dashboard
        </Button>
      </Card>
    );
  }

  const { offer, merchant, scanUrl, qrDataUrl } = data;
  const isScratch = offer.offerType === 'SCRATCH';
  const isDice = offer.offerType === 'DICE';
  // Clamped the same way the roll engine clamps — never prints 0 dice.
  const diceCount = normalizeDiceCount(offer.diceCount);
  const diceRange = discountRange(diceCount);
  const stampDots = Math.min(offer.requiredStamps ?? 0, MAX_STAMP_DOTS);
  const stampOverflow = (offer.requiredStamps ?? 0) - stampDots;

  return (
    <div className="flex flex-col gap-4">
      <FadeUp>
        <button
          onClick={() => router.push('/dashboard')}
          className="inline-flex items-center gap-1.5 font-label-lg text-label-lg text-on-surface-variant min-h-[44px] hover:text-on-surface"
        >
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </button>
        <h1 className="font-headline-md text-headline-md text-on-surface">QR Poster Ready</h1>
        <p className="font-body-md text-body-md text-on-surface-variant mt-1.5">
          {isScratch
            ? 'Print it, paste it at the counter — every scan opens a scratch card.'
            : isDice
              ? 'Print it, paste it at the counter — every scan lets the customer roll once.'
              : 'Print it, paste it at the counter — every scan starts a stamp card.'}
        </p>
      </FadeUp>

      {/* The poster card */}
      <Card className="flex flex-col items-center gap-4 text-center">
        <div className="flex items-center gap-2">
          {merchant.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={merchant.logoUrl}
              alt={`${merchant.businessName} logo`}
              className="w-8 h-8 rounded-full object-cover border border-brand-border"
            />
          ) : (
            <span className="w-8 h-8 rounded-[10px] bg-brand-green text-white grid place-items-center">
              {isScratch ? <Gift size={16} /> : isDice ? <Dices size={16} /> : <Stamp size={16} />}
            </span>
          )}
          <div className="text-left">
            <p className="font-label-lg text-label-lg text-on-surface leading-tight">
              {merchant.businessName}
            </p>
            <p className="font-label-sm text-label-sm text-on-surface-variant">{merchant.category}</p>
          </div>
        </div>

        <div>
          <p className="font-headline-sm text-headline-sm text-on-surface leading-snug">{offer.title}</p>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
            {isScratch
              ? offer.scratchMode === 'FIXED'
                ? `Scratch to reveal your reward within ${offer.durationDays} days`
                : `${offer.scratchItems.length} rewards in the pool — scratch to reveal within ${offer.durationDays} days`
              : isDice
                ? `Roll ${diceCount} dice once — the total is your ${diceRange.min}–${diceRange.max}% discount within ${offer.durationDays} days`
                : `Collect ${offer.requiredStamps} stamps within ${offer.durationDays} days`}
          </p>
        </div>

        {/* Stamp row / scratch hint / dice hint */}
        {isScratch ? (
          <div
            className="flex flex-wrap justify-center gap-1.5"
            aria-hidden="true"
          >
            <span className="h-7 px-3 rounded-pill bg-amber-100 border border-amber-300 text-[11px] font-bold text-amber-700 grid place-items-center">
              🎁 Scratch to reveal
            </span>
            {offer.scratchMode === 'RANDOM_POOL' &&
              offer.scratchItems.slice(0, 3).map((it) => (
                <span
                  key={it.id}
                  className="h-7 px-2.5 rounded-pill bg-white border border-dashed border-amber-300 text-[11px] font-semibold text-amber-600 grid place-items-center"
                >
                  {it.label}
                </span>
              ))}
          </div>
        ) : isDice ? (
          <div className="flex flex-wrap justify-center gap-1.5" aria-hidden="true">
            {Array.from({ length: diceCount }).map((_, i) => (
              <span
                key={i}
                className="w-7 h-7 rounded-md bg-indigo-50 border border-indigo-300 text-[12px] font-bold text-indigo-700 grid place-items-center"
              >
                🎲
              </span>
            ))}
            <span className="h-7 px-3 rounded-pill bg-indigo-100 border border-indigo-300 text-[11px] font-bold text-indigo-700 grid place-items-center">
              Roll once · total = discount %
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap justify-center gap-1.5" aria-hidden="true">
            {Array.from({ length: stampDots }).map((_, i) => (
              <span
                key={i}
                className="w-6 h-6 rounded-full border-[1.5px] border-dashed border-brand-green/40 bg-primary-fixed/50 grid place-items-center font-label-sm text-label-sm text-brand-green"
              >
                {i + 1}
              </span>
            ))}
            {stampOverflow > 0 && (
              <span className="h-6 px-2 rounded-pill bg-primary-fixed text-on-primary-fixed text-[11px] font-bold grid place-items-center">
                +{stampOverflow}
              </span>
            )}
          </div>
        )}

        {/* QR (popIn recipe: scale 0→1, rotate -180→0, 600ms bounce) */}
        <motion.div
          initial={shouldReduceMotion ? false : 'hidden'}
          animate="visible"
          variants={popIn}
          className="p-3 bg-white rounded-card border border-hairline shadow-ambient"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrDataUrl}
            alt={`QR code for ${offer.title}`}
            className="w-52 h-52 md:w-60 md:h-60"
          />
        </motion.div>

        <div className="flex flex-col gap-1">
          <p className="font-label-lg text-label-lg text-on-surface">
            Scan with any phone camera
          </p>
          <p className="font-body-sm text-body-sm text-on-surface-variant break-all max-w-xs mx-auto">{scanUrl}</p>
        </div>
      </Card>

      {/* Poster template preview, if one was saved on the offer */}
      {offer.posterTemplateUrl && !posterFailed && (
        <Card className="p-3">
          <p className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant mb-2">
            Poster preview
          </p>
          <div className="relative rounded-input overflow-hidden border border-brand-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={offer.posterTemplateUrl}
              alt="Poster template"
              className="w-full h-40 object-cover"
              onError={() => setPosterFailed(true)}
            />
            {qrDataUrl && (
              <img
                src={qrDataUrl}
                alt=""
                aria-hidden="true"
                className="absolute bottom-2 right-2 w-16 h-16 bg-white p-1 rounded-[8px] shadow"
              />
            )}
          </div>
        </Card>
      )}

      {/* Actions */}
      <div className="grid grid-cols-2 gap-3">
        <Button variant="outline" onClick={handleCopy}>
          {copied ? (
            <>
              <CheckCircle2 className="w-4 h-4 mr-1.5 text-brand-green" /> Copied
            </>
          ) : (
            <>
              <Copy className="w-4 h-4 mr-1.5" /> Copy Link
            </>
          )}
        </Button>
        <a
          href={qrDataUrl}
          download={`loyl-qr-${offer.id}.png`}
          className="inline-flex items-center justify-center font-semibold min-h-[44px] px-4 py-2.5 text-base border border-brand-border bg-white text-on-surface hover:bg-primary-container/[0.04] focus:outline-none focus:ring-2 focus:ring-brand-green focus:ring-offset-2 rounded-input transition-all"
        >
          <Download className="w-4 h-4 mr-1.5" /> Download PNG
        </a>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="w-4 h-4 mr-1.5" /> Print
        </Button>
        <Button variant="primary" onClick={() => router.push(`/offers/${offer.id}`)}>
          <Pencil className="w-4 h-4 mr-1.5" /> Edit Offer
        </Button>
      </div>
    </div>
  );
}
