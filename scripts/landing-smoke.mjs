/**
 * Landing page smoke — the marketing static site (separate Vercel project).
 *
 * The landing lives outside the Next app (repo-root `landing page/`, deployed to
 * its own origin), so no phaseN smoke covers it. This is its regression net: the
 * SEO contract (canonical / robots / OG / JSON-LD / sitemap), the asset contract
 * (icon, favicon, OG card) and the deliberate exclusions (`code.html`, `serve.js`
 * must stay unpublished).
 *
 * Usage: node scripts/landing-smoke.mjs [baseUrl]
 *   default baseUrl = https://loyl-landing.vercel.app
 * Local: node serve.js   (in `landing page/`) then
 *        node scripts/landing-smoke.mjs http://127.0.0.1.nip.io:4321
 *   (that host form is required: claude-seo's url_safety blocks plain loopback,
 *    and this script asserts against whatever origin it is given.)
 */
const BASE = (process.argv[2] || 'https://loyl-landing.vercel.app').replace(/\/+$/, '');
/** The app origin — conversion CTAs must navigate here, never to an anchor. */
const APP = 'https://loyl-self.vercel.app';
const WELCOME = `${APP}/welcome`;

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

/** First match of `re` against `text`, or null. */
function m(text, re) {
  const hit = text.match(re);
  return hit ? hit[1] : null;
}

async function get(path) {
  try {
    const res = await fetch(BASE + path, { redirect: 'manual' });
    const body = res.status < 300 || res.status >= 400 ? await res.text() : '';
    return { status: res.status, body, headers: res.headers };
  } catch (err) {
    return { status: 0, body: '', headers: null, error: String(err) };
  }
}

