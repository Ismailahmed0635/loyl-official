'use client';

import { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { ShieldCheck, Check, Mail, Globe, Layout } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export default function PricingPage() {
  const router = useRouter();
  const plans = [
    {
      name: 'Free',
      price: '৳0/mo',
      features: [
        '1 location',
        'Scratch card offers only',
        'Printable QR kit',
        'Basic analytics',
      ],
    },
    {
      name: 'Starter',
      price: '৳500/mo',
      features: [
        '1 branch, all features',
        'Digital menu included',
        'Unlimited stamp scans',
        'Priority support',
      ],
    },
    {
      name: 'Growth',
      price: '৳1,000/mo',
      features: [
        'Up to 3 branches',
        'Everything in Starter',
        'GPS auto-store detection',
        'Dedicated priority support',
      ],
    },
    {
      name: 'Enterprise',
      price: 'Custom',
      features: [
        'Unlimited locations',
        'White-label options',
        'POS & ERP integration support',
        'Dedicated account manager',
      ],
    },
  ];

  return (
    <main className="min-h-screen bg-surface-container-lowest flex items-center justify-center p-4 md:p-8">
      <div className="relative w-full max-w-md mx-auto md:max-w-2xl lg:max-w-6xl bg-surface-container-lowest rounded-panel shadow-ambient p-8 md:p-12">
        <h1 className="text-3xl font-bold text-brand-green mb-6 tracking-tight">
          Pricing
        </h1>

        <p className="text-body-md text-on-surface-variant mb-6 leading-relaxed">
          Choose the plan that fits your needs. All plans include a free trial
          period for new merchants.
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className="group bg-surface-container-low rounded-2xl border border-hairline p-6 md:p-8 shadow-ambient hover:shadow-lg transition-shadow min-h-fit"
            >
              <h2 className="text-xl font-semibold text-brand-green mb-4 tracking-tight">
                {plan.name} {plan.price}
              </h2>

              <ul className="space-y-2 text-body-sm text-on-surface-variant">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start">
                    <span className="w-4 h-4 rounded bg-brand-green/10 flex items-center justify-center">
                      <Check className="w-2 h-2 text-brand-green" />
                    </span>
                    <span className="ml-3 flex-1">{feature}</span>
                  </li>
                ))}
              </ul>

              <Button
                variant="outline"
                onClick={() => router.push('/dashboard')}
                className="mt-4 w-full"
              >
                Start {plan.name.toLowerCase()}
              </Button>
            </div>
          ))}
        </div>

        <div className="mt-8 pt-8 border-t border-hairline">
          <p className="text-xs text-on-surface-variant">
            No payment required to start. Paid plans include a 3-day free trial.
          </p>
        </div>
      </div>
    </main>
  );
}