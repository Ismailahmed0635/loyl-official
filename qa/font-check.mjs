// Is the Google Fonts stylesheet actually applying? Checks the link's media
// state, whether woff2 files are fetched, and whether rendered text uses the
// intended family or the fallback.
import { chromium } from 'playwright-core';

const CHROME = 'C:\\Users\\HP\\AppData\\Local\\ms-playwright\\chromium-1247\\chrome-win64\\chrome.exe';
const BASE = process.env.BASE || 'http://localhost:3000';

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

const fontReqs = [];
page.on('request', (r) => { if (r.url().includes('gstatic') || r.url().includes('googleapis')) fontReqs.push(`REQ ${r.url().slice(0, 90)}`); });
page.on('response', (r) => { if (r.url().includes('gstatic') || r.url().includes('googleapis')) fontReqs.push(`RES ${r.status()} ${r.url().slice(0, 90)}`); });

await page.goto(`${BASE}/welcome`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

const state = await page.evaluate(() => {
  const links = [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => ({
    href: l.href.slice(0, 80),
    media: l.media,
    loaded: l.sheet !== null,
  }));
  const p = document.querySelector('p.font-body-md');
  const computed = p ? getComputedStyle(p).fontFamily : null;
  // Measure: if Inter is active the width differs from the fallback.
  const probe = document.createElement('span');
  probe.textContent = 'Digital loyalty stamp cards 0123456789';
  probe.style.cssText = 'position:absolute;visibility:hidden;font-size:40px;';
  document.body.appendChild(probe);
  probe.style.fontFamily = 'Inter, monospace';
  const wInter = probe.offsetWidth;
  probe.style.fontFamily = 'monospace';
  const wMono = probe.offsetWidth;
  probe.remove();
  return {
    links,
    computed,
    wInter,
    wMono,
    interDiffersFromFallback: wInter !== wMono,
    fontFaceCount: document.fonts.size,
  };
});
console.log(JSON.stringify({ state, fontReqs }, null, 1));
await browser.close();
