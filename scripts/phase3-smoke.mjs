/**
 * Phase 3 — Customer Experience smoke test
 * Spec: phases.md Phase 3 ("customer can scan QR, collect stamps, redeem
 * reward") + TEST.md §4 (GPS proximity, scan cooldown, stamp counter,
 * reward trigger) + PRD 3.3 (review bonus).
 *
 * Flow: customer session -> role lockdown -> offer context (public vs
 *       authed) -> validation -> GPS checks -> scan opens a PENDING check-in
 *       (Phase 9) -> web approval rejected -> device-signed approval stamps
 *       the card (Phase 10) -> cooldown starts at approval -> review bonus
 *       -> complete card -> redeem -> cards list -> stats regression
 *       -> page renders.
 *
 * Usage: node scripts/phase3-smoke.mjs [baseUrl]
 */

import { signUpMerchant as signUpMerchantHelper, signInCustomer as signInCustomerHelper } from './test-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3111';
const RUN = Date.now().toString(36);
import { registerDevice, approveCheckIn } from './device-approval.mjs';

const MERCHANT_PHONE = '017' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const MERCHANT2_PHONE = '018' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const CUSTOMER_PHONE = '019' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const CUSTOMER2_PHONE = '016' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');

const BIZ_NAME = 'Crimson Cup Banani';
const BIZ2_NAME = 'Dhanmondi Cuts Salon';
const BRANCH = { latitude: 23.7937, longitude: 90.4066 }; // Banani
const NEAR = { latitude: 23.79371, longitude: 90.40661 }; // ~1 m away
const FAR = { latitude: 22.0, longitude: 90.0 }; // ~200 km away

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

/** label -> merchant id, so a device proof can be bound to it (Phase 10). */
const merchantIdByLabel = new Map();

