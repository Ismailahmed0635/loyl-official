import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError } from '@/backend/api/response';
import { withMerchant } from '@/backend/api/handler';
import { analyticsQuerySchema } from '@/backend/validation/schemas';
import { db } from '@/backend/db';
import {
  analyticsCsvFilename,
  buildOfferPerformance,
  buildSeries,
  computeTotals,
  defaultRange,
  parseDateKey,
  rangeDays,
  toAnalyticsCsv,
  type CustomerFirstSeen,
  type NormalizedEvent,
} from '@/backend/analytics';

/**
 * GET /api/merchant/analytics — Phase 4 time series + totals + per-offer
 * breakdown for the selected date range (default: last 30 days).
 *
 * Data sources are unioned: `ActivityEvent` (stamp scan/review/redeem, written
 * best-effort by the customer routes) + `ScratchResult` (scratch reveals) +
 * `DiceRollResult` (dice rolls — one per customer, ever).
 * `?format=csv` streams the same range as a CSV attachment instead of JSON.
 */
export const GET = withMerchant(async (req: NextRequest, session, merchant) => {
  try {
    const params = req.nextUrl.searchParams;
    const parsed = analyticsQuerySchema.safeParse({
      from: params.get('from') ?? undefined,
      to: params.get('to') ?? undefined,
      format: params.get('format') ?? undefined,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0]?.message || 'Invalid date range';
      return apiError(issue, 'VALIDATION_ERROR', 422);
    }

    const range =
      parsed.data.from && parsed.data.to
        ? { from: parsed.data.from, to: parsed.data.to }
        : defaultRange();

    const start = parseDateKey(range.from);
    const endExclusive = new Date(parseDateKey(range.to).getTime() + 24 * 60 * 60 * 1000);

    const [activityEvents, scratchResults, diceResults, customerRows, offers] = await Promise.all([
      db.activityEvent.findMany({
        where: { merchantId: merchant.id, createdAt: { gte: start, lt: endExclusive } },
        select: { type: true, offerId: true, customerPhone: true, createdAt: true },
      }),
      db.scratchResult.findMany({
        where: { merchantId: merchant.id, scratchedAt: { gte: start, lt: endExclusive } },
        select: { offerId: true, customerPhone: true, scratchedAt: true },
      }),
      db.diceRollResult.findMany({
        where: { merchantId: merchant.id, rolledAt: { gte: start, lt: endExclusive } },
        select: { offerId: true, customerPhone: true, rolledAt: true },
      }),
      db.customerStamp.findMany({
        where: { merchantId: merchant.id, deletedAt: null },
        select: { customerPhone: true, createdAt: true },
      }),
      // No deletedAt filter: history keeps resolving titles for soft-deleted offers.
      db.offer.findMany({
        where: { merchantId: merchant.id },
        select: { id: true, title: true, offerType: true },
      }),
    ]);

    const events: NormalizedEvent[] = [
      ...activityEvents.map((event) => ({
        type: event.type,
        offerId: event.offerId,
        customerPhone: event.customerPhone,
        at: event.createdAt,
      })),
      ...scratchResults.map((result) => ({
        type: 'SCRATCH' as const,
        offerId: result.offerId,
        customerPhone: result.customerPhone,
        at: result.scratchedAt,
      })),
      ...diceResults.map((result) => ({
        type: 'DICE' as const,
        offerId: result.offerId,
        customerPhone: result.customerPhone,
        at: result.rolledAt,
      })),
    ];
    const customers: CustomerFirstSeen[] = customerRows.map((row) => ({
      customerPhone: row.customerPhone,
      firstSeenAt: row.createdAt,
    }));

    const series = buildSeries(range.from, range.to, events, customers);
    const totals = computeTotals(series, events, customers, range.from);
    const offerPerformance = buildOfferPerformance(
      events,
      offers.map((offer) => ({ id: offer.id, title: offer.title, offerType: offer.offerType }))
    );

    if (parsed.data.format === 'csv') {
      const csv = toAnalyticsCsv(series, totals);
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${analyticsCsvFilename(range.from, range.to)}"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    return apiSuccess({
      range: { ...range, days: rangeDays(range.from, range.to) },
      totals,
      series,
      offers: offerPerformance,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error computing merchant analytics:', error);
    return apiError('Failed to load analytics', 'INTERNAL_ERROR', 500);
  }
});
