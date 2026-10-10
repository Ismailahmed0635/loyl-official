/**
 * Phase 4 — Analytics & Settings smoke test
 * Spec: phases.md Phase 4 + LOYLS_APP_REQUIREMENTS §2/§6.
 *
 * Flow: fresh merchant signup -> create stamp + scratch offers -> analytics
 *       baseline (zeros) -> range validation 422s -> CSV export headers ->
 *       customer activity (scan opens a check-in, app approval stamps it,
 *       review bonus, blocked re-scan, redeem, scratch)
 *       -> analytics totals + per-offer breakdown reflect every event ->
 *       customers list/search/pagination -> settings GET/PATCH validation +
 *       persistence -> auth lockdown (401/403/409) -> page renders.
 *
 * Usage: node scripts/phase4-smoke.mjs [baseUrl]
 */

const BASE = process.argv[2] || 'http://localhost:3111';
import { registerDevice, approveCheckIn } from './device-approval.mjs';
import { mintSession, signUpMerchant as signUpMerchantHelper, signInCustomer as signInCustomerHelper, grantActiveSubscription } from './test-session.mjs';
const RUN = Date.now().toString(36);

const M_PHONE = '017' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const TEMP_PHONE = '018' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const cust = (p) => p + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const C1 = cust('019');
const C2 = cust('016');

const STAMP_LABEL = 'Phase4 Stamp Café';
const STAMP_OFFER = 'Buy 2 Coffees Get 1 Free';
const SCRATCH_OFFER = 'Phase4 Scratch Dessert';
const SCRATCH_ITEM = 'Free Dessert (Phase4)';

const dayKey = (offsetDays = 0) =>
  new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const TODAY = dayKey(0);

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
    /* non-JSON (e.g. CSV) */
  }
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return { status: res.status, json, setCookie, headers: res.headers };
}

/** Fetch a non-JSON endpoint (CSV export) as raw text. */
async function fetchText(path, cookie) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, { headers }).catch(() => null);
  const body = res ? await res.text().catch(() => '') : '';
  return res ? { status: res.status, headers: res.headers, body } : null;
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

/** The signed-up merchant's id — the device proof binds to it (Phase 10). */
let merchantId = null;

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
  merchantId = merchant?.id ?? null;
  // Fresh signups are on the free trial (scratch only) — this suite builds
  // stamp offers, so grant the plan an admin approval would have granted.
  await grantActiveSubscription(merchant.id);
  return cookie;
}

/** Email session without a merchant profile (business setup never completed). */
async function signUpTemp(email) {
  return `loyl_session=${await mintSession({ userId: `temp_${RUN}`, phoneNumber: '', email })}`;
}

/** Signs a customer in (name + phone, collected — no OTP). */
async function signInCustomer(phone) {
  const { cookie } = await signInCustomerHelper((p, o) => call(p, o), { name: 'Smoke Customer', phone });
  return cookie;
}

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

async function getAnalytics(mCookie, from, to) {
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  const suffix = qs.toString() ? `?${qs}` : '';
  return call(`/api/merchant/analytics${suffix}`, { method: 'GET', cookie: mCookie });
}

