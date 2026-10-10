import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { apiSuccess, apiError } from '@/backend/api/response';
import { withMerchant } from '@/backend/api/handler';
import { checkRateLimit, recordHit, MUTATION_MERCHANT } from '@/backend/rateLimit';
import { LogoUploadError, deleteLogo, readLogo, saveLogo, merchantLogoPath } from '@/backend/logo';
import { db } from '@/backend/db';

/** The stored file is merchant-only: customers use the public logo URL. */
const LOGO_CACHE = { 'Cache-Control': 'private, no-store' } as const;

function uploadError(err: LogoUploadError) {
  return apiError(err.message, err.code, 422);
}

// GET /api/merchant/logo — streams the merchant's own uploaded logo back
// so the settings form can show what is currently live.
export const GET = withMerchant(async (_req: NextRequest, _session, merchant) => {
  const row = await db.merchant.findUnique({
    where: { id: merchant.id },
    select: { logoPath: true },
  });
  const file = await readLogo(row?.logoPath);
  if (!file) return apiError('No logo uploaded yet.', 'NO_LOGO', 404);

  return new NextResponse(new Uint8Array(file.data), {
    headers: { 'Content-Type': file.contentType, ...LOGO_CACHE },
  });
});

// POST /api/merchant/logo — validates and stores a logo image (multipart `logo`).
export const POST = withMerchant(async (req: NextRequest, _session, merchant) => {
  const gate = checkRateLimit(`merchant-logo:${merchant.id}`, MUTATION_MERCHANT);
  if (!gate.allowed) {
    return apiError('Too many uploads. Please wait a few minutes and try again.', 'RATE_LIMITED', 429, {
      retryAfterMs: gate.retryAfterMs,
    });
  }
  recordHit(`merchant-logo:${merchant.id}`, MUTATION_MERCHANT);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return apiError('Expected a multipart/form-data submission.', 'INVALID_FORM', 400);
  }

  const file = form.get('logo');
  if (!file || typeof file === 'string') {
    return apiError('Choose a logo to upload.', 'VALIDATION_ERROR', 422);
  }

  let savedName: string;
  try {
    savedName = await saveLogo(file);
  } catch (err) {
    if (err instanceof LogoUploadError) return uploadError(err);
    console.error('Merchant logo upload failed:', err);
    return apiError('Could not store the logo.', 'INTERNAL_ERROR', 500);
  }

  try {
    const previous = await db.merchant.findUnique({
      where: { id: merchant.id },
      select: { logoPath: true },
    });
    const previousPath = previous?.logoPath ?? null;
    await db.merchant.update({
      where: { id: merchant.id },
      data: { logoPath: savedName },
      select: { id: true },
    });

    // Only unlink after the row points at the new file, so a failed write can
    // never leave the merchant referencing a logo we already deleted.
    if (previousPath && previousPath !== savedName) await deleteLogo(previousPath);

    return apiSuccess({ logoUrl: merchantLogoPath(merchant.id) }, 201);
  } catch (error) {
    console.error('Error attaching merchant logo:', error);
    await deleteLogo(savedName);
    return apiError('Could not save the logo.', 'INTERNAL_ERROR', 500);
  }
});

// DELETE /api/merchant/logo — drops the logo (and its file) while keeping
// the legacy logoUrl fallback intact.
export const DELETE = withMerchant(async (_req: NextRequest, _session, merchant) => {
  const row = await db.merchant.findUnique({
    where: { id: merchant.id },
    select: { id: true, logoPath: true },
  });
  if (!row?.logoPath) return apiError('No logo uploaded yet.', 'NO_LOGO', 404);

  await db.merchant.update({
    where: { id: row.id },
    data: { logoPath: null },
    select: { id: true },
  });
  await deleteLogo(row.logoPath);

  return apiSuccess({ removed: true });
});
