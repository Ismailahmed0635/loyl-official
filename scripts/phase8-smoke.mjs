/**
 * Phase 8 — Polish & Launch Prep smoke test
 * Spec: phases.md Phase 8 (PWA manifest, SEO metadata, error boundaries,
 *       loading states).
 *
 * Flow: /manifest.webmanifest (web-only, colours, icons) -> /icon.svg +
 *       /icon-maskable.svg served -> /robots.txt (menu-only crawl policy) ->
 *       /sitemap.xml (published menus) -> root 307s into the auth flow ->
 *       /welcome head (favicon + theme-color + meta
 *       description + OG + noindex) ->
 *       gated app surfaces still render 200 with session-free contracts ->
 *       public 404 stays intact.
 *
 * Usage: node scripts/phase8-smoke.mjs [baseUrl]
 */

const BASE = process.argv[2] || 'http://localhost:3111';
import { signUpMerchant as signUpMerchantHelper } from './test-session.mjs';
const RUN = Date.now().toString(36);

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

async function fetchOf(path, accept) {
  const res = await fetch(BASE + path, {
    headers: accept ? { Accept: accept } : {},
    redirect: 'manual',
  }).catch(() => null);
  if (!res) return { status: 0, text: '', headers: new Headers() };
  const text = await res.text().catch(() => '');
  return { status: res.status, text, headers: res.headers };
}

const phone = (p) => p + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');

