'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { QrCode, AlertCircle, Gift, Store } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FadeUp } from '@/components/animations/FadeUp';
import { StampGrid } from '@/components/customer/StampGrid';
import { RewardModal } from '@/components/customer/RewardModal';
import { useRewardClaim } from '@/components/customer/useRewardClaim';
import { listCustomerCards, CustomerCardItem, CardsResponse, RedeemResult } from '@/lib/api/customer';
import { REWARD_LABELS } from '@/lib/constants';
import { timeUntil } from '@/lib/format';

/**
 * `/stamp-card` — every stamp card the customer holds, with the animated
 * stamp grid (phases.md Phase 3 deliverable file).
 */
export default function StampCardPage() {
  const router = useRouter();
  const [cards, setCards] = useState<CustomerCardItem[]>([]);
  const [totals, setTotals] = useState({ cards: 0, stampsCollected: 0, totalRedeemed: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const { item, claimed, claiming, claimError, open, close, claim } = useRewardClaim(
    useCallback((merchantId: string, next: RedeemResult) => {
      setCards((prev) =>
        prev.map((c) => (c.merchantId === merchantId ? { ...c, state: next.card } : c))
      );
      setTotals((t) => ({
        ...t,
        stampsCollected: t.stampsCollected - next.reward.requiredStamps + next.card.stampsCollected,
        totalRedeemed: t.totalRedeemed + 1,
      }));
    }, [])
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await listCustomerCards();
      if (res?.success) {
        const data = res.data as CardsResponse;
        setCards(data.cards);
        setTotals(data.totals);
      } else {
        setError(res?.error?.message || 'Failed to load your stamp cards.');
      }
    } catch {
      setError('Network error — check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <div className="h-16 bg-surface-container-lowest rounded-xl border border-hairline shadow-hairline" />
        {[0, 1].map((i) => (
          <div key={i} className="h-48 bg-surface-container-lowest rounded-xl border border-hairline shadow-hairline" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card className="flex flex-col items-start gap-3">
        <div className="flex items-center gap-2 text-brand-red">
          <AlertCircle className="w-5 h-5" />
          <p className="font-body-sm text-body-sm font-medium">{error}</p>
        </div>
        <button
          onClick={load}
          className="min-h-[44px] px-4 rounded-input bg-brand-green text-white font-label-lg text-label-lg shadow-inset-light hover:bg-brand-greenDark transition-colors"
        >
          Try again
        </button>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <FadeUp>
        <div>
          <h1 className="font-headline-md text-headline-md text-on-surface">Your Stamp Cards</h1>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
            {totals.cards} {totals.cards === 1 ? 'shop' : 'shops'} · {totals.totalRedeemed}{' '}
            {totals.totalRedeemed === 1 ? 'reward' : 'rewards'} earned
          </p>
        </div>
      </FadeUp>

      {cards.length === 0 ? (
        <FadeUp>
          <Card className="p-6 flex flex-col items-center text-center gap-3">
            <span className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-primary-fixed text-brand-green">
              <QrCode className="w-7 h-7" />
            </span>
            <p className="font-headline-sm text-headline-sm text-on-surface">No stamp cards yet</p>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              Scan a Loyl QR poster at any shop to start collecting your first stamp.
            </p>
            <Button variant="primary" size="sm" onClick={() => router.push('/scan')}>
              Go to Scan
            </Button>
          </Card>
        </FadeUp>
      ) : (
        cards.map((c) => {
          const required = c.offer?.requiredStamps ?? null;
          const stamps = c.state.stampsCollected;
          const complete = c.state.complete;

          return (
            <FadeUp key={c.merchantId}>
              <Card className="p-5 flex flex-col gap-4">
                {/* Shop header */}
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center justify-center w-10 h-10 rounded-input bg-primary-fixed text-brand-green shrink-0 overflow-hidden">
                    {c.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.logoUrl} alt="" className="w-10 h-10 rounded-input object-cover" />
                    ) : (
                      <Store size={18} />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-label-lg text-label-lg text-on-surface truncate">
                      {c.businessName}
                    </p>
                    <p className="font-body-sm text-body-sm text-on-surface-variant truncate">
                      {c.category}
                    </p>
                  </div>
                  {complete ? (
                    <span className="px-2.5 py-1 rounded-pill bg-brand-amber/15 text-brand-amber font-label-sm text-label-sm uppercase tracking-wider shrink-0">
                      Reward ready!
                    </span>
                  ) : required !== null ? (
                    <span className="px-2.5 py-1 rounded-pill bg-surface-container-high text-on-surface-variant font-label-sm text-label-sm uppercase tracking-wider shrink-0">
                      {stamps}/{required}
                    </span>
                  ) : null}
                </div>

                {c.offer && required !== null ? (
                  <>
                    <StampGrid total={required} filled={stamps} />

                    <div className="flex items-center justify-between font-body-sm text-body-sm gap-2">
                      <p className="text-on-surface-variant">
                        {c.offer.title} ·{' '}
                        <span className="font-semibold text-on-surface">
                          {REWARD_LABELS[c.offer.rewardType] || 'reward'}
                        </span>
                      </p>
                      {!complete && !c.state.canScan && (
                        <p className="text-on-surface-variant shrink-0">
                          Next stamp {timeUntil(c.state.nextScanAt)}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 border-t border-hairline pt-3">
                      {complete && (
                        <Button variant="accent" size="sm" onClick={() => open(c)}>
                          <Gift className="w-4 h-4 mr-1.5" /> Claim Reward
                        </Button>
                      )}
                      <button
                        onClick={() => router.push(`/scan/${c.offer!.id}`)}
                        className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-input font-label-lg text-label-lg text-brand-green hover:bg-primary-fixed/40"
                      >
                        <QrCode className="w-4 h-4" /> Open offer
                      </button>
                      {c.state.totalRedeemed > 0 && (
                        <span className="ml-auto font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
                          {c.state.totalRedeemed} redeemed
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="font-body-sm text-body-sm text-on-surface-variant">
                    This shop has no active offer right now — check back soon.
                  </p>
                )}
              </Card>
            </FadeUp>
          );
        })
      )}

      {/* Reward pop-up for the selected card */}
      <RewardModal
        open={!!item}
        mode={claimed ? 'claimed' : 'ready'}
        businessName={item?.businessName}
        rewardTitle={claimed?.reward.title || item?.offer?.title || 'Reward'}
        rewardLabel={
          REWARD_LABELS[(claimed?.reward.rewardType || item?.offer?.rewardType) as string] || ''
        }
        requiredStamps={item?.offer?.requiredStamps ?? 0}
        claiming={claiming}
        error={claimed ? null : claimError}
        claimedAt={claimed?.claimedAt ?? null}
        onClaim={claim}
        onClose={close}
      />
    </div>
  );
}
