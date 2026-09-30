'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Gift, AlertCircle, Sparkles } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FadeUp } from '@/components/animations/FadeUp';
import { RewardModal } from '@/components/customer/RewardModal';
import { useRewardClaim } from '@/components/customer/useRewardClaim';
import { listCustomerCards, CustomerCardItem, CardsResponse, RedeemResult } from '@/lib/api/customer';
import { REWARD_LABELS } from '@/lib/constants';

/**
 * `/reward` — rewards ready to claim + redemption history
 * (phases.md Phase 3 deliverable file; PRD 3.3 reward claim).
 */
export default function RewardPage() {
  const [cards, setCards] = useState<CustomerCardItem[]>([]);
  const [totalRedeemed, setTotalRedeemed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const { item, claimed, claiming, claimError, open, close, claim } = useRewardClaim(
    useCallback((merchantId: string, next: RedeemResult) => {
      setCards((prev) =>
        prev.map((c) => (c.merchantId === merchantId ? { ...c, state: next.card } : c))
      );
      setTotalRedeemed((n) => n + 1);
    }, [])
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await listCustomerCards();
        if (!alive) return;
        if (res?.success) {
          const data = res.data as CardsResponse;
          setCards(data.cards);
          setTotalRedeemed(data.totals.totalRedeemed);
        } else {
          setError(res?.error?.message || 'Failed to load your rewards.');
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

  if (loading) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <div className="h-24 bg-surface-container-lowest rounded-xl border border-hairline shadow-hairline" />
        <div className="h-32 bg-surface-container-lowest rounded-xl border border-hairline shadow-hairline" />
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
          onClick={() => window.location.reload()}
          className="min-h-[44px] px-4 rounded-input bg-brand-green text-white font-label-lg text-label-lg shadow-inset-light hover:bg-brand-greenDark transition-colors"
        >
          Try again
        </button>
      </Card>
    );
  }

  const ready = cards.filter((c) => c.state.complete && c.offer);
  const inProgress = cards.filter((c) => !c.state.complete && c.offer);
  const history = cards.filter((c) => c.state.totalRedeemed > 0);

  return (
    <div className="flex flex-col gap-5">
      {/* Totals */}
      <FadeUp>
        <Card className="p-5 flex items-center gap-4 shadow-ambient">
          <span className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary-fixed text-brand-green shrink-0">
            <Gift className="w-6 h-6" />
          </span>
          <div>
            <p className="font-metric-num text-metric-num text-brand-green tabular-nums leading-none">
              {totalRedeemed}
            </p>
            <p className="font-label-lg text-label-lg text-on-surface mt-1.5">
              {totalRedeemed === 1 ? 'reward earned' : 'rewards earned'} so far
            </p>
          </div>
        </Card>
      </FadeUp>

      {/* Ready to claim */}
      <FadeUp>
        <section className="flex flex-col gap-3" aria-labelledby="ready-heading">
          <h2 id="ready-heading" className="font-headline-sm text-headline-sm text-on-surface">
            Ready to claim
          </h2>
          {ready.length === 0 ? (
            <Card className="p-4 flex items-start gap-3">
              <span className="inline-flex items-center justify-center w-9 h-9 rounded-input bg-primary-fixed text-brand-green shrink-0">
                <Sparkles size={18} />
              </span>
              <div>
                <p className="font-label-lg text-label-lg text-on-surface">
                  No rewards ready yet
                </p>
                <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
                  Keep collecting stamps — your next reward is close.
                </p>
              </div>
            </Card>
          ) : (
            ready.map((c) => (
              <Card
                key={c.merchantId}
                className="p-4 flex items-center gap-3 shadow-ambient"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-label-lg text-label-lg text-on-surface truncate">
                    {c.offer!.title}
                  </p>
                  <p className="font-body-sm text-body-sm text-on-surface-variant truncate">
                    {c.businessName} ·{' '}
                    {REWARD_LABELS[c.offer!.rewardType] || 'reward'}
                  </p>
                </div>
                <Button variant="accent" size="sm" onClick={() => open(c)}>
                  Claim
                </Button>
              </Card>
            ))
          )}
        </section>
      </FadeUp>

      {/* In progress */}
      {inProgress.length > 0 && (
        <FadeUp>
          <section className="flex flex-col gap-3" aria-labelledby="progress-heading">
            <h2 id="progress-heading" className="font-headline-sm text-headline-sm text-on-surface">
              Keep collecting
            </h2>
            {inProgress.map((c) => (
              <Card key={c.merchantId} className="p-4 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-label-lg text-label-lg text-on-surface truncate">
                    {c.businessName}
                  </p>
                  <p className="font-body-sm text-body-sm text-on-surface-variant truncate">
                    {c.offer!.title}
                  </p>
                </div>
                <span className="px-2.5 py-1 rounded-pill bg-primary-fixed text-on-primary-fixed font-label-sm text-label-sm uppercase tracking-wider shrink-0">
                  {c.state.stampsCollected}/{c.offer!.requiredStamps}
                </span>
              </Card>
            ))}
          </section>
        </FadeUp>
      )}

      {/* History */}
      {history.length > 0 && (
        <FadeUp>
          <section className="flex flex-col gap-3" aria-labelledby="history-heading">
            <h2 id="history-heading" className="font-headline-sm text-headline-sm text-on-surface">
              Redeemed
            </h2>
            {history.map((c) => (
              <div
                key={c.merchantId}
                className="flex items-center justify-between px-4 py-3 bg-surface-container-lowest rounded-card border border-hairline shadow-hairline"
              >
                <span className="font-body-md text-body-md text-on-surface truncate">
                  {c.businessName}
                </span>
                <span className="font-label-sm text-label-sm uppercase tracking-wider text-brand-green shrink-0 ml-3">
                  {c.state.totalRedeemed}× redeemed
                </span>
              </div>
            ))}
          </section>
        </FadeUp>
      )}

      {/* Reward pop-up for the selected reward */}
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
