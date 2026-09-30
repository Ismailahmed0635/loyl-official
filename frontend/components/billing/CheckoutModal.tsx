'use client';

import React, { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { scaleIn } from '@/lib/motion/variants';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Check, Smartphone, Upload, Wallet, X } from 'lucide-react';
import {
  BKASH_NUMBER,
  CLIENT_SCREENSHOT_RULES,
  NAGAD_NUMBER,
  TIER_LABELS,
  planFor,
  screenshotClientCheck,
  submitCheckout,
  type BillingTier,
} from '@/lib/api/payments';

interface CheckoutModalProps {
  open: boolean;
  initialTier?: BillingTier;
  onClose: () => void;
  /** Fired after a successful submit so the host page can refresh. */
  onSubmitted?: (tier: BillingTier) => void;
}

const TIERS: BillingTier[] = ['FREE', 'MONTHLY', 'YEARLY', 'PREMIUM'];

/**
 * Phase 7 payment modal — shows the personal bKash/Nagad receive numbers,
 * collects transfer details, and attaches an OPTIONAL screenshot (free-tier
 * requests skip payment entirely). Submits POST /api/billing/checkout.
 */
export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  open,
  initialTier = 'MONTHLY',
  onClose,
  onSubmitted,
}) => {
  const shouldReduceMotion = useReducedMotion();

  const [tier, setTier] = useState<BillingTier>(initialTier);
  const [method, setMethod] = useState<'BKASH' | 'NAGAD'>('BKASH');
  const [senderNumber, setSenderNumber] = useState('');
  const [trxId, setTrxId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // Reset whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    setTier(initialTier);
    setMethod('BKASH');
    setSenderNumber('');
    setTrxId('');
    setFile(null);
    setError(null);
    setSubmitting(false);
    setDone(false);
  }, [open, initialTier]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, submitting, onClose]);

  const plan = planFor(tier);
  const paid = tier !== 'FREE';

  function pickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0] ?? null;
    setError(null);
    if (next) {
      const problem = screenshotClientCheck(next);
      if (problem) {
        setFile(null);
        event.target.value = '';
        setError(problem);
        return;
      }
    }
    setFile(next);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('requestedTier', tier);
      if (paid) {
        form.append('paymentMethod', method);
        form.append('senderNumber', senderNumber.trim());
        form.append('trxId', trxId.trim());
        form.append('amount', String(plan.priceBdt));
      }
      if (file) form.append('screenshot', file);

      const res = await submitCheckout(form);
      if (!res?.success) {
        setError(res?.error?.message || 'Submission failed — please try again.');
        return;
      }
      setDone(true);
      onSubmitted?.(tier);
    } catch {
      setError('Network error — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-inverse-surface/40 p-4"
      onClick={() => {
        if (!submitting) onClose();
      }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkout-title"
        initial={shouldReduceMotion ? false : 'hidden'}
        animate="visible"
        variants={scaleIn}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-surface-container-lowest p-6 shadow-ambient border border-hairline"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="checkout-title" className="font-headline-sm text-headline-sm text-on-surface">
              {done ? 'Request submitted' : 'Upgrade your subscription'}
            </h2>
            {!done && (
              <p className="mt-1 font-body-sm text-body-sm text-on-surface-variant">
                Pay with bKash or Nagad — we verify every transfer manually.
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close checkout"
            disabled={submitting}
            onClick={onClose}
            className="shrink-0 inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-input text-on-surface-variant hover:bg-surface-container-high focus:outline-none focus:ring-2 focus:ring-brand-green"
          >
            <X size={18} />
          </button>
        </div>

        {done ? (
          <div className="py-8 text-center">
            <span className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary-fixed text-on-primary-fixed">
              <Check size={24} />
            </span>
            <p className="font-headline-sm text-headline-sm text-on-surface">
              Your {TIER_LABELS[tier]} request is in review
            </p>
            <p className="mx-auto mt-2 max-w-sm font-body-sm text-body-sm text-on-surface-variant">
              {paid
                ? 'We’ll confirm the transfer on our side, then activate your subscription — usually within 24 hours.'
                : 'We’ll review your free-tier request manually — usually within 24 hours.'}{' '}
              Track progress on the Billing page.
            </p>
            <Button className="mt-6" variant="primary" size="md" onClick={onClose}>
              Back to billing
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-5">
            {/* Tier picker */}
            <fieldset>
              <legend className="font-label-lg text-label-lg text-on-surface">
                Choose a plan
              </legend>
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                {TIERS.map((value) => {
                  const valuePlan = planFor(value);
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setTier(value)}
                      aria-pressed={tier === value}
                      className={`rounded-input border px-2 py-2.5 text-center transition-colors ${
                        tier === value
                          ? 'border-brand-green bg-primary-fixed/50'
                          : 'border-brand-border bg-surface-container-lowest hover:bg-surface-container-low'
                      }`}
                    >
                      <span className="block font-label-lg text-label-lg text-on-surface">
                        {valuePlan.name}
                      </span>
                      <span className="block font-label-sm text-label-sm text-on-surface-variant tabular-nums">
                        {valuePlan.priceBdt === 0
                          ? 'Free'
                          : `৳${valuePlan.priceBdt.toLocaleString('en-US')}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {paid ? (
              <>
                {/* Personal receive numbers */}
                <div className="rounded-input border border-hairline bg-surface-container-low p-4">
                  <p className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
                    Send ৳{plan.priceBdt.toLocaleString('en-US')} to
                  </p>
                  <div className="mt-2.5 flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 font-body-md text-body-md text-on-surface">
                      <Wallet size={15} className="text-brand-green" /> bKash
                    </span>
                    <span className="font-mono text-sm font-semibold text-on-surface tabular-nums">
                      {BKASH_NUMBER}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 font-body-md text-body-md text-on-surface">
                      <Smartphone size={15} className="text-on-surface-variant" /> Nagad
                    </span>
                    <span className="font-mono text-sm font-semibold text-on-surface tabular-nums">
                      {NAGAD_NUMBER}
                    </span>
                  </div>
                  <p className="mt-3 font-body-sm text-body-sm text-on-surface-variant">
                    Use “Send Money” from your personal account, then details below.
                  </p>
                </div>

                {/* Which account was paid */}
                <fieldset>
                  <legend className="font-label-lg text-label-lg text-on-surface">
                    Which number did you pay to?
                  </legend>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {(['BKASH', 'NAGAD'] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setMethod(value)}
                        aria-pressed={method === value}
                        className={`rounded-input border px-3 py-2.5 min-h-[44px] font-label-lg text-label-lg transition-colors ${
                          method === value
                            ? 'border-brand-green bg-primary-fixed/50 text-on-surface'
                            : 'border-brand-border bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low'
                        }`}
                      >
                        {value === 'BKASH' ? 'bKash' : 'Nagad'}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    label="Your number"
                    inputMode="numeric"
                    placeholder="01XXXXXXXXX"
                    value={senderNumber}
                    onChange={(event) => setSenderNumber(event.target.value)}
                    required={paid}
                    autoComplete="tel"
                  />
                  <Input
                    label="Trx ID"
                    placeholder="e.g. 9H7BXK2EF"
                    value={trxId}
                    onChange={(event) => setTrxId(event.target.value)}
                    required={paid}
                    autoComplete="off"
                  />
                </div>

                <div className="flex items-center justify-between rounded-input border border-hairline bg-surface-container-low px-4 py-3">
                  <span className="font-body-md text-body-md text-on-surface-variant">Amount</span>
                  <span className="font-headline-sm text-headline-sm text-brand-green tabular-nums">
                    ৳{plan.priceBdt.toLocaleString('en-US')}
                  </span>
                </div>
              </>
            ) : (
              <p className="rounded-input border border-primary-fixed bg-primary-fixed/40 px-4 py-3 font-body-md text-body-md text-on-primary-fixed-variant">
                No payment needed — tell us you want the free tier and we’ll review the request
                manually.
              </p>
            )}

            {/* Optional screenshot */}
            <div>
              <label
                htmlFor="checkout-screenshot"
                className="font-label-lg text-label-lg text-on-surface"
              >
                Transaction screenshot{' '}
                <span className="font-normal text-on-surface-variant">(optional)</span>
              </label>
              <input
                id="checkout-screenshot"
                type="file"
                accept={CLIENT_SCREENSHOT_RULES.accept}
                onChange={pickFile}
                className="mt-1.5 block w-full font-body-sm text-body-sm text-on-surface-variant file:mr-3 file:cursor-pointer file:rounded-input file:border-0 file:bg-surface-container-low file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-green hover:file:bg-surface-container"
              />
              <p className="mt-1.5 flex items-center gap-1.5 font-body-sm text-body-sm text-on-surface-variant">
                <Upload size={12} /> PNG, JPEG, WebP or GIF up to 5MB — attaching it usually speeds
                up approval.
              </p>
              {file && (
                <p className="mt-1 font-body-sm text-body-sm font-medium text-brand-green">
                  Selected: {file.name}
                </p>
              )}
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-input border border-error-container bg-error-container/50 px-4 py-2.5 font-body-md text-body-md font-medium text-on-error-container"
              >
                {error}
              </p>
            )}

            <Button type="submit" variant="primary" size="md" isLoading={submitting}>
              {paid ? `Submit for verification` : 'Request free access'}
            </Button>
            <p className="-mt-2 text-center font-body-sm text-body-sm text-on-surface-variant">
              Requests are reviewed manually — usually within 24 hours.
            </p>
          </form>
        )}
      </motion.div>
    </div>
  );
};
