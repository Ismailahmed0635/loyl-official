'use client';

import { useState, useCallback } from 'react';
import { redeemOffer, CustomerCardItem, RedeemResult } from '@/lib/api/customer';
import { useConfetti } from '@/components/animations/Confetti';

/**
 * Shared reward-claim state for the stamp-card and rewards pages:
 * open/close the RewardModal and run the redeem call (TEST.md §4 reward
 * trigger), firing confetti on success.
 */
export function useRewardClaim(onRedeemed?: (merchantId: string, next: RedeemResult) => void) {
  const fireConfetti = useConfetti();
  const [item, setItem] = useState<CustomerCardItem | null>(null);
  const [claimed, setClaimed] = useState<RedeemResult | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState('');

  const open = useCallback((target: CustomerCardItem) => {
    if (!target.offer) return;
    setItem(target);
    setClaimed(null);
    setClaimError('');
  }, []);

  const close = useCallback(() => {
    setItem(null);
    setClaimed(null);
    setClaimError('');
  }, []);

  const claim = useCallback(async () => {
    if (!item?.offer || claiming) return;
    setClaiming(true);
    setClaimError('');
    try {
      const res = await redeemOffer(item.offer.id);
      if (res?.success) {
        const data = res.data as RedeemResult;
        setClaimed(data);
        setItem((prev) => (prev ? { ...prev, state: data.card } : prev));
        fireConfetti();
        onRedeemed?.(item.merchantId, data);
      } else {
        setClaimError(res?.error?.message || 'Could not redeem your reward. Try again.');
      }
    } catch {
      setClaimError('Network error — check your connection and try again.');
    } finally {
      setClaiming(false);
    }
  }, [item, claiming, fireConfetti, onRedeemed]);

  return { item, claimed, claiming, claimError, open, close, claim };
}
