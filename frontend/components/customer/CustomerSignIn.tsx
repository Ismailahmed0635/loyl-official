'use client';

import React, { useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { slideUp } from '@/lib/motion/variants';
import { createCustomerSession } from '@/lib/api/customer';
import { Smartphone } from 'lucide-react';

const PHONE_RE = /^(?:\+88)?01[3-9]\d{8}$/;

interface CustomerSignInProps {
  /** Called once the customer session cookie is issued. */
  onVerified: () => void;
  /** Overrides the heading (the scan page shows shop branding above). */
  heading?: string;
  subheading?: string;
  cta?: string;
}

/**
 * Customer check-in identity (PRD 3.3: mandatory mobile number, frictionless).
 *
 * Collects name + phone number and mints the customer session directly —
 * there is no OTP step. Numbers are collected data the merchant sees on the
 * check-in, not a verified identity. `onVerified` fires once the session
 * cookie is issued, same contract the OTP entry previously had.
 */
export const CustomerSignIn: React.FC<CustomerSignInProps> = ({
  onVerified,
  heading,
  subheading,
  cta = 'Continue',
}) => {
  const shouldReduceMotion = useReducedMotion();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inFlightRef = useRef(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlightRef.current) return;
    setError('');
    if (name.trim().length < 2) {
      setError('Please enter your full name');
      return;
    }
    if (!PHONE_RE.test(phone)) {
      setError('Enter a valid BD phone number, e.g. 01712345678');
      return;
    }
    inFlightRef.current = true;
    setLoading(true);
    try {
      const res = await createCustomerSession({ name: name.trim(), phoneNumber: phone });
      if (res?.success) {
        onVerified();
      } else {
        setError(res?.error?.message || 'Could not sign you in. Try again.');
      }
    } catch {
      setError('Network error — check your connection.');
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={shouldReduceMotion ? false : 'hidden'}
      animate="visible"
      variants={slideUp}
    >
      <Card className="p-5 sm:p-6">
        <div className="flex flex-col gap-5">
          <div>
            <span className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary-fixed text-brand-green mb-3">
              <Smartphone className="w-6 h-6" />
            </span>
            <h1 className="font-headline-md text-headline-md text-on-surface">
              {heading || 'Sign in to collect stamps'}
            </h1>
            <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
              {subheading ||
                'Enter your name and phone number to check in. No password needed.'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input
              label="Full Name"
              placeholder="Your name"
              autoComplete="name"
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              helperText="Shown to the shop when you check in."
              required
            />
            <Input
              label="Phone Number"
              placeholder="01712345678"
              autoComplete="tel"
              inputMode="tel"
              maxLength={14}
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, ''))}
              error={error || undefined}
              helperText="We only use your number for your stamp cards."
              required
            />
            <Button type="submit" variant="accent" isLoading={loading} className="w-full">
              {cta}
            </Button>
          </form>
        </div>
      </Card>
    </motion.div>
  );
};
