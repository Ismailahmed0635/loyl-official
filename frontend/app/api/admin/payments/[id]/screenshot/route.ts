import { NextResponse } from 'next/server';
import { apiError } from '@/backend/api/response';
import { withAdmin } from '@/backend/api/handler';
import { readScreenshot } from '@/backend/billing';
import { db } from '@/backend/db';

// GET /api/admin/payments/[id]/screenshot — streams the uploaded transaction
// screenshot to the admin review UI. Admin-only; the raw storage path is
// never exposed and files disappear once the request is reviewed.
export const GET = withAdmin(async (_req, _session, ctx) => {
  const { id } = await ctx.params;
  if (!id) return apiError('Payment request id is required', 'VALIDATION_ERROR', 422);

  const row = await db.paymentRequest.findUnique({ where: { id } });
  if (!row || row.deletedAt || !row.screenshotPath) {
    return apiError('No screenshot on this request.', 'SCREENSHOT_NOT_FOUND', 404);
  }

  const file = await readScreenshot(row.screenshotPath);
  if (!file) {
    return apiError('Screenshot file is missing from storage.', 'SCREENSHOT_NOT_FOUND', 404);
  }

  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      'Content-Type': file.contentType,
      'Cache-Control': 'private, no-store',
    },
  });
});
