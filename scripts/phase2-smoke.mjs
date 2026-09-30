/**
 * Phase 2 — Merchant Core smoke test
 * Spec: phases.md Phase 2 deliverable ("merchant can create offer, generate QR,
 * manage branches") + TEST.md (validation, access control, QR routing)
 *
 * Flow: auth (Phase 1 fast path) -> offer CRUD -> QR generation -> stats
 *       -> branch CRUD -> cross-merchant isolation -> page renders
 *
 * Usage: node scripts/phase2-smoke.mjs [baseUrl]
 */

import { signUpMerchant } from './test-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3111';
const RUN = Date.now().toString(36);
const PHONE_1 = '017' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const PHONE_2 = '018' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const BIZ_NAME = 'Crimson Cup Banani';

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

async function call(path, { method = 'POST', body, cookie } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return { status: res.status, json, setCookie, headers: res.headers };
}

function extractSessionCookie(setCookie) {
  for (const raw of setCookie) {
    if (raw.startsWith('loyl_session=')) {
      const value = raw.split(';')[0].slice('loyl_session='.length);
      if (value) return `loyl_session=${value}`;
    }
  }
  return '';
}

/** Signs a fresh merchant up (email session + business-setup); returns the session cookie. */
async function signUp(label, phone) {
  const email = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${RUN}@example.com`;
  const { cookie, tempCookie, merchant } = await signUpMerchant((p, o) => call(p, o), {
    email,
    phone,
    businessName: label,
    category: 'Café & Bakery',
  });
  check(`[${label}] business setup saved (200, ${merchant?.id || 'no-id'})`, !!merchant?.id);
  check(`[${label}] session cookie issued`, !!cookie);
  return { cookie, otpCookie: tempCookie };
}

async function pageRenders(route, cookie) {
  const r = await fetch(BASE + route, {
    redirect: 'manual',
    headers: cookie ? { Cookie: cookie } : {},
  }).catch(() => null);
  const html = r ? await r.text().catch(() => '') : '';
  const ok = !!r && r.status === 200 && !/Unhandled Runtime Error|__next_error__|Application error/.test(html);
  check(
    `Page ${route} renders (200, no build error)`,
    ok,
    r ? `status ${r.status}${/__next_error__/.test(html) ? ' — __next_error__ in HTML' : ''}` : 'no response'
  );
}

async function main() {
  console.log(`Phase 2 smoke test against ${BASE}\n`);

  // --- Server reachable -----------------------------------------------------
  const home = await fetch(BASE + '/').catch(() => null);
  check('Dev server responds on /', !!home && home.status < 500, home ? `status ${home.status}` : 'no response');

  // --- Unauthenticated access control (TEST.md: lockdown) -------------------
  const unauth = [
    ['GET', '/api/offers'],
    ['POST', '/api/offers'],
    ['GET', '/api/offers/any'],
    ['PATCH', '/api/offers/any'],
    ['DELETE', '/api/offers/any'],
    ['GET', '/api/offers/any/qr'],
    ['GET', '/api/branches'],
    ['POST', '/api/branches'],
    ['PATCH', '/api/branches/any'],
    ['DELETE', '/api/branches/any'],
    ['GET', '/api/merchant/stats'],
  ];
  for (const [method, path] of unauth) {
    const res = await call(path, { method });
    check(`${method} ${path} without session -> 401 UNAUTHORIZED`, res.status === 401 && res.json?.error?.code === 'UNAUTHORIZED', `status ${res.status}`);
  }

  // --- Sign up merchant 1 (Phase 1 flow) ------------------------------------
  const m1 = await signUp(BIZ_NAME, PHONE_1);

  // --- Setup-required guard: OTP session without a merchant profile ---------
  const needsSetup = await call('/api/offers', { method: 'GET', cookie: m1.otpCookie });
  check('Offers API before business-setup -> 409 SETUP_REQUIRED', needsSetup.status === 409 && needsSetup.json?.error?.code === 'SETUP_REQUIRED', `status ${needsSetup.status} ${JSON.stringify(needsSetup.json?.error || {})}`);

  // --- Stats baseline (fresh merchant) --------------------------------------
  const stats0 = await call('/api/merchant/stats', { method: 'GET', cookie: m1.cookie });
  check('GET /api/merchant/stats -> 200', stats0.status === 200 && stats0.json?.success === true, `status ${stats0.status}`);
  check('Stats baseline: 0 offers, 0 branches, 0 customers', stats0.json?.data?.stats?.offerCount === 0 && stats0.json?.data?.stats?.branchCount === 0 && stats0.json?.data?.stats?.customerCount === 0, JSON.stringify(stats0.json?.data?.stats || {}));
  check('Stats carries the merchant profile', stats0.json?.data?.merchant?.businessName === BIZ_NAME, `got ${stats0.json?.data?.merchant?.businessName}`);

  // --- Offer validation (422s) ----------------------------------------------
  const badOffers = [
    ['title too short', { title: 'AB', rewardType: 'DISCOUNT', requiredStamps: 10, durationDays: 90 }],
    ['bad reward type', { title: 'Valid Title', rewardType: 'CASH', requiredStamps: 10, durationDays: 90 }],
    ['too few stamps', { title: 'Valid Title', rewardType: 'DISCOUNT', requiredStamps: 1, durationDays: 90 }],
    ['zero duration', { title: 'Valid Title', rewardType: 'DISCOUNT', requiredStamps: 10, durationDays: 0 }],
    ['malformed poster URL', { title: 'Valid Title', rewardType: 'CUSTOM', requiredStamps: 10, durationDays: 30, posterTemplateUrl: 'not-a-url' }],
  ];
  for (const [label, payload] of badOffers) {
    const res = await call('/api/offers', { cookie: m1.cookie, body: payload });
    check(`POST /api/offers rejects ${label} -> 422`, res.status === 422 && res.json?.error?.code === 'VALIDATION_ERROR', `status ${res.status}`);
  }

  // --- Offer create ----------------------------------------------------------
  const offerAInput = {
    title: 'Buy 10 Coffees Get 1 Free',
    rewardType: 'FREE_ITEM',
    requiredStamps: 10,
    durationDays: 90,
    posterTemplateUrl: 'https://example.com/poster.png',
  };
  const createA = await call('/api/offers', { cookie: m1.cookie, body: offerAInput });
  check('POST /api/offers valid payload -> 201', createA.status === 201 && createA.json?.success === true, `status ${createA.status} ${JSON.stringify(createA.json)}`);
  const offerA = createA.json?.data?.offer;
  check('Created offer has a real cuid id', !!offerA?.id && /^[c][a-z0-9]+$/.test(offerA.id), `got ${offerA?.id}`);
  check('Created offer active by default', offerA?.isActive === true);
  check('Created offer echoes fields', offerA?.title === offerAInput.title && offerA?.rewardType === 'FREE_ITEM' && offerA?.requiredStamps === 10 && offerA?.durationDays === 90 && offerA?.posterTemplateUrl === offerAInput.posterTemplateUrl, JSON.stringify(offerA || {}));

  const createB = await call('/api/offers', {
    cookie: m1.cookie,
    body: { title: 'Salon Loyal Card', rewardType: 'DISCOUNT', requiredStamps: 5, durationDays: 30 },
  });
  check('Second offer created (201)', createB.status === 201, `status ${createB.status}`);
  const offerB = createB.json?.data?.offer;
  check('Offer without poster URL stores null', offerB?.posterTemplateUrl === null, `got ${offerB?.posterTemplateUrl}`);

  // --- Offer list & fetch ----------------------------------------------------
  const list1 = await call('/api/offers', { method: 'GET', cookie: m1.cookie });
  check('GET /api/offers lists both offers', list1.status === 200 && Array.isArray(list1.json?.data?.offers) && list1.json.data.offers.length === 2, `got ${list1.json?.data?.offers?.length}`);
  check('Offers listed newest first', list1.json?.data?.offers?.[0]?.id === offerB.id);

  const getA = await call(`/api/offers/${offerA.id}`, { method: 'GET', cookie: m1.cookie });
  check('GET /api/offers/[id] -> 200 with offer', getA.status === 200 && getA.json?.data?.offer?.id === offerA.id, `status ${getA.status}`);

  const getMissing = await call('/api/offers/c_does_not_exist', { method: 'GET', cookie: m1.cookie });
  check('GET missing offer -> 404', getMissing.status === 404, `status ${getMissing.status}`);

  // --- Offer update ----------------------------------------------------------
  const patchTitle = await call(`/api/offers/${offerA.id}`, { method: 'PATCH', cookie: m1.cookie, body: { title: 'Buy 12 Coffees Get 1 Free' } });
  check('PATCH updates title -> 200', patchTitle.status === 200 && patchTitle.json?.data?.offer?.title === 'Buy 12 Coffees Get 1 Free', `status ${patchTitle.status}`);

  const patchToggle = await call(`/api/offers/${offerA.id}`, { method: 'PATCH', cookie: m1.cookie, body: { isActive: false } });
  check('PATCH pauses offer -> 200 isActive=false', patchToggle.status === 200 && patchToggle.json?.data?.offer?.isActive === false, `status ${patchToggle.status}`);

  const patchEmpty = await call(`/api/offers/${offerA.id}`, { method: 'PATCH', cookie: m1.cookie, body: {} });
  check('PATCH with no changes -> 422', patchEmpty.status === 422, `status ${patchEmpty.status}`);

  const patchInvalid = await call(`/api/offers/${offerA.id}`, { method: 'PATCH', cookie: m1.cookie, body: { requiredStamps: 1 } });
  check('PATCH with invalid field -> 422', patchInvalid.status === 422, `status ${patchInvalid.status}`);

  // --- QR generation (TEST.md §3 — /scan/[offerId]) --------------------------
  const qr = await call(`/api/offers/${offerA.id}/qr`, { method: 'GET', cookie: m1.cookie });
  check('GET /api/offers/[id]/qr -> 200', qr.status === 200 && qr.json?.success === true, `status ${qr.status}`);
  check('QR payload is a PNG data URL', /^data:image\/png;base64,/.test(qr.json?.data?.qrDataUrl || ''), `got ${(qr.json?.data?.qrDataUrl || '').slice(0, 30)}`);
  check('QR payload is a decodable PNG (89504E47 magic)', /^data:image\/png;base64,iVBOR/.test(qr.json?.data?.qrDataUrl || ''));
  check('Scan URL targets /scan/[offerId]', (qr.json?.data?.scanUrl || '').endsWith(`/scan/${offerA.id}`), `got ${qr.json?.data?.scanUrl}`);
  check('Scan URL is absolute to this server', (qr.json?.data?.scanUrl || '').startsWith(`http`), `got ${qr.json?.data?.scanUrl}`);
  check('QR response carries merchant branding', qr.json?.data?.merchant?.businessName === BIZ_NAME, `got ${qr.json?.data?.merchant?.businessName}`);
  check('QR response carries the offer', qr.json?.data?.offer?.id === offerA.id);

  const qrMissing = await call('/api/offers/c_does_not_exist/qr', { method: 'GET', cookie: m1.cookie });
  check('QR for missing offer -> 404', qrMissing.status === 404, `status ${qrMissing.status}`);

  // --- Stats with offers -----------------------------------------------------
  const stats1 = await call('/api/merchant/stats', { method: 'GET', cookie: m1.cookie });
  check('Stats after 2 offers: offerCount=2, active=1 (A paused)', stats1.json?.data?.stats?.offerCount === 2 && stats1.json?.data?.stats?.activeOfferCount === 1, JSON.stringify(stats1.json?.data?.stats || {}));

  // --- Cross-merchant isolation ---------------------------------------------
  const m2 = await signUp('Second Shop Dhaka', PHONE_2);

  const foreignGet = await call(`/api/offers/${offerA.id}`, { method: 'GET', cookie: m2.cookie });
  check('Foreign merchant GET offer -> 404 (no enumeration)', foreignGet.status === 404, `status ${foreignGet.status}`);
  const foreignPatch = await call(`/api/offers/${offerA.id}`, { method: 'PATCH', cookie: m2.cookie, body: { title: 'Hijacked' } });
  check('Foreign merchant PATCH offer -> 404', foreignPatch.status === 404, `status ${foreignPatch.status}`);
  const foreignQr = await call(`/api/offers/${offerA.id}/qr`, { method: 'GET', cookie: m2.cookie });
  check('Foreign merchant QR -> 404', foreignQr.status === 404, `status ${foreignQr.status}`);
  const foreignDelete = await call(`/api/offers/${offerA.id}`, { method: 'DELETE', cookie: m2.cookie });
  check('Foreign merchant DELETE offer -> 404', foreignDelete.status === 404, `status ${foreignDelete.status}`);
  const foreignStillThere = await call(`/api/offers/${offerA.id}`, { method: 'GET', cookie: m1.cookie });
  check('Offer untouched after foreign attempts', foreignStillThere.status === 200 && foreignStillThere.json?.data?.offer?.title === 'Buy 12 Coffees Get 1 Free', `status ${foreignStillThere.status}`);

  // --- Branch CRUD -----------------------------------------------------------
  const badBranches = [
    ['name too short', { branchName: 'X' }],
    ['latitude out of range', { branchName: 'Banani Outlet', latitude: 999 }],
    ['longitude out of range', { branchName: 'Banani Outlet', longitude: -200 }],
    ['non-numeric coordinate', { branchName: 'Banani Outlet', latitude: 'here' }],
  ];
  for (const [label, payload] of badBranches) {
    const res = await call('/api/branches', { cookie: m1.cookie, body: payload });
    check(`POST /api/branches rejects ${label} -> 422`, res.status === 422, `status ${res.status}`);
  }

  const branchInput = {
    branchName: 'Banani Outlet',
    address: 'Road 11, Banani, Dhaka',
    latitude: 23.7937,
    longitude: 90.4066,
  };
  const createBr1 = await call('/api/branches', { cookie: m1.cookie, body: branchInput });
  check('POST /api/branches with GPS -> 201', createBr1.status === 201 && createBr1.json?.success === true, `status ${createBr1.status}`);
  const branch1 = createBr1.json?.data?.branch;
  check('Created branch echoes name + address', branch1?.branchName === 'Banani Outlet' && branch1?.address === 'Road 11, Banani, Dhaka');
  check('Created branch stores GPS coordinates', String(branch1?.latitude ?? '').startsWith('23.79') && String(branch1?.longitude ?? '').startsWith('90.40'), `lat=${branch1?.latitude} lng=${branch1?.longitude}`);

  const createBr2 = await call('/api/branches', { cookie: m1.cookie, body: { branchName: 'Dhanmondi Outlet' } });
  check('POST /api/branches without GPS -> 201, coords null', createBr2.status === 201 && createBr2.json?.data?.branch?.latitude === null && createBr2.json?.data?.branch?.longitude === null, `status ${createBr2.status}`);
  const branch2 = createBr2.json?.data?.branch;

  const listBr = await call('/api/branches', { method: 'GET', cookie: m1.cookie });
  check('GET /api/branches lists both', listBr.status === 200 && listBr.json?.data?.branches?.length === 2, `got ${listBr.json?.data?.branches?.length}`);

  const patchBr = await call(`/api/branches/${branch1.id}`, { method: 'PATCH', cookie: m1.cookie, body: { address: 'House 4, Road 11, Banani' } });
  check('PATCH updates branch address -> 200', patchBr.status === 200 && patchBr.json?.data?.branch?.address === 'House 4, Road 11, Banani', `status ${patchBr.status}`);
  check('PATCH keeps GPS coordinates intact', String(patchBr.json?.data?.branch?.latitude ?? '').startsWith('23.79'));

  const patchBrEmpty = await call(`/api/branches/${branch1.id}`, { method: 'PATCH', cookie: m1.cookie, body: {} });
  check('Branch PATCH with no changes -> 422', patchBrEmpty.status === 422, `status ${patchBrEmpty.status}`);

  const foreignBrPatch = await call(`/api/branches/${branch1.id}`, { method: 'PATCH', cookie: m2.cookie, body: { branchName: 'Mine now' } });
  check('Foreign merchant PATCH branch -> 404', foreignBrPatch.status === 404, `status ${foreignBrPatch.status}`);
  const foreignBrDelete = await call(`/api/branches/${branch1.id}`, { method: 'DELETE', cookie: m2.cookie });
  check('Foreign merchant DELETE branch -> 404', foreignBrDelete.status === 404, `status ${foreignBrDelete.status}`);

  const stats2 = await call('/api/merchant/stats', { method: 'GET', cookie: m1.cookie });
  check('Stats show branchCount=2', stats2.json?.data?.stats?.branchCount === 2, `got ${stats2.json?.data?.stats?.branchCount}`);

  // --- Soft deletes ----------------------------------------------------------
  const delBr2 = await call(`/api/branches/${branch2.id}`, { method: 'DELETE', cookie: m1.cookie });
  check('DELETE branch -> 200', delBr2.status === 200 && delBr2.json?.data?.deleted === true, `status ${delBr2.status}`);
  const listBrAfter = await call('/api/branches', { method: 'GET', cookie: m1.cookie });
  check('Deleted branch gone from list', listBrAfter.json?.data?.branches?.length === 1, `got ${listBrAfter.json?.data?.branches?.length}`);
  const delBr2Again = await call(`/api/branches/${branch2.id}`, { method: 'DELETE', cookie: m1.cookie });
  check('DELETE same branch again -> 404', delBr2Again.status === 404, `status ${delBr2Again.status}`);

  const delA = await call(`/api/offers/${offerA.id}`, { method: 'DELETE', cookie: m1.cookie });
  check('DELETE offer -> 200', delA.status === 200 && delA.json?.data?.deleted === true, `status ${delA.status}`);
  const getADeleted = await call(`/api/offers/${offerA.id}`, { method: 'GET', cookie: m1.cookie });
  check('Deleted offer -> 404', getADeleted.status === 404, `status ${getADeleted.status}`);
  const qrADeleted = await call(`/api/offers/${offerA.id}/qr`, { method: 'GET', cookie: m1.cookie });
  check('QR of deleted offer -> 404', qrADeleted.status === 404, `status ${qrADeleted.status}`);
  const listAfterDel = await call('/api/offers', { method: 'GET', cookie: m1.cookie });
  check('Deleted offer gone from list (1 remains)', listAfterDel.json?.data?.offers?.length === 1, `got ${listAfterDel.json?.data?.offers?.length}`);

  const stats3 = await call('/api/merchant/stats', { method: 'GET', cookie: m1.cookie });
  check('Stats after deletes: offerCount=1, branchCount=1', stats3.json?.data?.stats?.offerCount === 1 && stats3.json?.data?.stats?.branchCount === 1, JSON.stringify(stats3.json?.data?.stats || {}));

  // --- Regression: Phase 1 session endpoint ---------------------------------
  const me = await call('/api/auth/me', { method: 'GET', cookie: m1.cookie });
  check('GET /api/auth/me still 200 with merchant profile (regression)', me.status === 200 && me.json?.data?.merchant?.businessName === BIZ_NAME, `status ${me.status}`);

  // --- Pages exist (phases.md Phase 2 files) — session cookie required (middleware)
  for (const route of ['/dashboard', '/offers/new', `/offers/${offerB.id}`, `/offers/${offerB.id}/qr`, '/branches']) {
    await pageRenders(route, m1.cookie);
  }
  // Guest must be bounced by middleware before any HTML renders.
  const guestDash = await fetch(BASE + '/dashboard', { redirect: 'manual' }).catch(() => null);
  check(
    'Guest GET /dashboard -> 307 to /welcome (middleware gate)',
    !!guestDash && guestDash.status === 307 && (guestDash.headers.get('location') || '').includes('/welcome'),
    guestDash ? `status ${guestDash.status}, location ${guestDash.headers.get('location')}` : 'no response'
  );

  console.log('\n' + results.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
