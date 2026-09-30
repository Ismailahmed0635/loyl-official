import { Prisma } from '@prisma/client';
import { apiError, apiSuccess } from '@/backend/api/response';
import { withMerchant } from '@/backend/api/handler';
import { checkoutSchema } from '@/backend/validation/schemas';
import { checkRateLimit, recordHit, CHECKOUT_MERCHANT } from '@/backend/rateLimit';
import { deleteScreenshot, saveScreenshot, ScreenshotError } from '@/backend/billing';
import { db } from '@/backend/db';

function fieldOf(error: { issues: { path: (string | number)[] }[] }): string | undefined {
  return error.issues[0]?.path[0] !== undefined ? String(error.issues[0].path[0]) : undefined;
}

// POST /api/billing/checkout — Phase 7 manual payment request.
// multipart/form-data: requestedTier, payment details (paid tiers only) and
// an OPTIONAL screenshot file. One PENDING request per merchant at a time.
export const POST = withMerchant(async (req, _session, merchant) => {
  const gate = checkRateLimit(`checkout:${merchant.id}`, CHECKOUT_MERCHANT);
  if (!gate.allowed) {
    return apiError('Too many checkout attempts. Please wait a few minutes and try again.', 'RATE_LIMITED', 429, {
      retryAfterMs: gate.retryAfterMs,
    });
  }
  recordHit(`checkout:${merchant.id}`, CHECKOUT_MERCHANT);

  const existing = await db.paymentRequest.findFirst({
    where: { merchantId: merchant.id, status: 'PENDING', deletedAt: null },
    select: { id: true },
  });
  if (existing) {
    return apiError('You already have a request awaiting review.', 'PENDING_REQUEST_EXISTS', 409, {
      paymentRequestId: existing.id,
    });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return apiError('Expected a multipart/form-data submission.', 'INVALID_FORM', 400);
  }

  // FREE requests carry no payment details — drop any stray fields so the
  // paid-tier requirements never apply to them.
  const tierValue = form.get('requestedTier');
  const candidate: Record<string, unknown> = { requestedTier: tierValue ?? undefined };
  if (tierValue !== 'FREE') {
    candidate.paymentMethod = form.get('paymentMethod') ?? undefined;
    candidate.senderNumber = form.get('senderNumber') ?? undefined;
    candidate.trxId = form.get('trxId') ?? undefined;
    candidate.amount = form.get('amount') ?? undefined;
  }

  const parsed = checkoutSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return apiError(issue?.message || 'Invalid checkout details', 'VALIDATION_ERROR', 422, {
      field: fieldOf(parsed.error),
    });
  }
  const data = parsed.data;
  const free = data.requestedTier === 'FREE';

  // Optional screenshot: validated + persisted BEFORE the row exists, so a
  // rejected upload never leaves a half-created request (or orphan file).
  let screenshotPath: string | null = null;
  const file = form.get('screenshot');
  if (file && typeof file !== 'string' && file.size > 0) {
    try {
      screenshotPath = await saveScreenshot(file);
    } catch (err) {
      if (err instanceof ScreenshotError) return apiError(err.message, err.code, 422);
      throw err;
    }
  }

  try {
    // Serialize concurrent submissions per merchant: the row update takes a
    // write lock, so a second POST waits, then re-sees the first POST's
    // committed PENDING row (read-committed) instead of racing past the
    // pre-check above.
    const row = await db.$transaction(async (tx) => {
      await tx.merchant.update({ where: { id: merchant.id }, data: { updatedAt: new Date() } });
      const duplicate = await tx.paymentRequest.findFirst({
        where: { merchantId: merchant.id, status: 'PENDING', deletedAt: null },
        select: { id: true },
      });
      if (duplicate) return { duplicateId: duplicate.id as string, created: null as null };
      const created = await tx.paymentRequest.create({
        data: {
          merchantId: merchant.id,
          requestedTier: data.requestedTier,
          paymentMethod: free ? 'BKASH' : data.paymentMethod!,
          senderNumber: free ? null : data.senderNumber!,
          trxId: free ? null : data.trxId!,
          amount: free ? 0 : data.amount!,
          screenshotPath,
        },
      });
      return { duplicateId: null as string | null, created };
    });
    if (row.duplicateId) {
      // Lost the race: drop our just-saved file and point at the winner.
      await deleteScreenshot(screenshotPath);
      return apiError('You already have a request awaiting review.', 'PENDING_REQUEST_EXISTS', 409, {
        paymentRequestId: row.duplicateId,
      });
    }
    const created = row.created!;
    const { screenshotPath: _stored, ...rest } = created;
    return apiSuccess(
      { request: { ...rest, amount: Number(rest.amount), hasScreenshot: created.screenshotPath !== null } },
      201
    );
  } catch (err) {
    // Roll back the just-written file — the row it belonged to was not created.
    await deleteScreenshot(screenshotPath);
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return apiError('This Trx ID was already submitted.', 'TRX_ALREADY_USED', 409);
    }
    throw err;
  }
});
