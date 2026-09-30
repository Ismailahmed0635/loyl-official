'use client';

import React, { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Gift, PartyPopper, CheckCircle2, AlertCircle } from 'lucide-react';
import { scaleIn } from '@/lib/motion/variants';
import { Button } from '@/components/ui/Button';
import { StampGrid } from '@/components/customer/StampGrid';
import { ScratchCard } from '@/components/customer/ScratchCard';

interface RewardModalProps {
  open: boolean;
  /** 'ready' = celebration + claim button; 'claimed' = post-redeem receipt. */
  mode: 'ready' | 'claimed';
  businessName?: string;
  rewardTitle: string;
  rewardLabel: string;
  requiredStamps: number;
  onClose?: () => void;
  onClaim?: () => void;
  claiming?: boolean;
  error?: string | null;
  claimedAt?: string | null;
}

/**
 * PRD 3.3: the animated confirmation pop-up shown when all stamps are
 * collected — celebration state with a redemption button to show the cashier,
 * then the claimed receipt.
 */
export const RewardModal: React.FC<RewardModalProps> = ({
  open,
  mode,
  businessName,
  rewardTitle,
  rewardLabel,
  requiredStamps,
  onClose,
  onClaim,
  claiming = false,
  error,
  claimedAt,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const [revealed, setRevealed] = useState(false);

  // Fresh foil every time the modal opens on the 'ready' state.
  useEffect(() => {
    if (open && mode === 'ready') setRevealed(false);
  }, [open, mode]);

  if (!open) return null;

  const claimedTime = claimedAt
    ? new Date(claimedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <button
        type="button"
        className="absolute inset-0 bg-on-surface/60 cursor-default"
        aria-label="Close reward dialog"
        onClick={mode === 'ready' && !claiming ? onClose : undefined}
      />

      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'ready' ? 'Reward ready' : 'Reward claimed'}
        initial={shouldReduceMotion ? false : 'hidden'}
        animate="visible"
        variants={scaleIn}
        className="relative w-full max-w-sm bg-surface-container-lowest rounded-card p-6 shadow-ambient border border-hairline text-center flex flex-col gap-4"
      >
        {/* Icon */}
        <div className="mx-auto">
          <span
            className={`inline-flex items-center justify-center w-14 h-14 rounded-xl ${
              mode === 'ready'
                ? 'bg-brand-amber/15 text-brand-amber'
                : 'bg-primary-fixed text-brand-green'
            }`}
          >
            {mode === 'ready' ? (
              <Gift className="w-7 h-7" />
            ) : (
              <PartyPopper className="w-7 h-7" />
            )}
          </span>
        </div>

        <div>
          <h2 className="font-headline-sm text-headline-sm text-on-surface">
            {mode === 'ready' ? 'Your reward is ready!' : 'Reward claimed!'}
          </h2>
          {businessName && (
            <p className="font-body-sm text-body-sm text-on-surface-variant mt-1 inline-flex items-center justify-center gap-1.5">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full bg-brand-green"
                aria-hidden="true"
              />
              {businessName}
            </p>
          )}
        </div>

        {/* Full card celebration (ready) / reset note (claimed) */}
        {mode === 'ready' ? (
          <div className="flex flex-col gap-3 items-center">
            <ScratchCard
              className="w-full"
              hint="Scratch to reveal your reward"
              onReveal={() => setRevealed(true)}
            >
              <div className="flex flex-col gap-3 items-center rounded-card px-3 py-4 border border-dashed border-primary-fixed bg-surface-container-low">
                <StampGrid total={requiredStamps} filled={requiredStamps} size="sm" className="justify-center" />
                <div>
                  <p className="font-label-lg text-label-lg text-on-surface">{rewardTitle}</p>
                  <p className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant mt-0.5">
                    {rewardLabel}
                  </p>
                </div>
              </div>
            </ScratchCard>
            {!revealed && (
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Scratch the card to reveal your reward
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5">
            <CheckCircle2 className="w-8 h-8 text-brand-green" />
            <p className="font-label-lg text-label-lg text-on-surface">
              Show this screen to the cashier
            </p>
            {claimedTime && (
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Redeemed at {claimedTime}
              </p>
            )}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 text-left rounded-input bg-brand-red/5 border border-brand-red/25 px-3 py-2">
            <AlertCircle className="w-4 h-4 text-brand-red shrink-0 mt-0.5" />
            <p className="font-body-sm text-body-sm text-brand-red">{error}</p>
          </div>
        )}

        {mode === 'ready' ? (
          <Button
            variant={revealed ? 'accent' : 'primary'}
            className="w-full"
            isLoading={claiming}
            disabled={!revealed}
            onClick={onClaim}
          >
            {revealed ? 'Claim Reward' : 'Scratch to claim'}
          </Button>
        ) : (
          <Button variant="outline" className="w-full" onClick={onClose}>
            Done
          </Button>
        )}
      </motion.div>
    </div>
  );
};
