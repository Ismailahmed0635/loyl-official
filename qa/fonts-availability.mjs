// Strict probe: are the webfonts actually AVAILABLE for rendering, not just
// present in document.fonts? `document.fonts.check` answers that directly.
import { chromium } from 'playwright-core';

const CHROME = 'C:\\Users\\HP\\AppData\\Local\\ms-playwright\\chromium-1247\\chrome-win64\\chrome.exe';
const BASE = process.env.BASE || 'http://localhost:3111';

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 120)); });

await page.goto(`${BASE}/welcome`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

const state = await page.evaluate(async () => {
  await document.fonts.ready;
  const h1 = document.querySelector('h1');
  const p = document.querySelector('p.font-body-md');
  return {
    fontFaces: document.fonts.size,
    interAvail: document.fonts.check('700 16px Inter'),
    jakartaAvail: document.fonts.check('700 16px "Plus Jakarta Sans"'),
    h1Family: h1 ? getComputedStyle(h1).fontFamily : null,
    pFamily: p ? getComputedStyle(p).fontFamily : null,
    status: document.fonts.status,
  };
});
console.log(JSON.stringify({ state, consoleErrors: errors }, null, 2));
await browser.close();
