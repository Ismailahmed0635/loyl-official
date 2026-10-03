/**
 * Phase 12 — Digital Menu Card smoke test
 * Spec: phases.md Phase 12 + Digital Menu Card feature brief.
 *
 * Flow: merchant signup -> GET (no menu yet) -> photo upload (multipart,
 *       creates the row + slug) -> photo GET/DELETE + upload validation ->
 *       extract contract (200 draft, or 503 VISION_NOT_CONFIGURED with no
 *       vision key) -> PUT draft -> 422s (hex, empty, unknown field) ->
 *       publish -> public /menu/{slug} renders without a session ->
 *       unpublished + bogus slug 404 -> slug collision across merchants ->
 *       cross-tenant isolation -> auth lockdown -> merchant pages render.
 *
 * Usage: node scripts/menu-smoke.mjs [baseUrl]
 */

const BASE = process.argv[2] || 'http://localhost:3111';
import { signUpMerchant as signUpMerchantHelper, grantActiveSubscription } from './test-session.mjs';
const RUN = Date.now().toString(36);

/** 1x1 transparent PNG — small, valid, and recognised as image/png. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

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
  const headers = { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extra };
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

/** Multipart upload — Content-Type is left to fetch so the boundary is right. */
async function upload(path, { cookie, filename, type, bytes }) {
  const form = new FormData();
  form.append('photo', new Blob([bytes], { type }), filename);
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, { method: 'POST', headers, body: form, redirect: 'manual' });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json, headers: res.headers };
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
  // The digital menu card is a paid feature — put the fixture shop on a plan.
  await grantActiveSubscription(merchant.id);
  return cookie;
}

const phone = (p) => p + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');

async function getJson(path, cookie) {
  return call(path, { method: 'GET', cookie });
}

async function htmlOf(route, cookie) {
  const r = await fetch(BASE + route, {
    redirect: 'manual',
    headers: cookie ? { Cookie: cookie } : {},
  }).catch(() => null);
  const html = r ? await r.text().catch(() => '') : '';
  return { status: r ? r.status : 0, html };
}

async function pageRenders(route, cookie) {
  const { status, html } = await htmlOf(route, cookie);
  const ok =
    status === 200 && !/Unhandled Runtime Error|__next_error__|Application error/.test(html);
  check(`Page ${route} renders (200, no build error)`, ok, `status ${status}`);
}

const MENU_A = 'Menu Smoke Corner';
const MENU_B = 'Menu Smoke Corner'; // same name on purpose — forces a slug collision

