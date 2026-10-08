'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { User, Store, LogOut, AlertCircle, LayoutDashboard } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { FadeUp } from '@/components/animations/FadeUp';
import { getAuthMe, logout } from '@/lib/api/client';
import { listCustomerCards, CardsResponse } from '@/lib/api/customer';
import { maskPhone } from '@/lib/format';

interface MeData {
  session?: { phoneNumber?: string; role?: string };
  merchant?: { businessName?: string } | null;
}

/** `/profile` — customer identity, stats across shops, logout (Phase 3). */
export default function CustomerProfilePage() {
  const router = useRouter();
  const [me, setMe] = useState<MeData | null>(null);
  const [totals, setTotals] = useState({ cards: 0, stampsCollected: 0, totalRedeemed: 0 });
  const [shopNames, setShopNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [meRes, cardsRes] = await Promise.all([
          getAuthMe().catch(() => null),
          listCustomerCards().catch(() => null),
        ]);
        if (!alive) return;
        if (meRes?.data) setMe(meRes.data as MeData);
        if (cardsRes?.success) {
          const data = cardsRes.data as CardsResponse;
          setTotals(data.totals);
          setShopNames(data.cards.map((c) => c.businessName));
        }
      } catch {
        if (alive) setError('Network error — check your connection and try again.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      router.replace('/scan');
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <div className="h-36 bg-surface-container-lowest rounded-xl border border-hairline shadow-sm" />
        <div className="h-24 bg-surface-container-lowest rounded-xl border border-hairline shadow-sm" />
      </div>
    );
  }

  const phone = me?.session?.phoneNumber || '';
  const isMerchant = !!me?.merchant;

  const stats = [
    { label: 'Stamp Cards', value: totals.cards },
    { label: 'Stamps Held', value: totals.stampsCollected },
    { label: 'Rewards Earned', value: totals.totalRedeemed },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Identity */}
      <FadeUp>
        <Card className="p-5 flex items-center gap-4 shadow-ambient">
          <span className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-surface-container text-primary shrink-0">
            <User className="w-7 h-7" />
          </span>
          <div className="min-w-0">
            <p className="font-headline-md text-headline-md text-on-surface truncate">
              {maskPhone(phone)}
            </p>
            <Badge tone="neutral" uppercase className="mt-1.5">
              {isMerchant ? 'Loyl merchant · customer' : 'Loyl customer'}
            </Badge>
          </div>
        </Card>
      </FadeUp>

      {/* Stats */}
      <FadeUp>
        <div className="grid grid-cols-3 gap-3">
          {stats.map((s) => (
            <Card key={s.label} className="p-4 text-center">
              <p className="font-metric-num text-metric-num text-brand-green tabular-nums leading-none">
                {s.value}
              </p>
              <p className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant mt-1.5">
                {s.label}
              </p>
            </Card>
          ))}
        </div>
      </FadeUp>

      {/* Shops */}
      {shopNames.length > 0 && (
        <FadeUp>
          <Card className="p-5 flex flex-col gap-3">
            <h2 className="font-headline-sm text-headline-sm text-on-surface">Your shops</h2>
            <div className="flex flex-col gap-2">
              {shopNames.map((name) => (
                <div
                  key={name}
                  className="flex items-center gap-2 font-body-md text-body-md text-on-surface"
                >
                  <Store size={16} className="text-brand-green shrink-0" />
                  <span className="truncate">{name}</span>
                </div>
              ))}
            </div>
          </Card>
        </FadeUp>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-input bg-brand-red/5 border border-brand-red/25 px-3 py-2.5">
          <AlertCircle className="w-4 h-4 text-brand-red shrink-0" />
          <p className="font-body-sm text-body-sm text-brand-red">{error}</p>
        </div>
      )}

      {/* Actions */}
      <FadeUp>
        <div className="flex flex-col gap-3">
          {isMerchant && (
            <Button variant="outline" className="w-full" onClick={() => router.push('/dashboard')}>
              <LayoutDashboard className="w-4 h-4 mr-1.5" /> Open Merchant Dashboard
            </Button>
          )}
          <Button
            variant="outline"
            className="w-full border-brand-red/30 bg-brand-red/5 text-brand-red hover:bg-brand-red/10"
            onClick={handleLogout}
            isLoading={loggingOut}
          >
            <LogOut className="w-4 h-4 mr-1.5" /> Log out
          </Button>
        </div>
      </FadeUp>
    </div>
  );
}