/** Decode the few entities the landing actually uses before measuring text. */
function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function main() {
  console.log(`Landing page smoke against ${BASE}\n`);

  // --- homepage: on-page SEO ---------------------------------------------
  const home = await get('/');
  check('GET / is 200', home.status === 200, `status ${home.status}`);
  check('serves text/html', (home.headers?.get('content-type') || '').includes('text/html'));
  check('no localhost in served HTML', !home.body.includes('localhost'));

  // Length limits are on the RENDERED string — `&amp;` counts as one char, not five.
  const title = decodeEntities(m(home.body, /<title>([^<]*)<\/title>/) || '');
  check(`title present and <= 60 chars (got ${title.length})`, title.length > 0 && title.length <= 60, title);
  check('title names the product + market', /Loyl/i.test(title) && /Bangladesh/i.test(title), title);

  const desc = decodeEntities(m(home.body, /<meta name="description" content="([^"]*)"/) || '');
  check(`description 120-170 chars (got ${desc.length})`, desc.length >= 120 && desc.length <= 170, desc);

  const canonical = m(home.body, /<link rel="canonical" href="([^"]+)"/);
  check('canonical is self-referencing', canonical === `${BASE}/`, `got ${canonical}`);
  check('meta robots allows index/follow', /<meta name="robots" content="[^"]*index[^"]*follow/.test(home.body));
  check('exactly one <h1>', (home.body.match(/<h1[ >]/g) || []).length === 1);
  check('no skipped heading level in the mock phone', !/<h4>Scan\. Earn\. Return\.<\/h4>/.test(home.body));

  // --- Open Graph / Twitter ----------------------------------------------
  const ogImage = m(home.body, /property="og:image" content="([^"]+)"/);
  check('og:image absolute on this origin', ogImage === `${BASE}/og.png`, `got ${ogImage}`);
  check('og:image declares 1200x630', /property="og:image:width" content="1200"/.test(home.body) && /property="og:image:height" content="630"/.test(home.body));
  check('twitter:card is summary_large_image', m(home.body, /name="twitter:card" content="([^"]+)"/) === 'summary_large_image');
  check('og:url matches canonical', m(home.body, /property="og:url" content="([^"]+)"/) === `${BASE}/`);

  const og = await get('/og.png');
  check('og.png serves 200 image/png', og.status === 200 && (og.headers?.get('content-type') || '').startsWith('image/'));

  // --- structured data ----------------------------------------------------
  const ldRaw = m(home.body, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  let ld = null;
  try {
    ld = JSON.parse(ldRaw || '');
  } catch {
    /* handled below */
  }
  check('JSON-LD parses', !!ld, ldRaw ? 'invalid JSON' : 'block missing');
  if (ld) {
    const graph = ld['@graph'] || [ld];
    check('JSON-LD has @context', ld['@context'] === 'https://schema.org');
    const types = graph.map((n) => n['@type']);
    for (const t of ['Organization', 'WebSite', 'SoftwareApplication']) {
      check(`JSON-LD declares ${t}`, types.includes(t), `got ${types.join(',')}`);
    }
    const app = graph.find((n) => n['@type'] === 'SoftwareApplication');
    check(
      'offers priced in BDT',
      !!app && (app.offers || []).length >= 2 && (app.offers || []).every((o) => o.priceCurrency === 'BDT'),
      `${(app?.offers || []).length} offers`
    );
    check('no FAQPage markup (Google retired FAQ rich results 2026-05-07)', !types.includes('FAQPage'));
    const org = graph.find((n) => n['@type'] === 'Organization');
    check('Organization logo is absolute', /^https?:\/\//.test(org?.logo?.url || ''), org?.logo?.url || 'missing');
  }

  // --- assets -------------------------------------------------------------
  for (const [path, label] of [
    ['/styles.css', 'stylesheet'],
    ['/script.js', 'script'],
    ['/icon.svg', 'logo svg'],
    ['/favicon.ico', 'favicon'],
  ]) {
    const r = await get(path);
    check(`${label} ${path} -> 200`, r.status === 200, `status ${r.status}`);
  }
  check('icon linked as favicon', /<link rel="icon" href="icon\.svg"/.test(home.body));

  // --- security headers (landing page/vercel.json) ------------------------
  const hdr = (k) => (home.headers?.get(k) || '').toLowerCase();
  check('X-Content-Type-Options: nosniff', hdr('x-content-type-options') === 'nosniff');
  check('Referrer-Policy present', hdr('referrer-policy').length > 0);

  // --- CTA wiring to the app origin --------------------------------------
  check('CTAs point at the app /welcome', home.body.includes(WELCOME));

  // Every conversion CTA must be a real navigation. `script.js` calls
  // preventDefault() on every `a[href^="#"]` to smooth-scroll, so a CTA parked
  // on an anchor silently does nothing (bug 2026-10-05: 7 of them sat on
  // `#pricing`).
  const CTA = /Start Free Trial|Start Your Free Trial|Get Started|Sign In/i;
  const ctas = [...home.body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
    .map((hit) => ({
      attrs: hit[1],
      text: decodeEntities(hit[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(),
    }))
    .filter((a) => CTA.test(a.text));
  check(`homepage has conversion CTAs (found ${ctas.length})`, ctas.length >= 8, `${ctas.length}`);
  for (const a of ctas) {
    const href = (a.attrs.match(/href="([^"]*)"/) || [])[1];
    check(`CTA "${a.text.slice(0, 30)}" -> /welcome`, href === WELCOME, `got ${href}`);
  }

  // --- robots + sitemap ---------------------------------------------------
  const robots = await get('/robots.txt');
  check('robots.txt -> 200', robots.status === 200, `status ${robots.status}`);
  check('robots.txt advertises the sitemap', robots.body.includes(`Sitemap: ${BASE}/sitemap.xml`));
  check('robots.txt does not blanket-disallow', !/^Disallow: \/$/m.test(robots.body));

  const sitemap = await get('/sitemap.xml');
  check('sitemap.xml -> 200', sitemap.status === 200, `status ${sitemap.status}`);
  const locs = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((x) => x[1]);
  check(`sitemap lists 4 URLs (got ${locs.length})`, locs.length === 4, locs.join(', '));
  check('every sitemap URL is on this origin', locs.every((u) => u.startsWith(`${BASE}/`)), locs.join(', '));
  for (const p of ['/contact.html', '/privacy.html', '/refund.html']) {
    check(`sitemap includes ${p}`, locs.includes(`${BASE}${p}`), locs.join(', '));
  }

  // --- sub-pages: self-canonical, indexable, one h1 -----------------------
  for (const p of ['/contact.html', '/privacy.html', '/refund.html']) {
    const r = await get(p);
    check(`${p} -> 200`, r.status === 200, `status ${r.status}`);
    check(`${p} self-canonical`, m(r.body, /<link rel="canonical" href="([^"]+)"/) === `${BASE}${p}`);
    check(`${p} indexable`, /<meta name="robots" content="[^"]*index/.test(r.body));
    check(`${p} has og:image`, r.body.includes(`content="${BASE}/og.png"`));
    check(`${p} exactly one <h1>`, (r.body.match(/<h1[ >]/g) || []).length === 1);
    check(`${p} has no localhost`, !r.body.includes('localhost'));
    check(`${p} Start Free Trial -> /welcome`, r.body.includes(`href="${WELCOME}">Start Free Trial`));
    check(`${p} has no anchored conversion CTA`, !/href="(?:index\.html)?#pricing">Start Free/.test(r.body));
  }

  // --- deliberate exclusions ---------------------------------------------
  for (const p of ['/code.html', '/serve.js']) {
    const r = await get(p);
    check(`${p} is NOT published`, r.status === 404, `status ${r.status}`);
  }

  console.log(results.join('\n'));
  console.log(`\n${passed}/${passed + failed} assertions passed`);
  if (failed > 0) {
    console.error(`${failed} FAILED`);
    process.exit(1);
  }
}

main();
