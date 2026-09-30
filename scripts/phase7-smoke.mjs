/**
 * Phase 7 — Manual Payments & Billing smoke test
 * Spec: phases.md Phase 7 + user requirements (modal, optional screenshot,
 * tier approval, storage cleanup, auth-protected main app).
 *
 * Flow: root 307s into the sign-in flow -> middleware
 *       gate matrix (guests bounced server-side before any HTML: merchant ->
 *       /welcome, admin -> /admin/login, customer -> /scan?next=…, public
 *       allowlist untouched)
 *       -> auth matrix on billing endpoints ->
 *       FREE request (no payment details, stray fields dropped) + duplicate
 *       409 -> paid validation battery (422s incl. bad/oversize files) ->
 *       admin login -> screenshot endpoint (401/403/404) -> approve FREE
 *       (ACTIVE, no expiry) -> paid submit WITH screenshot (file on disk)
 *       -> admin views screenshot (200 image/png) -> approve as YEARLY
 *       (tier granted +365d, screenshotPath cleared + FILE DELETED) ->
 *       reject flow (file deleted too) -> duplicate trx 409 (no orphan file)
 *       -> invalid tier 422 / re-approve 409 -> pages render.
 *
 * Usage: node scripts/phase7-smoke.mjs [baseUrl]
 */

import { readFileSync } from 'node:fs';
import { access, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] || 'http://localhost:3111';
import { signUpMerchant as signUpMerchantHelper, signInCustomer as signInCustomerHelper } from './test-session.mjs';
const RUN = Date.now().toString(36);
const M_FREE = '017' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const M_PAID = '018' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const CUST = '019' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');

/** Repo-root storage dir — must match backend/billing.ts (process.cwd()/storage/…). */
const SCREENSHOT_DIR = path.join(
  fileURLToPath(new URL('..', import.meta.url)),
  'storage',
  'payment-screenshots'
);

/** Load KEY=value env files (root .env for Prisma, frontend/.env.local for runtime). */
function loadEnvFile(url) {
  try {
    const text = readFileSync(url, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let value = m[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[m[1]] === undefined) process.env[m[1]] = value;
    }
  } catch {
    /* file may not exist */
  }
}
loadEnvFile(new URL('../.env', import.meta.url));
loadEnvFile(new URL('../frontend/.env.local', import.meta.url));

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Loyl-Admin-2026!Dev';
const DAY_MS = 24 * 60 * 60 * 1000;

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

async function call(pathname, { method = 'POST', body, cookie, form, rawForm } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (rawForm) {
    headers['Content-Type'] = rawForm.contentType;
  } else if (!form) {
    headers['Content-Type'] = 'application/json';
  }
  // form = native FormData (browser-style); rawForm = hand-built Buffer body.
  const res = await fetch(BASE + pathname, {
    method,
    headers,
    body: rawForm
      ? rawForm.body
      : form
        ? form
        : body !== undefined
          ? JSON.stringify(body)
          : undefined,
    redirect: 'manual',
  });
  const contentType = res.headers.get('content-type') || '';
  let json = null;
  if (contentType.includes('application/json')) {
    try {
      json = await res.json();
    } catch {
      /* non-JSON */
    }
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
  return cookie;
}

/** Signs a customer in (name + phone, collected — no OTP). */
async function signInCustomer(phone) {
  const { cookie } = await signInCustomerHelper((p, o) => call(p, o), { name: 'Smoke Customer', phone });
  return cookie;
}

/** Builds a multipart checkout form (paid or free). */
function checkoutForm(fields, file) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  if (file) form.append('screenshot', new Blob([file.bytes], { type: file.type }), file.name);
  return form;
}

/**
 * Hand-built multipart body as ONE Buffer — used for LARGE uploads.
 * Node/undici's FormData encoder trickles at ~7KB/s on this stack and aborts
 * the socket over ~1MB (raw Buffer bodies from the same client are fast, and
 * browsers/curl are unaffected: curl sent 5MB+1 -> 422 in 70ms), so the
 * oversize test below must not go through native FormData.
 */
