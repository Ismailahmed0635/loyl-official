import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/backend/api/response';
import { withMerchant } from '@/backend/api/handler';
import { checkRateLimit, recordHit, MUTATION_MERCHANT } from '@/backend/rateLimit';
import { saveMenuSchema } from '@/backend/validation/schemas';
import { allocateSlug, menuInclude, serializeMenu, type MenuWithCategories } from '@/backend/menu';
import { gateMenuWrite } from '@/backend/subscription';
import { generateQrDataUrl, resolveRequestOrigin } from '@/lib/poster';
import { db } from '@/backend/db';

/** Prisma probe injected into the shared `allocateSlug` helper. */
const slugIsTaken = async (slug: string): Promise<boolean> =>
  Boolean(
    await db.digitalMenu.findUnique({ where: { slug }, select: { id: true } })
  );

/**
 * Uniform GET/PUT envelope: the menu (when one exists), the absolute share URL,
 * a QR that is only rendered while the menu is actually live, and the business
 * name — which is the source of the editor's default title before a row exists.
 */
async function respondWithMenu(
  req: NextRequest,
  businessName: string,
  menu: MenuWithCategories | null
) {
  if (!menu) return apiSuccess({ menu: null, businessName });

  const origin = resolveRequestOrigin(req);
  const url = `${origin.replace(/\/$/, '')}/menu/${menu.slug}`;
  // A QR that resolves to a 404 is worse than no QR: only render it once live.
  const qrDataUrl = menu.publishedAt ? await generateQrDataUrl(url) : null;

  return apiSuccess({ menu: { ...serializeMenu(menu), url, qrDataUrl }, businessName });
}

// GET /api/merchant/menu — the merchant's single digital menu (or `menu: null`
// when they have not built one yet), plus the shareable URL and, once
// published, a scannable QR data URL.
export const GET = withMerchant(async (req: NextRequest, _session, merchant) => {
  try {
    const menu = await db.digitalMenu.findUnique({
      where: { merchantId: merchant.id },
      include: menuInclude,
    });
    return respondWithMenu(req, merchant.businessName, menu);
  } catch (error) {
    console.error('Error loading digital menu:', error);
    return apiError('Failed to load your menu', 'INTERNAL_ERROR', 500);
  }
});

// PUT /api/merchant/menu — creates or replaces the whole menu. The merchant
// owns exactly one, so a partial-update schema would only add states to
// reason about; the client always sends the full editor payload.
// `publish: true` stamps `publishedAt`, which is what flips the public page on.
export const PUT = withMerchant(async (req: NextRequest, _session, merchant) => {
  const gate = checkRateLimit(`menu-save:${merchant.id}`, MUTATION_MERCHANT);
  if (!gate.allowed) {
    return apiError('Too many saves. Please wait a few minutes and try again.', 'RATE_LIMITED', 429, {
      retryAfterMs: gate.retryAfterMs,
    });
  }
  recordHit(`menu-save:${merchant.id}`, MUTATION_MERCHANT);

  // Subscription gate: the digital menu card is paid, and expired = read-only.
  const sub = gateMenuWrite(merchant);
  if (!sub.ok) return apiError(sub.message, sub.code, 403);

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return apiError('Expected a JSON body.', 'VALIDATION_ERROR', 422);
    }

    const validation = saveMenuSchema.safeParse(body);
    if (!validation.success) {
      const issue = validation.error.issues[0]?.message || 'Invalid input';
      return apiError(issue, 'VALIDATION_ERROR', 422);
    }
    const data = validation.data;
    const publishAt = data.publish ? new Date() : null;

    const existing = await db.digitalMenu.findUnique({
      where: { merchantId: merchant.id },
      select: { id: true, publishedAt: true },
    });

    let saved: MenuWithCategories;
    if (!existing) {
      saved = await db.$transaction(async (tx) => {
        const slug = await allocateSlug(merchant.businessName, slugIsTaken);
        return tx.digitalMenu.create({
          data: {
            merchantId: merchant.id,
            slug,
            title: data.title,
            backgroundHex: data.backgroundHex,
            publishedAt: publishAt,
            categories: {
              create: data.categories.map((cat, ci) => ({
                name: cat.name,
                sortOrder: ci,
                items: {
                  create: cat.items.map((it, ii) => ({
                    name: it.name,
                    description: it.description || null,
                    price: it.price || null,
                    sortOrder: ii,
                    isAvailable: it.isAvailable ?? true,
                    modifierGroups: {
                      create: (it.modifierGroups ?? []).map((g, gi) => ({
                        name: g.name,
                        selectionType: g.selectionType,
                        isRequired: g.isRequired ?? false,
                        sortOrder: gi,
                        options: {
                          create: g.options.map((o, oi) => ({
                            name: o.name,
                            price: o.price || null,
                            isDefault: o.isDefault ?? false,
                            sortOrder: oi,
                          })),
                        },
                      })),
                    },
                  })),
                },
              })),
            },
          },
          include: menuInclude,
        });
      });
    } else {
      // Full replace: the categories/items are derived from the editor's state,
      // so diffing them would only create a second source of truth.
      saved = await db.$transaction(async (tx) => {
        await tx.menuCategory.deleteMany({ where: { menuId: existing.id } });
        return tx.digitalMenu.update({
          where: { id: existing.id },
          data: {
            title: data.title,
            backgroundHex: data.backgroundHex,
            // Republishing an already-live menu must not move the original date.
            publishedAt: publishAt && !existing.publishedAt ? publishAt : undefined,
            categories: {
              create: data.categories.map((cat, ci) => ({
                name: cat.name,
                sortOrder: ci,
                items: {
                  create: cat.items.map((it, ii) => ({
                    name: it.name,
                    description: it.description || null,
                    price: it.price || null,
                    sortOrder: ii,
                    isAvailable: it.isAvailable ?? true,
                    modifierGroups: {
                      create: (it.modifierGroups ?? []).map((g, gi) => ({
                        name: g.name,
                        selectionType: g.selectionType,
                        isRequired: g.isRequired ?? false,
                        sortOrder: gi,
                        options: {
                          create: g.options.map((o, oi) => ({
                            name: o.name,
                            price: o.price || null,
                            isDefault: o.isDefault ?? false,
                            sortOrder: oi,
                          })),
                        },
                      })),
                    },
                  })),
                },
              })),
            },
          },
          include: menuInclude,
        });
      });
    }

    return respondWithMenu(req, merchant.businessName, saved);
  } catch (error) {
    console.error('Error saving digital menu:', error);
    return apiError('Failed to save your menu', 'INTERNAL_ERROR', 500);
  }
});
