import { describe, it, expect } from 'vitest';
import { buildCardState, offerEnded, SCAN_COOLDOWN_MS, REVIEW_COOLDOWN_MS } from './scan';

const REQUIRED = 5;
const NOW = Date.now();
const hoursAgo = (h: number) => new Date(NOW - h * 3600 * 1000);

function card(overrides: Partial<Parameters<typeof buildCardState>[0]> = {}) {
  return {
    stampsCollected: 1,
    totalRedeemed: 0,
    lastScannedAt: hoursAgo(1),
    lastReviewAt: null,
    ...overrides,
  };
}

describe('buildCardState — scan cooldown (TEST.md §4)', () => {
  it('never-scanned customers can scan immediately', () => {
    const s = buildCardState(null, REQUIRED);
    expect(s.exists).toBe(false);
    expect(s.stampsCollected).toBe(0);
    expect(s.canScan).toBe(true);
    expect(s.complete).toBe(false);
    expect(s.nextScanAt).toBeNull();
  });

  it('a scan inside the 24h window is blocked with nextScanAt set', () => {
    const s = buildCardState(card({ lastScannedAt: hoursAgo(1) }), REQUIRED);
    expect(s.canScan).toBe(false);
    expect(s.nextScanAt).not.toBeNull();
    const next = new Date(s.nextScanAt!).getTime();
    expect(next).toBeGreaterThan(NOW);
    expect(next - NOW).toBeLessThanOrEqual(SCAN_COOLDOWN_MS);
  });

  it('a scan 24h+ ago re-opens the window', () => {
    const s = buildCardState(card({ lastScannedAt: hoursAgo(25) }), REQUIRED);
    expect(s.canScan).toBe(true);
    expect(s.nextScanAt).toBeNull();
  });
});

describe('buildCardState — reward trigger (TEST.md §4)', () => {
  it('marks the card complete when stamps reach the threshold', () => {
    const s = buildCardState(card({ stampsCollected: REQUIRED }), REQUIRED);
    expect(s.complete).toBe(true);
    expect(s.canScan).toBe(false); // claim first — no stamp inflation
    expect(s.nextScanAt).toBeNull(); // claim now, don't wait out a window
  });

  it('one stamp short of the threshold is not complete', () => {
    const s = buildCardState(card({ stampsCollected: REQUIRED - 1 }), REQUIRED);
    expect(s.complete).toBe(false);
    expect(s.canScan).toBe(false); // still in cooldown from the last scan
  });

  it('unknown offer (required=null) never reports complete', () => {
    const s = buildCardState(card({ stampsCollected: 99 }), null);
    expect(s.complete).toBe(false);
    expect(s.requiredStamps).toBeNull();
    expect(s.canScan).toBe(false);
  });
});

describe('buildCardState — review bonus window (PRD 3.3)', () => {
  it('requires an existing card before a review bonus is allowed', () => {
    const s = buildCardState(null, REQUIRED);
    expect(s.canReviewBonus).toBe(false);
  });

  it('allows the first review bonus', () => {
    const s = buildCardState(card({ lastReviewAt: null }), REQUIRED);
    expect(s.canReviewBonus).toBe(true);
    expect(s.nextReviewAt).toBeNull();
  });

  it('blocks a second review bonus within 24h', () => {
    const s = buildCardState(card({ lastReviewAt: hoursAgo(2) }), REQUIRED);
    expect(s.canReviewBonus).toBe(false);
    expect(s.nextReviewAt).not.toBeNull();
    expect(new Date(s.nextReviewAt!).getTime()).toBeLessThanOrEqual(NOW + REVIEW_COOLDOWN_MS);
  });

  it('a complete card cannot take another review bonus', () => {
    const s = buildCardState(
      card({ stampsCollected: REQUIRED, lastReviewAt: null }),
      REQUIRED
    );
    expect(s.complete).toBe(true);
    expect(s.canReviewBonus).toBe(false);
  });
});

describe('offerEnded', () => {
  it('is false within the duration and true after it', () => {
    expect(offerEnded({ createdAt: new Date(NOW - 1000), durationDays: 30 })).toBe(false);
    expect(offerEnded({ createdAt: new Date(NOW - 31 * 24 * 3600 * 1000), durationDays: 30 })).toBe(true);
  });
});
