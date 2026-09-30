/**
 * Phase 4 — Analytics helpers (pure: no I/O, no Prisma) so they stay unit-testable.
 *
 * Days are bucketed in UTC: Postgres stores timestamps in UTC and charts label
 * the UTC calendar day (the dev/market is Asia/Dhaka, +06 — a local-time bucket
 * would need `date_trunc(... AT TIME ZONE)` raw SQL; revisit if merchants
 * complain about day boundaries).
 */

/**
 * Stamp-engine events come from `ActivityEvent`; scratch from `ScratchResult`
 * and dice rolls from `DiceRollResult` (each engine owns its own table, so the
 * analytics route unions them into this one event type).
 */
export type AnalyticsEventType = 'SCAN' | 'REVIEW_BONUS' | 'REDEEM' | 'SCRATCH' | 'DICE';

export interface NormalizedEvent {
  type: AnalyticsEventType;
  offerId: string | null;
  customerPhone: string;
  at: Date;
}

/** One merchant customer with the date their loyalty card first existed. */
export interface CustomerFirstSeen {
  customerPhone: string;
  firstSeenAt: Date;
}

export interface OfferMeta {
  id: string;
  title: string;
  offerType: 'STAMP' | 'SCRATCH' | 'DICE';
}

export interface SeriesPoint {
  /** YYYY-MM-DD (UTC). */
  date: string;
  scans: number;
  reviewBonuses: number;
  redeems: number;
  scratchReveals: number;
  /** Dice offers: one roll per customer, ever. */
  diceRolls: number;
  /** Customers whose card was first created on this day. */
  newCustomers: number;
  /** Distinct phones with any event on this day. */
  uniqueVisitors: number;
}

export interface AnalyticsTotals {
  scans: number;
  reviewBonuses: number;
  redeems: number;
  scratchReveals: number;
  diceRolls: number;
  newCustomers: number;
  /** Distinct phones active in the range whose card predates the range. */
  returningCustomers: number;
  uniqueVisitors: number;
  /** redeems / uniqueVisitors, rounded to a whole percent (0 when no visitors). */
  redemptionRate: number;
}

