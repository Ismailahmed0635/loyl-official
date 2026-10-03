/**
 * backend/storage.ts — object-storage seam for uploaded binaries.
 *
 * `saveScreenshot` / `saveMenuPhoto` and their read/delete twins used to write
 * straight to `process.cwd()/storage/…`. That is fine on a VM with a disk and
 * wrong on Vercel: serverless gives a read-only filesystem outside `/tmp`
 * (so `mkdir` throws EROFS) and no persistence between invocations, which is
 * exactly why both upload routes would have 500'd in production.
 *
 * One contract, two ways to satisfy it:
 *
 *   1. **Local filesystem** — what an explicit `dir` argument always selects,
 *      what dev and the unit tests use, and the fallback when no backend is
 *      configured. Preserves the historical `storage/<kind>/` layout.
 *   2. **Supabase Storage** — private buckets over plain REST `fetch`, so no
 *      SDK and no new dependency (same zero-dep rule as the vision request and
 *      the Ed25519 helpers). Selected when SUPABASE_URL and
 *      SUPABASE_SERVICE_ROLE_KEY are both set, i.e. in production.
 *
 * Selection happens per call in `resolveDriver`, so a test pins the local
 * backend by passing `dir` and the production backend is chosen purely from
 * the environment. `STORAGE_BACKEND=local|supabase` overrides the inference
 * when you need to be explicit (or to keep the phase7 smoke on local disk).
 *
 * Buckets stay **private**: objects are only ever read back here and streamed
 * by the admin/merchant routes that already enforce auth, so no object URL is
 * handed to a browser and payment screenshots (trx id + sender number) are
 * never publicly linkable.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Bucket (Supabase) / directory name (local) per artifact kind. */
export const BUCKET_PAYMENT_SCREENSHOTS = 'payment-screenshots';
export const BUCKET_MENU_PHOTOS = 'menu-photos';

/** Every storage request is bounded so a hung Supabase call cannot eat a
 * serverless function's whole budget (vision already caps itself at 45s). */
export const STORAGE_TIMEOUT_MS = 15_000;

export interface StorageDriver {
  /** Which backend this driver talks to — logged by callers on failure. */
  readonly kind: 'local' | 'supabase';
  /** Bucket (Supabase) / directory name (local) this driver owns. */
  readonly bucket: string;
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<boolean>;
}

/** Backend failure with a stable SCREAMING_SNAKE code (SEC/CODIN §3: codes are
 * additive — this introduces STORAGE_* rather than reusing an existing one). */
export class StorageError extends Error {
  /** Stable SCREAMING_SNAKE code (never repurposed; additive only). */
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
  }
}

/** Supabase config when both values are present; null means "stay local". */
export function supabaseStorageConfig(): { url: string; serviceRoleKey: string } | null {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, '');
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return url && serviceRoleKey ? { url, serviceRoleKey } : null;
}

function timeoutSignal(): AbortSignal | undefined {
  return typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(STORAGE_TIMEOUT_MS) : undefined;
}

/** Copy the bytes into a standalone ArrayBuffer: Node's fetch wants a
 * `BodyInit`, and a pooled Buffer's spare capacity must never ride along. */
function bodyBytes(data: Buffer): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

/** Supabase returns `{ message, statusCode }` or `{ error, statusCode }`;
 * fall back to the status line so a proxy/HTML error still reads usefully. */
async function describeFailure(res: Response): Promise<string> {
  return (await readFailure(res)).detail;
}

/**
 * One body read that both explains a failure and says whether it means
 * "the object is gone" rather than "the request broke".
 *
 * Live Supabase Storage (verified 2026-10-03) answers a **missing key with
 * `400 { message: "Object not found" }`**, not 404 — so keying only on 404
 * turned every missing screenshot/photo into a `STORAGE_GET_FAILED` throw
 * (a 500 on the admin view route). 404 is kept because older Storage API
 * versions and the plain object path still use it; anything else (401, 403,
 * 500, `Bucket not found`) stays a real failure so auth/config problems are
 * never masked as an empty result.
 */
async function readFailure(res: Response): Promise<{ detail: string; missing: boolean }> {
  const text = await res.text().catch(() => '');
  let detail = `${res.status} ${res.statusText}`.trim();
  try {
    const parsed = JSON.parse(text) as { message?: string; error?: string };
    const message = parsed.message || parsed.error;
    if (message) detail = `${res.status}: ${message}`;
  } catch {
    /* not JSON — keep the status line */
  }
  const missing = res.status === 404 || (res.status === 400 && /object not found/i.test(detail));
  return { detail, missing };
}

// --- Local filesystem driver ------------------------------------------------

/**
 * Bare-filename-only filesystem driver (path-traversal safe by construction:
 * a key that is not its own basename is refused rather than joined).
 */
