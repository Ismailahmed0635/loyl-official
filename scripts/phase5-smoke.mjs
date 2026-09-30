/**
 * Phase 5 — Admin Panel smoke test
 * Spec: phases.md Phase 5 + BUILD.md §Super Admin & Payment Engine.
 *
 * Flow: admin login (wrong/short/correct password, 12h session, role=admin)
 *       -> auth matrix (guest/merchant/customer blocked, admin blocked from
 *       merchant+customer endpoints, role=admin rejected by OTP verify)
 *       -> seed two payment requests via Prisma -> platform stats ->
 *       payments list/search/filter/pagination/validation -> approve (payment
 *       APPROVED + merchant subscription ACTIVE for 30 days) / reject
 *       (subscription untouched) + re-review 409s -> merchants list/search/
 *       filter/validation -> merchant actions (activate/expire/revoke/suspend
 *       with 403 ACCOUNT_SUSPENDED/restore) -> logout -> pages render.
 *
 * Note: exactly ONE wrong-password attempt is made (cleared by the successful
 * login) so the 5-fail/60s throttle never locks the smoke out on re-runs.
 * The lockout path itself is unit-tested in backend/admin.test.ts.
 *
 * Usage: node scripts/phase5-smoke.mjs [baseUrl]
 */

import { readFileSync } from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:3111';
import { mintSession, signUpMerchant as signUpMerchantHelper, signInCustomer as signInCustomerHelper } from './test-session.mjs';
const RUN = Date.now().toString(36);
const M1_PHONE = '017' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const M2_PHONE = '018' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const CUST_PHONE = '019' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const TEMP_PHONE = '016' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');

const M1_NAME = 'Phase5 Approve Cafe';
const M2_NAME = 'Phase5 Suspend Salon';

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