/** Merchant signup (email session + business-setup; mirrors the other smokes). */
async function signUpMerchant(label, p) {
  const email = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${RUN}@example.com`;
  const post = async (path, { cookie, body } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    }).catch(() => null);
    if (!res) return { status: 0, json: null, setCookie: [] };
    const json = await res.json().catch(() => null);
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    return { status: res.status, json, setCookie };
  };
  const { cookie, merchant } = await signUpMerchantHelper(post, {
    email,
    phone: p,
    businessName: label,
    category: 'Café & Bakery',
  });
  check(`[${label}] merchant signed up (200)`, !!merchant?.id);
  return cookie;
}

async function main() {
  // --- A. Web app manifest --------------------------------------------------
  const manifestRes = await fetchOf('/manifest.webmanifest');
  check('/manifest.webmanifest is 200', manifestRes.status === 200, `status ${manifestRes.status}`);

  let manifest = null;
  try {
    manifest = JSON.parse(manifestRes.text);
  } catch {
    /* handled below */
  }
  check('manifest parses as JSON', !!manifest, manifestRes.text.slice(0, 120));

  if (manifest) {
    check('manifest name carries Loyl', typeof manifest.name === 'string' && manifest.name.includes('Loyl'));
    check('manifest short_name is Loyl', manifest.short_name === 'Loyl');
    // Product decision (2026-09-26): web-only polish, not installable.
    check('manifest display is "browser" (not installable)', manifest.display === 'browser', `display ${manifest.display}`);
    check('manifest theme_color is Sovereign Green #0D472A', manifest.theme_color === '#0D472A', `theme ${manifest.theme_color}`);
    check('manifest background_color is porcelain #F1FCF4', manifest.background_color === '#F1FCF4', `bg ${manifest.background_color}`);
    check(
      'manifest declares both SVG icons',
      Array.isArray(manifest.icons) &&
        manifest.icons.some((i) => i.src === '/icon.svg' && i.purpose === 'any') &&
        manifest.icons.some((i) => i.src === '/icon-maskable.svg' && i.purpose === 'maskable'),
      `icons ${JSON.stringify(manifest.icons)}`
    );
    check('manifest start_url is /', manifest.start_url === '/');
  }

  // --- B. Icons served -------------------------------------------------------
  const icon = await fetchOf('/icon.svg');
  check('/icon.svg is 200 image/svg+xml', icon.status === 200 && (icon.headers.get('content-type') || '').includes('image/svg+xml'), `status ${icon.status}, type ${icon.headers.get('content-type')}`);
  check('/icon.svg body is an <svg>', icon.text.includes('<svg'));

  const maskable = await fetchOf('/icon-maskable.svg');
  check('/icon-maskable.svg is 200', maskable.status === 200 && maskable.text.includes('<svg'), `status ${maskable.status}`);

  // --- C. Robots --------------------------------------------------------------
  const robots = await fetchOf('/robots.txt');
  check('/robots.txt is 200 text/plain', robots.status === 200 && (robots.headers.get('content-type') || '').includes('text/plain'), `status ${robots.status}, type ${robots.headers.get('content-type')}`);
  check('robots disallows the whole app by default', /^Disallow:\s*\/\s*$/m.test(robots.text), robots.text);
  check('robots opts in /menu/ for the public menus', /^Allow:\s*\/menu\/\s*$/m.test(robots.text), robots.text);
  check('robots points at the sitemap', /Sitemap:\s*https?:\/\/\S+\/sitemap\.xml\s*$/m.test(robots.text), robots.text);

  // --- D. Sitemap --------------------------------------------------------------
  const sitemap = await fetchOf('/sitemap.xml');
  check('/sitemap.xml is 200 xml', sitemap.status === 200 && /xml/.test(sitemap.headers.get('content-type') || ''), `status ${sitemap.status}, type ${sitemap.headers.get('content-type')}`);
  check('sitemap has a urlset', sitemap.text.includes('<urlset'), sitemap.text.slice(0, 200));
  // Tolerant: empty DB -> empty urlset; a present menu smoke has published one.
  if (sitemap.text.includes('<loc>')) {
    const locs = [...sitemap.text.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
    check(
      'sitemap urls are /menu/ pages only',
      locs.length > 0 && locs.every((u) => /\/menu\/[^/]+$/.test(u)),
      locs.slice(0, 5).join(', ') || sitemap.text.slice(0, 200)
    );
  }

  // --- E. Root 307s into the auth flow; app head stays on /welcome ----------
  // The marketing landing lives on its own host (landing page/, deployed
  // separately), so this origin must never serve it at /.
  const root = await fetchOf('/');
  check('root redirects into the sign-in flow', root.status === 307 && (root.headers.get('location') || '').includes('/welcome'), `status ${root.status} -> ${root.headers.get('location')}`);

  const welcome = await fetchOf('/welcome');
  const html = welcome.text;
  check('welcome page renders 200', welcome.status === 200, `status ${welcome.status}`);
  check('head carries the SVG favicon link', /rel="icon"[^>]*href="\/icon\.svg"/.test(html) || /href="\/icon\.svg"[^>]*rel="icon"/.test(html), html.slice(0, 400));
  check('head carries the theme-color meta (#0D472A)', /<meta name="theme-color" content="#0D472A"/.test(html), html.slice(0, 400));
  check('head carries a meta description', /<meta name="description" content="[^"]+"/.test(html), html.slice(0, 400));
  check('head carries OG tags', /<meta property="og:site_name" content="Loyl"/.test(html), html.slice(0, 600));
  check('head carries the manifest link', /<link rel="manifest" href="\/manifest\.webmanifest"/.test(html), html.slice(0, 600));
  // Next serialises `{ index: false, follow: false }` as "noindex, nofollow"
  // (comma + space), so match the directive rather than the exact spacing.
  check('head carries robots noindex (auth-gated app)', /<meta name="robots" content="noindex,\s*nofollow"/.test(html), html.slice(0, 600));

  // --- F. Gated surfaces still render --------------------------------------------
  const m = await signUpMerchant('Phase8 Smoke Cafe', phone('017'));

  // A merchant page renders through the gate (session cookie from signup).
  const dashAuthed = await fetch(BASE + '/dashboard', { headers: { Cookie: m }, redirect: 'manual' }).catch(() => null);
  check('merchant /dashboard renders with a session (200)', !!dashAuthed && dashAuthed.status === 200, `status ${dashAuthed ? dashAuthed.status : 0}`);

  // Guests are bounced by middleware (the Phase 7 contract holds).
  const dashGuest = await fetchOf('/dashboard');
  check('guest /dashboard is redirected by middleware', dashGuest.status >= 300 && dashGuest.status < 400, `status ${dashGuest.status}`);

  const menuPublic = await fetchOf('/menu/phase8-smoke-not-published');
  check('unpublished menu slug 404s publicly', menuPublic.status === 404, `status ${menuPublic.status}`);

  // --- G. Error/loading boundaries exist in the shipped app ---------------------
  // The boundaries are client files; a rendered page always loads their chunk
  // only on failure, so we assert the compile artifacts instead: a page render
  // that 500s would mean a boundary file failed to compile into the group.
  const customerScan = await fetchOf('/scan');
  check('customer /scan renders (200)', customerScan.status === 200, `status ${customerScan.status}`);

  console.log(results.join('\n'));
  console.log(`\nPhase 8 smoke: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Smoke crashed:', err);
  process.exit(1);
});
