import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/backend/api/response';
import { withAdmin } from '@/backend/api/handler';
import { adminActionListQuerySchema } from '@/backend/validation/schemas';
import { db } from '@/backend/db';

/**
 * GET /api/admin/actions — the RT-02 admin audit trail.
 *
 * Newest first, paginated, optionally filtered by action or target type.
 * Rows are append-only, so this feed is the authoritative answer to
 * "who approved what, when" — row state alone cannot reconstruct it
 * (screenshots are deleted on review, subscriptions get overwritten).
 *
 * `detail` is a JSON string of safe context (ids, tiers, amounts) — it is
 * parsed for the response but never contains phones or tokens.
 */
export const GET = withAdmin(async (req: NextRequest) => {
  const url = new URL(req.url);
  const parsed = adminActionListQuerySchema.safeParse({
    action: url.searchParams.get('action') || undefined,
    targetType: url.searchParams.get('targetType') || undefined,
    page: url.searchParams.get('page') || undefined,
    pageSize: url.searchParams.get('pageSize') || undefined,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0]?.message || 'Invalid query';
    return apiError(issue, 'VALIDATION_ERROR', 422);
  }

  const page = parsed.data.page ?? 1;
  const pageSize = parsed.data.pageSize ?? 20;
  const where: { action?: string; targetType?: string } = {};
  if (parsed.data.action) where.action = parsed.data.action;
  if (parsed.data.targetType) where.targetType = parsed.data.targetType;

  const [rows, total] = await db.$transaction([
    db.adminAction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.adminAction.count({ where }),
  ]);

  return apiSuccess({
    actions: rows.map((row) => {
      let detail: unknown = null;
      if (row.detail) {
        try {
          detail = JSON.parse(row.detail);
        } catch {
          detail = null;
        }
      }
      const { detail: _raw, ...rest } = row;
      return { ...rest, detail };
    }),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  });
});