/** Decode a JWT payload (no verification — assertions only). */
function decodeJwt(jwt) {
  try {
    const b64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch {
    return null;
  }
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

/** Email session without a merchant profile (business setup never completed). */
async function signUpTemp(email) {
  return `loyl_session=${await mintSession({ userId: `temp_${RUN}`, phoneNumber: '', email })}`;
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

async function main() {
  console.log(`Phase 5 smoke test against ${BASE}\n`);

  // --- Server reachable -----------------------------------------------------
  const home = await fetch(BASE + '/').catch(() => null);
  check('Dev server responds on /', !!home && home.status < 500, home ? `status ${home.status}` : 'no response');

  // --- Sessions -------------------------------------------------------------
  const m1 = await signUpMerchant(M1_NAME, M1_PHONE);
  const m2 = await signUpMerchant(M2_NAME, M2_PHONE);
  const cust = await signInCustomer(CUST_PHONE);
  const temp = await signUpTemp(`temp-${RUN}@example.com`);
  check('Customer + temp sessions issued', !!(cust && temp));

  // --- A. Admin login -------------------------------------------------------
  const shortPw = await call('/api/admin/login', { body: { password: '123' } });
  check('Login rejects short password (422)', shortPw.status === 422, `status ${shortPw.status}`);

  const emptyBody = await call('/api/admin/login', { body: {} });
  check('Login rejects empty body (422)', emptyBody.status === 422, `status ${emptyBody.status}`);

  const wrongPw = await call('/api/admin/login', { body: { password: 'definitely-wrong-pw' } });
  check(
    'Login rejects wrong password (401 ADMIN_INVALID_PASSWORD)',
    wrongPw.status === 401 && wrongPw.json?.error?.code === 'ADMIN_INVALID_PASSWORD',
    `status ${wrongPw.status}, code ${wrongPw.json?.error?.code}`
  );

  const login = await call('/api/admin/login', { body: { password: ADMIN_PASSWORD } });
  const adminCookie = extractSessionCookie(login.setCookie);
  check(
    'Login accepts the ADMIN_PASSWORD (200, session cookie set)',
    login.status === 200 && !!adminCookie && login.json?.data?.role === 'admin',
    `status ${login.status}, cookie ${adminCookie ? 'set' : 'missing'}`
  );

  const jwt = adminCookie ? decodeJwt(adminCookie.slice('loyl_session='.length)) : null;
  check(
    'Admin session payload: userId=admin, role=admin',
    jwt?.userId === 'admin' && jwt?.role === 'admin',
    JSON.stringify({ userId: jwt?.userId, role: jwt?.role })
  );
  check(
    'Admin session TTL is 12h (exp - iat = 43200)',
    !!jwt && jwt.exp - jwt.iat === 43200,
    !!jwt ? `got ${jwt.exp - jwt.iat}s` : 'no jwt'
  );

  // --- B. Auth matrix -------------------------------------------------------
  const guestSession = await call('/api/admin/session', { method: 'GET' });
  check('GET /api/admin/session without session -> 401', guestSession.status === 401, `status ${guestSession.status}`);

  const merchantSession = await call('/api/admin/session', { method: 'GET', cookie: m1 });
  check(
    'Merchant session on /api/admin/session -> 403 NOT_ADMIN',
    merchantSession.status === 403 && merchantSession.json?.error?.code === 'NOT_ADMIN',
    `status ${merchantSession.status}, code ${merchantSession.json?.error?.code}`
  );

  const customerSession = await call('/api/admin/session', { method: 'GET', cookie: cust });
  check(
    'Customer session on /api/admin/session -> 403 NOT_ADMIN',
    customerSession.status === 403 && customerSession.json?.error?.code === 'NOT_ADMIN',
    `status ${customerSession.status}, code ${customerSession.json?.error?.code}`
  );

  const adminSession = await call('/api/admin/session', { method: 'GET', cookie: adminCookie });
  check(
    'Admin session on /api/admin/session -> 200 role admin',
    adminSession.status === 200 && adminSession.json?.data?.role === 'admin',
    `status ${adminSession.status}`
  );

  const adminOnMerchant = await call('/api/merchant/stats', { method: 'GET', cookie: adminCookie });
  check(
    'Admin cookie on /api/merchant/stats -> 403 ADMIN_SESSION',
    adminOnMerchant.status === 403 && adminOnMerchant.json?.error?.code === 'ADMIN_SESSION',
    `status ${adminOnMerchant.status}, code ${adminOnMerchant.json?.error?.code}`
  );

  const adminOnCustomer = await call('/api/customer/cards', { method: 'GET', cookie: adminCookie });
  check(
    'Admin cookie on /api/customer/cards -> 403 ADMIN_SESSION',
    adminOnCustomer.status === 403 && adminOnCustomer.json?.error?.code === 'ADMIN_SESSION',
    `status ${adminOnCustomer.status}, code ${adminOnCustomer.json?.error?.code}`
  );

  const merchantOnAdmin = await call('/api/admin/stats', { method: 'GET', cookie: m1 });
  check(
    'Merchant cookie on /api/admin/stats -> 403 NOT_ADMIN',
    merchantOnAdmin.status === 403 && merchantOnAdmin.json?.error?.code === 'NOT_ADMIN',
    `status ${merchantOnAdmin.status}`
  );

  const roleSmuggle = await call('/api/customer/session', {
    body: { name: 'Smoke Customer', phoneNumber: CUST_PHONE, role: 'admin' },
  });
  check(
    'Customer session with role=admin rejected (422 — role is never client-settable)',
    roleSmuggle.status === 422,
    `status ${roleSmuggle.status}`
  );

  // --- C. Seed payment requests (Phase 7 owns the merchant submission flow) --
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient();
  const runId = Date.now();
  const TRX1 = `P5A${runId}`;
  const TRX2 = `P5R${runId}`;

  try {
    const m1Row = await db.merchant.findUnique({ where: { phoneNumber: M1_PHONE } });
    const m2Row = await db.merchant.findUnique({ where: { phoneNumber: M2_PHONE } });
    check('Both smoke merchants exist in the DB', !!(m1Row && m2Row));

    const p1 = await db.paymentRequest.create({
      data: {
        merchantId: m1Row.id,
        paymentMethod: 'BKASH',
        senderNumber: M1_PHONE,
        trxId: TRX1,
        amount: 1000,
        status: 'PENDING',
      },
    });
    const p2 = await db.paymentRequest.create({
      data: {
        merchantId: m2Row.id,
        paymentMethod: 'NAGAD',
        senderNumber: M2_PHONE,
        trxId: TRX2,
        amount: 500,
        status: 'PENDING',
      },
    });
    check('Two PENDING payment requests seeded', !!(p1.id && p2.id));

    // --- D. Platform stats --------------------------------------------------
    const stats = await call('/api/admin/stats', { method: 'GET', cookie: adminCookie });
    const sData = stats.json?.data;
    const subs = sData?.merchants?.subscriptions || {};
    check(
      'GET /api/admin/stats (200, subscription counts sum to total)',
      stats.status === 200 &&
        sData?.merchants?.total >= 2 &&
        (subs.ACTIVE || 0) + (subs.PENDING || 0) + (subs.EXPIRED || 0) === sData.merchants.total,
      `status ${stats.status}, total ${sData?.merchants?.total}`
    );
    check(
      'Stats: pending payments >= 2 and pending amount >= 1500',
      (sData?.payments?.counts?.PENDING || 0) >= 2 && sData?.payments?.pendingAmount >= 1500,
      JSON.stringify(sData?.payments)
    );
    const recentTrx = (sData?.recentPayments || []).map((p) => p.trxId);
    check(
      'Stats: recent merchants + recent pending payments include the seeded rows',
      (sData?.recentMerchants || []).some((m) => m.phoneNumber === M1_PHONE) &&
        recentTrx.includes(TRX1) &&
        recentTrx.includes(TRX2),
      `recentTrx ${JSON.stringify(recentTrx)}`
    );

    // --- E. Payments list ---------------------------------------------------
    const pendingList = await call('/api/admin/payments', { method: 'GET', cookie: adminCookie });
    const pendingTrx = (pendingList.json?.data?.payments || []).map((p) => p.trxId);
    check(
      'GET /api/admin/payments defaults to PENDING and lists both seeded rows',
      pendingList.status === 200 && pendingTrx.includes(TRX1) && pendingTrx.includes(TRX2),
      `status ${pendingList.status}, trx ${JSON.stringify(pendingTrx.slice(0, 5))}`
    );
    check(
      'Payment rows carry merchant context + numeric amount',
      (pendingList.json?.data?.payments || []).every(
        (p) => p.merchant?.businessName && typeof p.amount === 'number'
      )
    );

    const paySearch = await call(`/api/admin/payments?q=${TRX1}`, {
      method: 'GET',
      cookie: adminCookie,
    });
    const searchRows = paySearch.json?.data?.payments || [];
    check(
      'Payment search ?q=trxId narrows to 1 row',
      paySearch.status === 200 && searchRows.length === 1 && searchRows[0].trxId === TRX1,
      JSON.stringify(searchRows.map((r) => r.trxId))
    );

    const payPage = await call('/api/admin/payments?page=1&pageSize=1', {
      method: 'GET',
      cookie: adminCookie,
    });
    check(
      'Payment pagination ?pageSize=1 (rows 1, totalPages >= 2)',
      payPage.status === 200 &&
        payPage.json.data.payments.length === 1 &&
        payPage.json.data.pagination.totalPages >= 2,
      JSON.stringify(payPage.json?.data?.pagination)
    );

    const badPayStatus = await call('/api/admin/payments?status=CANCELLED', {
      method: 'GET',
      cookie: adminCookie,
    });
    check('Payments rejects unknown status (422)', badPayStatus.status === 422, `status ${badPayStatus.status}`);
    const badPayPage = await call('/api/admin/payments?page=0', {
      method: 'GET',
      cookie: adminCookie,
    });
    check('Payments rejects page=0 (422)', badPayPage.status === 422, `status ${badPayPage.status}`);
    const longPayQ = await call(`/api/admin/payments?q=${'x'.repeat(31)}`, {
      method: 'GET',
      cookie: adminCookie,
    });
    check('Payments rejects overlong search (422)', longPayQ.status === 422, `status ${longPayQ.status}`);

    // Pre-approve: both merchants start PENDING (fresh signups).
    const preList = await call(`/api/admin/merchants?q=${M1_PHONE}`, {
      method: 'GET',
      cookie: adminCookie,
    });
    const preRow = (preList.json?.data?.merchants || [])[0];
    check(
      'M1 starts PENDING before approval',
      preRow?.subscriptionStatus === 'PENDING' && preRow?.suspended === false,
      JSON.stringify({ status: preRow?.subscriptionStatus, suspended: preRow?.suspended })
    );

    // --- F. Approve payment (BUILD.md workflow) -----------------------------
    const approveMissing = await call('/api/admin/approve-payment', {
      cookie: adminCookie,
      body: { paymentRequestId: 'cmu00000000000000000000' },
    });
    check(
      'Approve unknown payment -> 404 PAYMENT_NOT_FOUND',
      approveMissing.status === 404 && approveMissing.json?.error?.code === 'PAYMENT_NOT_FOUND',
      `status ${approveMissing.status}`
    );

    const approveNoBody = await call('/api/admin/approve-payment', {
      cookie: adminCookie,
      body: {},
    });
    check('Approve with empty body -> 422', approveNoBody.status === 422, `status ${approveNoBody.status}`);

    const approve = await call('/api/admin/approve-payment', {
      cookie: adminCookie,
      body: { paymentRequestId: p1.id },
    });
    const approvedMerchant = approve.json?.data?.merchant;
    const expiresAt = approvedMerchant?.subscriptionExpiresAt
      ? new Date(approvedMerchant.subscriptionExpiresAt).getTime()
      : 0;
    check(
      'Approve: payment APPROVED (200) + merchant ACTIVE with ~30d expiry',
      approve.status === 200 &&
        approve.json?.data?.payment?.status === 'APPROVED' &&
        approvedMerchant?.subscriptionStatus === 'ACTIVE' &&
        expiresAt > Date.now() + 29 * DAY_MS &&
        expiresAt <= Date.now() + 30 * DAY_MS + 60_000,
      `status ${approve.status}, ${JSON.stringify({
        payment: approve.json?.data?.payment?.status,
        sub: approvedMerchant?.subscriptionStatus,
        expiresAt: approvedMerchant?.subscriptionExpiresAt,
      })}`
    );

    const reApprove = await call('/api/admin/approve-payment', {
      cookie: adminCookie,
      body: { paymentRequestId: p1.id },
    });
    check(
      'Re-approve the same payment -> 409 PAYMENT_NOT_PENDING',
      reApprove.status === 409 && reApprove.json?.error?.code === 'PAYMENT_NOT_PENDING',
      `status ${reApprove.status}, code ${reApprove.json?.error?.code}`
    );

    // --- G. Reject payment (subscription untouched) -------------------------
    const reject = await call('/api/admin/reject-payment', {
      cookie: adminCookie,
      body: { paymentRequestId: p2.id },
    });
    check(
      'Reject: payment REJECTED (200)',
      reject.status === 200 && reject.json?.data?.payment?.status === 'REJECTED',
      `status ${reject.status}`
    );

    const m2AfterReject = await call(`/api/admin/merchants?q=${M2_PHONE}`, {
      method: 'GET',
      cookie: adminCookie,
    });
    const m2RowAfter = (m2AfterReject.json?.data?.merchants || [])[0];
    check(
      'Rejected payment leaves the merchant subscription unchanged (PENDING)',
      m2RowAfter?.subscriptionStatus === 'PENDING',
      JSON.stringify({ status: m2RowAfter?.subscriptionStatus })
    );

    const reReject = await call('/api/admin/reject-payment', {
      cookie: adminCookie,
      body: { paymentRequestId: p2.id },
    });
    check(
      'Re-reject the same payment -> 409 PAYMENT_NOT_PENDING',
      reReject.status === 409 && reReject.json?.error?.code === 'PAYMENT_NOT_PENDING',
      `status ${reReject.status}`
    );

    // --- H. Tabs reflect the reviews ---------------------------------------
    const defaultAfter = await call('/api/admin/payments', { method: 'GET', cookie: adminCookie });
    const defaultTrx = (defaultAfter.json?.data?.payments || []).map((p) => p.trxId);
    check(
      'Default (PENDING) tab no longer contains the reviewed rows',
      !defaultTrx.includes(TRX1) && !defaultTrx.includes(TRX2),
      JSON.stringify(defaultTrx.slice(0, 5))
    );

    const approvedTab = await call('/api/admin/payments?status=APPROVED', {
      method: 'GET',
      cookie: adminCookie,
    });
    const approvedTrx = (approvedTab.json?.data?.payments || []).map((p) => p.trxId);
    check(
      'APPROVED tab contains the approved payment',
      approvedTab.status === 200 && approvedTrx.includes(TRX1),
      JSON.stringify(approvedTrx.slice(0, 5))
    );

    const allTab = await call('/api/admin/payments?status=ALL', {
      method: 'GET',
      cookie: adminCookie,
    });
    const allTrx = (allTab.json?.data?.payments || []).map((p) => p.trxId);
    check(
      'ALL tab contains both reviewed payments',
      allTab.status === 200 && allTrx.includes(TRX1) && allTrx.includes(TRX2),
      JSON.stringify(allTrx.slice(0, 5))
    );

    // --- I. Merchants list --------------------------------------------------
    const merchants = await call('/api/admin/merchants', { method: 'GET', cookie: adminCookie });
    const rows = merchants.json?.data?.merchants || [];
    const m1AdminRow = rows.find((r) => r.phoneNumber === M1_PHONE);
    check(
      'GET /api/admin/merchants (200) lists M1 as ACTIVE after approval',
      merchants.status === 200 && m1AdminRow?.subscriptionStatus === 'ACTIVE',
      `status ${merchants.status}, m1 ${m1AdminRow?.subscriptionStatus}`
    );
    check(
      'Merchant rows expose activity counts + suspended flag',
      rows.every((r) => typeof r.suspended === 'boolean' && r._count && typeof r._count.offers === 'number')
    );
    check(
      'Stats pills: byStatus sum == total, suspended is a number',
      merchants.json?.data?.stats &&
        merchants.json.data.stats.byStatus.ACTIVE +
          merchants.json.data.stats.byStatus.PENDING +
          merchants.json.data.stats.byStatus.EXPIRED ===
          merchants.json.data.stats.total &&
        typeof merchants.json.data.stats.suspended === 'number',
      JSON.stringify(merchants.json?.data?.stats)
    );

    const merchSearch = await call(`/api/admin/merchants?q=${M2_PHONE}`, {
      method: 'GET',
      cookie: adminCookie,
    });
    const searchMerchantRows = merchSearch.json?.data?.merchants || [];
    check(
      'Merchant search ?q=phone narrows to M2 only',
      merchSearch.status === 200 &&
        searchMerchantRows.length === 1 &&
        searchMerchantRows[0].phoneNumber === M2_PHONE &&
        merchSearch.json.data.pagination.total === 1,
      JSON.stringify(searchMerchantRows.map((r) => r.phoneNumber))
    );

    const activeFilter = await call('/api/admin/merchants?status=ACTIVE', {
      method: 'GET',
      cookie: adminCookie,
    });
    const activeRows = activeFilter.json?.data?.merchants || [];
    check(
      '?status=ACTIVE returns only ACTIVE merchants incl. M1',
      activeFilter.status === 200 &&
        activeRows.length > 0 &&
        activeRows.every((r) => r.subscriptionStatus === 'ACTIVE') &&
        activeRows.some((r) => r.phoneNumber === M1_PHONE),
      JSON.stringify({ count: activeRows.length })
    );

    const merchPage = await call('/api/admin/merchants?page=1&pageSize=1', {
      method: 'GET',
      cookie: adminCookie,
    });
    check(
      'Merchant pagination ?pageSize=1 (rows 1, totalPages >= 2)',
      merchPage.status === 200 &&
        merchPage.json.data.merchants.length === 1 &&
        merchPage.json.data.pagination.totalPages >= 2,
      JSON.stringify(merchPage.json?.data?.pagination)
    );

    for (const [label, qs] of [
      ['unknown status', 'status=CANCELLED'],
      ['page=0', 'page=0'],
      ['overlong search', `q=${'x'.repeat(21)}`],
    ]) {
      const bad = await call(`/api/admin/merchants?${qs}`, { method: 'GET', cookie: adminCookie });
      check(`Merchant list rejects ${label} (422)`, bad.status === 422, `status ${bad.status}`);
    }

    // --- J. Merchant management actions (on M2) -----------------------------
    const m2Id = m2Row.id;
    async function action(body, path = `/api/admin/merchants/${m2Id}`) {
      return call(path, { method: 'PATCH', cookie: adminCookie, body });
    }
    async function m2Status() {
      const r = await call(`/api/admin/merchants?q=${M2_PHONE}`, {
        method: 'GET',
        cookie: adminCookie,
      });
      return (r.json?.data?.merchants || [])[0];
    }

    const badAction = await action({ action: 'delete' });
    check('PATCH merchants rejects unknown action (422)', badAction.status === 422, `status ${badAction.status}`);

    const noSuch = await call('/api/admin/merchants/cmu00000000000000000000', {
      method: 'PATCH',
      cookie: adminCookie,
      body: { action: 'activate' },
    });
    check('PATCH unknown merchant -> 404 MERCHANT_NOT_FOUND', noSuch.status === 404, `status ${noSuch.status}`);

    const activate = await action({ action: 'activate' });
    const actRow = activate.json?.data?.merchant;
    const actExpires = actRow?.subscriptionExpiresAt ? new Date(actRow.subscriptionExpiresAt).getTime() : 0;
    check(
      'activate -> ACTIVE with ~30d expiry',
      activate.status === 200 &&
        actRow?.subscriptionStatus === 'ACTIVE' &&
        actExpires > Date.now() + 29 * DAY_MS,
      `status ${activate.status}, ${actRow?.subscriptionStatus}`
    );

    const expire = await action({ action: 'expire' });
    check(
      'expire -> EXPIRED with expiry pinned to now',
      expire.status === 200 &&
        expire.json?.data?.merchant?.subscriptionStatus === 'EXPIRED' &&
        new Date(expire.json.data.merchant.subscriptionExpiresAt).getTime() <= Date.now() + 1000,
      `status ${expire.status}, ${expire.json?.data?.merchant?.subscriptionStatus}`
    );

    const revoke = await action({ action: 'revoke' });
    check(
      'revoke -> PENDING with no expiry',
      revoke.status === 200 &&
        revoke.json?.data?.merchant?.subscriptionStatus === 'PENDING' &&
        revoke.json.data.merchant.subscriptionExpiresAt === null,
      `status ${revoke.status}, ${revoke.json?.data?.merchant?.subscriptionStatus}`
    );

    const suspend = await action({ action: 'suspend' });
    const suspendedRow = await m2Status();
    check(
      'suspend -> listed as suspended, subscription fields untouched',
      suspend.status === 200 && suspendedRow?.suspended === true && suspendedRow?.subscriptionStatus === 'PENDING',
      `status ${suspend.status}, suspended ${suspendedRow?.suspended}`
    );

    const lockedMerchant = await call('/api/merchant/stats', { method: 'GET', cookie: m2 });
    check(
      "Suspended merchant's own /api/merchant/stats -> 403 ACCOUNT_SUSPENDED",
      lockedMerchant.status === 403 && lockedMerchant.json?.error?.code === 'ACCOUNT_SUSPENDED',
      `status ${lockedMerchant.status}, code ${lockedMerchant.json?.error?.code}`
    );

    const restore = await action({ action: 'restore' });
    const restoredRow = await m2Status();
    const unlockedMerchant = await call('/api/merchant/stats', { method: 'GET', cookie: m2 });
    check(
      'restore -> back in the list and the merchant works again (200)',
      restore.status === 200 &&
        restoredRow?.suspended === false &&
        unlockedMerchant.status === 200,
      `status ${restore.status}, suspended ${restoredRow?.suspended}, merchant stats ${unlockedMerchant.status}`
    );

    // --- K. Logout ----------------------------------------------------------
    // Sessions are stateless JWTs: logout must clear the cookie client-side
    // (the token itself stays cryptographically valid until its 12h expiry).
    const logout = await call('/api/auth/logout', { cookie: adminCookie });
    const clearedCookie = (logout.setCookie || []).find((c) => c.startsWith('loyl_session='));
    check(
      'Logout clears the admin session cookie (Max-Age=0)',
      logout.status === 200 && !!clearedCookie && /loyl_session=;/.test(clearedCookie),
      `logout ${logout.status}, set-cookie ${clearedCookie || 'missing'}`
    );

    // --- L. Pages render (admin session cookie required; /admin/login is public)
    await pageRenders('/admin', adminCookie);
    await pageRenders('/admin/merchants', adminCookie);
    await pageRenders('/admin/billing', adminCookie);
    await pageRenders('/admin/login');
  } finally {
    await db.$disconnect();
  }

  // --- Summary --------------------------------------------------------------
  console.log(results.join('\n'));
  console.log(`\nPhase 5 smoke: ${passed} passed, ${failed} failed (${passed + failed} checks)`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
