'use client';

import { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { ShieldCheck, Check, Mail, Globe, Layout } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export default function PrivacyPage() {
  const [showAccepted, setShowAccepted] = useState(false);

  return (
    <main className="min-h-screen bg-surface-container-lowest flex items-center justify-center p-4 md:p-8">
      <div className="relative w-full max-w-2xl bg-surface-container-lowest rounded-panel shadow-ambient p-8 md:p-12">
        <h1 className="text-3xl font-bold text-brand-green mb-6 tracking-tight">
          Privacy Policy
        </h1>

        <p className="text-body-md text-on-surface-variant mb-4 leading-relaxed">
          This privacy policy explains how Loyl collects, uses, discloses, and
          safeguards your personal information when you use our service.
        </p>

        <h2 className="text-xl font-semibold text-brand-green mb-3">
          Information We Collect
        </h2>

        <h3 className="text-body-sm text-brand-green mb-2">Phone Number</h3>
        <p className="text-body-sm text-on-surface-variant mb-4">
          When you register or check in, we collect your phone number as
          contact data for your loyalty account. Phone numbers are never used
          to verify your identity.
        </p>

        <h3 className="text-body-sm text-brand-green mb-2">Email Address</h3>
        <p className="text-body-sm text-on-surface-variant mb-4">
          Merchants sign in with email and password. Your email identifies
          your account and is used for account recovery and communications
          regarding your loyalty status.
        </p>

        <h3 className="text-body-sm text-brand-green mb-2">Reward Data</h3>
        <p className="text-body-sm text-on-surface-variant mb-4">
          Information about your stamp collection, reward redemptions, and
          transaction history necessary to operate the loyalty program.
        </p>

        <h2 className="text-xl font-semibold text-brand-green mt-6 mb-3">
          How We Use Your Information
        </h2>
        <ul className="text-body-sm text-on-surface-variant space-y-1">
          <li>
            To authenticate you and issue session tokens
          </li>
          <li>
            To manage your stamp cards and reward eligibility
          </li>
          <li>
            To send administrative communications about your account
          </li>
          <li>
            To improve the Loyl service and user experience
          </li>
        </ul>

        <h2 className="text-xl font-semibold text-brand-green mt-6 mb-3">
          Information Sharing
        </h2>
        <ul className="text-body-sm text-on-surface-variant space-y-1">
          <li>
            We do not sell your personal information to third parties
          </li>
          <li>
            We may share data with payment processors (bKash/Nagad) solely for
            transaction verification
          </li>
          <li>
            We may disclose data when required by law or to protect rights and
            safety
          </li>
        </ul>

        <h2 className="text-xl font-semibold text-brand-green mt-6 mb-3">
          Data Retention
        </h2>
        <p className="text-body-sm text-on-surface-variant mb-4">
          We retain your data for as long as your account is active or as needed
          to provide the Loyl service, comply with legal obligations, resolve
          disputes, and enforce our agreements.
        </p>

        <div className="mt-8 p-6 bg-surface-container-low rounded-xl border border-hairline">
          <p className="font-semibold text-on-surface mb-2">
            Your privacy matters. By using Loyl, you accept this privacy policy.
          </p>
          <Button variant="primary" onClick={() => setShowAccepted(true)}>
            I Accept
          </Button>
        </div>

        {showAccepted && (
          <p className="mt-4 text-xs text-on-surface-variant">
            You must accept the Privacy Policy to use Loyl.
          </p>
        )}
      </div>
    </main>
  );
}