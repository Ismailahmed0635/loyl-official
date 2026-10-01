import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SubscriptionTier } from '@prisma/client';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Storage root for transaction screenshots.
 * `STORAGE_DIR` (when set) points at a persistent volume / mounted disk so
 * files survive redeploys; unset = repo-root `storage/` (ephemeral on
 * serverless — fine for local dev, not for prod). Served only via admin API. */
export const SCREENSHOT_DIR = path.join(
  process.env.STORAGE_DIR || process.cwd(),
  process.env.STORAGE_DIR ? 'payment-screenshots' : path.join('storage', 'payment-screenshots')
);
export const SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;

// Production misconfiguration alarm: screenshots would land on the ephemeral
// container filesystem and vanish on redeploy until STORAGE_DIR mounts a volume.
if (process.env.NODE_ENV === 'production' && !process.env.STORAGE_DIR) {
  console.warn(
    'STORAGE_DIR is unset — payment screenshots use ephemeral repo-root storage/ and vanish on redeploy. Mount a persistent volume.'
  );
}
/** Allowed upload types → canonical extension/content-type. */
export const SCREENSHOT_MIME_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

/** Validity period granted per tier; FREE never expires. */
export const TIER_DURATION_DAYS: Record<SubscriptionTier, number | null> = {
  FREE: null,
  MONTHLY: 30,
  YEARLY: 365,
  PREMIUM: 365,
};

/**
 * Merchant update payload that grants a tier (Phase 7 approval):
 * status ACTIVE + tier recorded + expiry per tier (null = never expires).
 */
export function subscriptionGrant(tier: SubscriptionTier, now: Date = new Date()) {
  const days = TIER_DURATION_DAYS[tier];
  return {
    subscriptionTier: tier,
    subscriptionStatus: 'ACTIVE' as const,
    subscriptionExpiresAt: days === null ? null : new Date(now.getTime() + days * DAY_MS),
  };
}

/** Validation failure for an uploaded screenshot (routes map this to 422 + code). */
export class ScreenshotError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = 'ScreenshotError';
  }
}

/** Minimal file shape so tests don't need the DOM `File` type. */
export interface UploadLike {
  type?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * SEC-07: magic-byte sniffing. The client-declared MIME string is only a
 * hint — the stored bytes decide. Returns the detected kind or null.
 * PNG/JPEG/GIF/WebP have fixed signatures; HEIC/HEIF are ISO-BMFF files
 * identified by the `ftyp` box at offset 4 (brand not enforced — decoders
 * vary, but a PDF/script polyglot has no ftyp box and is rejected).
 */
export type DetectedImageKind = 'png' | 'jpeg' | 'webp' | 'gif' | 'heic' | 'heif';

export function detectImageKind(bytes: Uint8Array): DetectedImageKind | null {
  if (bytes.length < 12) return null;
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png';
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'gif'; // GIF8
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 && // RIFF....
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50 // ....WEBP
  ) {
    return 'webp';
  }
  if (
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70 // ftyp box
  ) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (brand.startsWith('heic') || brand === 'mif1') return 'heic';
    if (brand.startsWith('heix') || brand.startsWith('hevc') || brand.startsWith('hevx')) return 'heic';
    if (brand === 'msf1') return 'heif';
  }
  return null;
}

/** Claimed extension (from the MIME map) must match the sniffed bytes. */
export function imageKindMatchesExt(kind: DetectedImageKind, ext: string): boolean {
  const e = ext.toLowerCase();
  switch (kind) {
    case 'png':
      return e === '.png';
    case 'jpeg':
      return e === '.jpg' || e === '.jpeg';
    case 'webp':
      return e === '.webp';
    case 'gif':
      return e === '.gif';
    case 'heic':
      return e === '.heic';
    case 'heif':
      return e === '.heif';
  }
}

/**
 * Validates and persists an optional checkout screenshot; returns its filename.
 * Throws ScreenshotError (INVALID_FILE_TYPE / EMPTY_FILE / FILE_TOO_LARGE)
 * before anything is written, so bad uploads never touch storage.
 */
export async function saveScreenshot(
  file: UploadLike,
  dir: string = SCREENSHOT_DIR
): Promise<string> {
  const ext = file.type ? SCREENSHOT_MIME_EXT[file.type.toLowerCase()] : undefined;
  if (!ext) {
    throw new ScreenshotError(
      'Screenshot must be a PNG, JPEG, WebP or GIF image.',
      'INVALID_FILE_TYPE'
    );
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.byteLength === 0) {
    throw new ScreenshotError('Screenshot file is empty.', 'EMPTY_FILE');
  }
  if (buffer.byteLength > SCREENSHOT_MAX_BYTES) {
    throw new ScreenshotError('Screenshot must be 5MB or smaller.', 'FILE_TOO_LARGE');
  }
  // SEC-07: polyglot rejection — a PDF/script wearing image/png is refused.
  const kind = detectImageKind(buffer);
  if (!kind || !imageKindMatchesExt(kind, ext)) {
    throw new ScreenshotError(
      'File content does not match its declared image type.',
      'INVALID_FILE_TYPE'
    );
  }
  await mkdir(dir, { recursive: true });
  const name = `${randomUUID()}${ext}`;
  await writeFile(path.join(dir, name), buffer);
  return name;
}

/**
 * Storage cleanup the moment a request is reviewed (Phase 7 requirement).
 * Best-effort and path-traversal safe: only a bare filename inside `dir`
 * is ever unlinked, and missing files are not an error.
 */
export async function deleteScreenshot(
  fileName: string | null | undefined,
  dir: string = SCREENSHOT_DIR
): Promise<boolean> {
  if (!fileName) return false;
  const safe = path.basename(fileName);
  if (safe !== fileName) return false;
  try {
    await rm(path.join(dir, safe), { force: true });
    return true;
  } catch (err) {
    console.warn('Screenshot cleanup failed', err);
    return false;
  }
}

/** Reads a stored screenshot for the admin viewer; null when missing/unknown. */
export async function readScreenshot(
  fileName: string | null | undefined,
  dir: string = SCREENSHOT_DIR
): Promise<{ data: Buffer; contentType: string } | null> {
  if (!fileName) return null;
  const safe = path.basename(fileName);
  if (safe !== fileName) return null;
  const ext = path.extname(safe).toLowerCase();
  const contentType = Object.entries(SCREENSHOT_MIME_EXT).find(([, e]) => e === ext)?.[0];
  if (!contentType) return null;
  try {
    const data = await readFile(path.join(dir, safe));
    return { data, contentType };
  } catch {
    return null;
  }
}
