/**
 * backend/logo.ts — merchant logo upload storage.
 *
 * Same shape as the menu-photo helpers in `backend/menu.ts` (which in turn
 * mirror the screenshot helpers in `backend/billing.ts`): validate-before-
 * write, magic-byte polyglot rejection via `detectImageKind` +
 * `imageKindMatchesExt`, uuid filename, bare-filename-only delete/read.
 *
 * Differences from menu photos:
 *  - 2MB cap (logos render as small <img> on scan pages, not full photos).
 *  - PNG/JPEG/WebP only — no HEIC/HEIF, because browsers must render the
 *    bytes directly in an <img> tag and HEIC has no browser support.
 */
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BUCKET_MERCHANT_LOGOS, resolveDriver } from './storage';
import { detectImageKind, imageKindMatchesExt } from '@/backend/billing';

/** Storage root for merchant logos (never served publicly by path).
 * Same `STORAGE_DIR` contract as screenshots and menu photos. */
export const LOGO_DIR = path.join(
  process.env.STORAGE_DIR || process.cwd(),
  process.env.STORAGE_DIR ? 'merchant-logos' : path.join('storage', 'merchant-logos')
);
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/** Public URL for a merchant's logo. Stable per merchant id so a logo
 * change keeps the same URL (served with a short max-age, not immutable). */
export function merchantLogoPath(merchantId: string): string {
  return `/api/public/logo/${merchantId}`;
}

// Production misconfiguration alarm: same rule as screenshots/menu photos.
if (
  process.env.NODE_ENV === 'production' &&
  !process.env.STORAGE_DIR &&
  !process.env.SUPABASE_URL
) {
  console.warn(
    'No persistent storage configured — set SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY or mount a volume at STORAGE_DIR, otherwise merchant logos cannot be stored.'
  );
}

/** Minimal file shape so tests don't need the DOM `File` type (mirrors billing/menu). */
export interface UploadLike {
  type?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Validation failure for an uploaded logo (routes map this to 422 + code). */
export class LogoUploadError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = 'LogoUploadError';
  }
}

/** Allowed upload types → canonical extension/content-type. No HEIC/HEIF:
 * browsers must render the bytes directly in an <img> tag. */
export const LOGO_MIME_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

/**
 * Validates and persists a merchant logo; returns its bare filename.
 * Throws BEFORE anything is written, so a rejected upload never leaves an
 * orphan file behind.
 */
export async function saveLogo(file: UploadLike, dir?: string): Promise<string> {
  const ext = file.type ? LOGO_MIME_EXT[file.type.toLowerCase()] : undefined;
  if (!ext) {
    throw new LogoUploadError('Logo must be a PNG, JPEG or WebP image.', 'INVALID_FILE_TYPE');
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.byteLength === 0) {
    throw new LogoUploadError('Logo file is empty.', 'EMPTY_FILE');
  }
  if (buffer.byteLength > LOGO_MAX_BYTES) {
    throw new LogoUploadError('Logo must be 2MB or smaller.', 'FILE_TOO_LARGE');
  }
  // SEC-07: polyglot rejection — same rule as screenshots and menu photos.
  const kind = detectImageKind(buffer);
  if (!kind || !imageKindMatchesExt(kind, ext)) {
    throw new LogoUploadError(
      'File content does not match its declared image type.',
      'INVALID_FILE_TYPE'
    );
  }
  const name = `${randomUUID()}${ext}`;
  const contentType =
    Object.entries(LOGO_MIME_EXT).find(([, e]) => e === ext)?.[0] ?? 'application/octet-stream';
  await resolveDriver(BUCKET_MERCHANT_LOGOS, LOGO_DIR, dir).put(name, buffer, contentType);
  return name;
}

/** Best-effort, path-traversal safe removal — only a bare filename is unlinked. */
export async function deleteLogo(
  fileName: string | null | undefined,
  dir?: string
): Promise<boolean> {
  if (!fileName) return false;
  const safe = path.basename(fileName);
  if (safe !== fileName) return false;
  return resolveDriver(BUCKET_MERCHANT_LOGOS, LOGO_DIR, dir).remove(safe);
}

/** Reads a stored logo; null when missing/unknown. */
export async function readLogo(
  fileName: string | null | undefined,
  dir?: string
): Promise<{ data: Buffer; contentType: string } | null> {
  if (!fileName) return null;
  const safe = path.basename(fileName);
  if (safe !== fileName) return null;
  const contentType = Object.entries(LOGO_MIME_EXT).find(
    ([, e]) => e === path.extname(safe).toLowerCase()
  )?.[0];
  if (!contentType) return null;
  try {
    const data = await resolveDriver(BUCKET_MERCHANT_LOGOS, LOGO_DIR, dir).get(safe);
    return data ? { data, contentType } : null;
  } catch (err) {
    console.warn('Merchant logo read failed', err);
    return null;
  }
}

/**
 * Public logo URL for a merchant row: the stable per-id endpoint when a logo
 * file is stored, else the legacy externally-hosted `logoUrl`, else null.
 */
export function merchantLogoUrl(m: {
  id: string;
  logoPath: string | null | undefined;
  logoUrl: string | null | undefined;
}): string | null {
  if (m.logoPath) return merchantLogoPath(m.id);
  return m.logoUrl ?? null;
}
