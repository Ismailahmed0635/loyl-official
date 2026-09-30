import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  subscriptionGrant,
  TIER_DURATION_DAYS,
  saveScreenshot,
  deleteScreenshot,
  readScreenshot,
  ScreenshotError,
  SCREENSHOT_MAX_BYTES,
  detectImageKind,
  imageKindMatchesExt,
} from './billing';

/** Real magic-byte prefixes so fixtures pass the SEC-07 content gate. */
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WEBP_SIG = [0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
const JPEG_SIG = [0xff, 0xd8, 0xff, 0xe0];

function realBytes(sig: number[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  out.set(sig.slice(0, Math.min(sig.length, total)));
  return out;
}

describe('Phase 7 tier grants', () => {
  const now = new Date('2026-09-24T00:00:00.000Z');

  it('grants the right expiry per tier (30d / 365d / 365d / never)', () => {
    const monthly = subscriptionGrant('MONTHLY', now);
    expect(monthly.subscriptionStatus).toBe('ACTIVE');
    expect(monthly.subscriptionTier).toBe('MONTHLY');
    expect(monthly.subscriptionExpiresAt?.getTime()).toBe(now.getTime() + 30 * 86400000);

    const yearly = subscriptionGrant('YEARLY', now);
    expect(yearly.subscriptionExpiresAt?.getTime()).toBe(now.getTime() + 365 * 86400000);

    const premium = subscriptionGrant('PREMIUM', now);
    expect(premium.subscriptionStatus).toBe('ACTIVE');
    expect(premium.subscriptionExpiresAt?.getTime()).toBe(now.getTime() + 365 * 86400000);

    const free = subscriptionGrant('FREE', now);
    expect(free.subscriptionStatus).toBe('ACTIVE');
    expect(free.subscriptionTier).toBe('FREE');
    expect(free.subscriptionExpiresAt).toBeNull();
  });

  it('covers every tier in the duration map', () => {
    expect(Object.keys(TIER_DURATION_DAYS).sort()).toEqual([
      'FREE',
      'MONTHLY',
      'PREMIUM',
      'YEARLY',
    ]);
  });
});

describe('Phase 7 screenshot storage', () => {
  let dir: string;

  const file = (type: string, bytes: number | Uint8Array) => ({
    type,
    arrayBuffer: async () =>
      (typeof bytes === 'number' ? new Uint8Array(bytes) : bytes).buffer as ArrayBuffer,
  });

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'loyl-p7-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('saves a valid image and reads it back with its content type', async () => {
    const name = await saveScreenshot(file('image/png', realBytes(PNG_SIG, 32)), dir);
    expect(name.endsWith('.png')).toBe(true);
    expect(await readdir(dir)).toEqual([name]);

    const read = await readScreenshot(name, dir);
    expect(read?.contentType).toBe('image/png');
    expect(read?.data.byteLength).toBe(32);
  });

  it('rejects unsupported types, empty files and oversize uploads', async () => {
    await expect(saveScreenshot(file('text/plain', 10), dir)).rejects.toMatchObject({
      name: 'ScreenshotError',
      code: 'INVALID_FILE_TYPE',
    });
    await expect(saveScreenshot(file('image/png', 0), dir)).rejects.toMatchObject({
      code: 'EMPTY_FILE',
    });
    await expect(
      saveScreenshot(file('image/jpeg', SCREENSHOT_MAX_BYTES + 1), dir)
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    expect(await readdir(dir)).toEqual([]); // nothing written on failure
  });

  it('rejects with ScreenshotError instances', async () => {
    await expect(saveScreenshot(file('application/pdf', 5), dir)).rejects.toBeInstanceOf(
      ScreenshotError
    );
  });

  it('deleteScreenshot removes the file the moment it is called', async () => {
    const name = await saveScreenshot(file('image/webp', realBytes(WEBP_SIG, 16)), dir);
    expect(await deleteScreenshot(name, dir)).toBe(true);
    expect(await readdir(dir)).toEqual([]);
    expect(await readScreenshot(name, dir)).toBeNull();
  });

  it('deleteScreenshot is safe: traversal names, unknown names, nulls', async () => {
    expect(await deleteScreenshot('../evil.png', dir)).toBe(false);
    expect(await deleteScreenshot('nested/evil.png', dir)).toBe(false);
    expect(await deleteScreenshot(null, dir)).toBe(false);
    expect(await deleteScreenshot(undefined, dir)).toBe(false);
    expect(await deleteScreenshot('ghost.png', dir)).toBe(true); // force:true — already gone
  });

  it('readScreenshot refuses traversal and unknown extensions', async () => {
    expect(await readScreenshot('../secret.png', dir)).toBeNull();
    expect(await readScreenshot('nope.txt', dir)).toBeNull();
    expect(await readScreenshot(null, dir)).toBeNull();
  });

  it('SEC-07: rejects polyglots — PDF/script bytes wearing an image type', async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0, 0, 0, 0, 0, 0, 0]); // %PDF-
    await expect(saveScreenshot(file('image/png', pdf), dir)).rejects.toMatchObject({
      code: 'INVALID_FILE_TYPE',
    });
    // Right magic, wrong label: JPEG bytes claimed as PNG.
    await expect(
      saveScreenshot(file('image/png', realBytes(JPEG_SIG, 16)), dir)
    ).rejects.toMatchObject({ code: 'INVALID_FILE_TYPE' });
    expect(await readdir(dir)).toEqual([]); // nothing written on failure
  });
});

describe('SEC-07 magic-byte sniffing', () => {
  const u8 = (a: number[]) => new Uint8Array(a);
  it('detects png/jpeg/gif/webp/heic, null for junk', () => {
    expect(detectImageKind(u8([...PNG_SIG, 0, 0, 0, 0]))).toBe('png');
    expect(detectImageKind(u8([...JPEG_SIG, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('jpeg');
    expect(detectImageKind(u8([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]))).toBe('gif');
    expect(detectImageKind(u8(WEBP_SIG))).toBe('webp');
    // ftypheic box
    expect(
      detectImageKind(u8([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]))
    ).toBe('heic');
    expect(detectImageKind(u8([0x25, 0x50, 0x44, 0x46, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(detectImageKind(u8([1, 2, 3]))).toBeNull(); // too short
  });

  it('matches kinds to extensions (jpeg accepts .jpg)', () => {
    expect(imageKindMatchesExt('jpeg', '.jpg')).toBe(true);
    expect(imageKindMatchesExt('jpeg', '.png')).toBe(false);
    expect(imageKindMatchesExt('png', '.png')).toBe(true);
    expect(imageKindMatchesExt('webp', '.webp')).toBe(true);
    expect(imageKindMatchesExt('heic', '.heic')).toBe(true);
    expect(imageKindMatchesExt('gif', '.gif')).toBe(true);
  });
});
