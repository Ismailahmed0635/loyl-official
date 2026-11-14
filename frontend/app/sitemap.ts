import { db } from '@/backend/db';
import { APP_URL, buildSitemapEntries } from '@/lib/metadata';

/**
 * Phase 8 — serves `/sitemap.xml`. The only crawlable surface today is
 * published digital menus (the marketing landing is Phase 6), so the slug
 * list is read from the DB at request time rather than at build.
 */
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<ReturnType<typeof buildSitemapEntries>> {
  const published = await db.digitalMenu.findMany({
    where: { deletedAt: null, publishedAt: { not: null } },
    select: { slug: true, updatedAt: true },
    orderBy: { publishedAt: 'desc' },
  });
  const entries = buildSitemapEntries(
    published.map((m) => m.slug),
    undefined,
    new Map(published.map((m) => [m.slug, m.updatedAt]))
  );
  // Step 5.2 — the /menus hub itself: the internal-link source for all menus.
  const hubUpdated = published.reduce<Date | undefined>(
    (latest, m) => (!latest || m.updatedAt > latest ? m.updatedAt : latest),
    undefined
  );
  return [
    {
      url: new URL('/menus', APP_URL).toString(),
      lastModified: hubUpdated ?? new Date(),
      changeFrequency: 'daily' as const,
      priority: 0.8,
    },
    ...entries,
  ];
}
