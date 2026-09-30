'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { slideUp, fadeUp } from '@/lib/motion/variants';
import {
  isValidOptionalPhone,
  loginWithEmail,
  normalizeOptionalPhone,
  registerWithEmail,
  getFirebaseIdToken,
  validateEmail,
  validatePassword,
} from '@/lib/firebase/email-auth';
import { createEmailSession } from '@/lib/api/client';
import { CrowdCanvas } from '@/components/ui/skiper-ui/skiper39';
import { stashSetupPhone } from '@/lib/setupPhone';
import { QrCode, Store, Sparkles } from 'lucide-react';

type Mode = 'register' | 'login';

export default function WelcomePage() {
  const router = useRouter();
  const shouldReduceMotion = useReducedMotion();
  const [mode, setMode] = useState<Mode>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string; phone?: string }>({});
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);
  // The crowd is client-only: the server renders without it, so hydration never
  // sees a server/client difference (useReducedMotion answers false during SSR).
  const [crowdMounted, setCrowdMounted] = useState(false);
  useEffect(() => {
    setCrowdMounted(true);
  }, []);

  const isRegister = mode === 'register';

  function switchMode(next: Mode) {
    setMode(next);
    setFieldErrors({});
    setFormError('');
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    // Clean client-side validation (same helpers the Firebase wrapper uses,
    // so the form and the SDK can never disagree on what is valid).
    const nextErrors: typeof fieldErrors = {};
    const emailErr = validateEmail(email);
    if (emailErr) nextErrors.email = emailErr;
    const passwordErr = isRegister ? validatePassword(password) : !password ? 'Password is required.' : null;
    if (passwordErr) nextErrors.password = passwordErr;
    if (isRegister && !isValidOptionalPhone(phone)) {
      nextErrors.phone = 'Enter a valid phone number or leave it blank.';
    }
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setLoading(true);
    try {
      // Firebase Email/Password Auth: register writes Firestore `users/{uid}` =
      // { uid, email, phone? } (+ serverTimestamp); login is Auth-only.
      if (isRegister) {
        await registerWithEmail({ email, password, phone });
        // Forward the merchant's own number (if they typed one) so setup
        // prefills it — via sessionStorage, never the URL (C-01).
        const normalized = normalizeOptionalPhone(phone);
        stashSetupPhone(normalized ?? '');
      } else {
        await loginWithEmail(email, password);
      }
      // The Firebase sign-in alone authorizes nothing in this app: mint the
      // `loyl_session` cookie from the verified ID token, then route on
      // whether a merchant profile already exists for the email.
      const idToken = await getFirebaseIdToken();
      if (!idToken) {
        throw new Error('Signed in, but no session token was issued. Please try again.');
      }
      const session = await createEmailSession({ idToken });
      if (!session?.success) {
        throw new Error(
          session?.error?.message || 'Could not start your session. Please try again.'
        );
      }
      router.push(session?.data?.isExistingMerchant ? '/dashboard' : '/business-setup');
    } catch (err) {
      // registerWithEmail / loginWithEmail already map Firebase codes to
      // user-friendly messages — render `message` directly.
      setFormError(err instanceof Error && err.message ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative min-h-screen flex items-center justify-center overflow-hidden p-4 pb-[210px] md:pb-[250px] bg-surface-container-lowest">
      {/*
        Skiper39 "Canvas crowd" — hero animation band.
        It is pinned to the bottom in its own stacking layer (z-0) while the copy
        sits at z-10 with the matching bottom padding, so the crowd can never walk
        over the text. `pointer-events-none` keeps the form tappable.
      */}
      {crowdMounted && !shouldReduceMotion && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-[200px] overflow-hidden md:h-[240px]"
        >
          {/*
            The sprite draws each figure at 240x324 CSS px, so the scaler shrinks it
            to the band (0.4 on mobile, 0.5 from md up). Width is compensated by the
            inverse of the scale, keeping the walk spanning the full screen.
          */}
          <div className="absolute bottom-0 left-[-75%] h-[90vh] w-[250%] origin-bottom scale-[0.4] md:left-[-50%] md:w-[200%] md:scale-50">
            <CrowdCanvas src="/images/peeps/all-peeps.png" rows={15} cols={7} />
          </div>
        </div>
      )}

      <div className="relative z-10 w-full max-w-md mx-auto md:max-w-2xl lg:max-w-6xl">
        <motion.div
          initial={shouldReduceMotion ? false : 'hidden'}
          animate="visible"
          variants={slideUp}
          className="max-w-md mx-auto"
        >
          {/* Brand trust overhead badge */}
          <div className="flex justify-center mb-4">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-pill bg-surface-container-low border border-hairline shadow-hairline">
              <span className="w-2 h-2 rounded-full bg-brand-red animate-pulse" aria-hidden="true" />
              <span className="font-label-sm text-label-sm uppercase tracking-wider text-brand-green font-bold">
                Loyalty built for Bangladesh
              </span>
            </span>
          </div>

          {/* Brand centerpiece */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-brand-green text-white shadow-inset-light mb-4">
              <QrCode className="w-8 h-8" />
            </div>
            <h1 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface tracking-tight">
              Loyl<span className="text-brand-green">.io</span>
            </h1>
            <p className="font-body-md text-body-md text-on-surface-variant mt-1 max-w-xs mx-auto">
              Digital loyalty &amp; stamp cards for Bangladesh merchants
            </p>
          </div>

          {/* Form card with tinted micro-header */}
          <Card className="p-0 overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-3.5 mb-5 bg-surface-container-low border-b border-hairline">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-8 h-8 rounded-lg bg-brand-green/10 text-brand-green grid place-items-center shrink-0">
                  <Store className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <h2 className="font-headline-sm text-headline-sm text-on-surface leading-tight">
                    Merchant Access
                  </h2>
                  <p className="font-label-sm text-label-sm text-on-surface-variant">
                    {isRegister ? 'Create your account with email' : 'Sign in with your email'}
                  </p>
                </div>
              </div>
              <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-pill bg-brand-green/5 text-brand-green font-label-sm text-label-sm shrink-0">
                <Sparkles className="w-3 h-3" /> Free to start
              </span>
            </div>

            <div className="px-6 pb-6">
              <motion.div variants={fadeUp} className="flex flex-col gap-6">
                {/* Register / login toggle */}
                <div className="flex gap-2" role="tablist" aria-label="Account mode">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isRegister}
                    onClick={() => switchMode('register')}
                    className={`min-h-[44px] flex-1 px-4 rounded-input font-semibold transition-all ${
                      isRegister
                        ? 'bg-brand-green text-white shadow-inset-light'
                        : 'border border-brand-border text-on-surface'
                    }`}
                  >
                    Register
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={!isRegister}
                    onClick={() => switchMode('login')}
                    className={`min-h-[44px] flex-1 px-4 rounded-input font-semibold transition-all ${
                      !isRegister
                        ? 'bg-brand-green text-white shadow-inset-light'
                        : 'border border-brand-border text-on-surface'
                    }`}
                  >
                    Log in
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
                  <Input
                    label="Email Address"
                    placeholder="you@example.com"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    error={fieldErrors.email}
                    required
                  />

                  <Input
                    label="Password"
                    placeholder={isRegister ? '8+ chars, upper + lower + number' : 'Your password'}
                    type="password"
                    autoComplete={isRegister ? 'new-password' : 'current-password'}
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    error={fieldErrors.password}
                    helperText={isRegister ? 'Min 8 characters with upper, lower and a number.' : undefined}
                    required
                  />

                  {isRegister && (
                    <Input
                      label="Mobile Phone Number (optional)"
                      placeholder="01712345678"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      value={phone}
                      onChange={(e) => {
                        setPhone(e.target.value);
                        // Clear the phone error live once the value normalises.
                        if (fieldErrors.phone && normalizeOptionalPhone(e.target.value) !== null) {
                          setFieldErrors((prev) => ({ ...prev, phone: undefined }));
                        }
                      }}
                      error={fieldErrors.phone}
                      helperText="Optional — used for order and payment contact only"
                    />
                  )}

                  {formError && (
                    <p role="alert" className="font-body-sm text-body-sm text-brand-red">
                      {formError}
                    </p>
                  )}

                  <Button type="submit" variant="primary" isLoading={loading} className="w-full mt-2 rounded-lg">
                    {isRegister ? (
                      <>Sign Up with Email <Sparkles className="w-4 h-4 ml-2" /></>
                    ) : (
                      'Log in'
                    )}
                  </Button>
                </form>
              </motion.div>
            </div>
          </Card>
        </motion.div>
      </div>
    </main>
  );
}
