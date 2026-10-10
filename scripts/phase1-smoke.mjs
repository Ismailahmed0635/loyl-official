/**
 * Phase 1 — Auth Flow smoke test (email/password + collected phones, no OTP).
 *
 * Flow: POST /api/auth/session shapes -> customer session shapes ->
 * business-setup (email-keyed) -> session persists -> logout.
 * The Firebase signature check itself is unit-tested
 * (backend/api/auth.test.ts); smokes mint dev JWTs via test-session.mjs
 * because they cannot mint Firebase ID tokens.
 *
 * Usage: node scripts/phase1-smoke.mjs [baseUrl]
 */
import { mintSession, signUpMerchant } from './test-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3111';
const RUN = Date.now().toString(36);
const EMAIL = `smoke1-${RUN}@example.com`;
const EMAIL2 = `smoke1b-${RUN}@example.com`;
const PHONE = '017' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const PHONE_STRIP = '017' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');

let passed = 0;
let failed = 0;
const results = [];

function check(name, cond, detail = '') {
  if (cond) {
    passed++;
    results.push(`  PASS  ${name}`);
  } else {
    failed++;
    results.push(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function parseCookies(setCookieHeaders) {
  const jar = {};
  for (const raw of setCookieHeaders) {
    const [pair] = raw.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) jar[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return jar;
}

async function call(path, { method = 'POST', body, cookie, rawBody } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return { status: res.status, json, setCookie };
}

async function main() {
  console.log(`Phase 1 smoke test against ${BASE}\n`);

  const home = await fetch(BASE + '/').catch(() => null);
  check('Dev server responds on /', !!home && home.status < 500, home ? `status ${home.status}` : 'no response');

  // --- POST /api/auth/session (email transport) --------------------------
  const malformed = await call('/api/auth/session', { rawBody: 'not-json{{{' });
  check('Malformed JSON -> 422 VALIDATION_ERROR', malformed.status === 422 && malformed.json?.error?.code === 'VALIDATION_ERROR', `status ${malformed.status}`);

  for (const [label, body] of [['empty body', {}], ['short token', { idToken: 'short' }], ['extra field', { idToken: 'x'.repeat(64), email: 'a@b.c' }]]) {
    const r = await call('/api/auth/session', { body });
    check(`Session with ${label} -> 422`, r.status === 422, `status ${r.status}`);
  }

  const forged = await call('/api/auth/session', { body: { idToken: 'x'.repeat(500) } });
  check('Forged token -> 401 INVALID_FIREBASE_TOKEN, no cookie', forged.status === 401 && forged.json?.error?.code === 'INVALID_FIREBASE_TOKEN' && forged.setCookie.length === 0, `status ${forged.status}`);

  // --- POST /api/customer/session (collect, no code) ----------------------
  const badCust = await call('/api/customer/session', { body: { phoneNumber: PHONE } });
  check('Customer session without name -> 422', badCust.status === 422, `status ${badCust.status}`);

  const badPhone = await call('/api/customer/session', { body: { name: 'Smoke Customer', phoneNumber: '12345' } });
  check('Customer session with bad phone -> 422', badPhone.status === 422, `status ${badPhone.status}`);

  const cust = await call('/api/customer/session', { body: { name: 'Smoke Customer', phoneNumber: PHONE } });
  check('Customer session mints 200 + cookie', cust.status === 200 && cust.json?.success === true, `status ${cust.status}`);
  const custJar = parseCookies(cust.setCookie);
  check('Customer session cookie is a signed JWT', !!custJar.loyl_session && custJar.loyl_session.split('.').length === 3);

  // --- business-setup without session --------------------------------------
  const noAuthSetup = await call('/api/auth/business-setup', { body: { businessName: 'Crimson Cup', category: 'Café & Bakery', phoneNumber: PHONE } });
  check('business-setup without session -> 401', noAuthSetup.status === 401, `status ${noAuthSetup.status}`);

  // --- business-setup with a legacy (email-less) session -------------------
  const legacy = await mintSession({ userId: `temp_${RUN}`, phoneNumber: PHONE });
  const legacySetup = await call('/api/auth/business-setup', { method: 'POST', cookie: `loyl_session=${legacy}`, body: { businessName: 'Hijack Shop', category: 'Retail & Clothing', phoneNumber: PHONE } });
  check('business-setup with email-less session -> 403 EMAIL_REQUIRED', legacySetup.status === 403 && legacySetup.json?.error?.code === 'EMAIL_REQUIRED', `status ${legacySetup.status}`);

  // --- business-setup validation (email session, no profile yet) ------------
  const pre = await mintSession({ userId: `temp_${RUN}`, phoneNumber: '', email: EMAIL });
  const preCookie = `loyl_session=${pre}`;
  const badSetup = await call('/api/auth/business-setup', { method: 'POST', cookie: preCookie, body: { businessName: 'A', category: '', phoneNumber: 'nope' } });
  check('business-setup with invalid payload -> 422', badSetup.status === 422, `status ${badSetup.status}`);

  const badLogo = await call('/api/auth/business-setup', { method: 'POST', cookie: preCookie, body: { businessName: 'Crimson Cup', category: 'Café & Bakery', phoneNumber: PHONE_STRIP, logoUrl: 'not-a-url' } });
  check('business-setup strips logoUrl (file upload lives in Settings) -> 200, logoUrl null', badLogo.status === 200 && badLogo.json?.data?.merchant?.logoUrl === null, `status ${badLogo.status}`);

  // --- happy path (email-keyed, phone collected) ------------------------------
  const { cookie, merchant } = await signUpMerchant(
    (p, o) => call(p, o),
    { email: EMAIL, phone: PHONE, businessName: 'Crimson Cup Banani', category: 'Café & Bakery' }
  );
  check('Valid business profile saved (200)', !!merchant && merchant.subscriptionStatus === 'PENDING', JSON.stringify(merchant || {}));
  check('Saved merchant carries the verified email', !!merchant?.email && merchant.email.startsWith(EMAIL.split('@')[0]), `got ${merchant?.email}`);
  check('Saved merchant carries the collected phone', merchant?.phoneNumber === PHONE, `got ${merchant?.phoneNumber}`);
  const upgradedJar = parseCookies([cookie]);
  check('Session upgraded with merchant userId cookie', !!upgradedJar.loyl_session);

  const me = await call('/api/auth/me', { method: 'GET', cookie });
  check('Session persists after profile setup -> 200', me.status === 200 && me.json?.data?.authenticated === true, `status ${me.status}`);

  // --- collected phones can collide: second business, same number -> 409 ------
  let dupErr = '';
  try {
    await signUpMerchant(
      (p, o) => call(p, o),
      { email: EMAIL2, phone: PHONE, businessName: 'Second Shop', category: 'Retail & Clothing' }
    );
  } catch (e) {
    dupErr = String(e);
  }
  check('Duplicate collected phone -> 409 PHONE_TAKEN', /409/.test(dupErr) && /PHONE_TAKEN/.test(dupErr), dupErr.slice(0, 160));

  // --- logout ------------------------------------------------------------------
  const out = await call('/api/auth/logout', { method: 'POST', cookie });
  check('Logout returns 200', out.status === 200);
  check('Logout clears cookie (Max-Age=0)', out.setCookie.some((c) => /loyl_session=;/.test(c) && /Max-Age=0/i.test(c)), out.setCookie.join(' | '));

  // --- UI pages ------------------------------------------------------------------
  for (const route of ['/welcome', '/business-setup']) {
    const r = await fetch(BASE + route, { redirect: 'manual' }).catch(() => null);
    const html = r ? await r.text().catch(() => '') : '';
    check(`Page ${route} renders (200, no build error)`, !!r && r.status === 200 && !/Unhandled Runtime Error|__next_error__/.test(html), r ? `status ${r.status}` : 'no response');
  }
  const otp = await fetch(BASE + '/otp', { redirect: 'manual' }).catch(() => null);
  check('Page /otp is gone (307 to /welcome)', !!otp && otp.status === 307 && (otp.headers.get('location') || '').includes('/welcome'), otp ? `status ${otp.status}` : 'no response');

  console.log('\n' + results.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
