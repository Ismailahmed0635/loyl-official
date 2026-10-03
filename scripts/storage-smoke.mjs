#!/usr/bin/env node
/**
 * storage-smoke.mjs — exercises all three StorageDriver verbs against the
 * REAL driver (backend/storage.ts, loaded via Node's native type stripping),
 * not a copy of the logic.
 *
 * Two backends:
 *   1. local    — always run (temp dir): put/get/remove round trip, missing
 *                 key -> null, traversal refusal.
 *   2. supabase — run ONLY when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are
 *                 exported: put -> get -> remove against the live project, so
 *                 the REST contract in backend/storage.ts is verified against
 *                 Supabase itself rather than the fetch mocks in the unit
 *                 tests. Without credentials it prints SKIP — that is the
 *                 honest state on a dev machine, not a failure.
 *
 * Usage:  node scripts/storage-smoke.mjs
 *         SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/storage-smoke.mjs
 */

import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const storage = await import('../backend/storage.ts');
const {
  BUCKET_MENU_PHOTOS,
  BUCKET_PAYMENT_SCREENSHOTS,
  StorageError,
  localStorage,
  resolveDriver,
  supabaseStorage,
  supabaseStorageConfig,
} = storage;

let passed = 0;
let failed = 0;
const failures = [];

function check(label, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function skip(label, why) {
  console.log(`  SKIP  ${label} — ${why}`);
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

// --- 1. local driver round trip -------------------------------------------
console.log('Local filesystem driver:');
{
  const dir = await mkdtemp(path.join(tmpdir(), 'loyl-smoke-'));
  const key = `${randomUUID()}.png`;
  try {
    const store = localStorage(dir);
    await store.put(key, PNG, 'image/png');
    const back = await store.get(key);
    check('put -> get round trips the exact bytes', !!back && Buffer.compare(back, PNG) === 0);
    check('remove returns true for an existing key', (await store.remove(key)) === true);
    check('get after remove returns null', (await store.get(key)) === null);
    check('remove of a missing key is a no-op true', (await store.remove(key)) === true);
    check('get of a missing key returns null', (await store.get('never.png')) === null);

    let threw = null;
    try {
      await store.put('../escape.png', PNG, 'image/png');
    } catch (err) {
      threw = err;
    }
    check(
      'traversal key refused with StorageError/INVALID_STORAGE_KEY',
      threw instanceof StorageError && threw.code === 'INVALID_STORAGE_KEY',
      threw ? `${threw.name}/${threw.code}` : 'did not throw'
    );
    check('traversal get returns null', (await store.get('../../etc/passwd')) === null);
    check('traversal remove returns false', (await store.remove('nested/evil.png')) === false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// --- 2. resolveDriver selection -------------------------------------------
console.log('Driver selection:');
{
  const saved = Object.fromEntries(
    ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'STORAGE_BACKEND'].map((k) => [k, process.env[k]])
  );
  const set = (url, key, mode) => {
    for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'STORAGE_BACKEND']) delete process.env[k];
    if (url) process.env.SUPABASE_URL = url;
    if (key) process.env.SUPABASE_SERVICE_ROLE_KEY = key;
    if (mode) process.env.STORAGE_BACKEND = mode;
  };
  try {
    set(null, null, null);
    check('no config -> local', resolveDriver(BUCKET_MENU_PHOTOS, '/fallback').kind === 'local');
    set('https://x.supabase.co/', 'service-role', null);
    check('configured -> supabase', resolveDriver(BUCKET_MENU_PHOTOS, '/fallback').kind === 'supabase');
    check(
      'bucket is passed through',
      resolveDriver(BUCKET_PAYMENT_SCREENSHOTS, '/fallback').bucket === BUCKET_PAYMENT_SCREENSHOTS
    );
    set('https://x.supabase.co', 'service-role', 'local');
    check('STORAGE_BACKEND=local overrides', resolveDriver(BUCKET_MENU_PHOTOS, '/fallback').kind === 'local');
    let threw = null;
    set(null, null, 'supabase');
    try {
      resolveDriver(BUCKET_MENU_PHOTOS, '/fallback');
    } catch (err) {
      threw = err;
    }
    check(
      'STORAGE_BACKEND=supabase without creds fails loudly',
      threw instanceof StorageError && threw.code === 'STORAGE_NOT_CONFIGURED',
      threw ? `${threw.name}/${threw.code}` : 'did not throw'
    );
    // Explicit dir always wins (unit tests pin local this way).
    set('https://x.supabase.co', 'service-role', null);
    check(
      'explicit dir argument pins local even with supabase configured',
      resolveDriver(BUCKET_MENU_PHOTOS, '/fallback', '/tmp/pinned').kind === 'local'
    );
  } finally {
    for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'STORAGE_BACKEND']) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

// --- 3. live Supabase round trip (only with real credentials) --------------
const config = supabaseStorageConfig();
if (!config) {
  skip('Supabase live round trip', 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
} else {
  console.log(`Supabase live round trip (${config.url}):`);
  const driver = supabaseStorage({ ...config, bucket: BUCKET_MENU_PHOTOS });
  const key = `smoke-${randomUUID()}.png`;
  try {
    await driver.put(key, PNG, 'image/png');
    const back = await driver.get(key);
    check('put -> get round trips the exact bytes', !!back && Buffer.compare(back, PNG) === 0);
    check('get of a missing object is null', (await driver.get(`missing-${key}`)) === null);

    // Privacy proof: the bucket must not serve objects anonymously. This is the
    // property the design depends on (payment screenshots carry a trx id and
    // sender number), so the smoke asserts it against the live project.
    const anon = await fetch(`${config.url}/storage/v1/object/${BUCKET_MENU_PHOTOS}/${key}`, {
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    check(
      'anonymous read is refused (bucket is private)',
      // Refusal does not arrive as 401/403: live Supabase answers an anonymous
      // request to a private bucket with 400 "Bucket not found" (anti-
      // enumeration — it will not confirm the bucket exists). The property that
      // matters is that the bytes are never handed out, so assert on that.
      anon !== null && anon.status !== 200 && anon.status !== 206,
      anon ? `status ${anon.status}` : 'request failed'
    );

    check('remove returns true', (await driver.remove(key)) === true);
    // The batch DELETE answers 200 once accepted, but the object can keep
    // serving for a beat before it disappears — poll instead of racing it.
    let leftover = await driver.get(key);
    for (let i = 0; i < 10 && leftover !== null; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      leftover = await driver.get(key);
    }
    check('get after remove is null', leftover === null, leftover ? 'object still served' : '');
    check('remove of a missing object is a no-op true', (await driver.remove(key)) === true);
  } catch (err) {
    check('supabase verbs did not throw', false, `${err.name}/${err.code ?? ''}: ${err.message}`);
  } finally {
    // Never leave a smoke object behind, even when an assertion threw.
    await driver.remove(key).catch(() => false);
  }
}

console.log(`\nStorage smoke: ${passed} passed, ${failed} failed${failures.length ? ` (${failures.length} failing)` : ''}`);
if (failed > 0) {
  process.exitCode = 1;
}
