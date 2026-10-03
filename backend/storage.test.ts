import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  BUCKET_MENU_PHOTOS,
  BUCKET_PAYMENT_SCREENSHOTS,
  STORAGE_TIMEOUT_MS,
  StorageError,
  localStorage,
  resolveDriver,
  supabaseStorage,
  supabaseStorageConfig,
} from './storage';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** Snapshot/restore the env keys driver selection reads. */
const ENV_KEYS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'STORAGE_BACKEND'] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
});

describe('local filesystem driver', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'loyl-store-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips put/get/remove and creates the directory on demand', async () => {
    const store = localStorage(path.join(dir, 'nested', 'deep'));
    await store.put('a.png', PNG, 'image/png');
    expect(await store.get('a.png')).toEqual(PNG);
    expect(await store.remove('a.png')).toBe(true);
    expect(await store.get('a.png')).toBeNull();
  });

  it('returns null for a missing key instead of throwing', async () => {
    expect(await localStorage(dir).get('never-existed.png')).toBeNull();
  });

  it('refuses traversal keys on every verb', async () => {
    const store = localStorage(dir);
    await expect(store.put('../escape.png', PNG, 'image/png')).rejects.toMatchObject({
      name: 'StorageError',
      code: 'INVALID_STORAGE_KEY',
    });
    expect(await store.get('../../etc/passwd')).toBeNull();
    expect(await store.remove('nested/evil.png')).toBe(false);
  });

  it('reports cleanup failures as false rather than throwing', async () => {
    // A directory where the object should be: rm refuses without recursive.
    await (await import('node:fs/promises')).mkdir(path.join(dir, 'a.png'));
    expect(await localStorage(dir).remove('a.png')).toBe(false);
  });
});

describe('supabaseStorageConfig', () => {
  it('is null until both values are present', () => {
    expect(supabaseStorageConfig()).toBeNull();
    process.env.SUPABASE_URL = 'https://x.supabase.co';
    expect(supabaseStorageConfig()).toBeNull();
    process.env.SUPABASE_URL = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '   ';
    expect(supabaseStorageConfig()).toBeNull();
  });

  it('strips a trailing slash so paths never double up', () => {
    process.env.SUPABASE_URL = 'https://x.supabase.co/';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
    expect(supabaseStorageConfig()).toEqual({
      url: 'https://x.supabase.co',
      serviceRoleKey: 'service-role',
    });
  });
});