function rawMultipart(fields, file) {
  const boundary = '----loylP7' + Date.now();
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
      )
    );
  }
  if (file) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="screenshot"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`
      ),
      Buffer.from(file.bytes),
      Buffer.from('\r\n')
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

const PNG_BYTES = (size = 96) => {
  const buf = new Uint8Array(size);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG magic
  return buf;
};

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
  console.log(`Phase 7 smoke test against ${BASE}\n`);

  // --- A. Root bounces to the sign-in flow; app itself stays behind auth ----
  // The marketing landing is a separate deploy (landing page/), so this origin
  // has no page at / — it hands guests straight to /welcome.
  const home = await fetch(BASE + '/', { redirect: 'manual' }).catch(() => null);
  check(
    'GET / 307s to /welcome (no session needed to reach the sign-in flow)',
    !!home && home.status === 307 && (home.headers.get('location') || '').includes('/welcome'),
    home ? `status ${home.status} -> ${home.headers.get('location')}` : 'no response'
  );

  // --- B. Sessions ----------------------------------------------------------
  const mFree = await signUpMerchant('Phase7 Free Bakery', M_FREE);
  const mPaid = await signUpMerchant('Phase7 Paid Salon', M_PAID);
  const cust = await signInCustomer(CUST);
  check('Customer session issued', !!cust);

  const adminLogin = await call('/api/admin/login', { body: { password: ADMIN_PASSWORD } });
  const admin = extractSessionCookie(adminLogin.setCookie);
  check(
    'Admin login (200, session cookie)',
    adminLogin.status === 200 && !!admin,
    `status ${adminLogin.status}`
  );

  // --- B2. Middleware: main app strictly behind auth -------------------------
  async function guestPage(route) {
    const r = await fetch(BASE + route, { redirect: 'manual' }).catch(() => null);
    return { status: r?.status ?? 0, location: r?.headers.get('location') || '' };
  }

  const gDash = await guestPage('/dashboard');
  check(
    'Guest GET /dashboard -> 307 /welcome (middleware, before any HTML)',
    gDash.status === 307 && gDash.location.includes('/welcome'),
    `status ${gDash.status}, location ${gDash.location}`
  );

  const gBilling = await guestPage('/billing');
  check(
    'Guest GET /billing -> 307 /welcome',
    gBilling.status === 307 && gBilling.location.includes('/welcome'),
    `status ${gBilling.status}, location ${gBilling.location}`
  );

  const gAdmin = await guestPage('/admin');
  check(
    'Guest GET /admin -> 307 /admin/login',
    gAdmin.status === 307 && gAdmin.location.includes('/admin/login'),
    `status ${gAdmin.status}, location ${gAdmin.location}`
  );

  const gCustomer = await guestPage('/stamp-card');
  check(
    'Guest GET /stamp-card -> 307 /scan?next=… (customer layout mirror)',
    gCustomer.status === 307 &&
      gCustomer.location.includes('/scan?next=') &&
      decodeURIComponent(gCustomer.location).includes('/stamp-card'),
    `status ${gCustomer.status}, location ${gCustomer.location}`
  );

  const badCookie = await fetch(BASE + '/dashboard', {
    redirect: 'manual',
    headers: { Cookie: 'loyl_session=not.a.valid.jwt' },
  }).catch(() => null);
  check(
    'Tampered session cookie on /dashboard -> 307 /welcome',
    !!badCookie && badCookie.status === 307 && (badCookie.headers.get('location') || '').includes('/welcome'),
    badCookie ? `status ${badCookie.status}` : 'no response'
  );

  for (const route of ['/welcome', '/business-setup', '/scan', '/admin/login']) {
    const pub = await guestPage(route);
    check(
      `Public allowlist: guest GET ${route} renders (200)`,
      pub.status === 200,
      `status ${pub.status}, location ${pub.location}`
    );
  }

  const authedDash = await fetch(BASE + '/dashboard', {
    redirect: 'manual',
    headers: { Cookie: mFree },
  }).catch(() => null);
  check(
    'Merchant session GET /dashboard renders (200)',
    !!authedDash && authedDash.status === 200,
    authedDash ? `status ${authedDash.status}` : 'no response'
  );

  const authedCustomer = await fetch(BASE + '/stamp-card', {
    redirect: 'manual',
    headers: { Cookie: cust },
  }).catch(() => null);
  check(
    'Customer session GET /stamp-card renders (200)',
    !!authedCustomer && authedCustomer.status === 200,
    authedCustomer ? `status ${authedCustomer.status}` : 'no response'
  );

  const apiGuest = await call('/api/merchant/stats', { method: 'GET' });
  check(
    'Middleware leaves /api alone — API answers JSON 401 (not a redirect)',
    apiGuest.status === 401 && apiGuest.json?.error?.code === 'UNAUTHORIZED',
    `status ${apiGuest.status}, code ${apiGuest.json?.error?.code}`
  );

  // --- C. Auth matrix on billing endpoints ----------------------------------
  const billNoSession = await call('/api/billing', { method: 'GET' });
  check('GET /api/billing without session -> 401', billNoSession.status === 401, `status ${billNoSession.status}`);

  const billCustomer = await call('/api/billing', { method: 'GET', cookie: cust });
  check(
    'Customer session on /api/billing -> 403 CUSTOMER_SESSION',
    billCustomer.status === 403 && billCustomer.json?.error?.code === 'CUSTOMER_SESSION',
    `status ${billCustomer.status}, code ${billCustomer.json?.error?.code}`
  );

  const checkoutNoSession = await call('/api/billing/checkout', {
    form: checkoutForm({ requestedTier: 'FREE' }),
  });
  check('POST /api/billing/checkout without session -> 401', checkoutNoSession.status === 401, `status ${checkoutNoSession.status}`);

  const checkoutAdmin = await call('/api/billing/checkout', {
    cookie: admin,
    form: checkoutForm({ requestedTier: 'FREE' }),
  });
  check(
    'Admin session on /api/billing/checkout -> 403 ADMIN_SESSION',
    checkoutAdmin.status === 403 && checkoutAdmin.json?.error?.code === 'ADMIN_SESSION',
    `status ${checkoutAdmin.status}, code ${checkoutAdmin.json?.error?.code}`
  );

  const billingFresh = await call('/api/billing', { method: 'GET', cookie: mFree });
  check(
    'Fresh merchant billing: PENDING + tier FREE, no requests',
    billingFresh.status === 200 &&
      billingFresh.json?.data?.subscription?.status === 'PENDING' &&
      billingFresh.json?.data?.subscription?.tier === 'FREE' &&
      billingFresh.json?.data?.requests?.length === 0 &&
      billingFresh.json?.data?.pending === null,
    JSON.stringify(billingFresh.json?.data?.subscription)
  );

  // --- D. FREE request (no payment details needed) --------------------------
  const freeSubmit = await call('/api/billing/checkout', {
    cookie: mFree,
    // Stray payment fields must be dropped for FREE (amount would be 999).
    form: checkoutForm({
      requestedTier: 'FREE',
      amount: '999',
      trxId: 'SHOULD_NOT_PERSIST',
    }),
  });
  const freeRow = freeSubmit.json?.data?.request;
  check(
    'FREE request submitted without payment details (201)',
    freeSubmit.status === 201 && freeRow?.requestedTier === 'FREE',
    `status ${freeSubmit.status}`
  );
  check(
    'FREE request stores no transfer details (amount 0, trx/sender null)',
    freeRow?.amount === 0 && freeRow?.trxId === null && freeRow?.senderNumber === null && freeRow?.hasScreenshot === false,
    JSON.stringify({ amount: freeRow?.amount, trxId: freeRow?.trxId, sender: freeRow?.senderNumber })
  );

  const freeDup = await call('/api/billing/checkout', {
    cookie: mFree,
    form: checkoutForm({ requestedTier: 'FREE' }),
  });
  check(
    'Second request while one is pending -> 409 PENDING_REQUEST_EXISTS',
    freeDup.status === 409 && freeDup.json?.error?.code === 'PENDING_REQUEST_EXISTS',
    `status ${freeDup.status}, code ${freeDup.json?.error?.code}`
  );

  // --- E. Paid validation battery (M_PAID, no rows created) ------------------
  const paidBase = {
    requestedTier: 'MONTHLY',
    paymentMethod: 'BKASH',
    senderNumber: M_PAID,
    trxId: `P7N${Date.now()}`,
    amount: '500',
  };

  const noTrx = await call('/api/billing/checkout', {
    cookie: mPaid,
    form: checkoutForm({ ...paidBase, trxId: '' }),
  });
  check('Paid submit without Trx ID -> 422', noTrx.status === 422, `status ${noTrx.status}`);

  const badTier = await call('/api/billing/checkout', {
    cookie: mPaid,
    form: checkoutForm({ ...paidBase, requestedTier: 'LIFETIME' }),
  });
  check('Checkout with unknown tier -> 422', badTier.status === 422, `status ${badTier.status}`);

  const badType = await call('/api/billing/checkout', {
    cookie: mPaid,
    form: checkoutForm(paidBase, { bytes: [1, 2, 3], type: 'text/plain', name: 'note.txt' }),
  });
  check(
    'Non-image screenshot rejected (422 INVALID_FILE_TYPE)',
    badType.status === 422 && badType.json?.error?.code === 'INVALID_FILE_TYPE',
    `status ${badType.status}, code ${badType.json?.error?.code}`
  );

  const tooBig = await call('/api/billing/checkout', {
    cookie: mPaid,
    rawForm: rawMultipart(paidBase, {
      bytes: new Uint8Array(5 * 1024 * 1024 + 1),
      type: 'image/png',
      name: 'huge.png',
    }),
  });
  check(
    'Oversize screenshot rejected (422 FILE_TOO_LARGE)',
    tooBig.status === 422 && tooBig.json?.error?.code === 'FILE_TOO_LARGE',
    `status ${tooBig.status}, code ${tooBig.json?.error?.code}`
  );

  const afterInvalid = await call('/api/billing', { method: 'GET', cookie: mPaid });
  check(
    'Failed submissions created no rows',
    afterInvalid.json?.data?.requests?.length === 0,
    `rows ${afterInvalid.json?.data?.requests?.length}`
  );

  // --- F. Screenshot endpoint access control --------------------------------
  const shotGuest = await call(`/api/admin/payments/${freeRow.id}/screenshot`, { method: 'GET' });
  check('Screenshot without session -> 401', shotGuest.status === 401, `status ${shotGuest.status}`);

  const shotMerchant = await call(`/api/admin/payments/${freeRow.id}/screenshot`, {
    method: 'GET',
    cookie: mPaid,
  });
  check(
    'Screenshot with merchant session -> 403 NOT_ADMIN',
    shotMerchant.status === 403 && shotMerchant.json?.error?.code === 'NOT_ADMIN',
    `status ${shotMerchant.status}`
  );

  const shotFreeRow = await call(`/api/admin/payments/${freeRow.id}/screenshot`, {
    method: 'GET',
    cookie: admin,
  });
  check(
    'Screenshot on a request without one -> 404 SCREENSHOT_NOT_FOUND',
    shotFreeRow.status === 404 && shotFreeRow.json?.error?.code === 'SCREENSHOT_NOT_FOUND',
    `status ${shotFreeRow.status}, code ${shotFreeRow.json?.error?.code}`
  );

  // --- G. Approve FREE (defaults to requested tier, no expiry) ---------------
  const approveFree = await call('/api/admin/approve-payment', {
    cookie: admin,
    body: { paymentRequestId: freeRow.id },
  });
  check(
    'Approve FREE request -> 200, tier FREE, ACTIVE, no expiry',
    approveFree.status === 200 &&
      approveFree.json?.data?.payment?.status === 'APPROVED' &&
      approveFree.json?.data?.merchant?.subscriptionTier === 'FREE' &&
      approveFree.json?.data?.merchant?.subscriptionStatus === 'ACTIVE' &&
      approveFree.json?.data?.merchant?.subscriptionExpiresAt === null,
    `status ${approveFree.status}, ${JSON.stringify(approveFree.json?.data?.merchant)}`
  );

  const freeBilling = await call('/api/billing', { method: 'GET', cookie: mFree });
  check(
    'FREE merchant sees ACTIVE/FREE with no expiry + approved history',
    freeBilling.json?.data?.subscription?.status === 'ACTIVE' &&
      freeBilling.json?.data?.subscription?.tier === 'FREE' &&
      freeBilling.json?.data?.subscription?.expiresAt === null &&
      freeBilling.json?.data?.requests?.[0]?.status === 'APPROVED' &&
      freeBilling.json?.data?.pending === null,
    JSON.stringify(freeBilling.json?.data?.subscription)
  );

  // --- H. Paid submit WITH screenshot (file lands on disk) -------------------
  const runId = Date.now();
  const TRX1 = `P7A${runId}`;
  const paidSubmit = await call('/api/billing/checkout', {
    cookie: mPaid,
    form: checkoutForm(
      { ...paidBase, trxId: TRX1 },
      { bytes: PNG_BYTES(128), type: 'image/png', name: 'trx.png' }
    ),
  });
  const paidRow = paidSubmit.json?.data?.request;
  check(
    'Paid request with screenshot submitted (201, hasScreenshot)',
    paidSubmit.status === 201 && paidRow?.hasScreenshot === true && paidRow?.trxId === TRX1,
    `status ${paidSubmit.status}`
  );

  // Locate the stored file via the DB row (path never leaves the server).
  let storedPath = null;
  {
    const { PrismaClient } = await import('@prisma/client');
    const db = new PrismaClient();
    try {
      const row = await db.paymentRequest.findUnique({ where: { id: paidRow.id } });
      storedPath = row?.screenshotPath ?? null;
    } finally {
      await db.$disconnect();
    }
  }
  check('Screenshot filename recorded in the DB', !!storedPath, 'screenshotPath null');
  let fileOnDisk = false;
  if (storedPath) {
    await access(path.join(SCREENSHOT_DIR, storedPath)).then(
      () => (fileOnDisk = true),
      () => (fileOnDisk = false)
    );
  }
  check('Screenshot file exists on disk before review', fileOnDisk, storedPath || 'no path');

  // --- I. Admin views the screenshot ----------------------------------------
  const listPaid = await call(`/api/admin/payments?q=${TRX1}`, { method: 'GET', cookie: admin });
  const listed = (listPaid.json?.data?.payments || []).find((p) => p.trxId === TRX1);
  check(
    'Admin list shows requestedTier + hasScreenshot',
    listed?.requestedTier === 'MONTHLY' && listed?.hasScreenshot === true,
    JSON.stringify({ tier: listed?.requestedTier, shot: listed?.hasScreenshot })
  );

  const shotView = await call(`/api/admin/payments/${paidRow.id}/screenshot`, {
    method: 'GET',
    cookie: admin,
  });
  const shotBytes = shotView.headers.get('content-type');
  check(
    'Admin views screenshot (200, image/png)',
    shotView.status === 200 && shotBytes === 'image/png' && shotView.headers.get('content-length') !== '0',
    `status ${shotView.status}, type ${shotBytes}`
  );

  // --- J. Approve as YEARLY: tier granted + storage cleanup ------------------
  const approveYearly = await call('/api/admin/approve-payment', {
    cookie: admin,
    body: { paymentRequestId: paidRow.id, tier: 'YEARLY' },
  });
  const granted = approveYearly.json?.data?.merchant;
  const expiresIn = granted?.subscriptionExpiresAt
    ? new Date(granted.subscriptionExpiresAt).getTime() - Date.now()
    : 0;
  check(
    'Approve with tier YEARLY -> ACTIVE + ~365d expiry',
    approveYearly.status === 200 &&
      granted?.subscriptionTier === 'YEARLY' &&
      granted?.subscriptionStatus === 'ACTIVE' &&
      expiresIn > 364 * DAY_MS &&
      expiresIn <= 366 * DAY_MS,
    `status ${approveYearly.status}, ${JSON.stringify({ tier: granted?.subscriptionTier, expiresInDays: Math.round(expiresIn / DAY_MS) })}`
  );
  check(
    'Approval reports the screenshot as deleted',
    approveYearly.json?.data?.deletedScreenshot === true && approveYearly.json?.data?.payment?.screenshotPath === null,
    JSON.stringify({ deleted: approveYearly.json?.data?.deletedScreenshot })
  );

  let goneFromDisk = false;
  if (storedPath) {
    await access(path.join(SCREENSHOT_DIR, storedPath)).then(
      () => (goneFromDisk = false),
      () => (goneFromDisk = true)
    );
  }
  check('Screenshot FILE DELETED from storage on approve', goneFromDisk, storedPath || 'no path');

  const shotAfter = await call(`/api/admin/payments/${paidRow.id}/screenshot`, {
    method: 'GET',
    cookie: admin,
  });
  check(
    'Screenshot endpoint now 404 (pointer cleared)',
    shotAfter.status === 404 && shotAfter.json?.error?.code === 'SCREENSHOT_NOT_FOUND',
    `status ${shotAfter.status}`
  );

  const paidBilling = await call('/api/billing', { method: 'GET', cookie: mPaid });
  check(
    'Paid merchant sees YEARLY/ACTIVE after approval',
    paidBilling.json?.data?.subscription?.tier === 'YEARLY' &&
      paidBilling.json?.data?.subscription?.status === 'ACTIVE',
    JSON.stringify(paidBilling.json?.data?.subscription)
  );

  // --- K. Reject flow: also cleans up storage --------------------------------
  const TRX2 = `P7R${Date.now()}`;
  const secondSubmit = await call('/api/billing/checkout', {
    cookie: mPaid,
    form: checkoutForm(
      { ...paidBase, requestedTier: 'YEARLY', amount: '5000', trxId: TRX2 },
      { bytes: PNG_BYTES(64), type: 'image/png', name: 'trx2.png' }
    ),
  });
  const secondRow = secondSubmit.json?.data?.request;
  check('Second paid request submitted (201)', secondSubmit.status === 201, `status ${secondSubmit.status}`);

  let secondPath = null;
  {
    const { PrismaClient } = await import('@prisma/client');
    const db = new PrismaClient();
    try {
      const row = await db.paymentRequest.findUnique({ where: { id: secondRow.id } });
      secondPath = row?.screenshotPath ?? null;
    } finally {
      await db.$disconnect();
    }
  }

  const reject = await call('/api/admin/reject-payment', {
    cookie: admin,
    body: { paymentRequestId: secondRow.id },
  });
  let secondGone = false;
  if (secondPath) {
    await access(path.join(SCREENSHOT_DIR, secondPath)).then(
      () => (secondGone = false),
      () => (secondGone = true)
    );
  }
  check(
    'Reject: payment REJECTED, screenshot deleted, subscription untouched',
    reject.status === 200 &&
      reject.json?.data?.payment?.status === 'REJECTED' &&
      reject.json?.data?.deletedScreenshot === true &&
      secondGone &&
      reject.json?.data?.payment?.merchant?.subscriptionTier === 'YEARLY',
    `status ${reject.status}, fileGone ${secondGone}`
  );

  // --- L. Duplicate trx + review guards --------------------------------------
  const filesBefore = await readdir(SCREENSHOT_DIR).catch(() => []);
  const dupTrx = await call('/api/billing/checkout', {
    cookie: mPaid,
    form: checkoutForm(
      { ...paidBase, trxId: TRX1 },
      { bytes: PNG_BYTES(64), type: 'image/png', name: 'dup.png' }
    ),
  });
  const filesAfter = await readdir(SCREENSHOT_DIR).catch(() => []);
  check(
    'Re-used Trx ID -> 409 TRX_ALREADY_USED and no orphan file left',
    dupTrx.status === 409 &&
      dupTrx.json?.error?.code === 'TRX_ALREADY_USED' &&
      filesAfter.length === filesBefore.length,
    `status ${dupTrx.status}, files ${filesBefore.length} -> ${filesAfter.length}`
  );

  const reApprove = await call('/api/admin/approve-payment', {
    cookie: admin,
    body: { paymentRequestId: paidRow.id, tier: 'PREMIUM' },
  });
  check(
    'Re-approve an approved request -> 409 PAYMENT_NOT_PENDING',
    reApprove.status === 409 && reApprove.json?.error?.code === 'PAYMENT_NOT_PENDING',
    `status ${reApprove.status}, code ${reApprove.json?.error?.code}`
  );

  const badApproveTier = await call('/api/admin/approve-payment', {
    cookie: admin,
    body: { paymentRequestId: 'cmu00000000000000000000', tier: 'LIFETIME' },
  });
  check('Approve with unknown tier -> 422', badApproveTier.status === 422, `status ${badApproveTier.status}`);

  // --- M. Pages render (session cookies — middleware gates guests) ----------
  await pageRenders('/billing', mFree);
  await pageRenders('/billing/checkout', mFree);
  await pageRenders('/admin/billing', admin);

  // --- Summary ---------------------------------------------------------------
  console.log(results.join('\n'));
  console.log(`\nPhase 7 smoke: ${passed} passed, ${failed} failed (${passed + failed} checks)`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
