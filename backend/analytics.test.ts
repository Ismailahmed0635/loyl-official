import { describe, it, expect } from 'vitest';
import {
  analyticsCsvFilename,
  buildOfferPerformance,
  buildSeries,
  computeTotals,
  dateKeysBetween,
  defaultRange,
  parseDateKey,
  rangeDays,
  toDateKey,
  toAnalyticsCsv,
  type CustomerFirstSeen,
  type NormalizedEvent,
} from './analytics';

const ev = (
  type: NormalizedEvent['type'],
  customerPhone: string,
  iso: string,
  offerId: string | null = 'o1'
): NormalizedEvent => ({ type, offerId, customerPhone, at: new Date(iso) });

const customer = (phone: string, iso: string): CustomerFirstSeen => ({
  customerPhone: phone,
  firstSeenAt: new Date(iso),
});

const ZERO_TOTALS = {
  scans: 0,
  reviewBonuses: 0,
  redeems: 0,
  scratchReveals: 0,
  diceRolls: 0,
  newCustomers: 0,
  returningCustomers: 0,
  uniqueVisitors: 0,
  redemptionRate: 0,
};

describe('Phase 4 date helpers', () => {
  it('formats and parses UTC date keys', () => {
    expect(toDateKey(new Date('2026-09-24T13:45:00.000Z'))).toBe('2026-09-24');
    expect(parseDateKey('2026-09-24').toISOString()).toBe('2026-09-24T00:00:00.000Z');
  });

  it('rejects malformed and impossible dates', () => {
    expect(() => parseDateKey('24-09-2026')).toThrow();
    expect(() => parseDateKey('2026-9-24')).toThrow();
    expect(() => parseDateKey('2026-02-31')).toThrow(); // rolls over in Date.parse
    expect(() => parseDateKey('not-a-date')).toThrow();
  });

  it('counts days inclusively across month boundaries', () => {
    expect(rangeDays('2026-09-24', '2026-09-24')).toBe(1);
    expect(rangeDays('2026-01-30', '2026-02-02')).toBe(4);
    expect(dateKeysBetween('2026-01-30', '2026-02-02')).toEqual([
      '2026-01-30',
      '2026-01-31',
      '2026-02-01',
      '2026-02-02',
    ]);
    expect(dateKeysBetween('2026-09-25', '2026-09-24')).toEqual([]);
  });

  it('defaults to the last 30 days including today', () => {
    const now = new Date('2026-09-24T10:00:00.000Z');
    const range = defaultRange(now);
    expect(range.to).toBe('2026-09-24');
    expect(range.from).toBe('2026-08-26');
    expect(rangeDays(range.from, range.to)).toBe(30);
  });
});

describe('buildSeries', () => {
  it('zero-fills every day in the range', () => {
    const series = buildSeries('2026-09-22', '2026-09-24', [], []);
    expect(series.map((p) => p.date)).toEqual(['2026-09-22', '2026-09-23', '2026-09-24']);
    expect(series.every((p) => p.scans === 0 && p.uniqueVisitors === 0)).toBe(true);
  });

  it('buckets events by UTC day and counts each type', () => {
    const events = [
      ev('SCAN', '01711111111', '2026-09-23T02:00:00.000Z'),
      ev('SCAN', '01722222222', '2026-09-23T23:59:59.000Z'),
      ev('REVIEW_BONUS', '01711111111', '2026-09-23T05:00:00.000Z'),
      ev('REDEEM', '01733333333', '2026-09-24T01:00:00.000Z'),
      ev('SCRATCH', '01744444444', '2026-09-24T12:00:00.000Z', 'o2'),
      ev('DICE', '01755555555', '2026-09-24T15:00:00.000Z', 'o3'),
    ];
    const series = buildSeries('2026-09-23', '2026-09-24', events, []);

    expect(series[0]).toMatchObject({
      date: '2026-09-23',
      scans: 2,
      reviewBonuses: 1,
      redeems: 0,
      scratchReveals: 0,
      diceRolls: 0,
      uniqueVisitors: 2, // both phones deduped, reviewer counted too => 2? (phones: 0171, 0172)
    });
    expect(series[1]).toMatchObject({
      date: '2026-09-24',
      scans: 0,
      redeems: 1,
      scratchReveals: 1,
      diceRolls: 1,
      uniqueVisitors: 3,
    });
  });

  it('ignores events outside the range', () => {
    const events = [ev('SCAN', '01711111111', '2026-09-20T10:00:00.000Z')];
    const series = buildSeries('2026-09-23', '2026-09-24', events, []);
    expect(series.every((p) => p.scans === 0 && p.uniqueVisitors === 0)).toBe(true);
  });

  it('marks the day a customer card was first created as a new customer', () => {
    const customers = [
      customer('01711111111', '2026-09-23T09:00:00.000Z'),
      customer('01722222222', '2026-09-01T09:00:00.000Z'), // before the range
    ];
    const series = buildSeries('2026-09-23', '2026-09-24', [], customers);
    expect(series[0].newCustomers).toBe(1);
    expect(series[1].newCustomers).toBe(0);
  });
});

