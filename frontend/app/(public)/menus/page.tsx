import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/backend/db';
import { pageMetadata } from '@/lib/metadata';

/** DB-backed at request time — never prerender (no DB at build). */
export const dynamic = 'force-dynamic';

/**
 * Step 5.2 — crawlable menu directory at `/menus` (plural).
 * `/menu` is owned by the merchant editor (`(merchant)/menu`), so the public
 * hub lives here instead. The sitemap advertises every published
 * `/menu/[slug]`, but crawlers need HTML links too — this hub lists them
 * (newest first), and each menu page links back here.
 */
export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    title: 'Restaurant & Cafe Menus in Bangladesh',
    description:
      'Browse digital menus from cafes, restaurants and salons across Bangladesh on Loyl — items, prices and branches.',
    path: '/menus',
    robots: 'index',
  });
}

export default async function MenusIndexPage() {
  const menus = await db.digitalMenu.findMany({
    where: { deletedAt: null, publishedAt: { not: null } },
    select: {
      slug: true,
      title: true,
      updatedAt: true,
      merchant: { select: { businessName: true, category: true } },
    },
    orderBy: { publishedAt: 'desc' },
    take: 200,
  });

  return (
    <main className="min-h-screen px-5 py-8 sm:px-8 font-body-md text-body-md antialiased">
      <div className="mx-auto w-full max-w-2xl">
        <p className="font-label-sm text-label-sm uppercase tracking-wider opacity-70">Loyl</p>
        <h1 className="mt-2 font-headline-lg-mobile text-headline-lg-mobile sm:font-headline-lg sm:text-headline-lg font-bold tracking-tight">
          Restaurant &amp; cafe menus in Bangladesh
        </h1>
        <p className="mt-1.5 font-body-md text-body-md opacity-80">
          {menus.length === 0
            ? 'Menus are being published. Check back soon.'
            : `${menus.length} digital menu${menus.length === 1 ? '' : 's'} from local businesses.`}
        </p>
        {menus.length > 0 && (
          <ul className="mt-8 flex flex-col gap-2.5">
            {menus.map((m) => (
              <li key={m.slug}>
                <Link
                  href={`/menu/${m.slug}`}
                  className="rounded-card p-4 flex items-baseline justify-between gap-4 shadow-sm underline-offset-2 hover:underline"
                >
                  <span className="min-w-0">
                    <span className="font-headline-sm text-headline-sm font-semibold block truncate">
                      {m.merchant.businessName}
                    </span>
                    <span className="font-body-sm text-body-sm opacity-75 block truncate">
                      {m.title}
                      {m.merchant.category ? ` · ${m.merchant.category}` : ''}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
