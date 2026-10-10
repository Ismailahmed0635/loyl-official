import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  saveLogo,
  deleteLogo,
  readLogo,
  LogoUploadError,
  LOGO_MAX_BYTES,
  merchantLogoUrl,
  merchantLogoPath,
} from './logo';

/** Real magic-byte prefixes so fixtures pass the SEC-07 content gate. */
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WEBP_SIG = [0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
const JPEG_SIG = [0xff, 0xd8, 0xff, 0xe0];

function realBytes(sig: number[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  out.set(sig.slice(0, Math.min(sig.length, total)));
  return out;
}

describe('merchant logo storage', () => {
  let dir: string;

  const file = (type: string, bytes: number | Uint8Array) => ({
    type,
    arrayBuffer: async () =>
      (typeof bytes === 'number' ? new Uint8Array(bytes) : bytes).buffer as ArrayBuffer,
  });

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'loyl-logo-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('saves a valid PNG and reads it back with its content type', async () => {
    const name = await saveLogo(file('image/png', realBytes(PNG_SIG, 32)), dir);
    expect(name.endsWith('.png')).toBe(true);
    expect(await readdir(dir)).toEqual([name]);

    const read = await readLogo(name, dir);
    expect(read?.contentType).toBe('image/png');
    expect(read?.data.byteLength).toBe(32);
  });

  it('saves jpeg and webp with canonical extensions', async () => {
    const jpg = await saveLogo(file('image/jpeg', realBytes(JPEG_SIG, 32)), dir);
    expect(jpg.endsWith('.jpg')).toBe(true);
    expect((await readLogo(jpg, dir))?.contentType).toBe('image/jpeg');

    const webp = await saveLogo(file('image/webp', realBytes(WEBP_SIG, 32)), dir);
    expect(webp.endsWith('.webp')).toBe(true);
    expect((await readLogo(webp, dir))?.contentType).toBe('image/webp');
  });

  it('rejects unsupported mime types (gif, heic, svg, pdf)', async () => {
    for (const type of ['image/gif', 'image/heic', 'image/heif', 'image/svg+xml', 'application/pdf', 'text/plain']) {
      await expect(saveLogo(file(type, 32), dir)).rejects.toMatchObject({
        name: 'LogoUploadError',
        code: 'INVALID_FILE_TYPE',
      });
    }
    expect(await readdir(dir)).toEqual([]);
  });

  it('rejects a missing mime type', async () => {
    await expect(
      saveLogo({ arrayBuffer: async () => new Uint8Array(32).buffer as ArrayBuffer }, dir)
    ).rejects.toMatchObject({ code: 'INVALID_FILE_TYPE' });
  });

  it('rejects empty files', async () => {
    await expect(saveLogo(file('image/png', 0), dir)).rejects.toMatchObject({
      code: 'EMPTY_FILE',
    });
    expect(await readdir(dir)).toEqual([]);
  });

  it('rejects oversize uploads at the 2MB cap', async () => {
    await expect(
      saveLogo(file('image/png', LOGO_MAX_BYTES + 1), dir)
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    expect(await readdir(dir)).toEqual([]);
  });

  it('SEC-07: rejects polyglots — PDF/script bytes wearing an image type', async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0, 0, 0, 0, 0, 0, 0]); // %PDF-
    await expect(saveLogo(file('image/png', pdf), dir)).rejects.toMatchObject({
      code: 'INVALID_FILE_TYPE',
    });
    // Right magic, wrong label: JPEG bytes claimed as PNG.
    await expect(
      saveLogo(file('image/png', realBytes(JPEG_SIG, 16)), dir)
    ).rejects.toMatchObject({ code: 'INVALID_FILE_TYPE' });
    expect(await readdir(dir)).toEqual([]);
  });

  it('rejects with LogoUploadError instances', async () => {
    await expect(saveLogo(file('application/pdf', 5), dir)).rejects.toBeInstanceOf(
      LogoUploadError
    );
  });

  it('deleteLogo removes the file the moment it is called', async () => {
    const name = await saveLogo(file('image/webp', realBytes(WEBP_SIG, 16)), dir);
    expect(await deleteLogo(name, dir)).toBe(true);
    expect(await readdir(dir)).toEqual([]);
    expect(await readLogo(name, dir)).toBeNull();
  });

  it('deleteLogo/readLogo are safe: traversal names, unknown names, nulls', async () => {
    expect(await deleteLogo('../evil.png', dir)).toBe(false);
    expect(await deleteLogo('nested/evil.png', dir)).toBe(false);
    expect(await deleteLogo(null, dir)).toBe(false);
    expect(await deleteLogo(undefined, dir)).toBe(false);
    expect(await deleteLogo('ghost.png', dir)).toBe(true); // force:true — already gone
    expect(await readLogo('../secret.png', dir)).toBeNull();
    expect(await readLogo('nope.txt', dir)).toBeNull();
    expect(await readLogo(null, dir)).toBeNull();
  });

  it('merchantLogoUrl prefers the stored path, falls back to legacy logoUrl', () => {
    expect(
      merchantLogoUrl({ id: 'm1', logoPath: 'abc.png', logoUrl: 'https://x/y.png' })
    ).toBe('/api/public/logo/m1');
    expect(merchantLogoUrl({ id: 'm1', logoPath: null, logoUrl: 'https://x/y.png' })).toBe(
      'https://x/y.png'
    );
    expect(merchantLogoUrl({ id: 'm1', logoPath: null, logoUrl: null })).toBeNull();
    expect(merchantLogoPath('m1')).toBe('/api/public/logo/m1');
  });
});
