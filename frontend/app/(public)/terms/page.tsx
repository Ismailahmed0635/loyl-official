'use client';

import { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { ShieldCheck, Check, Mail, Globe, Layout } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export default function TermsPage() {
  const [showAccepted, setShowAccepted] = useState(false);

  const handleAccept = () => {
    setShowAccepted(true);
  };

  return (
    <main className="min-h-screen bg-surface-container-lowest flex items-center justify-center p-4 md:p-8">
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-ambient p-8 md:p-12">
        <h1 className="text-3xl font-bold text-brand-green mb-6 tracking-tight">
          Terms of Service
        </h1>

        <p className="text-body-md text-on-surface-variant mb-4 leading-relaxed">
          These terms govern your use of the Loyl loyalty platform. By accessing
          or using the service, you accept these terms without qualification or
          modification.
        </p>

        <h2 className="text-xl font-semibold text-brand-green mt-6 mb-3">
          1. Acceptance
        </h2>
        <p className="text-body-sm text-on-surface-variant mb-4">
          By registering an account or using the Loyl mobile application, you
          agree to these Terms of Service, Privacy Policy, and all applicable
          laws and regulations. If you disagree with any part of the terms, you
          may not access the service.
        </p>

        <h2 className="text-xl font-semibold text-brand-green mt-6 mb-3">
          2. Account Registration
        </h2>
        <p className="text-body-sm text-on-surface-variant mb-4">
          Users must provide accurate, current, and complete information during
          registration. You are responsible for maintaining the security of your
          account password and for all activities that occur under your account.
        </p>

        <h2 className="text-xl font-semibold text-brand-green mt-6 mb-3">
          3. Merchant Terms
        </h2>
        <p className="text-body-sm text-on-surface-variant mb-4">
          Merchants using Loyl to create offers and loyalty programs must comply
          with all applicable regulations, including but not limited to consumer
          protection laws, advertising standards, and data privacy requirements.
        </p>

        <h2 className="text-xl font-semibold text-brand-green mt-6 mb-3">
          4. Customer Rights
        </h2>
        <p className="text-body-sm text-on-surface-variant mb-4">
          Customers have the right to collect stamps, redeem rewards, and request
          deletion of their personal data in accordance with applicable law.
        </p>

        <h2 className="text-xl font-semibold text-brand-green mt-6 mb-3">
          5. Liability Limitation
        </h2>
        <p className="text-body-sm text-on-surface-variant mb-4">
          Loyl and its merchants are not liable for indirect, incidental, or
          consequential damages arising from the use or inability to use the
          service.
        </p>

        <div className="mt-8 p-6 bg-surface-container-low rounded-xl border border-hairline">
          <p className="font-semibold text-on-surface mb-2">
            By continuing to use Loyl, you accept these terms.
          </p>
          <Button onClick={handleAccept} variant="primary">
            I Accept
          </Button>
        </div>

        {showAccepted && (
          <p className="mt-4 text-xs text-on-surface-variant">
            You must accept the Terms of Service to use Loyl.
          </p>
        )}
      </div>
    </main>
  );
}