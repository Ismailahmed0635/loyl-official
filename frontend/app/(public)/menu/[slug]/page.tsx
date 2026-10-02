import React, { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/backend/db';
import { menuSlugSchema } from '@/backend/validation/schemas';
import {
  MENU_DEFAULT_BACKGROUND,
  contrastOn,
  normalizeHexColor,
  surfaceOn,
} from '@/backend/menu';
import { pageMetadata } from '@/lib/metadata';

/**
 * Public menu page — Phase 12 Digital Menu Card.
 *
 * A customer scans a printed QR with their camera and lands here with no app
 * and no session, so it is a plain server component: no client JS ships, no
 * auth gate runs (see `PUBLIC_PREFIXES` in middleware.ts), and the content is
 * in the HTML for share previews.
 *
 * The merchant picks any background they like; `contrastOn` decides the text
 * colour from WCAG luminance so a dark green and a pale yellow both stay
 * readable. Those two colours (background / foreground) and the `surface`
 * panel tint are applied with inline `style` because an arbitrary per-merchant
 * hex — and a translucent overlay derived from it — is the one thing Tailwind
 * cannot express as a class. Everything structural uses the Sovereign Green
 * type + geometry tokens.
 *
 * There is deliberately **no `loading.tsx` here**. A segment-level fallback
 * streams the shell as soon as this page suspends on its one fast, indexed
 * query, which commits the HTTP status before `notFound()` runs — a missing
 * menu would then answer 200 to crawlers (the page is the app's only crawlable
 * surface, so the 404 has to be a real 404). Shipping the document in one flush
 * is also the faster path for a page whose entire body is server-rendered.
 */

const loadMenu = cache(async (rawSlug: string) => {
  const slug = menuSlugSchema.safeParse(rawSlug);
  if (!slug.success) return null;

  return db.digitalMenu.findFirst({
    where: { slug: slug.data, deletedAt: null, publishedAt: { not: null } },
    select: {
      title: true,
      backgroundHex: true,
      publishedAt: true,
      merchant: {
        select: { businessName: true, category: true },
      },
      categories: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          name: true,
          items: {
            orderBy: { sortOrder: 'asc' },
            select: {
              id: true,
              name: true,
              description: true,
              price: true,
              isAvailable: true,
            },
          },
        },
      },
    },
  });
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const menu = await loadMenu(slug);
  if (!menu) return { title: 'Menu not found' };

  const description = `Menu for ${menu.merchant.businessName}${
    menu.merchant.category ? ` — ${menu.merchant.category}` : ''
  }.`;

  // Published menus are the one crawlable surface (robots.txt allows /menu/),
  // so this page opts into indexing over the root layout's noindex default.
  return {
    ...pageMetadata({
      title: `${menu.title} — ${menu.merchant.businessName}`,
      description,
      path: `/menu/${slug}`,
      robots: 'index',
    }),
    twitter: { card: 'summary', title: menu.title, description },
  };
}

export default async function PublicMenuPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const menu = await loadMenu(slug);
  if (!menu) notFound();

  const background = normalizeHexColor(menu.backgroundHex) ?? MENU_DEFAULT_BACKGROUND;
  const foreground = contrastOn(background);
  const surface = surfaceOn(background);
  const hasItems = menu.categories.some((cat) => cat.items.length > 0);

  return (
    <main
      className="min-h-screen px-5 py-8 sm:px-8 font-body-md text-body-md antialiased"
      style={{ backgroundColor: background, color: foreground }}
    >
      <div className="mx-auto w-full max-w-2xl">
        <header className="pb-6">
          <p className="font-label-sm text-label-sm uppercase tracking-wider opacity-70">
            {menu.merchant.category}
          </p>
          <h1 className="mt-2 font-headline-lg-mobile text-headline-lg-mobile sm:font-headline-lg sm:text-headline-lg font-bold tracking-tight">
            {menu.title}
          </h1>
          <p className="mt-1.5 font-body-md text-body-md opacity-80">
            {menu.merchant.businessName}
          </p>
        </header>

        {hasItems ? (
          <div className="flex flex-col gap-8">
            {menu.categories.map((category) => (
              <section key={category.id} className="flex flex-col gap-3">
                {/* Section title with the tactile left colour bar */}
                <div className="flex items-center gap-2 pl-1">
                  <span className="w-1.5 h-6 rounded-full bg-current" aria-hidden="true" />
                  <h2 className="font-headline-sm text-headline-sm uppercase tracking-wide">
                    {category.name}
                  </h2>
                </div>
                <ul className="flex flex-col gap-2.5">
                  {category.items.map((item) => (
                    <li
                      key={item.id}
                      className="rounded-card p-4 flex items-start justify-between gap-4 shadow-hairline"
                      style={{ backgroundColor: surface }}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span
                            className={`font-headline-sm text-headline-sm font-semibold ${
                              item.isAvailable ? '' : 'line-through opacity-60'
                            }`}
                          >
                            {item.name}
                          </span>
                          {!item.isAvailable && (
                            <span
                              className="rounded-pill px-2 py-0.5 font-label-sm text-label-sm uppercase tracking-wider font-semibold"
                              style={{ backgroundColor: foreground, color: background }}
                            >
                              Sold out
                            </span>
                          )}
                        </div>
                        {item.description && (
                          <p className="mt-1 font-body-sm text-body-sm opacity-75 line-clamp-2">
                            {item.description}
                          </p>
                        )}
                      </div>
                      {item.price && (
                        <span
                          className={`shrink-0 whitespace-nowrap font-metric-num text-headline-sm font-bold tabular-nums ${
                            item.isAvailable ? '' : 'opacity-60'
                          }`}
                        >
                          {item.price}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <p
            className="rounded-card px-4 py-6 text-center font-body-md text-body-md"
            style={{ backgroundColor: surface }}
          >
            This menu is being updated. Please check back soon.
          </p>
        )}

        <footer
          className="mt-12 border-t pt-4 font-body-sm text-body-sm opacity-70"
          style={{ borderColor: surface }}
        >
          <p>
            {menu.merchant.businessName} · Updated{' '}
            {menu.publishedAt ? new Date(menu.publishedAt).toLocaleDateString('en-GB') : ''}
          </p>
        </footer>
      </div>
    </main>
  );
}