export interface OfferPerformance {
  offerId: string;
  title: string;
  offerType: 'STAMP' | 'SCRATCH' | 'DICE';
  scans: number;
  reviewBonuses: number;
  redeems: number;
  scratchReveals: number;
  diceRolls: number;
  uniqueVisitors: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** UTC calendar day of a date, as YYYY-MM-DD. */
export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Parses YYYY-MM-DD as UTC midnight. Throws on malformed/impossible dates. */
export function parseDateKey(key: string): Date {
  if (!DATE_KEY_RE.test(key)) {
    throw new Error(`Invalid date key: ${key}`);
  }
  const ms = Date.parse(`${key}T00:00:00.000Z`);
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid date key: ${key}`);
  }
  const parsed = new Date(ms);
  // Rejects 2026-02-31 style input (Date.parse rolls it over).
  if (toDateKey(parsed) !== key) {
    throw new Error(`Invalid calendar date: ${key}`);
  }
  return parsed;
}

/** Inclusive day count between two YYYY-MM-DD keys. */
export function rangeDays(from: string, to: string): number {
  const ms = parseDateKey(to).getTime() - parseDateKey(from).getTime();
  return Math.floor(ms / DAY_MS) + 1;
}

/** Every YYYY-MM-DD key from `from` to `to` inclusive (empty when from > to). */
export function dateKeysBetween(from: string, to: string): string[] {
  const start = parseDateKey(from).getTime();
  const end = parseDateKey(to).getTime();
  const keys: string[] = [];
  for (let t = start; t <= end; t += DAY_MS) {
    keys.push(toDateKey(new Date(t)));
  }
  return keys;
}

/** Default window when no range is supplied: the last 30 days incl. today. */
export function defaultRange(now: Date = new Date()): { from: string; to: string } {
  const to = toDateKey(now);
  const from = toDateKey(new Date(now.getTime() - 29 * DAY_MS));
  return { from, to };
}

/** Max days a single analytics range may span (matches the query schema). */
export const MAX_RANGE_DAYS = 366;

function emptyPoint(date: string): SeriesPoint {
  return {
    date,
    scans: 0,
    reviewBonuses: 0,
    redeems: 0,
    scratchReveals: 0,
    diceRolls: 0,
    newCustomers: 0,
    uniqueVisitors: 0,
  };
}

/**
 * Buckets events + first-visit dates into one zero-filled point per day so the
 * chart never skips a day. Events outside [from, to] are ignored.
 */
export function buildSeries(
  from: string,
  to: string,
  events: NormalizedEvent[],
  customers: CustomerFirstSeen[]
): SeriesPoint[] {
  const points = new Map<string, SeriesPoint>(dateKeysBetween(from, to).map((k) => [k, emptyPoint(k)]));
  const visitorsByDay = new Map<string, Set<string>>();

  const pointFor = (at: Date): SeriesPoint | undefined => points.get(toDateKey(at));

  for (const event of events) {
    const point = pointFor(event.at);
    if (!point) continue;
    switch (event.type) {
      case 'SCAN':
        point.scans += 1;
        break;
      case 'REVIEW_BONUS':
        point.reviewBonuses += 1;
        break;
      case 'REDEEM':
        point.redeems += 1;
        break;
      case 'SCRATCH':
        point.scratchReveals += 1;
        break;
      case 'DICE':
        point.diceRolls += 1;
        break;
    }
    const key = toDateKey(event.at);
    let visitors = visitorsByDay.get(key);
    if (!visitors) {
      visitors = new Set();
      visitorsByDay.set(key, visitors);
    }
    visitors.add(event.customerPhone);
  }

  for (const [key, phones] of visitorsByDay) {
    const point = points.get(key);
    if (point) point.uniqueVisitors = phones.size;
  }

  for (const customer of customers) {
    const point = pointFor(customer.firstSeenAt);
    if (point) point.newCustomers += 1;
  }

  return [...points.values()];
}

/**
 * Range totals from the zero-filled series + raw events.
 * `returningCustomers` = distinct phones active in the range whose card was
 * created before the range started.
 */
export function computeTotals(
  series: SeriesPoint[],
  events: NormalizedEvent[],
  customers: CustomerFirstSeen[],
  from: string
): AnalyticsTotals {
  const rangeStart = parseDateKey(from).getTime();
  const totals: AnalyticsTotals = {
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

  for (const point of series) {
    totals.scans += point.scans;
    totals.reviewBonuses += point.reviewBonuses;
    totals.redeems += point.redeems;
    totals.scratchReveals += point.scratchReveals;
    totals.diceRolls += point.diceRolls;
    totals.newCustomers += point.newCustomers;
  }

  const firstSeenByPhone = new Map(customers.map((c) => [c.customerPhone, c.firstSeenAt.getTime()]));
  const activePhones = new Set<string>();
  const returningPhones = new Set<string>();
  for (const event of events) {
    activePhones.add(event.customerPhone);
    const firstSeen = firstSeenByPhone.get(event.customerPhone);
    if (firstSeen !== undefined && firstSeen < rangeStart) {
      returningPhones.add(event.customerPhone);
    }
  }

  totals.uniqueVisitors = activePhones.size;
  totals.returningCustomers = returningPhones.size;
  totals.redemptionRate = totals.uniqueVisitors
    ? Math.round((totals.redeems / totals.uniqueVisitors) * 100)
    : 0;
  return totals;
}

/** Per-offer breakdown for the selected range, busiest first. */
export function buildOfferPerformance(
  events: NormalizedEvent[],
  offers: OfferMeta[]
): OfferPerformance[] {
  const byOffer = new Map<string, OfferPerformance>();
  const visitorsByOffer = new Map<string, Set<string>>();

  for (const offer of offers) {
    byOffer.set(offer.id, {
      offerId: offer.id,
      title: offer.title,
      offerType: offer.offerType,
      scans: 0,
      reviewBonuses: 0,
      redeems: 0,
      scratchReveals: 0,
      diceRolls: 0,
      uniqueVisitors: 0,
    });
  }

  for (const event of events) {
    if (!event.offerId) continue;
    let row = byOffer.get(event.offerId);
    if (!row) {
      // Offer hard-deleted (or foreign id): keep history under a stub row.
      row = {
        offerId: event.offerId,
        title: 'Deleted offer',
        offerType: event.type === 'SCRATCH' ? 'SCRATCH' : event.type === 'DICE' ? 'DICE' : 'STAMP',
        scans: 0,
        reviewBonuses: 0,
        redeems: 0,
        scratchReveals: 0,
        diceRolls: 0,
        uniqueVisitors: 0,
      };
      byOffer.set(event.offerId, row);
    }
    if (event.type === 'SCAN') row.scans += 1;
    else if (event.type === 'REVIEW_BONUS') row.reviewBonuses += 1;
    else if (event.type === 'REDEEM') row.redeems += 1;
    else if (event.type === 'DICE') row.diceRolls += 1;
    else row.scratchReveals += 1;

    let visitors = visitorsByOffer.get(event.offerId);
    if (!visitors) {
      visitors = new Set();
      visitorsByOffer.set(event.offerId, visitors);
    }
    visitors.add(event.customerPhone);
  }

  for (const [offerId, phones] of visitorsByOffer) {
    const row = byOffer.get(offerId);
    if (row) row.uniqueVisitors = phones.size;
  }

  return [...byOffer.values()]
    .filter(
      (row) => row.scans + row.reviewBonuses + row.redeems + row.scratchReveals + row.diceRolls > 0
    )
    .sort(
      (a, b) =>
        b.scans + b.redeems + b.scratchReveals + b.diceRolls -
        (a.scans + a.redeems + a.scratchReveals + a.diceRolls)
    );
}

/** RFC 4180 cell escaping (dates/counts are plain, but keep it correct anyway). */
function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV export (TEST/LOYLS §4 "CSV export"): one row per day + a `total` row.
 * Newlines are CRLF for Excel compatibility.
 */
export function toAnalyticsCsv(series: SeriesPoint[], totals: AnalyticsTotals): string {
  const header = [
    'date',
    'scans',
    'review_bonuses',
    'redeems',
    'scratch_reveals',
    'dice_rolls',
    'new_customers',
    'unique_visitors',
  ];
  const rows = series.map((p) =>
    [
      p.date,
      p.scans,
      p.reviewBonuses,
      p.redeems,
      p.scratchReveals,
      p.diceRolls,
      p.newCustomers,
      p.uniqueVisitors,
    ]
      .map(csvCell)
      .join(',')
  );
  const totalRow = [
    'total',
    totals.scans,
    totals.reviewBonuses,
    totals.redeems,
    totals.scratchReveals,
    totals.diceRolls,
    totals.newCustomers,
    totals.uniqueVisitors,
  ].map(csvCell);
  return [[header.join(','), ...rows, totalRow.join(',')].join('\r\n'), ''].join('\r\n');
}

/** Attachment filename for the CSV export. */
export function analyticsCsvFilename(from: string, to: string): string {
  return `loyl-analytics-${from}_${to}.csv`;
}
