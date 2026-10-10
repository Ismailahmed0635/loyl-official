import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/backend/api/response';
import { withMerchant } from '@/backend/api/handler';
import { customerListQuerySchema } from '@/backend/validation/schemas';
import { db } from '@/backend/db';

const DEFAULT_PAGE_SIZE = 20;

/**
 * Phase 12: the list is the union of *every* check-in source, so a customer is
 * visible the moment they check in rather than only once a stamp is granted:
 *
 *   • `CustomerStamp`  — one row per approved card holder (stamps, rewards,
 *     review). Created by `grantStamp`, i.e. only after the merchant approves.
 *   • `ScanRequest`    — every stamp check-in ever made. A customer whose
 *     check-in is still waiting (or who was never approved) lives only here.
 *   • `ScratchResult`  — scratch reveals. A reveal IS a check-in (the customer
 *     scanned, signed in and won instantly), but scratch opens no ScanRequest,
 *     so before Phase 13 these customers were invisible here — and since the
 *     free trial only sells scratch cards, that meant a trial merchant saw
 *     nothing at all after a scan.
 *   • `DiceRollResult` — dice rolls: same instant-reward shape, same gap.
 *
 * The instant-reward sources contribute name, first/last visit and their share
 * of `scanCount`; they never touch `stampsCollected`/`totalRedeemed` (no card,
 * no approval) or `pendingCount` (there is nothing to approve).
 *
 * All four are keyed by `customerPhone`, so the merge is a keyed union. The
 * cardinality of each read is the merchant's *distinct customer count*, not
 * their scan count, which keeps this modest for a single-shop loyalty card.
 * The union has to be materialised before search + pagination can be applied,
 * which is why this no longer does `skip`/`take` in the database.
 *
 * `CUSTOMER_MERGE_LIMIT` is a guard against pathological data (a runaway bot
 * hammering the scan endpoint). It is deliberately far above any real shop's
 * customer count; hitting it truncates the *newest* customers first because
 * every read is ordered newest-first.
 */
const CUSTOMER_MERGE_LIMIT = 10_000;

/** One merged customer row returned to the merchant dashboard. */
interface MergedCustomer {
  /** `CustomerStamp.id`, or `scan:<phone>` for a customer with no card yet. */
  id: string;
  customerPhone: string;
  /** Phase 11/12: the name captured at check-in; null when never supplied. */
  customerName: string | null;
  stampsCollected: number;
  totalRedeemed: number;
  /**
   * Phase 12: every check-in this phone ever made — approved history, any
   * still waiting, plus instant-reward scratch reveals and dice rolls. This is
   * the per-scan tracking number the merchant sees, and it is deliberately
   * *not* the same as `stampsCollected` (which only counts approved stamps).
   */
  scanCount: number;
  /** Check-ins still awaiting the merchant's approval. */
  pendingCount: number;
  lastScannedAt: string | null;
  lastReviewAt: string | null;
  createdAt: string;
}

/**
 * GET /api/merchant/customers — Phase 4 customer list for the signed-in
 * merchant: search by phone number or name (`?q=`), pagination
 * (`?page=&pageSize=`). Scoped to the owning merchant; customer sessions never
 * reach it (withMerchant).
 *
 * Phase 12: returns the customer's name and their per-scan counts, and
 * includes customers who have checked in but have no approved stamp yet.
 * Phase 13: scratch reveals and dice rolls count as check-ins too, so the
 * instant-reward engines the free trial exposes are no longer invisible here.
 */