describe('resolveDriver', () => {
  const supabaseEnv = () => {
    process.env.SUPABASE_URL = 'https://x.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  };

  it('lets an explicit dir (unit tests) win over a configured Supabase', () => {
    supabaseEnv();
    // If this ever routed to Supabase the existing 341 tests would hit the network.
    expect(resolveDriver(BUCKET_PAYMENT_SCREENSHOTS, '/fallback', '/tmp/pinned')).toHaveProperty(
      'kind',
      'local'
    );
  });

  it('uses Supabase when configured, else the local dir', () => {
    expect(resolveDriver(BUCKET_PAYMENT_SCREENSHOTS, '/fallback')).toHaveProperty('kind', 'local');
    supabaseEnv();
    expect(resolveDriver(BUCKET_PAYMENT_SCREENSHOTS, '/fallback')).toHaveProperty('kind', 'supabase');
  });

  it('honours STORAGE_BACKEND=local even with Supabase configured', () => {
    supabaseEnv();
    process.env.STORAGE_BACKEND = 'local';
    expect(resolveDriver(BUCKET_MENU_PHOTOS, '/fallback')).toHaveProperty('kind', 'local');
  });

  it('fails loudly when asked for supabase without credentials', () => {
    process.env.STORAGE_BACKEND = 'supabase';
    expect(() => resolveDriver(BUCKET_PAYMENT_SCREENSHOTS, '/fallback')).toThrowError(StorageError);
    try {
      resolveDriver(BUCKET_PAYMENT_SCREENSHOTS, '/fallback');
    } catch (err) {
      expect((err as StorageError).code).toBe('STORAGE_NOT_CONFIGURED');
    }
  });

  it('routes to the bucket it was asked for', () => {
    supabaseEnv();
    expect(resolveDriver(BUCKET_MENU_PHOTOS, '/fallback')).toHaveProperty('bucket', BUCKET_MENU_PHOTOS);
    expect(resolveDriver(BUCKET_PAYMENT_SCREENSHOTS, '/fallback')).toHaveProperty(
      'bucket',
      BUCKET_PAYMENT_SCREENSHOTS
    );
  });
});

describe('supabaseStorage REST verbs', () => {
  const config = { url: 'https://x.supabase.co', serviceRoleKey: 'service-role', bucket: 'menu-photos' };
  const auth = { Authorization: 'Bearer service-role' };
  let fetchMock: ReturnType<typeof vi.fn>;

  const jsonResponse = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('PUTs to the object path with auth, content-type and upsert headers', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { Key: 'a.png' }));
    await supabaseStorage(config).put('a.png', PNG, 'image/png');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://x.supabase.co/storage/v1/object/menu-photos/a.png');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ ...auth, 'Content-Type': 'image/png', 'x-upsert': 'true' });
    expect(Buffer.from(init.body)).toEqual(PNG);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('bounds every request with STORAGE_TIMEOUT_MS', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    await supabaseStorage(config).put('a.png', PNG, 'image/png');
    expect(timeoutSpy).toHaveBeenCalledWith(STORAGE_TIMEOUT_MS);
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    timeoutSpy.mockRestore();
  });

  it('surfaces an upload failure as StorageError/STORAGE_PUT_FAILED', async () => {
    fetchMock.mockResolvedValue(jsonResponse(413, { message: 'Payload too large' }));
    await expect(supabaseStorage(config).put('a.png', PNG, 'image/png')).rejects.toMatchObject({
      name: 'StorageError',
      code: 'STORAGE_PUT_FAILED',
      message: expect.stringContaining('413: Payload too large'),
    });
  });

  it('GETs the authenticated path first', async () => {
    fetchMock.mockResolvedValue(new Response(PNG, { status: 200 }));
    expect(await supabaseStorage(config).get('a.png')).toEqual(PNG);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(
      /^https:\/\/x\.supabase\.co\/storage\/v1\/object\/authenticated\/menu-photos\/a\.png\?cb=\d+$/
    );
    expect(fetchMock.mock.calls[0][1].headers).toEqual(auth);
  });

  it('falls back to the plain object path when authenticated 404s', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(404, { message: 'not found' }))
      .mockResolvedValueOnce(new Response(PNG, { status: 200 }));
    expect(await supabaseStorage(config).get('a.png')).toEqual(PNG);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toMatch(
      /^https:\/\/x\.supabase\.co\/storage\/v1\/object\/menu-photos\/a\.png\?cb=\d+$/
    );
  });

  it('returns null when both paths 404 (object genuinely missing)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { message: 'not found' }));
    expect(await supabaseStorage(config).get('gone.png')).toBeNull();
  });

  it('returns null when both paths answer 400 Object not found (live Supabase shape)', async () => {
    // Live Storage returns 400 + "Object not found" for a missing key, not
    // 404 — keying only on 404 made every absent file throw STORAGE_GET_FAILED.
    // A fresh Response per call, because each fetch consumes its own body.
    fetchMock.mockImplementation(async () => jsonResponse(400, { message: 'Object not found' }));
    expect(await supabaseStorage(config).get('gone.png')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not mistake a 400 config error for a missing object', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { message: 'Bucket not found' }));
    await expect(supabaseStorage(config).get('a.png')).rejects.toMatchObject({
      code: 'STORAGE_GET_FAILED',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not fall back on a non-404 failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { message: 'boom' }));
    await expect(supabaseStorage(config).get('a.png')).rejects.toMatchObject({
      code: 'STORAGE_GET_FAILED',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('DELETEs via the batch prefixes shape and treats 404 as a no-op success', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { message: 'ok' }));
    expect(await supabaseStorage(config).remove('a.png')).toBe(true);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://x.supabase.co/storage/v1/object/menu-photos');
    expect(init.method).toBe('DELETE');
    expect(init.headers).toMatchObject({ ...auth, 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ prefixes: ['a.png'] });
  });

  it('reports a cleanup failure as false instead of throwing', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { message: 'boom' }));
    expect(await supabaseStorage(config).remove('a.png')).toBe(false);
  });

  it('percent-encodes keys so a crafted name cannot escape the bucket', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { message: 'not found' }));
    await supabaseStorage(config).get('..%2F..%2Fsecret.png');
    expect(String(fetchMock.mock.calls[0][0])).toMatch(
      /^https:\/\/x\.supabase\.co\/storage\/v1\/object\/authenticated\/menu-photos\/\.\.%252F\.\.%252Fsecret\.png\?cb=\d+$/
    );
  });
});
