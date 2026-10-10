/**
 * Phase 3.5 — Separated Offer Types (Stamp / Scratch Card / Dice Roll) smoke test
 * Spec: phases.md Phase 3.5 + LOYLS_APP_REQUIREMENTS §3/3A/3B.
 *
 * Flow: merchant sessions (no-GPS + GPS) -> create stamp, scratch & dice offers
 *       (legacy body, FIXED, POOL) -> validation 422s -> PATCH type
 *       immutability + item replace -> cross-type 409s -> FIXED reveal +
 *       cooldown -> POOL rotation across customers -> dice roll once per
 *       customer with a lifetime limit -> GPS guards -> stamp scan opens a
 *       PENDING check-in (Phase 9) -> web approval rejected -> device-signed
 *       approval stamps the card (Phase 10) -> cards regression -> auth
 *       lockdown -> page renders.
 *
 * Usage: node scripts/offer-type-smoke.mjs [baseUrl]
 */

import { registerDevice, approveCheckIn } from './device-approval.mjs';
import { signUpMerchant as signUpMerchantHelper, signInCustomer as signInCustomerHelper, grantActiveSubscription } from './test-session.mjs';
const RUN = Date.now().toString(36);

const BASE = process.argv[2] || 'http://localhost:3111';
const M1_PHONE = '017' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const M2_PHONE = '018' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const cust = (p) => p + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const C_FIXED1 = cust('019');
const C_FIXED2 = cust('016');
const C_POOL1 = cust('015');
const C_POOL2 = cust('014');
const C_POOL3 = cust('013');
const C_GEO = cust('017');

const BRANCH = { latitude: 23.7937, longitude: 90.4066 }; // Banani
const NEAR = { latitude: 23.79371, longitude: 90.40661 }; // ~1 m
const FAR = { latitude: 22.0, longitude: 90.0 }; // ~200 km

const FIXED_LABEL = 'Free Dessert';
const POOL = ['Free Drink', '20% Off', 'Free Dessert'];

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

async function call(path, { method = 'POST', body, cookie, headers: extra = {} } = {}) {
  const headers = { 'Content-Type': 'application/json', ...extra };
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

/** label -> merchant id, so later steps can bind a device proof to it. */
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
  check(`[${label}] merchant signed up (200)`, !!merchant?.id);
  merchantIdByLabel.set(label, merchant?.id ?? null);
  // Fresh signups are on the free trial (scratch only) — this suite covers
  // stamp and dice offers, so grant the plan an admin approval would have.
  await grantActiveSubscription(merchant.id);
  return cookie;
}

/** Signs a customer in (name + phone, collected — no OTP). */
async function signInCustomer(phone) {
  const { cookie } = await signInCustomerHelper((p, o) => call(p, o), { name: 'Smoke Customer', phone });
  return cookie;
}

/**
 * Phase 10 device registration + approval live in `device-approval.mjs` (the
 * shared implementation): the merchant's app signs the check-in id with an
 * Ed25519 key the server only ever sees the public half of.
 */

async function pageRenders(route, cookie) {
  const r = await fetch(BASE + route, {
    redirect: 'manual',
    headers: cookie ? { Cookie: cookie } : {},
  }).catch(() => null);
  const html = r ? await r.text().catch(() => '') : '';
  const ok =
    !!r && r.status === 200 && !/Unhandled Runtime Error|__next_error__|Application error/.test(html);
  check(
    `Page ${route} renders (200, no build error)`,
    ok,
    r ? `status ${r.status}${/__next_error__/.test(html) ? ' — __next_error__ in HTML' : ''}` : 'no response'
  );
}

