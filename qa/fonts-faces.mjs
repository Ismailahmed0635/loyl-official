// Enumerate every FontFace: family, weight, status — and which weights the
// page actually uses for headlines, so a missing face is unambiguous.
import { chromium } from 'playwright-core';

const CHROME = 'C:\\Users\\HP\\AppData\\Local\\ms-playwright\\chromium-1247\\chrome-win64\\chrome.exe';
const BASE = process.env.BASE || 'http://localhost:3111';

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(`${BASE}/welcome`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

const out = await page.evaluate(async () => {
  await document.fonts.ready;
  const faces = [];
  document.fonts.forEach((f) => faces.push(`${f.family} w${f.weight} ${f.style} ${f.status}`));
  const weights = {};
  for (const spec of ['400 16px "Plus Jakarta Sans"', '600 16px "Plus Jakarta Sans"', '700 16px "Plus Jakarta Sans"', '400 16px Inter', '500 16px Inter', '600 16px Inter', '700 16px Inter']) {
    weights[spec] = document.fonts.check(spec);
  }
  const h1 = document.querySelector('h1');
  const cs = h1 ? getComputedStyle(h1) : null;
  return { faces, checks: weights, h1: cs ? { family: cs.fontFamily, weight: cs.fontWeight, size: cs.fontSize } : null };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