export function localStorage(dir: string): StorageDriver {
  const resolve = (key: string): string | null => {
    const safe = path.basename(key);
    return safe === key ? path.join(dir, safe) : null;
  };

  return {
    kind: 'local',
    bucket: path.basename(dir),
    async put(key, data) {
      const file = resolve(key);
      if (!file) throw new StorageError(`Refusing to write a non-bare storage key: ${key}`, 'INVALID_STORAGE_KEY');
      await mkdir(dir, { recursive: true });
      await writeFile(file, data);
    },
    async get(key) {
      const file = resolve(key);
      if (!file) return null;
      try {
        return await readFile(file);
      } catch {
        return null;
      }
    },
    async remove(key) {
      const file = resolve(key);
      if (!file) return false;
      try {
        await rm(file, { force: true });
        return true;
      } catch (err) {
        console.warn('Storage cleanup failed', err);
        return false;
      }
    },
  };
}

// --- Supabase Storage driver ------------------------------------------------

/**
 * Supabase Storage over REST (`service_role` key, private buckets).
 *
 * Endpoints follow the documented Storage API. `get` tries the authenticated
 * object path first and falls back to the plain object path, because a "not
 * found" there is ambiguous (unknown route vs missing object) and the fallback
 * costs one request only in that case — if the object genuinely does not
 * exist both paths report missing (`404`, or live Supabase's
 * `400 Object not found`) and we return null, which is the contract. Reads are
 * cache-busted (see `get`) so a Cloudflare HIT can never serve a stale or
 * already-deleted object. `scripts/storage-smoke.mjs` exercises all three
 * verbs against a real project to keep this honest.
 */
export function supabaseStorage(config: {
  url: string;
  serviceRoleKey: string;
  bucket: string;
}): StorageDriver {
  const { url, serviceRoleKey, bucket } = config;
  const objectPath = (key: string): string =>
    `${url}/storage/v1/object/${bucket}/${encodeURIComponent(key)}`;
  const authenticatedPath = (key: string): string =>
    `${url}/storage/v1/object/authenticated/${bucket}/${encodeURIComponent(key)}`;
  const auth = { Authorization: `Bearer ${serviceRoleKey}` };

  return {
    kind: 'supabase',
    bucket,
    async put(key, data, contentType) {
      const res = await fetch(objectPath(key), {
        method: 'POST',
        headers: {
          ...auth,
          'Content-Type': contentType,
          'x-upsert': 'true',
        },
        body: bodyBytes(data),
        signal: timeoutSignal(),
      });
      if (!res.ok) throw new StorageError(await describeFailure(res), 'STORAGE_PUT_FAILED');
    },

    async get(key) {
      // Cloudflare caches these GETs by URL (observed `cf-cache-status: HIT`
      // even though Supabase answers `cache-control: no-cache`): after an
      // overwrite the cached URL still served the *previous* bytes, and after
      // a delete it kept serving the removed object. A per-request param forces
      // a fresh read. The cache is keyed on the Authorization header — an
      // anonymous request to the same URL is BYPASSed and refused 400 — so this
      // is a correctness fix, not a disclosure one.
      const bust = `?cb=${Date.now()}`;
      const first = await fetch(authenticatedPath(key) + bust, { headers: auth, signal: timeoutSignal() });
      if (first.ok) return Buffer.from(await first.arrayBuffer());
      const firstResult = await readFailure(first);
      if (!firstResult.missing) throw new StorageError(firstResult.detail, 'STORAGE_GET_FAILED');

      const fallback = await fetch(objectPath(key) + bust, { headers: auth, signal: timeoutSignal() });
      if (fallback.ok) return Buffer.from(await fallback.arrayBuffer());
      const fallbackResult = await readFailure(fallback);
      if (fallbackResult.missing) return null;
      throw new StorageError(fallbackResult.detail, 'STORAGE_GET_FAILED');
    },

    async remove(key) {
      // Batch shape (`{ prefixes: [...] }`) is how the storage client deletes
      // objects; a missing key is a successful no-op, matching local `rm(force)`.
      const res = await fetch(`${url}/storage/v1/object/${bucket}`, {
        method: 'DELETE',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: [key] }),
        signal: timeoutSignal(),
      });
      if (res.ok) return true;
      console.warn('Storage cleanup failed', await describeFailure(res));
      return false;
    },
  };
}

// --- Backend selection ------------------------------------------------------

/**
 * Resolve the driver for a bucket.
 *
 * `dir` (an explicit argument from a unit test) always wins and stays local.
 * Otherwise `STORAGE_BACKEND` decides, defaulting to Supabase when it is
 * configured and to the local directory when it is not. Asking for
 * `STORAGE_BACKEND=supabase` without credentials fails loudly rather than
 * silently falling back — the same fail-fast posture as JWT_SECRET.
 */
export function resolveDriver(bucket: string, defaultDir: string, dir?: string): StorageDriver {
  if (dir !== undefined) return localStorage(dir);

  const mode = process.env.STORAGE_BACKEND;
  const config = supabaseStorageConfig();

  if (mode === 'supabase' && !config) {
    throw new StorageError(
      'STORAGE_BACKEND=supabase but SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not both set.',
      'STORAGE_NOT_CONFIGURED'
    );
  }
  if (config && mode !== 'local') return supabaseStorage({ ...config, bucket });
  return localStorage(defaultDir);
}