export const GET = withMerchant(async (req: NextRequest, session, merchant) => {
  try {
    const params = req.nextUrl.searchParams;
    const parsed = customerListQuerySchema.safeParse({
      q: params.get('q') ?? undefined,
      page: params.get('page') ?? undefined,
      pageSize: params.get('pageSize') ?? undefined,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0]?.message || 'Invalid query';
      return apiError(issue, 'VALIDATION_ERROR', 422);
    }

    const q = parsed.data.q || '';
    const page = parsed.data.page ?? 1;
    const pageSize = parsed.data.pageSize ?? DEFAULT_PAGE_SIZE;

    const scope = { merchantId: merchant.id, deletedAt: null } as const;

    // Scratch/dice result tables are not soft-deletable, so they take the
    // merchant scope only — `scope` (with `deletedAt`) would fail to validate.
    const rewardScope = { merchantId: merchant.id } as const;

    const [
      stamps,
      latestRequests,
      scanCounts,
      pendingCounts,
      latestScratches,
      scratchCounts,
      latestRolls,
      rollCounts,
    ] = await Promise.all([
      // Approved card holders.
      db.customerStamp.findMany({
        where: scope,
        orderBy: [{ lastScannedAt: 'desc' }, { createdAt: 'desc' }],
        take: CUSTOMER_MERGE_LIMIT,
        select: {
          id: true,
          customerPhone: true,
          customerName: true,
          stampsCollected: true,
          totalRedeemed: true,
          lastScannedAt: true,
          lastReviewAt: true,
          createdAt: true,
        },
      }),
      // One row per distinct phone, newest first — so the *latest* check-in,
      // which is where the name snapshot and the most recent visit live.
      db.scanRequest.findMany({
        where: scope,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        distinct: ['customerPhone'],
        take: CUSTOMER_MERGE_LIMIT,
        select: {
          customerPhone: true,
          customerName: true,
          createdAt: true,
        },
      }),
      // Every check-in ever made, per phone — the per-scan tracking count.
      db.scanRequest.groupBy({
        by: ['customerPhone'],
        where: scope,
        _count: { _all: true },
      }),
      // Check-ins still waiting on the merchant.
      db.scanRequest.groupBy({
        by: ['customerPhone'],
        where: { ...scope, status: 'PENDING' },
        _count: { _all: true },
      }),
      // Instant-reward reveals, newest reveal per phone (name + first visit).
      db.scratchResult.findMany({
        where: rewardScope,
        orderBy: [{ scratchedAt: 'desc' }, { id: 'desc' }],
        distinct: ['customerPhone'],
        take: CUSTOMER_MERGE_LIMIT,
        select: {
          customerPhone: true,
          customerName: true,
          scratchedAt: true,
        },
      }),
      db.scratchResult.groupBy({
        by: ['customerPhone'],
        where: rewardScope,
        _count: { _all: true },
      }),
      // Same for dice rolls (Phase 13 kept the two engines symmetric).
      db.diceRollResult.findMany({
        where: rewardScope,
        orderBy: [{ rolledAt: 'desc' }, { id: 'desc' }],
        distinct: ['customerPhone'],
        take: CUSTOMER_MERGE_LIMIT,
        select: {
          customerPhone: true,
          customerName: true,
          rolledAt: true,
        },
      }),
      db.diceRollResult.groupBy({
        by: ['customerPhone'],
        where: rewardScope,
        _count: { _all: true },
      }),
    ]);

    const scanCountByPhone = new Map<string, number>(
      scanCounts.map((r) => [r.customerPhone, r._count._all])
    );
    const scratchCountByPhone = new Map<string, number>(
      scratchCounts.map((r) => [r.customerPhone, r._count._all])
    );
    const rollCountByPhone = new Map<string, number>(
      rollCounts.map((r) => [r.customerPhone, r._count._all])
    );
    const pendingCountByPhone = new Map<string, number>(
      pendingCounts.map((r) => [r.customerPhone, r._count._all])
    );

    const byPhone = new Map<string, MergedCustomer>();

    // Approved card holders carry the stamps/rewards; their card's createdAt is
    // the first *approval*, which the scan below may move earlier.
    for (const r of stamps) {
      byPhone.set(r.customerPhone, {
        id: r.id,
        customerPhone: r.customerPhone,
        customerName: r.customerName?.trim() || null,
        stampsCollected: r.stampsCollected,
        totalRedeemed: r.totalRedeemed,
        scanCount: 0,
        pendingCount: 0,
        lastScannedAt: r.lastScannedAt?.toISOString() ?? null,
        lastReviewAt: r.lastReviewAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      });
    }

    // Everyone who ever checked in: adds the customers who have no approved
    // stamp yet, and backfills a name onto a card granted without one.
    for (const r of latestRequests) {
      const name = r.customerName?.trim() || null;
      const seen = r.createdAt.toISOString();
      const existing = byPhone.get(r.customerPhone);
      if (existing) {
        if (!existing.customerName && name) existing.customerName = name;
        if (!existing.lastScannedAt || seen > existing.lastScannedAt) {
          existing.lastScannedAt = seen;
        }
        // The first check-in predates the first approval, so a card's own
        // createdAt is not the customer's first visit.
        if (seen < existing.createdAt) existing.createdAt = seen;
        continue;
      }
      byPhone.set(r.customerPhone, {
        id: `scan:${r.customerPhone}`,
        customerPhone: r.customerPhone,
        customerName: name,
        stampsCollected: 0,
        totalRedeemed: 0,
        scanCount: 0,
        pendingCount: 0,
        lastScannedAt: seen,
        lastReviewAt: null,
        createdAt: seen,
      });
    }

    // Instant rewards: scratch reveals and dice rolls are check-ins too, but
    // neither opens a ScanRequest, so they are unioned in as their own source —
    // presence, name, first visit and last visit. They never touch
    // stampsCollected/totalRedeemed (no card, no approval) or pendingCount
    // (there is nothing to approve).
    const mergeInstantReward = (
      phone: string,
      name: string | null,
      at: string,
      idPrefix: 'scratch' | 'dice'
    ) => {
      const trimmed = name?.trim() || null;
      const existing = byPhone.get(phone);
      if (existing) {
        if (!existing.customerName && trimmed) existing.customerName = trimmed;
        if (!existing.lastScannedAt || at > existing.lastScannedAt) {
          existing.lastScannedAt = at;
        }
        if (at < existing.createdAt) existing.createdAt = at;
        return;
      }
      byPhone.set(phone, {
        id: `${idPrefix}:${phone}`,
        customerPhone: phone,
        customerName: trimmed,
        stampsCollected: 0,
        totalRedeemed: 0,
        scanCount: 0,
        pendingCount: 0,
        lastScannedAt: at,
        lastReviewAt: null,
        createdAt: at,
      });
    };

    for (const r of latestScratches) {
      mergeInstantReward(r.customerPhone, r.customerName, r.scratchedAt.toISOString(), 'scratch');
    }
    for (const r of latestRolls) {
      mergeInstantReward(r.customerPhone, r.customerName, r.rolledAt.toISOString(), 'dice');
    }

    // Every check-in ever made, per phone — the per-scan tracking count.
    // Assign, then *add* the instant-reward share: `scanCount` is every visit
    // this phone ever made, so a customer who both scanned a stamp card and
    // scratched counts once for each.
    for (const [phone, count] of scanCountByPhone) {
      const row = byPhone.get(phone);
      if (row) row.scanCount = count;
    }
    for (const [phone, count] of scratchCountByPhone) {
      const row = byPhone.get(phone);
      if (row) row.scanCount += count;
    }
    for (const [phone, count] of rollCountByPhone) {
      const row = byPhone.get(phone);
      if (row) row.scanCount += count;
    }
    for (const [phone, count] of pendingCountByPhone) {
      const row = byPhone.get(phone);
      if (row) row.pendingCount = count;
    }

    const needle = q.trim().toLowerCase();
    const matches = Array.from(byPhone.values()).filter(
      (r) =>
        !needle ||
        r.customerPhone.includes(needle) ||
        (r.customerName || '').toLowerCase().includes(needle)
    );

    // Most recent visit first; createdAt breaks ties (same-second scans).
    matches.sort((a, b) => {
      const aAt = a.lastScannedAt || a.createdAt;
      const bAt = b.lastScannedAt || b.createdAt;
      if (aAt !== bAt) return aAt < bAt ? 1 : -1;
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
      return a.customerPhone < b.customerPhone ? -1 : 1;
    });

    const total = matches.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(Math.max(1, page), totalPages);

    return apiSuccess({
      customers: matches.slice((safePage - 1) * pageSize, safePage * pageSize),
      stats: { totalCustomers: total },
      pagination: { page: safePage, pageSize, total, totalPages },
    });
  } catch (error) {
    console.error('Error listing merchant customers:', error);
    return apiError('Failed to load customers', 'INTERNAL_ERROR', 500);
  }
});
