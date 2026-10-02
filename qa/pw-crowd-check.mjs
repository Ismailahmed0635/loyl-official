// Verifies the /welcome crowd still renders AND animates after the
// performance work (createImageBitmap source, staggered init, 30fps gate).
// Asserts: canvas exists, has drawn pixels, two samples 900ms apart differ
// (the crowd is walking), zero console/page errors. Saves a screenshot.
import { chromium } from 'playwright-core';

const CHROME = 'C:\\Users\\HP\\AppData\\Local\\ms-playwright\\chromium-1247\\chrome-win64\\chrome.exe';
const BASE = process.env.BASE || 'http://localhost:3000';

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(`${BASE}/welcome`, { waitUntil: 'networkidle' });

const canvas = page.locator('canvas');
await canvas.waitFor({ state: 'visible', timeout: 10000 });
// Give the staggered init (105 walkers / 4 per frame) time to fill the band.
await page.waitForTimeout(1500);

const sample = () => page.evaluate(() => {
  const c = document.querySelector('canvas');
  const ctx = c.getContext('2d');
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  let drawn = 0;
  let hash = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] !== 0) drawn += 1;
    hash = (hash * 31 + data[i] + data[i + 1] * 3 + data[i + 2] * 7 + data[i + 3] * 11) | 0;
  }
  return { drawn, hash, w: c.width, h: c.height };
});

const a = await sample();
await page.waitForTimeout(900);
const b = await sample();

await page.screenshot({ path: 'qa/pw-crowd-check.png' });

const checks = [
  ['canvas has drawn pixels', a.drawn > 5000, `${a.drawn} painted px on ${a.w}x${a.h}`],
  ['crowd is animating (frames differ)', a.hash !== b.hash, `hash ${a.hash} -> ${b.hash}`],
  ['no console/page errors', errors.length === 0, errors.join(' | ') || 'clean'],
];

let fail = 0;
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${detail})`);
  if (!ok) fail += 1;
}
await browser.close();
process.exit(fail === 0 ? 0 : 1);