describe('computeTotals', () => {
  it('sums the series and derives unique visitors, returning customers, and redemption rate', () => {
    const events = [
      ev('SCAN', '01711111111', '2026-09-23T10:00:00.000Z'),
      ev('SCAN', '01722222222', '2026-09-23T11:00:00.000Z'),
      ev('REDEEM', '01722222222', '2026-09-24T11:00:00.000Z'),
      ev('SCRATCH', '01733333333', '2026-09-24T12:00:00.000Z', 'o2'),
      ev('DICE', '01755555555', '2026-09-24T13:00:00.000Z', 'o3'),
    ];
    const customers = [
      customer('01711111111', '2026-09-23T09:00:00.000Z'), // new in range
      customer('01722222222', '2026-08-01T09:00:00.000Z'), // returning
      customer('01744444444', '2026-09-01T09:00:00.000Z'), // never active in range
    ];
    const series = buildSeries('2026-09-23', '2026-09-24', events, customers);
    const totals = computeTotals(series, events, customers, '2026-09-23');

    expect(totals.scans).toBe(2);
    expect(totals.redeems).toBe(1);
    expect(totals.scratchReveals).toBe(1);
    expect(totals.diceRolls).toBe(1);
    expect(totals.newCustomers).toBe(1);
    expect(totals.uniqueVisitors).toBe(4);
    expect(totals.returningCustomers).toBe(1); // 0172 only
    expect(totals.redemptionRate).toBe(25); // 1 redeem / 4 visitors
  });

  it('never divides by zero', () => {
    const totals = computeTotals([], [], [], '2026-09-23');
    expect(totals).toEqual(ZERO_TOTALS);
  });
});

describe('buildOfferPerformance', () => {
  it('counts activity per offer with deduped visitors, busiest first', () => {
    const events = [
      ev('SCAN', '01711111111', '2026-09-23T10:00:00.000Z', 'o1'),
      ev('SCAN', '01711111111', '2026-09-23T12:00:00.000Z', 'o1'),
      ev('REDEEM', '01722222222', '2026-09-23T13:00:00.000Z', 'o1'),
      ev('SCRATCH', '01733333333', '2026-09-23T14:00:00.000Z', 'o2'),
      ev('DICE', '01744444444', '2026-09-23T15:00:00.000Z', 'o3'),
      ev('DICE', '01755555555', '2026-09-23T16:00:00.000Z', 'o3'),
    ];
    const offers = [
      { id: 'o1', title: 'Buy 2 Get 1', offerType: 'STAMP' as const },
      { id: 'o2', title: 'Mystery Scratch', offerType: 'SCRATCH' as const },
      { id: 'o3', title: 'Lucky Dice', offerType: 'DICE' as const },
      { id: 'o4', title: 'Untouched', offerType: 'STAMP' as const },
    ];
    const rows = buildOfferPerformance(events, offers);

    expect(rows).toHaveLength(3); // o4 has no activity → filtered out
    expect(rows[0].offerId).toBe('o1');
    expect(rows[0]).toMatchObject({ scans: 2, redeems: 1, uniqueVisitors: 2 });
    expect(rows[1]).toMatchObject({ offerId: 'o3', diceRolls: 2, uniqueVisitors: 2 });
    expect(rows[2]).toMatchObject({ offerId: 'o2', scratchReveals: 1, uniqueVisitors: 1 });
  });

  it('keeps history for offers that no longer exist as a Deleted stub', () => {
    const events = [ev('SCAN', '01711111111', '2026-09-23T10:00:00.000Z', 'gone')];
    const rows = buildOfferPerformance(events, []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ offerId: 'gone', title: 'Deleted offer', scans: 1 });
  });
});

describe('toAnalyticsCsv', () => {
  it('emits header + one row per day + a total row, CRLF terminated', () => {
    const events = [ev('SCAN', '01711111111', '2026-09-23T10:00:00.000Z')];
    const customers = [customer('01711111111', '2026-09-23T10:00:00.000Z')];
    const series = buildSeries('2026-09-23', '2026-09-24', events, customers);
    const totals = computeTotals(series, events, customers, '2026-09-23');

    const csv = toAnalyticsCsv(series, totals);
    const lines = csv.split('\r\n');

    expect(lines[0]).toBe(
      'date,scans,review_bonuses,redeems,scratch_reveals,dice_rolls,new_customers,unique_visitors'
    );
    expect(lines[1]).toBe('2026-09-23,1,0,0,0,0,1,1');
    expect(lines[2]).toBe('2026-09-24,0,0,0,0,0,0,0');
    expect(lines[3]).toBe('total,1,0,0,0,0,1,1');
    expect(lines[4]).toBe(''); // trailing CRLF
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('builds a dated attachment filename', () => {
    expect(analyticsCsvFilename('2026-09-01', '2026-09-24')).toBe(
      'loyl-analytics-2026-09-01_2026-09-24.csv'
    );
  });
});