/** Signs a merchant up (email session + business-setup); returns the session cookie. */
async function signUpMerchant(label, phone) {
  const email = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${RUN}@example.com`;
  const { cookie, merchant } = await signUpMerchantHelper((p, o) => call(p, o), {
    email,
    phone,
    businessName: label,
    category: 'Café & Bakery',
  });
  check(`[${label}] business setup saved (200)`, !!merchant?.id);
  merchantIdByLabel.set(label, merchant?.id ?? null);
  return cookie;
}

/**
 * Signs a customer in (name + phone, collected — no OTP).
 * `label` doubles as the customer's display name ("Customer 1").
 */
async function signInCustomer(label, phone) {
  const { cookie } = await signInCustomerHelper((p, o) => call(p, o), { name: label, phone });
  check(`[${label}] customer session issued (200)`, !!cookie);
  return cookie;
}

function status(res) {
  return res?.status;
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
  console.log(`Phase 3 smoke test against ${BASE}\n`);

  // --- Server reachable -----------------------------------------------------
  const home = await fetch(BASE + '/').catch(() => null);
  check('Dev server responds on /', !!home && home.status < 500, home ? `status ${home.status}` : 'no response');

  // --- Unauthenticated lockdown --------------------------------------------
  const unauth = [
    ['GET', '/api/customer/cards'],
    ['POST', '/api/customer/scan'],
    ['POST', '/api/customer/redeem'],
    ['POST', '/api/customer/review'],
  ];
  for (const [method, path] of unauth) {
    const res = await call(path, { method });
    check(
      `${method} ${path} without session -> 401 UNAUTHORIZED`,
      res.status === 401 && res.json?.error?.code === 'UNAUTHORIZED',
      `status ${res.status}`
    );
  }

  // --- Fixtures: 2 merchants, 2 offers, 1 GPS branch ------------------------
  const m1 = await signUpMerchant(BIZ_NAME, MERCHANT_PHONE);
  const offerA = (
    await call('/api/offers', {
      cookie: m1,
      body: { title: 'Buy 10 Coffees Get 1 Free', rewardType: 'FREE_ITEM', requiredStamps: 2, durationDays: 30 },
    })
  ).json?.data?.offer;
  check('Merchant 1 offer created (requiredStamps=2)', /^[c][a-z0-9]+$/.test(offerA?.id || ''), `got ${offerA?.id}`);
  await call('/api/branches', {
    cookie: m1,
    body: { branchName: 'Banani Outlet', address: 'Road 11, Banani', ...BRANCH },
  });

  const m2 = await signUpMerchant(BIZ2_NAME, MERCHANT2_PHONE);
  const offerB = (
    await call('/api/offers', {
      cookie: m2,
      body: { title: 'Salon loyal card', rewardType: 'DISCOUNT', requiredStamps: 5, durationDays: 60 },
    })
  ).json?.data?.offer;
  check('Merchant 2 offer created (requiredStamps=5)', /^[c][a-z0-9]+$/.test(offerB?.id || ''), `got ${offerB?.id}`);

  // --- App devices (Phase 10): only these can approve a check-in -----------
  const dev1 = await registerDevice({
    cookie: m1,
    merchantId: merchantIdByLabel.get(BIZ_NAME),
    deviceName: 'Crimson Cup Phone',
  });
  check('Merchant 1 app device registered (201)', dev1.status === 201 && !!dev1.deviceId, `status ${dev1.status}, device ${dev1.deviceId}`);

  const dev2 = await registerDevice({
    cookie: m2,
    merchantId: merchantIdByLabel.get(BIZ2_NAME),
    deviceName: 'Dhanmondi Cuts Phone',
  });
  check('Merchant 2 app device registered (201)', dev2.status === 201 && !!dev2.deviceId, `status ${dev2.status}, device ${dev2.deviceId}`);

  // --- Customer session: role + lockdown ------------------------------------
  const c1 = await signInCustomer('Customer 1', CUSTOMER_PHONE);
  const me = await call('/api/auth/me', { method: 'GET', cookie: c1 });
  check('GET /api/auth/me -> authenticated customer session', me.status === 200 && me.json?.data?.authenticated === true, `status ${me.status}`);
  check('Session carries role=customer', me.json?.data?.session?.role === 'customer', `got ${me.json?.data?.session?.role}`);
  check('Customer session has no merchant profile', me.json?.data?.merchant === null, JSON.stringify(me.json?.data?.merchant));

  for (const [method, path] of [['GET', '/api/offers'], ['GET', '/api/merchant/stats'], ['POST', '/api/branches']]) {
    const res = await call(path, { method, cookie: c1 });
    check(
      `Customer session on ${method} ${path} -> 403 CUSTOMER_SESSION`,
      res.status === 403 && res.json?.error?.code === 'CUSTOMER_SESSION',
      `status ${res.status}`
    );
  }

  // --- Offer context: public vs authenticated (TEST.md §3 dynamic routing) --
  const ctxPublic = await call(`/api/customer/offers/${offerA.id}`, { method: 'GET' });
  check('Unauth GET offer context -> 200', ctxPublic.status === 200 && ctxPublic.json?.success === true, `status ${ctxPublic.status}`);
  check('Context carries public branding', ctxPublic.json?.data?.offer?.title === 'Buy 10 Coffees Get 1 Free' && ctxPublic.json?.data?.merchant?.businessName === BIZ_NAME, JSON.stringify(ctxPublic.json?.data?.merchant || {}));
  check('Context reports authenticated=false', ctxPublic.json?.data?.authenticated === false);
  check('Context withholds card state pre-auth', ctxPublic.json?.data?.card === null);
  check('Context flags geo requirement (GPS branch exists)', ctxPublic.json?.data?.geoRequired === true && ctxPublic.json?.data?.geoRadiusM === 200, JSON.stringify({ geoRequired: ctxPublic.json?.data?.geoRequired, geoRadiusM: ctxPublic.json?.data?.geoRadiusM }));

  const ctxMissing = await call('/api/customer/offers/c_does_not_exist', { method: 'GET' });
  check('Unauth GET missing offer context -> 404', ctxMissing.status === 404, `status ${ctxMissing.status}`);

  const ctx1 = await call(`/api/customer/offers/${offerA.id}`, { method: 'GET', cookie: c1 });
  check('Authed GET offer context -> 200 authenticated=true', ctx1.status === 200 && ctx1.json?.data?.authenticated === true, `status ${ctx1.status}`);
  check('Fresh customer: card exists=false, canScan=true, stamps=0', ctx1.json?.data?.card?.exists === false && ctx1.json?.data?.card?.canScan === true && ctx1.json?.data?.card?.stampsCollected === 0, JSON.stringify(ctx1.json?.data?.card || {}));

  // --- Scan validation (422s / 404s) ----------------------------------------
  const badScans = [
    ['empty payload', {}],
    ['missing offer', { offerId: '' }],
    ['half coordinate pair', { offerId: offerA.id, latitude: BRANCH.latitude }],
    ['latitude out of range', { offerId: offerA.id, latitude: 999, longitude: BRANCH.longitude }],
  ];
  for (const [label, payload] of badScans) {
    const res = await call('/api/customer/scan', { cookie: c1, body: payload });
    check(`POST /api/customer/scan rejects ${label} -> 422`, res.status === 422 && res.json?.error?.code === 'VALIDATION_ERROR', `status ${res.status}`);
  }
  const unknownOffer = await call('/api/customer/scan', { cookie: c1, body: { offerId: 'c_missing' } });
  check('POST /api/customer/scan unknown offer -> 404', unknownOffer.status === 404, `status ${unknownOffer.status}`);

  // --- GPS proximity (TEST.md §4) -------------------------------------------
  const noCoords = await call('/api/customer/scan', { cookie: c1, body: { offerId: offerA.id } });
  check('Scan without coordinates at GPS shop -> 422 NEED_LOCATION', noCoords.status === 422 && noCoords.json?.error?.code === 'NEED_LOCATION', `status ${noCoords.status}`);

  const tooFar = await call('/api/customer/scan', { cookie: c1, body: { offerId: offerA.id, ...FAR } });
  check('Scan from out-of-range coordinates -> 403 LOCATION_OUT_OF_RANGE', tooFar.status === 403 && tooFar.json?.error?.code === 'LOCATION_OUT_OF_RANGE', `status ${tooFar.status}`);
  check('Out-of-range response carries distance + radius', typeof tooFar.json?.data?.distanceMeters === 'number' && tooFar.json?.data?.distanceMeters > 200 && tooFar.json?.data?.radiusM === 200, JSON.stringify(tooFar.json?.data || {}));
  check('Out-of-range names the nearest branch', tooFar.json?.data?.nearestBranch === 'Banani Outlet', `got ${tooFar.json?.data?.nearestBranch}`);

  // --- Scan (Phase 9): opens a check-in, no stamp until the app approves ----
  const scan1 = await call('/api/customer/scan', { cookie: c1, body: { offerId: offerA.id, ...NEAR } });
  const pendingA = scan1.json?.data?.request;
  check('Scan from valid branch coordinates -> 200 (check-in opened)', scan1.status === 200 && scan1.json?.success === true && scan1.json?.data?.requested === true, `status ${scan1.status} ${JSON.stringify(scan1.json)}`);
  check('Scan opens a PENDING check-in — no stamp before approval', pendingA?.status === 'PENDING' && scan1.json?.data?.card?.stampsCollected === 0 && scan1.json?.data?.card?.exists === false && scan1.json?.data?.stamped === 0, JSON.stringify(scan1.json?.data?.card || {}));
  check('Card not complete before approval (0 of 2)', scan1.json?.data?.complete === false);
  check('Scan response carries reward details', scan1.json?.data?.reward?.requiredStamps === 2 && scan1.json?.data?.reward?.merchantName === BIZ_NAME, JSON.stringify(scan1.json?.data?.reward || {}));

  // --- Phase 10: the web dashboard can never approve ------------------------
  const webApprove = await call(`/api/merchant/scan-requests/${pendingA?.id}`, { cookie: m1 });
  check('Web session approval -> 403 APP_APPROVAL_REQUIRED', webApprove.status === 403 && webApprove.json?.error?.code === 'APP_APPROVAL_REQUIRED', `status ${webApprove.status}, code ${webApprove.json?.error?.code}`);

  const approve1 = await approveCheckIn({ cookie: m1, signer: dev1.signer, deviceId: dev1.deviceId, requestId: pendingA?.id });
  check('App-signed approval stamps the card (1 of 2)', approve1.status === 200 && approve1.json?.data?.card?.stampsCollected === 1, `status ${approve1.status} ${JSON.stringify(approve1.json)}`);
  check('Approval records the signing device', approve1.json?.data?.request?.approvedByDeviceId === dev1.deviceId, JSON.stringify(approve1.json?.data?.request || {}));
  check('Card not complete (1 of 2)', approve1.json?.data?.card?.complete === false);
  check('Cooldown starts at approval (nextScanAt set)', typeof approve1.json?.data?.card?.nextScanAt === 'string', `got ${approve1.json?.data?.card?.nextScanAt}`);

  // --- Cooldown (TEST.md §4) -------------------------------------------------
  const cooldown = await call('/api/customer/scan', { cookie: c1, body: { offerId: offerA.id, ...NEAR } });
  check('Immediate re-scan -> 429 COOLDOWN', cooldown.status === 429 && cooldown.json?.error?.code === 'COOLDOWN', `status ${cooldown.status}`);
  check('Cooldown response carries nextScanAt + card', typeof cooldown.json?.data?.nextScanAt === 'string' && cooldown.json?.data?.card?.stampsCollected === 1, JSON.stringify(cooldown.json?.data || {}));

  // --- Review bonus (PRD 3.3) -----------------------------------------------
  const scanFirst = await call('/api/customer/review', { cookie: c1, body: { offerId: offerB.id } });
  check('Review bonus without a card -> 409 SCAN_FIRST', scanFirst.status === 409 && scanFirst.json?.error?.code === 'SCAN_FIRST', `status ${scanFirst.status}`);

  const review1 = await call('/api/customer/review', { cookie: c1, body: { offerId: offerA.id } });
  check('Review bonus -> 200 (stamp 2 of 2)', review1.status === 200 && review1.json?.data?.stamped === 2 && review1.json?.data?.complete === true, `status ${review1.status} ${JSON.stringify(review1.json?.data?.card || {})}`);
  check('Card now reports reward complete', review1.json?.data?.card?.complete === true);

  const review2 = await call('/api/customer/review', { cookie: c1, body: { offerId: offerA.id } });
  check('Second review on a complete card -> 409 CARD_COMPLETE', review2.status === 409 && review2.json?.error?.code === 'CARD_COMPLETE', `status ${review2.status}`);

  // --- Complete card blocks further scans ------------------------------------
  const whileComplete = await call('/api/customer/scan', { cookie: c1, body: { offerId: offerA.id, ...NEAR } });
  check('Scan on a complete card -> 409 CARD_COMPLETE', whileComplete.status === 409 && whileComplete.json?.error?.code === 'CARD_COMPLETE', `status ${whileComplete.status}`);

  // --- Redeem (TEST.md §4 reward trigger) ------------------------------------
  const notReady = await call('/api/customer/redeem', { cookie: c1, body: { offerId: offerB.id } });
  check('Redeem for a shop with no card -> 409 REWARD_NOT_READY', notReady.status === 409 && notReady.json?.error?.code === 'REWARD_NOT_READY', `status ${notReady.status}`);

  const c2 = await signInCustomer('Customer 2', CUSTOMER2_PHONE);
  const c2Scan = await call('/api/customer/scan', { cookie: c2, body: { offerId: offerB.id } });
  check('Merchant without GPS: scan without coordinates -> 200 (check-in opened)', c2Scan.status === 200 && c2Scan.json?.data?.requested === true && c2Scan.json?.data?.nearestBranch === null, `status ${c2Scan.status} ${JSON.stringify(c2Scan.json)}`);
  const approveC2 = await approveCheckIn({ cookie: m2, signer: dev2.signer, deviceId: dev2.deviceId, requestId: c2Scan.json?.data?.request?.id });
  check('Approval stamps 1 of 5 (no-GPS shop)', approveC2.status === 200 && approveC2.json?.data?.card?.stampsCollected === 1, `status ${approveC2.status} ${JSON.stringify(approveC2.json)}`);

  // Review cooldown needs an incomplete card (C1's card is already complete).
  const c2Review = await call('/api/customer/review', { cookie: c2, body: { offerId: offerB.id } });
  check('Review bonus on partial card -> 200 (stamp 2 of 5)', c2Review.status === 200 && c2Review.json?.data?.stamped === 2, `status ${c2Review.status}`);
  const c2ReviewAgain = await call('/api/customer/review', { cookie: c2, body: { offerId: offerB.id } });
  check('Second review bonus within window -> 429 REVIEW_COOLDOWN', c2ReviewAgain.status === 429 && c2ReviewAgain.json?.error?.code === 'REVIEW_COOLDOWN', `status ${c2ReviewAgain.status}`);
  check('Review cooldown response carries nextReviewAt', typeof c2ReviewAgain.json?.data?.nextReviewAt === 'string', JSON.stringify(c2ReviewAgain.json?.data || {}));

  const c2RedeemEarly = await call('/api/customer/redeem', { cookie: c2, body: { offerId: offerB.id } });
  check('Redeem before threshold -> 409 REWARD_NOT_READY', c2RedeemEarly.status === 409 && c2RedeemEarly.json?.error?.code === 'REWARD_NOT_READY', `status ${c2RedeemEarly.status}`);

  const redeem = await call('/api/customer/redeem', { cookie: c1, body: { offerId: offerA.id } });
  check('Redeem on complete card -> 200', redeem.status === 200 && redeem.json?.success === true, `status ${redeem.status} ${JSON.stringify(redeem.json)}`);
  check('Redeem resets stamps to 0', redeem.json?.data?.card?.stampsCollected === 0, `got ${redeem.json?.data?.card?.stampsCollected}`);
  check('Redeem bumps totalRedeemed to 1', redeem.json?.data?.card?.totalRedeemed === 1, `got ${redeem.json?.data?.card?.totalRedeemed}`);
  check('Redeem echoes the reward + timestamp', redeem.json?.data?.reward?.title === 'Buy 10 Coffees Get 1 Free' && typeof redeem.json?.data?.claimedAt === 'string', JSON.stringify(redeem.json?.data || {}));

  const afterRedeem = await call('/api/customer/scan', { cookie: c1, body: { offerId: offerA.id, ...NEAR } });
  check('Post-redeem scan still inside cooldown -> 429', afterRedeem.status === 429, `status ${afterRedeem.status}`);

  // --- Cards list -------------------------------------------------------------
  const cards1 = await call('/api/customer/cards', { method: 'GET', cookie: c1 });
  check('GET /api/customer/cards -> 1 card for customer 1', cards1.status === 200 && cards1.json?.data?.cards?.length === 1, `got ${cards1.json?.data?.cards?.length}`);
  const card1 = cards1.json?.data?.cards?.[0];
  check('Card carries shop + offer + state', card1?.businessName === BIZ_NAME && card1?.offer?.requiredStamps === 2 && card1?.state?.stampsCollected === 0 && card1?.state?.totalRedeemed === 1, JSON.stringify(card1 || {}));
  check('Customer 1 totals: 1 card, 0 stamps, 1 reward', cards1.json?.data?.totals?.cards === 1 && cards1.json?.data?.totals?.stampsCollected === 0 && cards1.json?.data?.totals?.totalRedeemed === 1, JSON.stringify(cards1.json?.data?.totals || {}));

  const cards2 = await call('/api/customer/cards', { method: 'GET', cookie: c2 });
  check('Customer 2 sees only their own card', cards2.json?.data?.cards?.length === 1 && cards2.json?.data?.cards?.[0]?.businessName === BIZ2_NAME, JSON.stringify(cards2.json?.data?.cards || []));
  check('Customer 2 card: 2 stamps of 5 (scan + review bonus)', cards2.json?.data?.cards?.[0]?.state?.stampsCollected === 2, `got ${cards2.json?.data?.cards?.[0]?.state?.stampsCollected}`);

  // --- Merchant stats regression ----------------------------------------------
  const stats = await call('/api/merchant/stats', { method: 'GET', cookie: m1 });
  const s = stats.json?.data?.stats || {};
  check('Merchant 1 stats: customerCount=1 (only C1 scanned)', s.customerCount === 1, JSON.stringify(s));
  check('Merchant 1 stats: totalRedeemed=1, stampsCollected=0', s.totalRedeemed === 1 && s.stampsCollected === 0, JSON.stringify(s));
  check('Merchant 1 stats: offerCount=1, branchCount=1', s.offerCount === 1 && s.branchCount === 1, JSON.stringify(s));

  // --- Pages exist (phases.md Phase 3 files) ----------------------------------
  // /scan* is the public entry; every other customer page needs a session
  // (frontend/middleware.ts bounces guests to /scan?next=…).
  for (const route of ['/scan', `/scan/${offerA.id}`]) {
    await pageRenders(route);
  }
  for (const route of ['/stamp-card', '/reward', '/profile']) {
    await pageRenders(route, c1);
  }

  console.log('\n' + results.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
