'use client';

import React, { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { slideUp } from '@/lib/motion/variants';
import { submitBusinessSetup } from '@/lib/api/client';
import { peekSetupPhone, clearSetupPhone } from '@/lib/setupPhone';
import { Store, Building2, Tag, CheckCircle2 } from 'lucide-react';

const CATEGORIES = [
  'Café & Bakery',
  'Restaurant & Fast Food',
  'Salon & Spa',
  'Gym & Fitness',
  'Retail & Clothing',
  'Electronics & Gadgets',
  'Other Local Business',
];

function BusinessSetupContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const shouldReduceMotion = useReducedMotion();

  // C-01: the verified phone arrives via sessionStorage (same-tab); the
  // legacy ?phone= query is honored only as a fallback for old links.
  const phoneParam = searchParams.get('phone') || peekSetupPhone() || '';
  const [businessName, setBusinessName] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  // Never prefill a fake number: an empty field forces the merchant to type
  // their real phone (the old '01712345678' default was submitted as-is and
  // then rejected by the PHONE_MISMATCH guard).
  const [phoneNumber, setPhoneNumber] = useState(phoneParam);
  const [loading, setLoading] = useState(false);
  // Per-field errors: a server/client failure must render under the input it
  // belongs to (PHONE_TAKEN under phone, never under business name).
  // Anything session-level or unknown goes to formError.
  const [fieldErrors, setFieldErrors] = useState<{
    businessName?: string;
    phoneNumber?: string;
  }>({});
  const [formError, setFormError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErrors({});
    setFormError('');

    const nextErrors: typeof fieldErrors = {};
    if (!businessName.trim()) {
      nextErrors.businessName = 'Please enter your business name';
    }
    if (!phoneNumber.trim()) {
      nextErrors.phoneNumber = 'Please enter your merchant phone number';
    }
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      return;
    }

    setLoading(true);
    try {
      const res = await submitBusinessSetup({
        businessName: businessName.trim(),
        category,
        phoneNumber: phoneNumber.trim(),
      });

      if (res.success) {
        clearSetupPhone();
        router.push('/dashboard');
      } else {
        const code: string | undefined = res.error?.code;
        const message: string = res.error?.message || 'Failed to save business profile';
        if (code === 'PHONE_TAKEN') {
          setFieldErrors({ phoneNumber: message });
        } else if (code === 'VALIDATION_ERROR') {
          // 422s carry only a message — route it by content.
          if (/business name/i.test(message)) setFieldErrors({ businessName: message });
          else if (/phone/i.test(message)) setFieldErrors({ phoneNumber: message });
          else setFormError(message);
        } else {
          setFormError(message);
        }
      }
    } catch (err) {
      setFormError('Network error saving profile.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={shouldReduceMotion ? false : 'hidden'}
      animate="visible"
      variants={slideUp}
      className="max-w-md mx-auto"
    >
      <Card className="p-0 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3.5 bg-surface-container-low border-b border-hairline">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-8 h-8 rounded-lg bg-brand-green/10 text-brand-green grid place-items-center shrink-0">
              <Building2 className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h1 className="font-headline-sm text-headline-sm text-on-surface leading-tight">
                Merchant Profile
              </h1>
              <p className="font-label-sm text-label-sm text-on-surface-variant">
                Step 2 of 2 · Takes under a minute
              </p>
            </div>
          </div>
          <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-pill bg-brand-green/5 text-brand-green font-label-sm text-label-sm shrink-0">
            <CheckCircle2 className="w-3 h-3" /> Setup
          </span>
        </div>

        <div className="px-6 pb-6 pt-5">
          <p className="font-body-md text-body-md text-on-surface-variant mb-5">
            Tell us about your business to generate your customized loyalty stamp card.
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input
              label="Business Name *"
              placeholder="e.g. Crimson Cup Banani"
              value={businessName}
              onChange={(e) => {
                setBusinessName(e.target.value);
                if (fieldErrors.businessName) setFieldErrors((p) => ({ ...p, businessName: undefined }));
              }}
              error={fieldErrors.businessName}
              required
            />

            <div className="flex flex-col gap-1.5">
              <label className="font-label-lg text-label-lg text-on-surface flex items-center gap-1.5">
                <Tag className="w-4 h-4 text-brand-green" /> Business Category *
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full min-h-[48px] px-4 py-3 bg-white border border-brand-border rounded-input text-on-surface focus:outline-none focus:border-brand-green focus:ring-1 focus:ring-brand-green transition-all"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <Input
              label="Merchant Phone Number *"
              placeholder="01712345678"
              type="tel"
              inputMode="tel"
              value={phoneNumber}
              onChange={(e) => {
                setPhoneNumber(e.target.value);
                if (fieldErrors.phoneNumber) setFieldErrors((p) => ({ ...p, phoneNumber: undefined }));
              }}
              error={fieldErrors.phoneNumber}
              required
            />

            {formError && (
              <p role="alert" className="font-body-sm text-body-sm text-brand-red">
                {formError}
              </p>
            )}

            <Button type="submit" variant="primary" isLoading={loading} className="w-full mt-2 rounded-lg">
              Complete Setup &amp; Go to Dashboard <CheckCircle2 className="w-4 h-4 ml-2" />
            </Button>
          </form>
        </div>
      </Card>
    </motion.div>
  );
}

export default function BusinessSetupPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-surface-container-lowest">
      <div className="w-full max-w-md mx-auto md:max-w-2xl lg:max-w-6xl">
        <Suspense fallback={<div className="text-center py-8">Loading setup...</div>}>
          <BusinessSetupContent />
        </Suspense>
      </div>
    </main>
  );
}
