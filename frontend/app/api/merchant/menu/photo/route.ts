import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError } from '@/backend/api/response';
import { withMerchant } from '@/backend/api/handler';
import { checkRateLimit, recordHit, MUTATION_MERCHANT } from '@/backend/rateLimit';
import { gateMenuWrite } from '@/backend/subscription';
import {
  MENU_DEFAULT_BACKGROUND,
  MenuUploadError,
  allocateSlug,
  deleteMenuPhoto,
  menuInclude,
  readMenuPhoto,
  saveMenuPhoto,
  serializeMenu,
} from '@/backend/menu';
import { db } from '@/backend/db';
import { resolveRequestOrigin } from '@/lib/poster';

/** The stored file is merchant-only: customers get the structured menu, never the photo. */
const PHOTO_CACHE = { 'Cache-Control': 'private, no-store' } as const;

/** Prisma probe injected into the shared `allocateSlug` helper. */
const slugIsTaken = async (slug: string): Promise<boolean> =>
  Boolean(
    await db.digitalMenu.findUnique({ where: { slug }, select: { id: true } })
  );

function uploadError(err: MenuUploadError) {
  return apiError(err.message, err.code, 422);
}

// GET /api/merchant/menu/photo — streams the merchant's own uploaded photo back
// so the editor can show what is about to be (or was) read.
export const GET = withMerchant(async (_req: NextRequest, _session, merchant) => {
  const menu = await db.digitalMenu.findUnique({
    where: { merchantId: merchant.id },
    select: { photoPath: true },
  });
  const file = await readMenuPhoto(menu?.photoPath);
  if (!file) return apiError('No menu photo uploaded yet.', 'NO_MENU_PHOTO', 404);

  return new NextResponse(new Uint8Array(file.data), {
    headers: { 'Content-Type': file.contentType, ...PHOTO_CACHE },
  });
});

// POST /api/merchant/menu/photo — validates and stores a camera/gallery image.
// The menu row is created on first upload (unpublished) so the photo has
// somewhere to live before the merchant has written a single item.
export const POST = withMerchant(async (req: NextRequest, _session, merchant) => {
  const gate = checkRateLimit(`menu-photo:${merchant.id}`, MUTATION_MERCHANT);
  if (!gate.allowed) {
    return apiError('Too many uploads. Please wait a few minutes and try again.', 'RATE_LIMITED', 429, {
      retryAfterMs: gate.retryAfterMs,
    });
  }
  recordHit(`menu-photo:${merchant.id}`, MUTATION_MERCHANT);

  // Subscription gate: uploading is part of building the menu.
  const sub = gateMenuWrite(merchant);
  if (!sub.ok) return apiError(sub.message, sub.code, 403);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return apiError('Expected a multipart/form-data submission.', 'INVALID_FORM', 400);
  }

  const file = form.get('photo');
  if (!file || typeof file === 'string') {
    return apiError('Choose a menu photo to upload.', 'VALIDATION_ERROR', 422);
  }

  let savedName: string;
  try {
    savedName = await saveMenuPhoto(file);
  } catch (err) {
    if (err instanceof MenuUploadError) return uploadError(err);
    console.error('Menu photo upload failed:', err);
    return apiError('Could not store the menu photo.', 'INTERNAL_ERROR', 500);
  }

  try {
    const existing = await db.digitalMenu.findUnique({
      where: { merchantId: merchant.id },
      select: { id: true, photoPath: true },
    });

    const previousPath = existing?.photoPath ?? null;
    const menu = existing
      ? await db.digitalMenu.update({
          where: { id: existing.id },
          data: { photoPath: savedName },
          include: menuInclude,
        })
      : await db.digitalMenu.create({
          data: {
            merchantId: merchant.id,
            slug: await allocateSlug(merchant.businessName, slugIsTaken),
            title: merchant.businessName,
            backgroundHex: MENU_DEFAULT_BACKGROUND,
            photoPath: savedName,
          },
          include: menuInclude,
        });

    // Only unlink after the row points at the new file, so a failed write can
    // never leave the menu referencing a photo we already deleted.
    if (previousPath && previousPath !== savedName) await deleteMenuPhoto(previousPath);

    return apiSuccess(
      {
        photoUrl: '/api/merchant/menu/photo',
        // The row is often created right here (first upload), so the share URL
        // has to come back with it or the editor has nothing to show. It rides
        // on `menu` exactly where GET/PUT put it — one shape for every read.
        menu: {
          ...serializeMenu(menu),
          url: `${resolveRequestOrigin(req).replace(/\/$/, '')}/menu/${menu.slug}`,
        },
      },
      201
    );
  } catch (error) {
    console.error('Error attaching menu photo:', error);
    await deleteMenuPhoto(savedName);
    return apiError('Could not save the menu photo.', 'INTERNAL_ERROR', 500);
  }
});

// DELETE /api/merchant/menu/photo — drops the photo (and its file) while
// keeping the menu itself; the merchant can always start over by uploading.
export const DELETE = withMerchant(async (_req: NextRequest, _session, merchant) => {
  const menu = await db.digitalMenu.findUnique({
    where: { merchantId: merchant.id },
    select: { id: true, photoPath: true },
  });
  if (!menu?.photoPath) return apiError('No menu photo uploaded yet.', 'NO_MENU_PHOTO', 404);

  await db.digitalMenu.update({
    where: { id: menu.id },
    data: { photoPath: null },
    select: { id: true },
  });
  await deleteMenuPhoto(menu.photoPath);

  return apiSuccess({ removed: true });
});