async function main() {
  // --- A. Merchant + empty state ------------------------------------------
  const a = await signUpMerchant(MENU_A, phone('017'));

  const empty = await getJson('/api/merchant/menu', a);
  check(
    'GET /api/merchant/menu with no menu -> { menu: null } + businessName',
    empty.status === 200 &&
      empty.json?.success === true &&
      empty.json.data.menu === null &&
      typeof empty.json.data.businessName === 'string',
    `status ${empty.status}, body ${JSON.stringify(empty.json?.data ?? empty.json)}`
  );

  // --- B. Photo upload creates the row ------------------------------------
  const up = await upload('/api/merchant/menu/photo', {
    cookie: a,
    filename: 'menu.png',
    type: 'image/png',
    bytes: PNG_1X1,
  });
  check('POST photo (PNG) -> 201', up.status === 201, `status ${up.status}`);
  const uploaded = up.json?.data?.menu;
  check(
    'upload creates the menu row with hasPhoto + a slug',
    !!uploaded && uploaded.hasPhoto === true && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(uploaded.slug ?? ''),
    `menu ${JSON.stringify(uploaded)}`
  );
  check(
    'upload returns the absolute share URL on the menu',
    typeof up.json?.data?.menu?.url === 'string' && /\/menu\//.test(up.json.data.menu.url),
    `url ${up.json?.data?.menu?.url}`
  );
  check(
    'a brand-new menu is not live yet (publishedAt null)',
    uploaded?.publishedAt === null,
    `publishedAt ${uploaded?.publishedAt}`
  );

  const afterUpload = await getJson('/api/merchant/menu', a);
  check(
    'GET after upload reports hasPhoto and still no QR',
    afterUpload.json?.data?.menu?.hasPhoto === true &&
      afterUpload.json?.data?.menu?.qrDataUrl === null,
    `body ${JSON.stringify(afterUpload.json?.data?.menu ?? afterUpload.json)}`
  );

  // --- C. Photo serving + upload validation -------------------------------
  const photo = await fetch(BASE + '/api/merchant/menu/photo', { headers: { Cookie: a } });
  check(
    'GET photo -> 200 image/png',
    photo.status === 200 && (photo.headers.get('content-type') || '').startsWith('image/png'),
    `status ${photo.status}, type ${photo.headers.get('content-type')}`
  );

  const badType = await upload('/api/merchant/menu/photo', {
    cookie: a,
    filename: 'menu.txt',
    type: 'text/plain',
    bytes: Buffer.from('not an image'),
  });
  check(
    'POST photo (text/plain) -> 422 INVALID_FILE_TYPE',
    badType.status === 422 && badType.json?.error?.code === 'INVALID_FILE_TYPE',
    `status ${badType.status}, code ${badType.json?.error?.code}`
  );

  const noFile = await call('/api/merchant/menu/photo', { cookie: a, body: {} });
  check(
    'POST photo with no multipart body -> 4xx (not a 500)',
    noFile.status >= 400 && noFile.status < 500,
    `status ${noFile.status}`
  );

  // --- D. Extraction contract ---------------------------------------------
  const extract = await call('/api/merchant/menu/extract', { cookie: a });
  const extractCode = extract.json?.error?.code;
  check(
    'POST extract answers with a defined contract (200 / 502 / 503, never 500)',
    extract.status === 200 || extract.status === 502 || extract.status === 503,
    `status ${extract.status}, code ${extractCode}`
  );
  if (extract.status === 503) {
    check(
      'no vision key -> 503 VISION_NOT_CONFIGURED (manual editor is the fallback)',
      extractCode === 'VISION_NOT_CONFIGURED',
      `code ${extractCode}`
    );
  }
  if (extract.status === 200) {
    const draft = extract.json?.data?.draft;
    check(
      'a configured key returns a bounded draft shape',
      Array.isArray(draft?.categories) &&
        draft.categories.every(
          (c) => typeof c.name === 'string' && Array.isArray(c.items) && c.items.length > 0
        ),
      `draft ${JSON.stringify(draft)}`
    );
  }

  // --- E. Draft save + validation -----------------------------------------
  const draftBody = {
    title: 'Cafe Corner — All Day Menu',
    backgroundHex: '#FFF7ED',
    categories: [
      {
        name: 'Coffee',
        items: [
          { name: 'Latte', description: 'Double shot, whole milk', price: '৳250', isAvailable: true },
          { name: 'Americano', description: '', price: '৳200', isAvailable: true },
        ],
      },
      {
        name: 'Bakery',
        items: [{ name: 'Croissant', description: 'Butter', price: '৳180', isAvailable: false }],
      },
    ],
  };

  const draftSave = await call('/api/merchant/menu', { cookie: a, method: 'PUT', body: draftBody });
  check('PUT (draft) -> 200', draftSave.status === 200, `status ${draftSave.status}`);
  check(
    'a draft save does not publish and issues no QR',
    draftSave.json?.data?.menu?.publishedAt === null &&
      draftSave.json?.data?.menu?.qrDataUrl === null,
    `menu ${JSON.stringify(draftSave.json?.data?.menu)}`
  );
  check(
    'the slug survives the save (it is the printed URL)',
    draftSave.json?.data?.menu?.slug === uploaded?.slug,
    `slug ${draftSave.json?.data?.menu?.slug} vs ${uploaded?.slug}`
  );
  check(
    'the payload round-trips: 2 sections, 3 items, prices preserved',
    draftSave.json?.data?.menu?.categories?.length === 2 &&
      draftSave.json.data.menu.categories[0].items[0].price === '৳250' &&
      draftSave.json.data.menu.categories[1].items[0].isAvailable === false,
    `categories ${JSON.stringify(draftSave.json?.data?.menu?.categories)}`
  );

  const rejects = [
    ['bad hex', { ...draftBody, backgroundHex: 'red' }],
    ['no sections', { ...draftBody, categories: [] }],
    ['empty section', { ...draftBody, categories: [{ name: 'Coffee', items: [] }] }],
    ['unknown field', { ...draftBody, sneaky: true }],
    ['over-long title', { ...draftBody, title: 'x'.repeat(120) }],
  ];
  for (const [label, body] of rejects) {
    const r = await call('/api/merchant/menu', { cookie: a, method: 'PUT', body });
    check(
      `PUT rejects ${label} -> 422 VALIDATION_ERROR`,
      r.status === 422 && r.json?.error?.code === 'VALIDATION_ERROR',
      `status ${r.status}, code ${r.json?.error?.code}`
    );
  }

  // --- F. Publish ----------------------------------------------------------
  const publish = await call('/api/merchant/menu', {
    cookie: a,
    method: 'PUT',
    body: { ...draftBody, backgroundHex: '#0F172A', publish: true },
  });
  const live = publish.json?.data?.menu;
  check('PUT publish -> 200 with publishedAt set', publish.status === 200 && !!live?.publishedAt,
    `status ${publish.status}, publishedAt ${live?.publishedAt}`);
  check(
    'a live menu carries an absolute URL and a QR data URL',
    typeof live?.url === 'string' && /^data:image\/png;base64,/.test(live?.qrDataUrl ?? ''),
    `url ${live?.url}, qr ${String(live?.qrDataUrl).slice(0, 32)}`
  );

  const afterPublish = await htmlOf(`/menu/${live.slug ?? uploaded?.slug}`);
  check(
    'the published background colour reaches the public page',
    afterPublish.status === 200 &&
      (afterPublish.html.includes('0F172A') || afterPublish.html.includes('#0f172a')),
    `status ${afterPublish.status}, background not found in HTML`
  );

  const republish = await call('/api/merchant/menu', {
    cookie: a,
    method: 'PUT',
    body: { ...draftBody, backgroundHex: '#0F172A', publish: true },
  });
  check(
    'republishing does not move the original publishedAt',
    republish.json?.data?.menu?.publishedAt === live?.publishedAt,
    `was ${live?.publishedAt}, now ${republish.json?.data?.menu?.publishedAt}`
  );

  const keepLive = await call('/api/merchant/menu', {
    cookie: a,
    method: 'PUT',
    body: draftBody, // no publish flag
  });
  check(
    'a later draft-less save keeps the menu live',
    keepLive.json?.data?.menu?.publishedAt !== null &&
      typeof keepLive.json?.data?.menu?.qrDataUrl === 'string',
    `publishedAt ${keepLive.json?.data?.menu?.publishedAt}`
  );

  // --- G. Public page (no session) ----------------------------------------
  const slug = live?.slug ?? uploaded?.slug;
  const pub = await htmlOf(`/menu/${slug}`);
  check(
    'GET /menu/{slug} renders 200 with no session (middleware allowlist)',
    pub.status === 200,
    `status ${pub.status} (307 would mean the allowlist is missing /menu)`
  );
  check(
    'the public page shows the title, items and prices',
    pub.html.includes('Cafe Corner — All Day Menu') &&
      pub.html.includes('Latte') &&
      pub.html.includes('Croissant') &&
      pub.html.includes('৳250'),
    `title/items missing from HTML`
  );
  check(
    'the most recent save repaints the live page (no republish needed)',
    pub.html.includes('FFF7ED') || pub.html.includes('#fff7ed'),
    'background hex not found in HTML'
  );
  check(
    'an unavailable item is marked, not silently dropped',
    /Sold out/i.test(pub.html),
    'no "Sold out" badge in HTML'
  );
  check(
    'the merchant photo is NOT served to the public',
    !pub.html.includes('/api/merchant/menu/photo'),
    'private photo URL leaked into the public page'
  );

  const bogus = await htmlOf('/menu/definitely-not-a-real-menu-xyz');
  check('GET /menu/{unknown slug} -> 404', bogus.status === 404, `status ${bogus.status}`);

  const hostile = await htmlOf('/menu/..%2F..%2Fadmin');
  check(
    'hostile slug -> 404 (not a 500, not a redirect)',
    hostile.status === 404,
    `status ${hostile.status}`
  );

  // --- H. A second merchant with the same name ----------------------------
  const b = await signUpMerchant(MENU_B, phone('018'));

  const bEmpty = await getJson('/api/merchant/menu', b);
  check(
    'merchant B does not see merchant A\'s menu (no cross-tenant leak)',
    bEmpty.status === 200 && bEmpty.json?.data?.menu === null,
    `body ${JSON.stringify(bEmpty.json?.data)}`
  );

  const bUp = await upload('/api/merchant/menu/photo', {
    cookie: b,
    filename: 'menu.png',
    type: 'image/png',
    bytes: PNG_1X1,
  });
  const aSlug = uploaded?.slug;
  const bSlug = bUp.json?.data?.menu?.slug;
  check(
    'identical business names get distinct slugs',
    typeof bSlug === 'string' && bSlug !== aSlug,
    `A ${aSlug} vs B ${bSlug}`
  );

  const aStill = await getJson('/api/merchant/menu', a);
  check(
    'A\'s menu is unchanged after B signed up',
    aStill.json?.data?.menu?.slug === aSlug,
    `slug ${aStill.json?.data?.menu?.slug}`
  );

  // --- I. Photo removal ----------------------------------------------------
  const del = await call('/api/merchant/menu/photo', { method: 'DELETE', cookie: a });
  check('DELETE photo -> 200', del.status === 200, `status ${del.status}`);
  const afterDel = await fetch(BASE + '/api/merchant/menu/photo', { headers: { Cookie: a } });
  check('photo is gone after DELETE -> 404', afterDel.status === 404, `status ${afterDel.status}`);
  const menuAfterDel = await getJson('/api/merchant/menu', a);
  check(
    'removing the photo keeps the menu and its items',
    menuAfterDel.json?.data?.menu?.hasPhoto === false &&
      menuAfterDel.json?.data?.menu?.categories?.length === 2,
    `menu ${JSON.stringify(menuAfterDel.json?.data?.menu)}`
  );
  const pubAfterDel = await htmlOf(`/menu/${aSlug}`);
  check(
    'the public page still renders after the photo is removed',
    pubAfterDel.status === 200 && pubAfterDel.html.includes('Latte'),
    `status ${pubAfterDel.status}`
  );

  // --- J. Auth lockdown ----------------------------------------------------
  const unauthGet = await call('/api/merchant/menu', { method: 'GET' });
  check(
    'Unauth GET /api/merchant/menu -> 401 UNAUTHORIZED',
    unauthGet.status === 401 && unauthGet.json?.error?.code === 'UNAUTHORIZED',
    `status ${unauthGet.status}`
  );

  const unauthPut = await call('/api/merchant/menu', { method: 'PUT', body: draftBody });
  check(
    'Unauth PUT /api/merchant/menu -> 401 UNAUTHORIZED',
    unauthPut.status === 401 && unauthPut.json?.error?.code === 'UNAUTHORIZED',
    `status ${unauthPut.status}`
  );

  const unauthExtract = await call('/api/merchant/menu/extract', { method: 'POST' });
  check(
    'Unauth POST extract -> 401 UNAUTHORIZED',
    unauthExtract.status === 401,
    `status ${unauthExtract.status}`
  );

  // --- K. Page renders -----------------------------------------------------
  await pageRenders('/menu', a);
  await pageRenders('/dashboard', a);
  await pageRenders(`/menu/${aSlug}`);

  // --- Summary -------------------------------------------------------------
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
