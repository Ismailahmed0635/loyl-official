/**
 * Shared dev-only session helper for the smoke scripts.
 *
 * Auth is email/password (merchant) and name+phone (customer) — there is no
 * OTP step anywhere. The Firebase signature check itself is unit-tested
 * (backend/api/auth.test.ts: 422/503/401) and exercised live by real users;
 * smokes cannot mint Firebase ID tokens, so they mint `loyl_session` JWTs
 * directly with the dev JWT_SECRET instead. This covers every downstream
 * contract (guards, setup, approval, devices) exactly as a real session
 * would — the signature is verified by the same `verifySessionToken`.
 *
 * DEV ONLY: reads frontend/.env.local, with the shell's own environment
 * winning over it (Next gives already-set env vars the same precedence, so
 * the secret we sign with is always the one the server verifies — CI has no
 * .env.local at all, it exports JWT_SECRET directly). Never import into app
 * code, never run against a reachable host.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function devEnv() {
  const out = {};
  let raw = null;
  try {
    raw = readFileSync(join(ROOT, 'frontend', '.env.local'), 'utf8');
  } catch (err) {
    // CI has no .env.local (gitignored) — process.env below is the whole env.
    if (err?.code !== 'ENOENT') throw err;
  }
  for (const line of raw ? raw.split('\n') : []) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

let SECRET = null;
export function jwtSecret() {
  if (!SECRET) {
    SECRET = devEnv().JWT_SECRET;
    if (!SECRET) {
      throw new Error(
        'test-session: JWT_SECRET missing — set it in frontend/.env.local or export it (CI does)'
      );
    }
  }
  return new TextEncoder().encode(SECRET);
}

/** Mint a `loyl_session` JWT with the same shape `createSessionToken` makes. */
export async function mintSession(payload, expiresIn = '30d') {
  return new SignJWT({ jti: randomUUID(), ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(jwtSecret());
}

function sessionCookie(token) {
  return `loyl_session=${token}`;
}

/**
 * Merchant signup: mint a pre-setup email session, run business-setup
 * (creates/updates the merchant keyed by email), return the upgraded cookie.
 *
 * The caller email is made unique per call (random suffix on the local part):
 * two merchants that share a business name must still be two merchant rows —
 * the upsert key must never merge them.
 */
export async function signUpMerchant(call, { email, phone, businessName, category }) {
  const at = email.lastIndexOf('@');
  const uniqueEmail = `${email.slice(0, at)}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}${email.slice(at)}`;
  const temp = await mintSession({ userId: `temp_${randomUUID()}`, phoneNumber: '', email: uniqueEmail });
  const setup = await call('/api/auth/business-setup', {
    method: 'POST',
    cookie: sessionCookie(temp),
    body: { businessName, category, phoneNumber: phone },
  });
  if (setup.status !== 200 || !setup.json?.success) {
    throw new Error(`signUpMerchant failed: ${setup.status} ${JSON.stringify(setup.json)}`);
  }
  const setCookie = setup.setCookie || [];
  const upgraded = setCookie
    .map((c) => c.split(';')[0])
    .find((c) => c.startsWith('loyl_session='));
  if (!upgraded) throw new Error('signUpMerchant: no upgraded session cookie');
  return { cookie: upgraded, tempCookie: sessionCookie(temp), merchant: setup.json.data.merchant };
}

/** Customer check-in identity: real endpoint, no minting needed. */
export async function signInCustomer(call, { name, phone }) {
  const res = await call('/api/customer/session', {
    method: 'POST',
    body: { name, phoneNumber: phone },
  });
  if (res.status !== 200 || !res.json?.success) {
    throw new Error(`signInCustomer failed: ${res.status} ${JSON.stringify(res.json)}`);
  }
  const setCookie = res.setCookie || [];
  const cookie = setCookie
    .map((c) => c.split(';')[0])
    .find((c) => c.startsWith('loyl_session='));
  if (!cookie) throw new Error('signInCustomer: no session cookie');
  return { cookie, ...res.json.data };
}
