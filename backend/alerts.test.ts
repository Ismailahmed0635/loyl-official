import { describe, it, expect } from 'vitest';
import {
  APPROVAL_BURST_THRESHOLD,
  APPROVAL_BURST_WINDOW_MS,
  approvalBurstMessage,
  isApprovalBurst,
} from './alerts';

const NOW = 1_760_000_000_000;

describe('RT-03 isApprovalBurst', () => {
  it('does not fire below the threshold', () => {
    const ts = Array.from({ length: APPROVAL_BURST_THRESHOLD - 1 }, (_, i) => NOW - i * 1000);
    expect(isApprovalBurst(ts, NOW)).toBe(false);
  });

  it('fires exactly at the threshold', () => {
    const ts = Array.from({ length: APPROVAL_BURST_THRESHOLD }, (_, i) => NOW - i * 1000);
    expect(isApprovalBurst(ts, NOW)).toBe(true);
  });

  it('ignores approvals older than the window', () => {
    const ts = Array.from({ length: APPROVAL_BURST_THRESHOLD + 5 }, (_, i) => ({
      ts: NOW - APPROVAL_BURST_WINDOW_MS - 1 - i * 1000,
    }));
    expect(
      isApprovalBurst(
        ts.map((x) => x.ts),
        NOW
      )
    ).toBe(false);
  });

  it('counts only the in-window slice of a mixed history', () => {
    const old = Array.from({ length: 30 }, (_, i) => NOW - APPROVAL_BURST_WINDOW_MS - 1 - i * 1000);
    const fresh = Array.from({ length: APPROVAL_BURST_THRESHOLD }, (_, i) => NOW - i * 500);
    expect(isApprovalBurst([...old, ...fresh], NOW)).toBe(true);
    expect(isApprovalBurst([...old, ...fresh.slice(1)], NOW)).toBe(false);
  });

  it('tolerates a slightly fast device clock (future skew)', () => {
    const ts = Array.from({ length: APPROVAL_BURST_THRESHOLD }, (_, i) => NOW + i * 100);
    expect(isApprovalBurst(ts, NOW)).toBe(true);
  });

  it('still hides far-future garbage (beyond skew tolerance)', () => {
    const ts = Array.from({ length: APPROVAL_BURST_THRESHOLD }, (_, i) => NOW + 60_001 + i * 1000);
    expect(isApprovalBurst(ts, NOW)).toBe(false);
  });

  it('accepts custom window/threshold (contract for tuning)', () => {
    const ts = [NOW - 1000, NOW - 2000];
    expect(isApprovalBurst(ts, NOW, { windowMs: 10_000, threshold: 2 })).toBe(true);
    expect(isApprovalBurst(ts, NOW, { windowMs: 10_000, threshold: 3 })).toBe(false);
  });

  it('never fires on an empty history', () => {
    expect(isApprovalBurst([], NOW)).toBe(false);
  });
});

describe('RT-03 approvalBurstMessage', () => {
  it('states the count and window without any PII', () => {
    const msg = approvalBurstMessage(12, APPROVAL_BURST_WINDOW_MS);
    expect(msg).toContain('12');
    expect(msg).toContain('5 minutes');
    // No phone numbers, no emails, no customer/merchant names.
    expect(msg).not.toMatch(/\d{11}/);
    expect(msg).not.toMatch(/@/);
  });

  it('rounds sub-minute windows to at least one minute', () => {
    expect(approvalBurstMessage(10, 15_000)).toContain('1 minutes');
  });
});
