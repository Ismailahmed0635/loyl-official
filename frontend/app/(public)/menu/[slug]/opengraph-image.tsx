import { ImageResponse } from 'next/og';
import { db } from '@/backend/db';
import { menuSlugSchema } from '@/backend/validation/schemas';

export const runtime = 'edge';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * Step 3b — per-menu OG image.
 * File-based route: Next serves `/menu/[slug]/opengraph-image` and uses it as
 * the page's `og:image` automatically. Sovereign Green bg, merchant + menu
 * names as plain text (Bengali script renders as system font on the edge).
 */
export default async function MenuOgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const parsed = menuSlugSchema.safeParse(slug);
  const menu = parsed.success
    ? await db.digitalMenu.findFirst({
        where: { slug: parsed.data, deletedAt: null, publishedAt: { not: null } },
        select: {
          title: true,
          merchant: { select: { businessName: true, category: true } },
        },
      })
    : null;

  const business = menu?.merchant.businessName ?? 'Loyl';
  const title = menu?.title ?? 'Digital menu';
  const category = menu?.merchant.category ?? 'Bangladesh';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '80px',
          backgroundColor: '#0D472A',
          color: '#F1FCF4',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ fontSize: 40, opacity: 0.75 }}>{category}</div>
        <div style={{ fontSize: 96, fontWeight: 800, marginTop: 16, lineHeight: 1.1 }}>{business}</div>
        <div style={{ fontSize: 48, marginTop: 16, opacity: 0.9 }}>{title}</div>
        <div style={{ fontSize: 32, marginTop: 32, opacity: 0.7 }}>Loyl · Digital menu</div>
      </div>
    ),
    { ...size }
  );
}