async function main() {
  console.log(`Offer-type smoke test against ${BASE}\n`);

  // --- Server reachable -----------------------------------------------------
  const home = await fetch(BASE + '/').catch(() => null);
  check('Dev server responds on /', !!home && home.status < 500, home ? `status ${home.status}` : 'no response');

  // --- Sessions -------------------------------------------------------------
  const m1 = await signUpMerchant('Stamp & Scratch Café', M1_PHONE);
  const m2 = await signUpMerchant('GPS Salon Dhaka', M2_PHONE);
  const cFix1 = await signInCustomer(C_FIXED1);
  const cFix2 = await signInCustomer(C_FIXED2);
  const cPool1 = await signInCustomer(C_POOL1);
  const cPool2 = await signInCustomer(C_POOL2);
  const cPool3 = await signInCustomer(C_POOL3);
  const cGeo = await signInCustomer(C_GEO);
  check(
    'Customer sessions issued',
    !!(cFix1 && cFix2 && cPool1 && cPool2 && cPool3 && cGeo),
    JSON.stringify({ cFix1: !!cFix1, cPool1: !!cPool1, cGeo: !!cGeo })
  );

  // --- A. Creation ----------------------------------------------------------
  // Legacy body (no offerType) must keep creating stamp offers.
  const legacy = await call('/api/offers', {
    cookie: m1,
    body: { title: 'Legacy Stamp Offer', rewardType: 'FREE_ITEM', requiredStamps: 5, durationDays: 60 },
  });
  const legacyGet =
    legacy.status === 201
      ? await call(`/api/offers/${legacy.json.data.offer.id}`, { method: 'GET', cookie: m1 })
      : null;
  check(
    'Legacy create (no offerType) -> 201 as STAMP',
    legacy.status === 201 && legacyGet?.json?.data?.offer?.offerType === 'STAMP',
    `status ${legacy.status}, type ${legacyGet?.json?.data?.offer?.offerType}`
  );
  const legacyId = legacy.json?.data?.offer?.id;

  const stamp = await call('/api/offers', {
    cookie: m1,
    body: {
      offerType: 'STAMP',
      title: 'Buy 5 Coffees Get 1 Free',
      rewardType: 'FREE_ITEM',
      requiredStamps: 5,
      durationDays: 90,
    },
  });
  const stampId = stamp.json?.data?.offer?.id;
  check(
    'Explicit STAMP create -> 201 offerType STAMP, requiredStamps 5',
    stamp.status === 201 &&
      stamp.json.data.offer.offerType === 'STAMP' &&
      stamp.json.data.offer.requiredStamps === 5,
    `status ${stamp.status}`
  );

  const fixed = await call('/api/offers', {
    cookie: m1,
    body: {
      offerType: 'SCRATCH',
      title: 'Scratch & Win Dessert',
      durationDays: 60,
      scratchMode: 'FIXED',
      items: [FIXED_LABEL],
    },
  });
  const fixedId = fixed.json?.data?.offer?.id;
  check(
    'FIXED scratch create -> 201 with 1 ScratchItem, requiredStamps null',
    fixed.status === 201 &&
      fixed.json.data.offer.offerType === 'SCRATCH' &&
      fixed.json.data.offer.scratchMode === 'FIXED' &&
      fixed.json.data.offer.requiredStamps === null &&
      fixed.json.data.offer.scratchItems?.length === 1 &&
      fixed.json.data.offer.scratchItems[0].label === FIXED_LABEL,
    `status ${fixed.status}, items ${JSON.stringify(fixed.json?.data?.offer?.scratchItems)}`
  );
  check(
    'FIXED scratch create defaults the reveal cooldown to 24h',
    fixed.json?.data?.offer?.scratchCooldownHours === 24,
    `scratchCooldownHours=${fixed.json?.data?.offer?.scratchCooldownHours}`
  );

  const pool = await call('/api/offers', {
    cookie: m1,
    body: {
      offerType: 'SCRATCH',
      title: 'Scratch & Win Combo',
      durationDays: 90,
      scratchMode: 'RANDOM_POOL',
      items: POOL,
    },
  });
  const poolId = pool.json?.data?.offer?.id;
  const poolLabels = (pool.json?.data?.offer?.scratchItems || []).map((i) => i.label);
  check(
    'RANDOM_POOL scratch create -> 201 with 3 ordered ScratchItems',
    pool.status === 201 &&
      pool.json.data.offer.scratchMode === 'RANDOM_POOL' &&
      poolLabels.length === 3 &&
      poolLabels[0] === POOL[0] &&
      poolLabels[1] === POOL[1] &&
      poolLabels[2] === POOL[2],
    `status ${pool.status}, labels ${JSON.stringify(poolLabels)}`
  );

  // A merchant-chosen window shorter than the 24h default, stored as sent.
  const shortCooldown = await call('/api/offers', {
    cookie: m1,
    body: {
      offerType: 'SCRATCH',
      title: 'Happy Hour Scratch',
      durationDays: 30,
      scratchMode: 'FIXED',
      items: ['Free Drink'],
      scratchCooldownHours: 6,
    },
  });
  check(
    'Scratch create honours a custom reveal cooldown (6h)',
    shortCooldown.status === 201 &&
      shortCooldown.json?.data?.offer?.scratchCooldownHours === 6,
    `status ${shortCooldown.status}, hours=${shortCooldown.json?.data?.offer?.scratchCooldownHours}`
  );

  const list = await call('/api/offers', { method: 'GET', cookie: m1 });  const listIds = (list.json?.data?.offers || []).map((o) => o.id);
  const listPool = (list.json?.data?.offers || []).find((o) => o.id === poolId);
  check(
    'GET /api/offers lists both types with scratchItems arrays',
    list.status === 200 &&
      listIds.includes(stampId) &&
      listIds.includes(poolId) &&
      Array.isArray(listPool?.scratchItems) &&
      listPool.scratchItems.length === 3,
    `status ${list.status}`
  );

  const poolGet = await call(`/api/offers/${poolId}`, { method: 'GET', cookie: m1 });
  check(
    'GET /api/offers/[id] includes scratch items',
    poolGet.status === 200 && poolGet.json.data.offer.scratchItems?.length === 3,
    `status ${poolGet.status}`
  );

  // --- B. Validation (422s) -------------------------------------------------
  const badBodies = [
    ['unknown offerType', { offerType: 'Mystery', title: 'Weird', durationDays: 30 }],
    ['scratch with 0 rewards', { offerType: 'SCRATCH', title: 'Empty Card', durationDays: 30, scratchMode: 'RANDOM_POOL', items: [] }],
    ['FIXED with 2 rewards', { offerType: 'SCRATCH', title: 'Two Fixed', durationDays: 30, scratchMode: 'FIXED', items: ['A', 'B'] }],
    ['POOL with 1 reward', { offerType: 'SCRATCH', title: 'One Pool', durationDays: 30, scratchMode: 'RANDOM_POOL', items: ['A'] }],
    ['blank reward label', { offerType: 'SCRATCH', title: 'Blank Row', durationDays: 30, scratchMode: 'FIXED', items: ['   '] }],
    ['21 rewards (max 20)', { offerType: 'SCRATCH', title: 'Too Many', durationDays: 30, scratchMode: 'RANDOM_POOL', items: Array.from({ length: 21 }, (_, i) => `R${i}`) }],
    ['stamp-only field on scratch', { offerType: 'SCRATCH', title: 'Mixed', durationDays: 30, scratchMode: 'FIXED', items: ['A'], requiredStamps: 5 }],
    ['stamp missing requiredStamps', { offerType: 'STAMP', title: 'No Stamps', rewardType: 'DISCOUNT', durationDays: 30 }],
    ['stamp with 1 stamp', { offerType: 'STAMP', title: 'One Stamp', rewardType: 'DISCOUNT', requiredStamps: 1, durationDays: 30 }],
    // 0 would let a customer reveal in a loop; 999 is an accidental lockout.
    ['cooldown below 1 hour', { offerType: 'SCRATCH', title: 'No Cooldown', durationDays: 30, scratchMode: 'FIXED', items: ['A'], scratchCooldownHours: 0 }],
    ['cooldown above 168 hours', { offerType: 'SCRATCH', title: 'Lockout', durationDays: 30, scratchMode: 'FIXED', items: ['A'], scratchCooldownHours: 999 }],
    ['cooldown that is not a whole number', { offerType: 'SCRATCH', title: 'Fractional', durationDays: 30, scratchMode: 'FIXED', items: ['A'], scratchCooldownHours: 6.5 }],
    ['cooldown on a stamp offer', { offerType: 'STAMP', title: 'Mixed Cooldown', rewardType: 'DISCOUNT', requiredStamps: 5, durationDays: 30, scratchCooldownHours: 6 }],
  ];
  for (const [name, body] of badBodies) {
    const res = await call('/api/offers', { cookie: m1, body });
    check(`422 on ${name}`, res.status === 422 && res.json?.error?.code === 'VALIDATION_ERROR', `status ${res.status}`);
  }

  // --- C. PATCH: type immutable + item replace ------------------------------
  const typeFix = await call(`/api/offers/${fixedId}`, {
    method: 'PATCH',
    cookie: m1,
    body: { offerType: 'STAMP', requiredStamps: 5 },
  });
  check(
    'PATCH scratch -> STAMP rejected 422 OFFER_TYPE_IMMUTABLE',
    typeFix.status === 422 && typeFix.json?.error?.code === 'OFFER_TYPE_IMMUTABLE',
    `status ${typeFix.status}, code ${typeFix.json?.error?.code}`
  );

  const typeStamp = await call(`/api/offers/${stampId}`, {
    method: 'PATCH',
    cookie: m1,
    body: { offerType: 'SCRATCH', scratchMode: 'FIXED', items: ['A'] },
  });
  check(
    'PATCH stamp -> SCRATCH rejected 422 OFFER_TYPE_IMMUTABLE',
    typeStamp.status === 422 && typeStamp.json?.error?.code === 'OFFER_TYPE_IMMUTABLE',
    `status ${typeStamp.status}, code ${typeStamp.json?.error?.code}`
  );

  const newLabels = ['Free Brownie', '50% Off'];
  const patchItems = await call(`/api/offers/${poolId}`, {
    method: 'PATCH',
    cookie: m1,
    body: { title: 'Scratch & Win Combo v2', items: newLabels },
  });
  const patchItemsGet = await call(`/api/offers/${poolId}`, { method: 'GET', cookie: m1 });
  const patchedLabels = (patchItemsGet.json?.data?.offer?.scratchItems || []).map((i) => i.label);
  check(
    'PATCH scratch replaces reward rows + title',
    patchItems.status === 200 &&
      patchItemsGet.json.data.offer.title === 'Scratch & Win Combo v2' &&
      patchedLabels.length === 2 &&
      patchedLabels[0] === newLabels[0] &&
      patchedLabels[1] === newLabels[1],
    `status ${patchItems.status}, labels ${JSON.stringify(patchedLabels)}`
  );
  // Restore the 3-label pool for the rotation checks below.
  await call(`/api/offers/${poolId}`, { method: 'PATCH', cookie: m1, body: { items: POOL } });

  const patchEmpty = await call(`/api/offers/${fixedId}`, { method: 'PATCH', cookie: m1, body: {} });
  check(
    'PATCH scratch {} -> 422 no changes',
    patchEmpty.status === 422,
    `status ${patchEmpty.status}`
  );

  const patchCross = await call(`/api/offers/${fixedId}`, {
    method: 'PATCH',
    cookie: m1,
    body: { items: ['A', 'B'] },
  });
  check(
    'PATCH FIXED offer with 2 rewards -> 422',
    patchCross.status === 422,
    `status ${patchCross.status}`
  );

  const patchStampTitle = await call(`/api/offers/${stampId}`, {
    method: 'PATCH',
    cookie: m1,
    body: { title: 'Buy 5 Coffees Get 1 Free!' },
  });
  check(
    'PATCH stamp title still works (200)',
    patchStampTitle.status === 200 && patchStampTitle.json.data.offer.title === 'Buy 5 Coffees Get 1 Free!',
    `status ${patchStampTitle.status}`
  );

  const foreign = await call(`/api/offers/${fixedId}`, {
    method: 'PATCH',
    cookie: m2,
    body: { title: 'Hijacked' },
  });
  check('Cross-merchant PATCH of scratch offer -> 404', foreign.status === 404, `status ${foreign.status}`);

  // --- D. Cross-type 409s ---------------------------------------------------
  const scanOnScratch = await call('/api/customer/scan', { cookie: cFix1, body: { offerId: fixedId } });
  check(
    'scan on SCRATCH offer -> 409 WRONG_OFFER_TYPE',
    scanOnScratch.status === 409 && scanOnScratch.json?.error?.code === 'WRONG_OFFER_TYPE',
    `status ${scanOnScratch.status}, code ${scanOnScratch.json?.error?.code}`
  );

  const redeemOnScratch = await call('/api/customer/redeem', { cookie: cFix1, body: { offerId: fixedId } });
  check(
    'redeem on SCRATCH offer -> 409 WRONG_OFFER_TYPE',
    redeemOnScratch.status === 409 && redeemOnScratch.json?.error?.code === 'WRONG_OFFER_TYPE',
    `status ${redeemOnScratch.status}`
  );

  const reviewOnScratch = await call('/api/customer/review', { cookie: cFix1, body: { offerId: fixedId } });
  check(
    'review on SCRATCH offer -> 409 WRONG_OFFER_TYPE',
    reviewOnScratch.status === 409 && reviewOnScratch.json?.error?.code === 'WRONG_OFFER_TYPE',
    `status ${reviewOnScratch.status}`
  );

  const scratchOnStamp = await call('/api/customer/scratch', { cookie: cFix1, body: { offerId: stampId } });
  check(
    'scratch on STAMP offer -> 409 WRONG_OFFER_TYPE (data.offerType=STAMP)',
    scratchOnStamp.status === 409 &&
      scratchOnStamp.json?.error?.code === 'WRONG_OFFER_TYPE' &&
      scratchOnStamp.json?.data?.offerType === 'STAMP',
    `status ${scratchOnStamp.status}, data ${JSON.stringify(scratchOnStamp.json?.data)}`
  );

  // --- E. Context (no label spoiler) ---------------------------------------
  const ctx = await call(`/api/customer/offers/${poolId}`, { method: 'GET', cookie: cPool1 });
  const ctxRaw = JSON.stringify(ctx.json?.data || {});
  check(
    'Scratch context: offerType/scratchMode/itemCount, card null',
    ctx.status === 200 &&
      ctx.json.data.offer.offerType === 'SCRATCH' &&
      ctx.json.data.offer.scratchMode === 'RANDOM_POOL' &&
      ctx.json.data.offer.itemCount === 3 &&
      ctx.json.data.card === null,
    `status ${ctx.status}`
  );
  check(
    'Scratch context hides reward labels (itemCount only)',
    !ctxRaw.includes('Free Drink') && !ctxRaw.includes('20% Off'),
    ctxRaw.slice(0, 200)
  );
  check(
    'Authed scratch context exposes scratch state (canScratch=true)',
    ctx.json.data.scratch?.canScratch === true && ctx.json.data.scratch?.hasResult === false,
    JSON.stringify(ctx.json?.data?.scratch || {})
  );

  const ctxStamp = await call(`/api/customer/offers/${stampId}`, { method: 'GET', cookie: cFix1 });
  check(
    'Stamp context unchanged: scratch null, card present',
    ctxStamp.status === 200 &&
      ctxStamp.json.data.offer.offerType === 'STAMP' &&
      ctxStamp.json.data.scratch === null &&
      !!ctxStamp.json.data.card,
    `status ${ctxStamp.status}`
  );

  // --- F. FIXED reveal + cooldown ------------------------------------------
  const fix1 = await call('/api/customer/scratch', { cookie: cFix1, body: { offerId: fixedId } });
  check(
    'FIXED reveal #1 -> 200 with the predetermined reward',
    fix1.status === 200 &&
      fix1.json.data.reward?.label === FIXED_LABEL &&
      fix1.json.data.reward?.mode === 'FIXED' &&
      !!fix1.json.data.scratch?.hasResult &&
      !!fix1.json.data.nextScratchAt,
    `status ${fix1.status}, label ${fix1.json?.data?.reward?.label}`
  );

  const fix1b = await call('/api/customer/scratch', { cookie: cFix1, body: { offerId: fixedId } });
  check(
    'Second reveal within 24h -> 429 COOLDOWN',
    fix1b.status === 429 && fix1b.json?.error?.code === 'COOLDOWN' && !!fix1b.json?.data?.nextScratchAt,
    `status ${fix1b.status}, code ${fix1b.json?.error?.code}`
  );
  check(
    'Default-offer COOLDOWN reports the 24h window it enforced',
    fix1b.json?.data?.cooldownHours === 24 && fix1b.json?.data?.scratch?.cooldownHours === 24,
    `cooldownHours=${fix1b.json?.data?.cooldownHours}`
  );

  // --- F2. Per-offer cooldown (merchant-configurable window) ---------------
  const shortId = shortCooldown.json?.data?.offer?.id;
  const cShort = await signInCustomer(cust('019'));
  const shortCtx = await call(`/api/customer/offers/${shortId}`, { method: 'GET', cookie: cShort });
  check(
    'Context advertises the offer-specific cooldown hours',
    shortCtx.status === 200 && shortCtx.json.data.offer.scratchCooldownHours === 6,
    `status ${shortCtx.status}, hours=${shortCtx.json?.data?.offer?.scratchCooldownHours}`
  );

  const short1 = await call('/api/customer/scratch', { cookie: cShort, body: { offerId: shortId } });
  check(
    'Custom-cooldown reveal -> 200',
    short1.status === 200 && short1.json?.data?.cooldownHours === 6,
    `status ${short1.status}, cooldownHours=${short1.json?.data?.cooldownHours}`
  );

  const short2 = await call('/api/customer/scratch', { cookie: cShort, body: { offerId: shortId } });
  check(
    'Second reveal blocked by the 6h window, not the 24h default',
    short2.status === 429 &&
      short2.json?.error?.code === 'COOLDOWN' &&
      short2.json?.data?.cooldownHours === 6 &&
      short2.json?.data?.scratch?.cooldownHours === 6,
    `status ${short2.status}, cooldownHours=${short2.json?.data?.cooldownHours}`
  );
  // The stored window really is 6h: nextScratchAt = scratchedAt + 6h, not + 24h.
  const shortNext = new Date(short2.json?.data?.nextScratchAt || 0).getTime();
  const shortLast = new Date(short2.json?.data?.scratch?.lastResult?.scratchedAt || 0).getTime();
  const shortSpanH = (shortNext - shortLast) / 3_600_000;
  check(
    'COOLDOWN expiry lands 6h after the reveal',
    Math.abs(shortSpanH - 6) < 0.05,
    `span=${shortSpanH.toFixed(3)}h`
  );

  const patchCooldown = await call(`/api/offers/${shortId}`, {
    method: 'PATCH',
    cookie: m1,
    body: { scratchCooldownHours: 48 },
  });
  check(
    'PATCH updates the reveal cooldown (48h)',
    patchCooldown.status === 200 &&
      patchCooldown.json?.data?.offer?.scratchCooldownHours === 48,
    `status ${patchCooldown.status}, hours=${patchCooldown.json?.data?.offer?.scratchCooldownHours}`
  );

  const patchCooldownBad = await call(`/api/offers/${shortId}`, {
    method: 'PATCH',
    cookie: m1,
    body: { scratchCooldownHours: 0 },
  });
  check(
    'PATCH out-of-range cooldown -> 422',
    patchCooldownBad.status === 422,
    `status ${patchCooldownBad.status}`
  );

  // A stamp offer must not accept the scratch-only cooldown field.
  const patchCooldownStamp = await call(`/api/offers/${stampId}`, {
    method: 'PATCH',
    cookie: m1,
    body: { scratchCooldownHours: 6 },
  });
  check(
    'PATCH cooldown on a stamp offer -> 422 OFFER_TYPE_MISMATCH',
    patchCooldownStamp.status === 422 &&
      patchCooldownStamp.json?.error?.code === 'OFFER_TYPE_MISMATCH',
    `status ${patchCooldownStamp.status}, code ${patchCooldownStamp.json?.error?.code}`
  );

  const ctxCooldown = await call(`/api/customer/offers/${fixedId}`, { method: 'GET', cookie: cFix1 });
  check(
    'Context after reveal: canScratch=false, last reward visible',
    ctxCooldown.json?.data?.scratch?.canScratch === false &&
      ctxCooldown.json?.data?.scratch?.lastResult?.rewardLabel === FIXED_LABEL &&
      ctxCooldown.json?.data?.card === null,
    JSON.stringify(ctxCooldown.json?.data?.scratch || {})
  );

  const fix2 = await call('/api/customer/scratch', { cookie: cFix2, body: { offerId: fixedId } });
  check(
    'FIXED reveal by 2nd customer -> same predetermined reward',
    fix2.status === 200 && fix2.json.data.reward?.label === FIXED_LABEL,
    `status ${fix2.status}, label ${fix2.json?.data?.reward?.label}`
  );

  // --- G. POOL rotation across customers -----------------------------------
  const p1 = await call('/api/customer/scratch', { cookie: cPool1, body: { offerId: poolId } });
  const p2 = await call('/api/customer/scratch', { cookie: cPool2, body: { offerId: poolId } });
  const p3 = await call('/api/customer/scratch', { cookie: cPool3, body: { offerId: poolId } });
  const drawn = [p1, p2, p3].map((r) => r.json?.data?.reward?.label);
  check(
    'POOL reveal #1 -> 200 with a pool reward',
    p1.status === 200 && POOL.includes(drawn[0]) && p1.json.data.reward?.mode === 'RANDOM_POOL',
    `status ${p1.status}, label ${drawn[0]}`
  );
  check(
    'POOL reveal #2 -> different consecutive reward',
    p2.status === 200 && POOL.includes(drawn[1]) && drawn[1] !== drawn[0],
    `drawn ${JSON.stringify(drawn)}`
  );
  check(
    'POOL rotation covers every reward once per cycle (3 customers, 3 labels)',
    p3.status === 200 &&
      POOL.includes(drawn[2]) &&
      drawn[2] !== drawn[1] &&
      new Set(drawn).size === 3,
    `drawn ${JSON.stringify(drawn)}`
  );

  // --- H. GPS guards on the scratch endpoint (m2 has a GPS branch) ----------
  const branch = await call('/api/branches', {
    cookie: m2,
    body: { branchName: 'Banani Branch', address: 'Banani, Dhaka', latitude: BRANCH.latitude, longitude: BRANCH.longitude },
  });
  check('Merchant 2 branch with GPS created (201)', branch.status === 201, `status ${branch.status}`);

  const geoOffer = await call('/api/offers', {
    cookie: m2,
    body: { offerType: 'SCRATCH', title: 'GPS Scratch Card', durationDays: 30, scratchMode: 'RANDOM_POOL', items: ['Free Cut', '20% Off'] },
  });
  const geoId = geoOffer.json?.data?.offer?.id;
  check('Merchant 2 scratch offer created', geoOffer.status === 201, `status ${geoOffer.status}`);

  const noGeo = await call('/api/customer/scratch', { cookie: cGeo, body: { offerId: geoId } });
  check(
    'Scratch without coordinates -> 422 NEED_LOCATION',
    noGeo.status === 422 && noGeo.json?.error?.code === 'NEED_LOCATION',
    `status ${noGeo.status}, code ${noGeo.json?.error?.code}`
  );

  const farGeo = await call('/api/customer/scratch', {
    cookie: cGeo,
    body: { offerId: geoId, latitude: FAR.latitude, longitude: FAR.longitude },
  });
  check(
    'Scratch far away -> 403 LOCATION_OUT_OF_RANGE',
    farGeo.status === 403 && farGeo.json?.error?.code === 'LOCATION_OUT_OF_RANGE',
    `status ${farGeo.status}, code ${farGeo.json?.error?.code}`
  );

  const nearGeo = await call('/api/customer/scratch', {
    cookie: cGeo,
    body: { offerId: geoId, latitude: NEAR.latitude, longitude: NEAR.longitude },
  });
  check(
    'Scratch within the fence -> 200 reveal with nearest branch',
    nearGeo.status === 200 && !!nearGeo.json.data.reward?.label && !!nearGeo.json.data.nearestBranch,
    `status ${nearGeo.status}, data ${JSON.stringify(nearGeo.json?.data?.reward || {})}`
  );

  // --- H2. Dice Roll offer: create -> roll once -> lifetime limit ------------
  const cDice1 = await signInCustomer(cust('018'));
  // Phone prefixes must match /^(?:\+88)?01[3-9]\d{8}$/ — 011/012 are not BD
  // numbers and the OTP send would 422, leaving an empty session cookie.
  const cDice2 = await signInCustomer(cust('013'));

  const diceBadBodies = [
    ['dice with 0 dice', { offerType: 'DICE', title: 'Zero Dice', durationDays: 30, diceCount: 0 }],
    ['dice with 6 dice', { offerType: 'DICE', title: 'Six Dice', durationDays: 30, diceCount: 6 }],
    ['dice-only field on a stamp offer', { offerType: 'STAMP', title: 'Stamp With Dice', rewardType: 'DISCOUNT', requiredStamps: 5, durationDays: 30, diceCount: 3 }],
    ['dice-only field on a scratch offer', { offerType: 'SCRATCH', title: 'Scratch With Dice', durationDays: 30, scratchMode: 'FIXED', items: ['A'], diceCount: 3 }],
  ];
  for (const [name, body] of diceBadBodies) {
    const res = await call('/api/offers', { cookie: m1, body });
    check(
      `422 on ${name}`,
      res.status === 422 && res.json?.error?.code === 'VALIDATION_ERROR',
      `status ${res.status}, code ${res.json?.error?.code}`
    );
  }

  const dice = await call('/api/offers', {
    cookie: m1,
    body: { offerType: 'DICE', title: 'Roll For A Discount', durationDays: 45, diceCount: 3 },
  });
  const diceId = dice.json?.data?.offer?.id;
  check(
    'DICE create -> 201 with offerType DICE, diceCount 3, stamp columns nulled',
    dice.status === 201 &&
      dice.json.data.offer.offerType === 'DICE' &&
      dice.json.data.offer.diceCount === 3 &&
      dice.json.data.offer.requiredStamps === null &&
      dice.json.data.offer.scratchItems?.length === 0,
    `status ${dice.status}, data ${JSON.stringify(dice.json?.data?.offer ?? dice.json)}`
  );

  // Context: dice state instead of card/scratch, and the configured count.
  const diceCtx = await call(`/api/customer/offers/${diceId}`, { method: 'GET', cookie: cDice1 });
  check(
    'Dice context: diceCount 3, canRoll true, card + scratch null',
    diceCtx.status === 200 &&
      diceCtx.json.data.offer.offerType === 'DICE' &&
      diceCtx.json.data.offer.diceCount === 3 &&
      diceCtx.json.data.dice?.canRoll === true &&
      diceCtx.json.data.dice?.hasRoll === false &&
      diceCtx.json.data.card === null &&
      diceCtx.json.data.scratch === null,
    `status ${diceCtx.status}, data ${JSON.stringify(diceCtx.json?.data ?? {})}`
  );

  // Social links: the merchant sets them in Settings, and the customer
  // context exposes them so every offer page can render the Google review
  // button + follow links.
  const socialsPatch = await call('/api/merchant/settings', {
    method: 'PATCH',
    cookie: m1,
    body: {
      websiteUrl: 'https://loyl.example',
      facebookUrl: 'https://facebook.com/loylshop',
      instagramUrl: 'https://instagram.com/loylshop',
    },
  });
  check(
    'Merchant saves social links -> 200',
    socialsPatch.status === 200,
    `status ${socialsPatch.status}`
  );
  const socialCtx = await call(`/api/customer/offers/${diceId}`, { method: 'GET', cookie: cDice1 });
  const sm = socialCtx.json?.data?.merchant;
  check(
    'Offer context exposes the merchant social links',
    socialCtx.status === 200 &&
      sm?.websiteUrl === 'https://loyl.example' &&
      sm?.facebookUrl === 'https://facebook.com/loylshop' &&
      sm?.instagramUrl === 'https://instagram.com/loylshop',
    JSON.stringify(sm)
  );

  // Roll #1 — total IS the discount percent.
  const roll1 = await call('/api/customer/dice', { cookie: cDice1, body: { offerId: diceId } });
  const r1 = roll1.json?.data?.roll;
  const r1Sum = (r1?.diceValues || []).reduce((a, b) => a + b, 0);
  check(
    'Dice roll #1 -> 200 with 3 faces, total = sum = discount %',
    roll1.status === 200 &&
      r1?.diceCount === 3 &&
      r1.diceValues.length === 3 &&
      r1.diceValues.every((v) => v >= 1 && v <= 6) &&
      r1.total === r1Sum &&
      r1.discountPercent === r1.total &&
      r1.discountPercent >= 3 &&
      r1.discountPercent <= 18 &&
      roll1.json.data.dice?.canRoll === false,
    `status ${roll1.status}, roll ${JSON.stringify(r1)}`
  );

  // Roll #2 (double submit / rescan) — refused by the DB-backed limit.
  const roll2 = await call('/api/customer/dice', { cookie: cDice1, body: { offerId: diceId } });
  check(
    'Second roll -> 409 ALREADY_ROLLED with the existing roll attached',
    roll2.status === 409 &&
      roll2.json?.error?.code === 'ALREADY_ROLLED' &&
      roll2.json?.data?.dice?.canRoll === false &&
      roll2.json?.data?.dice?.lastRoll?.total === r1?.total,
    `status ${roll2.status}, code ${roll2.json?.error?.code}, data ${JSON.stringify(roll2.json?.data)}`
  );

  // A refresh/rescan re-reads the same outcome — never a fresh roll.
  const diceCtx2 = await call(`/api/customer/offers/${diceId}`, { method: 'GET', cookie: cDice1 });
  check(
    'Context after the roll: canRoll false, same total (refresh cannot re-roll)',
    diceCtx2.json?.data?.dice?.canRoll === false &&
      diceCtx2.json?.data?.dice?.lastRoll?.total === r1?.total &&
      diceCtx2.json?.data?.dice?.lastRoll?.diceValues?.length === 3,
    JSON.stringify(diceCtx2.json?.data?.dice || {})
  );

  // The limit is per customer, not per offer.
  const rollOther = await call('/api/customer/dice', { cookie: cDice2, body: { offerId: diceId } });
  check(
    'A second customer rolls the same offer -> 200',
    rollOther.status === 200 && rollOther.json?.data?.roll?.diceValues?.length === 3,
    `status ${rollOther.status}`
  );

  // --- H3. Dice cross-type guards + one-time limit ---------------------------
  const scanOnDice = await call('/api/customer/scan', { cookie: cDice1, body: { offerId: diceId } });
  check(
    'scan on DICE offer -> 409 WRONG_OFFER_TYPE',
    scanOnDice.status === 409 && scanOnDice.json?.error?.code === 'WRONG_OFFER_TYPE',
    `status ${scanOnDice.status}, code ${scanOnDice.json?.error?.code}`
  );
  const redeemOnDice = await call('/api/customer/redeem', { cookie: cDice1, body: { offerId: diceId } });
  check(
    'redeem on DICE offer -> 409 WRONG_OFFER_TYPE',
    redeemOnDice.status === 409 && redeemOnDice.json?.error?.code === 'WRONG_OFFER_TYPE',
    `status ${redeemOnDice.status}`
  );
  const reviewOnDice = await call('/api/customer/review', { cookie: cDice1, body: { offerId: diceId } });
  check(
    'review on DICE offer -> 409 WRONG_OFFER_TYPE',
    reviewOnDice.status === 409 && reviewOnDice.json?.error?.code === 'WRONG_OFFER_TYPE',
    `status ${reviewOnDice.status}`
  );
  const scratchOnDice = await call('/api/customer/scratch', { cookie: cDice1, body: { offerId: diceId } });
  check(
    'scratch on DICE offer -> 409 WRONG_OFFER_TYPE (data.offerType=DICE)',
    scratchOnDice.status === 409 &&
      scratchOnDice.json?.error?.code === 'WRONG_OFFER_TYPE' &&
      scratchOnDice.json?.data?.offerType === 'DICE',
    `status ${scratchOnDice.status}`
  );
  const diceOnStamp = await call('/api/customer/dice', { cookie: cDice1, body: { offerId: stampId } });
  check(
    'dice roll on STAMP offer -> 409 WRONG_OFFER_TYPE (data.offerType=STAMP)',
    diceOnStamp.status === 409 &&
      diceOnStamp.json?.error?.code === 'WRONG_OFFER_TYPE' &&
      diceOnStamp.json?.data?.offerType === 'STAMP',
    `status ${diceOnStamp.status}, data ${JSON.stringify(diceOnStamp.json?.data)}`
  );
  const diceOnScratch = await call('/api/customer/dice', { cookie: cDice1, body: { offerId: fixedId } });
  check(
    'dice roll on SCRATCH offer -> 409 WRONG_OFFER_TYPE (data.offerType=SCRATCH)',
    diceOnScratch.status === 409 &&
      diceOnScratch.json?.error?.code === 'WRONG_OFFER_TYPE' &&
      diceOnScratch.json?.data?.offerType === 'SCRATCH',
    `status ${diceOnScratch.status}`
  );

  // Paused: refused with the customer's (empty) roll state attached.
  await call(`/api/offers/${diceId}`, { method: 'PATCH', cookie: m1, body: { isActive: false } });
  const rollPaused = await call('/api/customer/dice', { cookie: cDice2, body: { offerId: diceId } });
  check(
    'Roll on a paused DICE offer -> 409 OFFER_PAUSED',
    rollPaused.status === 409 && rollPaused.json?.error?.code === 'OFFER_PAUSED',
    `status ${rollPaused.status}, code ${rollPaused.json?.error?.code}`
  );
  await call(`/api/offers/${diceId}`, { method: 'PATCH', cookie: m1, body: { isActive: true } });

  // --- H4. Dice PATCH rules --------------------------------------------------
  const diceTypeChange = await call(`/api/offers/${diceId}`, {
    method: 'PATCH',
    cookie: m1,
    body: { offerType: 'STAMP' },
  });
  check(
    'PATCH dice -> STAMP rejected 422 OFFER_TYPE_IMMUTABLE',
    diceTypeChange.status === 422 && diceTypeChange.json?.error?.code === 'OFFER_TYPE_IMMUTABLE',
    `status ${diceTypeChange.status}, code ${diceTypeChange.json?.error?.code}`
  );

  const dicePatch = await call(`/api/offers/${diceId}`, {
    method: 'PATCH',
    cookie: m1,
    body: { title: 'Roll For A Discount v2', diceCount: 5 },
  });
  check(
    'PATCH dice updates title + diceCount (5)',
    dicePatch.status === 200 &&
      dicePatch.json?.data?.offer?.title === 'Roll For A Discount v2' &&
      dicePatch.json?.data?.offer?.diceCount === 5,
    `status ${dicePatch.status}, diceCount=${dicePatch.json?.data?.offer?.diceCount}`
  );

  const dicePatchBad = await call(`/api/offers/${diceId}`, {
    method: 'PATCH',
    cookie: m1,
    body: { diceCount: 9 },
  });
  check('PATCH out-of-range diceCount -> 422', dicePatchBad.status === 422, `status ${dicePatchBad.status}`);

  const stampDiceField = await call(`/api/offers/${stampId}`, {
    method: 'PATCH',
    cookie: m1,
    body: { diceCount: 3 },
  });
  check(
    'PATCH diceCount on a stamp offer -> 422 OFFER_TYPE_MISMATCH',
    stampDiceField.status === 422 && stampDiceField.json?.error?.code === 'OFFER_TYPE_MISMATCH',
    `status ${stampDiceField.status}, code ${stampDiceField.json?.error?.code}`
  );

  const diceForeign = await call(`/api/offers/${diceId}`, {
    method: 'PATCH',
    cookie: m2,
    body: { title: 'Hijacked Dice' },
  });
  check('Cross-merchant PATCH of dice offer -> 404', diceForeign.status === 404, `status ${diceForeign.status}`);

  // --- H5. Dice offer analytics (rolls count as activity) -------------------
  const diceAnalytics = await call('/api/merchant/analytics', { method: 'GET', cookie: m1 });
  const dicePerf = (diceAnalytics.json?.data?.offers || []).find((o) => o.offerId === diceId);
  check(
    'Analytics totals count dice rolls',
    diceAnalytics.status === 200 && diceAnalytics.json?.data?.totals?.diceRolls >= 2,
    `status ${diceAnalytics.status}, diceRolls=${diceAnalytics.json?.data?.totals?.diceRolls}`
  );
  check(
    'Offer performance lists the dice offer with a Dice pill row',
    !!dicePerf && dicePerf.offerType === 'DICE' && dicePerf.diceRolls >= 1,
    JSON.stringify(dicePerf || 'missing')
  );

  // --- H6. GPS guards on the dice endpoint ----------------------------------
  const geoDice = await call('/api/offers', {
    cookie: m2,
    body: { offerType: 'DICE', title: 'GPS Dice Roll', durationDays: 30, diceCount: 2 },
  });
  const geoDiceId = geoDice.json?.data?.offer?.id;
  check('Merchant 2 dice offer created', geoDice.status === 201, `status ${geoDice.status}`);

  const cDiceGeo = await signInCustomer(cust('016'));
  const diceNoGeo = await call('/api/customer/dice', { cookie: cDiceGeo, body: { offerId: geoDiceId } });
  check(
    'Dice roll without coordinates -> 422 NEED_LOCATION',
    diceNoGeo.status === 422 && diceNoGeo.json?.error?.code === 'NEED_LOCATION',
    `status ${diceNoGeo.status}, code ${diceNoGeo.json?.error?.code}`
  );

  const diceFar = await call('/api/customer/dice', {
    cookie: cDiceGeo,
    body: { offerId: geoDiceId, latitude: FAR.latitude, longitude: FAR.longitude },
  });
  check(
    'Dice roll far away -> 403 LOCATION_OUT_OF_RANGE',
    diceFar.status === 403 && diceFar.json?.error?.code === 'LOCATION_OUT_OF_RANGE',
    `status ${diceFar.status}, code ${diceFar.json?.error?.code}`
  );

  const diceNear = await call('/api/customer/dice', {
    cookie: cDiceGeo,
    body: { offerId: geoDiceId, latitude: NEAR.latitude, longitude: NEAR.longitude },
  });
  check(
    'Dice roll within the fence -> 200 with nearest branch',
    diceNear.status === 200 &&
      diceNear.json?.data?.roll?.diceValues?.length === 2 &&
      !!diceNear.json.data.nearestBranch,
    `status ${diceNear.status}, data ${JSON.stringify(diceNear.json?.data ?? diceNear.json)}`
  );

  // --- I. Stamp regression (scan -> PENDING -> app-only approval -> stamp) --
  // Phase 9/10: a scan never stamps. It opens a PENDING check-in that only the
  // merchant's app may approve (Ed25519 proof in `x-loyl-device`); a plain web
  // session is rejected with 403 APP_APPROVAL_REQUIRED by design.
  const scan1 = await call('/api/customer/scan', { cookie: cFix1, body: { offerId: stampId } });
  const pendingId = scan1.json?.data?.request?.id;
  check(
    'Stamp scan opens a PENDING check-in (no instant stamp, card untouched)',
    scan1.status === 200 &&
      scan1.json?.data?.requested === true &&
      scan1.json?.data?.request?.status === 'PENDING' &&
      scan1.json?.data?.card?.stampsCollected === 0 &&
      scan1.json?.data?.card?.exists === false,
    `status ${scan1.status}, data ${JSON.stringify(scan1.json?.data?.request ?? scan1.json)}`
  );

  // Phase 12: the request has to actually ARRIVE at the merchant, not just
  // exist in the customer's response. This is the "merchant sees a pending
  // check-in" contract the /requests page polls for.
  const arrived = await call('/api/merchant/scan-requests?status=PENDING', { method: 'GET', cookie: m1 });
  const arrivedRow = (arrived.json?.data?.requests || []).find((r) => r.id === pendingId);
  check(
    'Pending check-in ARRIVES in the merchant queue with the customer name',
    arrived.status === 200 &&
      arrived.json?.data?.pendingCount >= 1 &&
      !!arrivedRow &&
      arrivedRow.customerPhone === C_FIXED1 &&
      arrivedRow.customerName === 'Smoke Customer',
    `status ${arrived.status}, pendingCount ${arrived.json?.data?.pendingCount}, row ${JSON.stringify(arrivedRow ?? null)}`
  );

  // Phase 12: a customer who has ONLY scanned (no approved stamp yet) must be
  // visible on /customers — previously the list read CustomerStamp alone, so a
  // scan-only customer was invisible and the name was never shown at all.
  const custList = await call(`/api/merchant/customers?q=${C_FIXED1}`, { method: 'GET', cookie: m1 });
  const seen = (custList.json?.data?.customers || [])[0];
  check(
    'Scan-only customer appears on /customers with name, scan count and pending badge',
    custList.status === 200 &&
      !!seen &&
      seen.customerPhone === C_FIXED1 &&
      seen.customerName === 'Smoke Customer' &&
      seen.scanCount >= 1 &&
      seen.pendingCount >= 1,
    `status ${custList.status}, row ${JSON.stringify(seen ?? null)}`
  );

  // Phase 12: the search matches names too, not only phone fragments.
  const byName = await call('/api/merchant/customers?q=Smoke%20Customer', { method: 'GET', cookie: m1 });
  check(
    'Customer search matches the NAME as well as the phone',
    byName.status === 200 &&
      (byName.json?.data?.customers || []).some((r) => r.customerPhone === C_FIXED1),
    `status ${byName.status}, rows ${(byName.json?.data?.customers || []).length}`
  );

  const webApprove = await call(`/api/merchant/scan-requests/${pendingId}`, { cookie: m1 });
  check(
    'Web session approval -> 403 APP_APPROVAL_REQUIRED',
    webApprove.status === 403 && webApprove.json?.error?.code === 'APP_APPROVAL_REQUIRED',
    `status ${webApprove.status}, code ${webApprove.json?.error?.code}`
  );

  const device = await registerDevice({
    cookie: m1,
    merchantId: merchantIdByLabel.get('Stamp & Scratch Café'),
    deviceName: 'Offer-Type Smoke Phone',
  });
  check(
    'Device registered (201), public key only',
    device.status === 201 && !!device.deviceId && !JSON.stringify(device.json).includes('"d":'),
    `status ${device.status}, device ${device.deviceId}`
  );

  const approve = await approveCheckIn({
    cookie: m1,
    signer: device.signer,
    deviceId: device.deviceId,
    requestId: pendingId,
  });
  check(
    'App-signed approval lands the stamp (1/2, attributed to the device)',
    approve.status === 200 &&
      approve.json?.data?.request?.status === 'APPROVED' &&
      approve.json?.data?.request?.approvedByDeviceId === device.deviceId &&
      approve.json?.data?.card?.stampsCollected === 1,
    `status ${approve.status}, data ${JSON.stringify(approve.json?.data ?? approve.json)}`
  );

  // Phase 12: after approval the same customer must read as a *card holder*
  // (stamps filled, pending cleared) while the scan history is preserved —
  // i.e. the union merges rather than double-counts or drops either side.
  // Phase 13: `scanCount` now counts every visit, so it is 1 stamp scan + 1
  // scratch reveal for this phone. The merge is still asserted by the row
  // count below — a duplicate row would make it 2 for one unique phone.
  const afterApprove = await call(`/api/merchant/customers?q=${C_FIXED1}`, { method: 'GET', cookie: m1 });
  const mergedRows = afterApprove.json?.data?.customers || [];
  const merged = mergedRows[0];
  check(
    'After approval the row is a card holder: 1 stamp, 2 check-ins, 0 pending, name kept',
    afterApprove.status === 200 &&
      mergedRows.length === 1 &&
      !!merged &&
      merged.customerName === 'Smoke Customer' &&
      merged.stampsCollected === 1 &&
      merged.scanCount === 2 &&
      merged.pendingCount === 0,
    `status ${afterApprove.status}, rows ${mergedRows.length}, row ${JSON.stringify(merged ?? null)}`
  );

  const cards = await call('/api/customer/cards', { method: 'GET', cookie: cFix1 });
  const cardOffers = (cards.json?.data?.cards || []).map((c) => c.offer?.id).filter(Boolean);
  check(
    'Cards list pairs the stamp card with the STAMP offer only',
    cards.status === 200 &&
      cardOffers.includes(stampId) &&
      !cardOffers.includes(fixedId) &&
      !cardOffers.includes(poolId),
    `status ${cards.status}, offers ${JSON.stringify(cardOffers)}`
  );

  const legacyScan = await call('/api/customer/scan', { cookie: cFix2, body: { offerId: legacyId } });
  check(
    'Legacy-created stamp offer scans (offerType default works end-to-end)',
    legacyScan.status === 200,
    `status ${legacyScan.status}`
  );

  // --- J. Auth lockdown -----------------------------------------------------
  const unauthScratch = await call('/api/customer/scratch', { body: { offerId: poolId } });
  check(
    'Unauth POST /api/customer/scratch -> 401 UNAUTHORIZED',
    unauthScratch.status === 401 && unauthScratch.json?.error?.code === 'UNAUTHORIZED',
    `status ${unauthScratch.status}`
  );

  const unauthOffers = await call('/api/offers', { body: {} });
  check(
    'Unauth POST /api/offers -> 401 UNAUTHORIZED',
    unauthOffers.status === 401 && unauthOffers.json?.error?.code === 'UNAUTHORIZED',
    `status ${unauthOffers.status}`
  );

  const unauthDice = await call('/api/customer/dice', { body: { offerId: 'any' } });
  check(
    'Unauth POST /api/customer/dice -> 401 UNAUTHORIZED',
    unauthDice.status === 401 && unauthDice.json?.error?.code === 'UNAUTHORIZED',
    `status ${unauthDice.status}`
  );

  // --- K. Page renders (merchant pages need the session cookie; /scan is public)
  await pageRenders('/offers/new', m1);
  await pageRenders(`/offers/${fixedId}`, m1);
  await pageRenders(`/offers/${fixedId}/qr`, m1);
  await pageRenders(`/offers/${diceId}`, m1);
  await pageRenders(`/offers/${diceId}/qr`, m1);
  await pageRenders(`/scan/${poolId}`);
  await pageRenders(`/scan/${stampId}`);
  await pageRenders(`/scan/${diceId}`);

  // --- Summary --------------------------------------------------------------
  console.log('\n' + results.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('\nSmoke test crashed:', err);
  console.log('\n' + results.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
  process.exit(1);
});
