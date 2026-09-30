import { db } from '@/backend/db';
import { buildSitemapEntries } from '@/lib/metadata';

/**
 * Phase 8 — serves `/sitemap.xml`. The only crawlable surface today is
 * published digital menus (the marketing landing is Phase 6), so the slug
 * list is read from the DB at request time rather than at build.
 */
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<ReturnType<typeof buildSitemapEntries>> {
  const published = await db.digitalMenu.findMany({
    where: { deletedAt: null, publishedAt: { not: null } },
    select: { slug: true },
    orderBy: { publishedAt: 'desc' },
  });
  return buildSitemapEntries(published.map((m) => m.slug));
}
