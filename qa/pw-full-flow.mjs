import { chromium } from 'playwright-core';

const BASE = process.argv[2] || 'http://localhost:3000';
const CHROME = 'C:\\Users\\HP\\AppData\\Local\\ms-playwright\\chromium-1247\\chrome-win64\\chrome.exe';

const results = [];
let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; results.push(`  PASS  ${name}`); }
  else { failed++; results.push(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

const browser = await chromium.launch({ executablePath: CHROME });
try {
  for (const vp of [{ w: 390, h: 844, label: 'mobile' }, { w: 1280, h: 800, label: 'desktop' }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
    const page = await ctx.newPage();
    const errors = [];
    const badResponses = [];
    // Gate probes MUST fail for guests (no session cookie): every guarded API
    // correctly answers 401 UNAUTHORIZED, so all /api 401s are allowed here.
    // Anything else (403/404/5xx) is a real failure — a leak, a crash, or a
    // missing route.
    page.on('response', (r) => {
      try {
        const u = new URL(r.url());
        if (u.origin === BASE && u.pathname.startsWith('/api') && r.status() >= 400 && r.status() !== 401) {
          badResponses.push(`${r.status()} ${u.pathname}`);
        }
      } catch { /* ignore */ }
    });
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 160)));

    // 1. / redirects to /welcome
    let r = await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    check(`[${vp.label}] / -> /welcome (307/200, url=${page.url().replace(BASE, '')})`,
      /\/welcome/.test(page.url()), `url=${page.url()} status=${r?.status()}`);

    // 2. Core public/auth pages render (+ /otp is gone → bounces to /welcome)
    for (const route of ['/welcome', '/business-setup']) {
      const res = await page.goto(BASE + route, { waitUntil: 'domcontentloaded' });
      const body = await page.content();
      check(`[${vp.label}] ${route} renders (${res?.status()})`,
        res?.status() === 200 && !/Unhandled Runtime Error|__next_error__/.test(body), `status=${res?.status()}`);
    }
    {
      const res = await fetch(BASE + '/otp', { redirect: 'manual' }).catch(() => null);
      check(`[${vp.label}] /otp removed (307 to /welcome)`,
        res?.status === 307 && (res.headers.get('location') || '').includes('/welcome'),
        `status=${res?.status}`);
    }

    // 3. Interactive: /welcome is Firebase email-auth (register/login toggle).
    // No side-effect submits here (a valid submit would create a real Firebase
    // user) — assert the client validation UX instead. Fresh dev compiles are
    // slow to hydrate, so poll the toggle until the mode switch lands.
    await page.goto(BASE + '/welcome', { waitUntil: 'networkidle' });
    const loginTab = page.locator('button[role="tab"]', { hasText: 'Log in' });
    let toggled = false;
    try {
      await loginTab.waitFor({ state: 'visible', timeout: 20000 });
      for (let i = 0; i < 6 && !toggled; i++) {
        await loginTab.click({ timeout: 5000 }).catch(() => null);
        await page.waitForTimeout(800);
        toggled = await page.locator('text=Sign in with your email').isVisible().catch(() => false);
      }
    } catch { /* handled below */ }
    check(`[${vp.label}] /welcome toggles to login mode`, toggled);
    if (toggled) {
      await page.locator('button[type="submit"]').click();
      await page.waitForTimeout(500);
      const valErr = await page.locator('text=required', { exact: false }).first().isVisible().catch(() => false);
      check(`[${vp.label}] /welcome empty submit shows validation`, valErr);
      await page.locator('input[type="email"]').fill('not-an-email');
      await page.locator('button[type="submit"]').click();
      await page.waitForTimeout(500);
      const emailErr = await page.locator('text=valid email', { exact: false }).first().isVisible().catch(() => false);
      check(`[${vp.label}] /welcome invalid email rejected inline`, emailErr);
    } else {
      results.push(`  SKIP  [${vp.label}] welcome validation — toggle did not land`);
    }

    // 4. Guest gates: merchant + admin + customer pages redirect to entry, never 500
    const gates = [
      ['/dashboard', '/welcome'], ['/offers/new', '/welcome'], ['/branches', '/welcome'],
      ['/analytics', '/welcome'], ['/customers', '/welcome'], ['/requests', '/welcome'],
      ['/billing', '/welcome'], ['/settings', '/welcome'],
      ['/stamp-card', '/scan'], ['/reward', '/scan'],
      ['/admin', '/admin/login'],
    ];
    for (const [route, expectFrag] of gates) {
      const res = await page.goto(BASE + route, { waitUntil: 'domcontentloaded' }).catch(() => null);
      const ok = res && res.status() < 500 && page.url().includes(expectFrag);
      check(`[${vp.label}] guest ${route} -> ${expectFrag}`, !!ok, `url=${page.url()} status=${res?.status()}`);
    }
    // /menu is deliberately public at the middleware layer (PUBLIC_PREFIXES must
    // cover public /menu/[slug]); the merchant layout client-gate bounces guests
    // to /welcome. Give the client gate a moment, then assert the landing spot.
    await page.goto(BASE + '/menu', { waitUntil: 'domcontentloaded' }).catch(() => null);
    await page.waitForURL(/\/welcome/, { timeout: 15000 }).catch(() => null);
    check(`[${vp.label}] guest /menu -> /welcome via client gate`, page.url().includes('/welcome'), `url=${page.url()}`);

    // 5. Customer + admin entry pages render
    for (const route of ['/scan', '/admin/login']) {
      const res = await page.goto(BASE + route, { waitUntil: 'domcontentloaded' });
      check(`[${vp.label}] ${route} renders (${res?.status()})`, res?.status() === 200, `status=${res?.status()}`);
    }

    // 6. Public menu surface: sitemap lists a published slug, first slug renders
    try {
      const sm = await ctx.request.get(BASE + '/sitemap.xml');
      const xml = await sm.text();
      const m = xml.match(/\/menu\/([a-z0-9-]+)/);
      if (m) {
        const res = await page.goto(BASE + '/menu/' + m[1], { waitUntil: 'domcontentloaded' });
        check(`[${vp.label}] public /menu/${m[1]} renders (${res?.status()})`, res?.status() === 200, `status=${res?.status()}`);
      } else results.push(`  SKIP  [${vp.label}] no published menu slug in sitemap`);
    } catch (e) { results.push(`  SKIP  [${vp.label}] sitemap fetch failed: ${String(e).slice(0, 100)}`); }

    // 7. Unknown route: guests are bounced to /welcome by middleware (307), so
    // the 404 page only applies to authenticated sessions. Assert the bounce.
    const nfRes = await fetch(BASE + '/this-route-does-not-exist-xyz', { redirect: 'manual' }).catch(() => null);
    const nf = await page.goto(BASE + '/this-route-does-not-exist-xyz', { waitUntil: 'domcontentloaded' });
    check(`[${vp.label}] unknown route guest -> /welcome (307 bounce)`,
      nfRes?.status === 307 && page.url().includes('/welcome'), `direct=${nfRes?.status} final=${page.url()}`);

    // 8. No unexpected console errors. Known dev-only noise (filtered with
    // reason): Next.js react-refresh runtime uses eval, which the SEC-05 CSP
    // (no 'unsafe-eval') blocks — dev chunks only, absent from prod builds
    // (and now explicitly allowed in dev via next.config.mjs).
    // The missing favicon.ico (CODIN §10 open item) is filtered the same way.
    // Guest 401 resource-load noise from the layout gate probes (/api/auth/me
    // etc.) is asserted precisely via badResponses above instead of here, so
    // this filter only drops the favicon + dev-runtime eval lines.
    const real = errors.filter((t) => !/favicon/i.test(t) && !/react-refresh|unsafe-eval|Evaluating a string/i.test(t) && !/^Failed to load resource.*401/.test(t));
    check(`[${vp.label}] 0 unexpected console errors`, real.length === 0, real.slice(0, 3).join(' | '));
    check(`[${vp.label}] 0 unexpected API 4xx/5xx (guest 401 probes allowed)`, badResponses.length === 0, badResponses.slice(0, 5).join(' | '));

    // 9. Screenshots
    await page.goto(BASE + '/welcome', { waitUntil: 'domcontentloaded' });
    await page.screenshot({ path: `qa/pw-flow-welcome-${vp.label}.png` });
    await ctx.close();
  }
} finally {
  await browser.close();
}

console.log('\n' + results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