async function main() {
  console.log(`Phase 4 smoke test against ${BASE}\n`);

  // --- Server reachable -----------------------------------------------------
  const home = await fetch(BASE + '/').catch(() => null);
  check('Dev server responds on /', !!home && home.status < 500, home ? `status ${home.status}` : 'no response');

  // --- Sessions -------------------------------------------------------------
  const merchant = await signUpMerchant(STAMP_LABEL, M_PHONE);
  const c1 = await signInCustomer(C1);
  const c2 = await signInCustomer(C2);
  const temp = await signUpTemp(`temp-${RUN}@example.com`);
  check('Customer + temp sessions issued', !!(c1 && c2 && temp));

  // --- Setup: one offer of each type ---------------------------------------
  const stamp = await call('/api/offers', {
    cookie: merchant,
    body: {
      offerType: 'STAMP',
      title: STAMP_OFFER,
      rewardType: 'FREE_ITEM',
      requiredStamps: 2,
      durationDays: 30,
    },
  });
  const stampId = stamp.json?.data?.offer?.id;
  check('Stamp offer created (201)', stamp.status === 201 && !!stampId, `status ${stamp.status}`);

  const scratch = await call('/api/offers', {
    cookie: merchant,
    body: {
      offerType: 'SCRATCH',
      title: SCRATCH_OFFER,
      durationDays: 60,
      scratchMode: 'FIXED',
      items: [SCRATCH_ITEM],
    },
  });
  const scratchId = scratch.json?.data?.offer?.id;
  check('Scratch offer created (201)', scratch.status === 201 && !!scratchId, `status ${scratch.status}`);

  // --- A. Analytics baseline + range validation ----------------------------
  const baseline = await getAnalytics(merchant);
  const bData = baseline.json?.data;
  const bTotals = bData?.totals;
  check(
    'GET /api/merchant/analytics default range (200, zeroed totals)',
    baseline.status === 200 &&
      Array.isArray(bData?.series) &&
      bData.series.length === bData?.range?.days &&
      bTotals?.scans === 0 &&
      bTotals?.newCustomers === 0 &&
      bTotals?.uniqueVisitors === 0 &&
      bTotals?.redemptionRate === 0,
    `status ${baseline.status}, totals ${JSON.stringify(bTotals)}`
  );

  const validations = [
    ['from only', `from=${TODAY}`],
    ['reversed range', `from=${dayKey(1)}&to=${TODAY}`],
    ['malformed date', 'from=09/01/2026&to=2026-09-24'],
    ['impossible calendar date', `from=2026-02-31&to=${TODAY}`],
    ['range over 366 days', `from=${dayKey(-400)}&to=${TODAY}`],
    ['unknown format', 'format=xml'],
  ];
  for (const [label, qs] of validations) {
    const r = await call(`/api/merchant/analytics?${qs}`, { method: 'GET', cookie: merchant });
    check(`Analytics rejects ${label} (422)`, r.status === 422, `status ${r.status}`);
  }

  const oneDay = await getAnalytics(merchant, TODAY, TODAY);
  check(
    'Explicit single-day range (200, days 1, series length 1)',
    oneDay.status === 200 &&
      oneDay.json.data.range.days === 1 &&
      oneDay.json.data.series.length === 1 &&
      oneDay.json.data.series[0].date === TODAY,
    `status ${oneDay.status}, days ${oneDay.json?.data?.range?.days}`
  );

  // --- B. CSV export --------------------------------------------------------
  const csvEmpty = await fetchText(
    `/api/merchant/analytics?format=csv&from=${TODAY}&to=${TODAY}`,
    merchant
  );
  const csvHeader = csvEmpty?.headers.get('content-type') || '';
  const disposition = csvEmpty?.headers.get('content-disposition') || '';
  check(
    'CSV export responds 200 with text/csv',
    csvEmpty?.status === 200 && csvHeader.includes('text/csv'),
    `status ${csvEmpty?.status}, type ${csvHeader}`
  );
  check(
    'CSV export sends an attachment filename',
    /^attachment;.*filename="loyl-analytics-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv"/.test(
      disposition
    ),
    disposition
  );
  check(
    'CSV body has the header row and a total row',
    csvEmpty?.body.startsWith(
      'date,scans,review_bonuses,redeems,scratch_reveals,dice_rolls,new_customers,unique_visitors'
    ) &&
      /\r\ntotal,/.test(csvEmpty.body),
    (csvEmpty?.body || '').slice(0, 80)
  );

  // --- C. Customer activity feeds analytics --------------------------------
  // Phase 9/10: a scan only opens a PENDING check-in — analytics counts the
  // SCAN when the merchant's app approves it, which is also when the card row
  // (and therefore the new customer) comes into existence.
  const device = await registerDevice({
    cookie: merchant,
    merchantId,
    deviceName: 'Phase4 Phone',
  });
  check(
    'Merchant app device registered (201)',
    device.status === 201 && !!device.deviceId,
    `status ${device.status}, device ${device.deviceId}`
  );

  const scan1 = await call('/api/customer/scan', { cookie: c1, body: { offerId: stampId } });
  check(
    'C1 scan (no branch yet -> GPS not required) opens a PENDING check-in',
    scan1.status === 200 && scan1.json.data.requested === true && scan1.json.data.request.status === 'PENDING',
    `status ${scan1.status}`
  );
  check(
    'C1 scan stamps nothing before approval',
    scan1.json.data.card.stampsCollected === 0 && scan1.json.data.card.exists === false,
    JSON.stringify(scan1.json.data.card)
  );

  const approve1 = await approveCheckIn({
    cookie: merchant,
    signer: device.signer,
    deviceId: device.deviceId,
    requestId: scan1.json?.data?.request?.id,
  });
  check(
    'C1 approval stamps 1/2 and records the device',
    approve1.status === 200 &&
      approve1.json.data.card.stampsCollected === 1 &&
      approve1.json.data.request.approvedByDeviceId === device.deviceId,
    `status ${approve1.status}`
  );

  const interim = await getAnalytics(merchant, TODAY, TODAY);
  const iTotals = interim.json?.data?.totals;
  check(
    'Interim analytics: scan + new customer recorded',
    iTotals?.scans === 1 && iTotals?.newCustomers === 1 && iTotals?.uniqueVisitors === 1,
    JSON.stringify(iTotals)
  );

  const review = await call('/api/customer/review', { cookie: c1, body: { offerId: stampId } });
  check(
    'C1 review bonus (card completes to 2/2)',
    review.status === 200 && review.json.data.card.stampsCollected === 2,
    `status ${review.status}`
  );

  const cooldown = await call('/api/customer/scan', { cookie: c1, body: { offerId: stampId } });
  check(
    'C1 re-scan blocked on a full card (409 CARD_COMPLETE)',
    cooldown.status === 409 && cooldown.json?.error?.code === 'CARD_COMPLETE',
    `status ${cooldown.status}, code ${cooldown.json?.error?.code}`
  );

  const afterCooldown = await getAnalytics(merchant, TODAY, TODAY);
  const cTotals = afterCooldown.json?.data?.totals;
  check(
    'Blocked scan recorded no extra event (scans still 1)',
    cTotals?.scans === 1 && cTotals?.reviewBonuses === 1,
    JSON.stringify(cTotals)
  );

  const redeem = await call('/api/customer/redeem', { cookie: c1, body: { offerId: stampId } });
  check(
    'C1 redeems reward (card resets, totalRedeemed 1)',
    redeem.status === 200 &&
      redeem.json.data.card.stampsCollected === 0 &&
      redeem.json.data.card.totalRedeemed === 1,
    `status ${redeem.status}`
  );

  const scan2 = await call('/api/customer/scan', { cookie: c2, body: { offerId: stampId } });
  check(
    'C2 scan opens a PENDING check-in (second new customer)',
    scan2.status === 200 && scan2.json.data.requested === true,
    `status ${scan2.status}`
  );
  const approve2 = await approveCheckIn({
    cookie: merchant,
    signer: device.signer,
    deviceId: device.deviceId,
    requestId: scan2.json?.data?.request?.id,
  });
  check(
    'C2 approval stamps 1/2',
    approve2.status === 200 && approve2.json.data.card.stampsCollected === 1,
    `status ${approve2.status}`
  );

  const scratchReveal = await call('/api/customer/scratch', {
    cookie: c1,
    body: { offerId: scratchId },
  });
  check('C1 scratches the scratch offer (200)', scratchReveal.status === 200, `status ${scratchReveal.status}`);

  // --- D. Final analytics: totals, series, per-offer breakdown -------------
  const final = await getAnalytics(merchant, TODAY, TODAY);
  const fData = final.json?.data;
  const fTotals = fData?.totals;
  check(
    'Final totals: scans 2, review 1, redeems 1, scratch 1, new 2, visitors 2, rate 50%',
    fTotals?.scans === 2 &&
      fTotals?.reviewBonuses === 1 &&
      fTotals?.redeems === 1 &&
      fTotals?.scratchReveals === 1 &&
      fTotals?.newCustomers === 2 &&
      fTotals?.uniqueVisitors === 2 &&
      fTotals?.returningCustomers === 0 && // both cards created inside the range
      fTotals?.redemptionRate === 50,
    JSON.stringify(fTotals)
  );
  check(
    'Series point for today matches the totals',
    fData?.series?.[0]?.date === TODAY &&
      fData.series[0].scans === 2 &&
      fData.series[0].reviewBonuses === 1 &&
      fData.series[0].redeems === 1 &&
      fData.series[0].scratchReveals === 1 &&
      fData.series[0].newCustomers === 2,
    JSON.stringify(fData?.series?.[0])
  );

  const stampRow = (fData?.offers || []).find((o) => o.offerId === stampId);
  const scratchRow = (fData?.offers || []).find((o) => o.offerId === scratchId);
  check(
    'Stamp offer breakdown: 2 scans, 1 review, 1 redeem, 2 visitors',
    stampRow?.scans === 2 &&
      stampRow?.reviewBonuses === 1 &&
      stampRow?.redeems === 1 &&
      stampRow?.uniqueVisitors === 2 &&
      stampRow?.offerType === 'STAMP',
    JSON.stringify(stampRow)
  );
  check(
    'Scratch offer breakdown: 1 reveal, 1 visitor, SCRATCH type',
    scratchRow?.scratchReveals === 1 &&
      scratchRow?.uniqueVisitors === 1 &&
      scratchRow?.offerType === 'SCRATCH',
    JSON.stringify(scratchRow)
  );

  const csvFull = await fetchText(
    `/api/merchant/analytics?format=csv&from=${TODAY}&to=${TODAY}`,
    merchant
  );
  const totalLine = (csvFull?.body || '').split(/\r\n/).find((line) => line.startsWith('total,'));
  check(
    'CSV total row reflects activity (scans 2, redeems 1, scratch 1, dice 0)',
    totalLine === 'total,2,1,1,1,0,2,2',
    totalLine || 'no total row'
  );

  // --- E. Customers list ----------------------------------------------------
  const customers = await call('/api/merchant/customers', { method: 'GET', cookie: merchant });
  const custPhones = (customers.json?.data?.customers || []).map((row) => row.customerPhone);
  check(
    'GET /api/merchant/customers lists both customers with stamps/rewards',
    customers.status === 200 &&
      custPhones.includes(C1) &&
      custPhones.includes(C2) &&
      customers.json.data.stats.totalCustomers >= 2 &&
      customers.json.data.customers.every((row) => typeof row.stampsCollected === 'number'),
    `status ${customers.status}, phones ${JSON.stringify(custPhones)}`
  );

  const search = await call(`/api/merchant/customers?q=${C1}`, { method: 'GET', cookie: merchant });
  const searchPhones = (search.json?.data?.customers || []).map((row) => row.customerPhone);
  check(
    'Customer search ?q= filters to the matching phone only',
    search.status === 200 &&
      searchPhones.length === 1 &&
      searchPhones[0] === C1 &&
      search.json.data.pagination.total === 1,
    JSON.stringify(searchPhones)
  );

  const paged = await call('/api/merchant/customers?page=1&pageSize=1', {
    method: 'GET',
    cookie: merchant,
  });
  check(
    'Customer pagination ?pageSize=1 (total 2, totalPages 2)',
    paged.status === 200 &&
      paged.json.data.customers.length === 1 &&
      paged.json.data.pagination.total === 2 &&
      paged.json.data.pagination.totalPages === 2,
    JSON.stringify(paged.json?.data?.pagination)
  );

  const badPage = await call('/api/merchant/customers?page=0', { method: 'GET', cookie: merchant });
  check('Customer list rejects page=0 (422)', badPage.status === 422, `status ${badPage.status}`);

  // --- F. Settings ----------------------------------------------------------
  const settings = await call('/api/merchant/settings', { method: 'GET', cookie: merchant });
  check(
    'GET /api/merchant/settings returns the profile + social link columns',
    settings.status === 200 &&
      settings.json.data.merchant.phoneNumber === M_PHONE &&
      settings.json.data.merchant.businessName === STAMP_LABEL &&
      'websiteUrl' in settings.json.data.merchant &&
      'facebookUrl' in settings.json.data.merchant,
    `status ${settings.status}`
  );

  const patchValidations = [
    ['empty body', {}],
    ['too-short business name', { businessName: 'X' }],
    ['blank category', { category: '' }],
    ['non-http(s) social link', { websiteUrl: 'ftp://example.com' }],
    ['malformed website URL', { websiteUrl: 'not-a-url' }],
  ];
  for (const [label, body] of patchValidations) {
    const r = await call('/api/merchant/settings', { method: 'PATCH', cookie: merchant, body });
    check(`PATCH settings rejects ${label} (422)`, r.status === 422, `status ${r.status}`);
  }

  const patch = await call('/api/merchant/settings', {
    method: 'PATCH',
    cookie: merchant,
    body: {
      businessName: 'Phase4 Renamed Cafe',
      category: 'Salon & Spa',
      websiteUrl: 'https://example.com',
      facebookUrl: 'https://facebook.com/phase4loyl',
      instagramUrl: '',
    },
  });
  const patched = patch.json?.data?.merchant;
  check(
    'PATCH settings saves profile + links; empty string clears a link to null',
    patch.status === 200 &&
      patched?.businessName === 'Phase4 Renamed Cafe' &&
      patched?.category === 'Salon & Spa' &&
      patched?.websiteUrl === 'https://example.com' &&
      patched?.facebookUrl === 'https://facebook.com/phase4loyl' &&
      patched?.instagramUrl === null,
    `status ${patch.status}, ${JSON.stringify({ name: patched?.businessName, ig: patched?.instagramUrl })}`
  );

  const reget = await call('/api/merchant/settings', { method: 'GET', cookie: merchant });
  check(
    'Settings persist across requests',
    reget.json?.data?.merchant?.businessName === 'Phase4 Renamed Cafe' &&
      reget.json?.data?.merchant?.websiteUrl === 'https://example.com',
    JSON.stringify(reget.json?.data?.merchant?.businessName)
  );

  const clear = await call('/api/merchant/settings', {
    method: 'PATCH',
    cookie: merchant,
    body: { websiteUrl: '' },
  });
  check(
    'Clearing a link with an empty string persists as null',
    clear.status === 200 && clear.json.data.merchant.websiteUrl === null,
    `status ${clear.status}`
  );

  // --- G2. Logo upload (gallery file, replaces the old logoUrl field) --------
  const PNG_1X1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  async function uploadLogo(bytes, type, filename) {
    const form = new FormData();
    form.append('logo', new Blob([bytes], { type }), filename);
    const res = await fetch(BASE + '/api/merchant/logo', {
      method: 'POST',
      headers: { Cookie: merchant },
      body: form,
      redirect: 'manual',
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* non-JSON */
    }
    return { status: res.status, json };
  }
  const badLogo = await uploadLogo(Buffer.from('not an image'), 'image/png', 'evil.png');
  check(
    'Logo upload rejects polyglot bytes -> 422 INVALID_FILE_TYPE',
    badLogo.status === 422 && badLogo.json?.error?.code === 'INVALID_FILE_TYPE',
    `status ${badLogo.status}, code ${badLogo.json?.error?.code}`
  );
  const logoUp = await uploadLogo(PNG_1X1, 'image/png', 'logo.png');
  check(
    'Logo upload (PNG) -> 201 with public logoUrl',
    logoUp.status === 201 &&
      typeof logoUp.json?.data?.logoUrl === 'string' &&
      logoUp.json.data.logoUrl.startsWith('/api/public/logo/'),
    `status ${logoUp.status}`
  );
  const ownLogo = await fetch(BASE + '/api/merchant/logo', {
    headers: { Cookie: merchant },
    redirect: 'manual',
  });
  check(
    'Own logo streams back -> 200 image/png',
    ownLogo.status === 200 && (ownLogo.headers.get('content-type') || '').includes('image/png'),
    `status ${ownLogo.status}`
  );
  const logoDel = await call('/api/merchant/logo', { method: 'DELETE', cookie: merchant });
  check('Logo DELETE removes it', logoDel.status === 200, `status ${logoDel.status}`);
  const logoGone = await fetch(BASE + '/api/merchant/logo', {
    headers: { Cookie: merchant },
    redirect: 'manual',
  });
  check('Logo GET after delete -> 404', logoGone.status === 404, `status ${logoGone.status}`);

  // --- G. Auth lockdown -----------------------------------------------------
  for (const route of ['/api/merchant/analytics', '/api/merchant/customers', '/api/merchant/settings']) {
    const noAuth = await call(route, { method: 'GET' });
    check(`${route} without session -> 401`, noAuth.status === 401, `status ${noAuth.status}`);

    const asCustomer = await call(route, { method: 'GET', cookie: c1 });
    check(
      `${route} with customer session -> 403 CUSTOMER_SESSION`,
      asCustomer.status === 403 && asCustomer.json?.error?.code === 'CUSTOMER_SESSION',
      `status ${asCustomer.status}, code ${asCustomer.json?.error?.code}`
    );
  }

  const noSetup = await call('/api/merchant/analytics', { method: 'GET', cookie: temp });
  check(
    'Analytics before business setup -> 409 SETUP_REQUIRED',
    noSetup.status === 409 && noSetup.json?.error?.code === 'SETUP_REQUIRED',
    `status ${noSetup.status}, code ${noSetup.json?.error?.code}`
  );

  const patchCustomer = await call('/api/merchant/settings', {
    method: 'PATCH',
    cookie: c1,
    body: { businessName: 'Hacked Name' },
  });
  check(
    'Customer PATCH settings -> 403 (cannot edit merchant profile)',
    patchCustomer.status === 403,
    `status ${patchCustomer.status}`
  );

  // --- H. Pages render (session cookie required — middleware gates guests) ---
  await pageRenders('/analytics', merchant);
  await pageRenders('/customers', merchant);
  await pageRenders('/settings', merchant);

  // --- Summary --------------------------------------------------------------
  console.log(results.join('\n'));
  console.log(`\nPhase 4 smoke: ${passed} passed, ${failed} failed (${passed + failed} checks)`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
