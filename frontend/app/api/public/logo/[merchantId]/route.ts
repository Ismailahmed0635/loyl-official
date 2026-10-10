import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/backend/db';
import { readLogo } from '@/backend/logo';

// GET /api/public/logo/[merchantId] — public logo bytes for scan pages.
// No auth guard: logos are public by nature (shown before any sign-in).
// Same merchantId URL survives logo changes, so this is revalidated quickly
// rather than immutable — Cloudflare caches by URL.
const PUBLIC_LOGO_CACHE = {
  'Cache-Control': 'public, max-age=60, must-revalidate',
} as const;

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ merchantId?: string }> }
) {
  const { merchantId } = await ctx.params;
  if (!merchantId) return NextResponse.json({ error: 'Missing merchant id' }, { status: 400 });

  const merchant = await db.merchant.findFirst({
    where: { id: merchantId, deletedAt: null },
    select: { logoPath: true },
  });
  const file = await readLogo(merchant?.logoPath);
  if (!file) return NextResponse.json({ error: 'No logo' }, { status: 404 });

  return new NextResponse(new Uint8Array(file.data), {
    headers: { 'Content-Type': file.contentType, ...PUBLIC_LOGO_CACHE },
  });
}
