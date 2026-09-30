'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import type { Offer } from '@prisma/client';
import { OfferForm, OfferFormValues } from '@/components/merchant/OfferForm';
import { createOffer } from '@/lib/api/merchant';
import { FadeUp } from '@/components/animations/FadeUp';

// Offer Generator — Phase 2
export default function NewOfferPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (values: OfferFormValues) => {
    setSubmitting(true);
    setError('');
    try {
      const res = await createOffer(values);
      if (res?.success) {
        const offer = res.data.offer as Offer;
        router.push(`/offers/${offer.id}/qr`);
        return;
      }
      setError(res?.error?.message || 'Failed to create offer');
    } catch (err) {
      setError('Network error creating offer.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <FadeUp>
        <button
          onClick={() => router.push('/dashboard')}
          className="inline-flex items-center gap-1.5 font-label-lg text-label-lg text-on-surface-variant min-h-[44px] hover:text-on-surface"
        >
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </button>
        <h1 className="font-headline-md text-headline-md text-on-surface">Create an Offer</h1>
        <p className="font-body-md text-body-md text-on-surface-variant mt-1.5">
          Pick an offer type first — a classic Stamp Card, a Scratch Card with merchant-chosen
          rewards, or a Dice Roll where the total is the discount — then fill in its fields.
          We&apos;ll generate a printable QR poster next.
        </p>
      </FadeUp>

      <OfferForm
        submitLabel="Create Offer & Generate QR"
        submitting={submitting}
        error={error}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
