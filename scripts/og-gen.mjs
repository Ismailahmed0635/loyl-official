/**
 * og-gen.mjs — regenerate `landing page/og.png` (1200x630) for social/OG cards.
 *
 * Why this exists: the marketing landing has no raster brand asset of the right
 * shape for og:image (the checked-in `preview-full.png` is a 1425x5900 full-page
 * screenshot). This renders a designed card through headless Chrome, the same
 * approach `scripts/favicon-gen.mjs` uses for the app favicon, so the OG image is
 * generated rather than hand-maintained.
 *
 * Re-run whenever the landing headline, pricing or palette changes:
 *   node scripts/og-gen.mjs
 *
 * Requires Google Chrome/Edge on a PATH-known location (already present for the
 * favicon script and Playwright QA).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'landing page', 'og.png');
const W = 1200;
const H = 630;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

const chrome = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!chrome) {
  console.error('og-gen: no Chrome/Edge install found (set CHROME_PATH).');
  process.exit(1);
}

// Palette is the landing's own CSS custom properties (styles.css): primary green
// and wine accent, so the card matches the page it advertises.
const html = `<!doctype html><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap">
<style>
  * { box-sizing: border-box; margin: 0; }
  html, body { width: ${W}px; height: ${H}px; overflow: hidden; }
  body {
    font-family: Inter, "Segoe UI", Arial, sans-serif;
    background:
      radial-gradient(900px 500px at 88% -10%, rgba(255,255,255,.10), transparent 60%),
      linear-gradient(135deg, #0f3a26 0%, #195035 55%, #143f2b 100%);
    color: #fff;
    padding: 64px 68px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .brand { display: flex; align-items: center; gap: 16px; }
  .tile {
    width: 58px; height: 58px; border-radius: 14px; background: #fff;
    display: grid; place-items: center;
  }
  .word { font-size: 32px; font-weight: 800; letter-spacing: -.02em; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 56px; }
  .copy { max-width: 660px; }
  h1 { font-size: 62px; line-height: 1.08; letter-spacing: -.035em; font-weight: 800; }
  .sub { margin-top: 22px; font-size: 25px; line-height: 1.5; color: rgba(255,255,255,.82); max-width: 600px; }
  .chips { margin-top: 30px; display: flex; gap: 12px; }
  .chip {
    font-size: 17px; font-weight: 700; padding: 9px 18px; border-radius: 999px;
    background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.22);
  }
  .foot { display: flex; align-items: center; justify-content: space-between; font-size: 20px; color: rgba(255,255,255,.75); }
  .card {
    width: 356px; flex: none; background: #fff; color: #1a1a1a;
    border-radius: 26px; padding: 26px; box-shadow: 0 30px 60px -20px rgba(0,0,0,.45);
  }
  .card-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
  .shop { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 19px; }
  .shop i { width: 34px; height: 34px; border-radius: 10px; background: #195035; display: inline-block; }
  .vip { font-size: 13px; font-weight: 800; color: #195035; background: rgba(25,80,53,.10); padding: 6px 12px; border-radius: 999px; }
  .name { font-size: 15px; color: #5a605b; font-weight: 600; }
  .count { font-size: 34px; font-weight: 800; letter-spacing: -.02em; margin-top: 12px; }
  .count span { font-size: 16px; font-weight: 700; color: #831b36; background: rgba(131,27,54,.10); padding: 5px 11px; border-radius: 999px; margin-left: 10px; vertical-align: middle; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 18px; }
  .s {
    aspect-ratio: 1; border-radius: 12px; display: grid; place-items: center;
    font-size: 22px; background: #f1fcf4; border: 2px solid #0d472a; color: #0d472a;
  }
  .s.todo { background: #fff; border-style: dashed; border-color: #cfd6d1; color: #b9c2bc; }
  .pill { margin-top: 18px; font-size: 15px; font-weight: 800; color: #fff; background: #831b36; border-radius: 999px; padding: 11px 16px; text-align: center; }
</style>
<body>
  <div class="brand">
    <span class="tile">
      <svg width="40" height="40" viewBox="0 0 512 512" aria-hidden="true">
        <rect width="512" height="512" rx="112" fill="#0D472A"/>
        <rect x="96" y="96" width="320" height="320" rx="72" fill="#F1FCF4"/>
        <rect x="144" y="144" width="96" height="96" rx="20" fill="#0D472A"/>
        <rect x="272" y="144" width="96" height="96" rx="20" fill="none" stroke="#0D472A" stroke-width="12" stroke-dasharray="26 18"/>
        <rect x="144" y="272" width="96" height="96" rx="20" fill="none" stroke="#0D472A" stroke-width="12" stroke-dasharray="26 18"/>
        <rect x="272" y="272" width="96" height="96" rx="20" fill="none" stroke="#0D472A" stroke-width="12" stroke-dasharray="26 18"/>
      </svg>
    </span>
    <span class="word">Loyl</span>
  </div>

  <div class="row">
    <div class="copy">
      <h1>Turn every visit into a repeat customer</h1>
      <p class="sub">QR loyalty program for cafes, salons, gyms &amp; retail in Bangladesh. Set up in 2 minutes — no app download.</p>
      <div class="chips">
        <span class="chip">Stamp cards</span>
        <span class="chip">Scratch rewards</span>
        <span class="chip">Digital menu</span>
      </div>
    </div>

    <div class="card">
      <div class="card-top">
        <span class="shop"><i></i> Crimson Roast</span>
        <span class="vip">VIP CARD</span>
      </div>
      <div class="name">Tanvir Hasan</div>
      <div class="count">7 / 8<span>1 to free drink</span></div>
      <div class="grid">
        <span class="s">&#9749;</span><span class="s">&#9749;</span><span class="s">&#9749;</span><span class="s">&#9749;</span>
        <span class="s">&#9749;</span><span class="s">&#9749;</span><span class="s">&#9749;</span><span class="s todo">&#127873;</span>
      </div>
      <div class="pill">+1 stamp added — keep it coming</div>
    </div>
  </div>

  <div class="foot">
    <span>loyl-landing.vercel.app</span>
    <span>Free for one branch &middot; 3-day trial on paid plans</span>
  </div>
</body>`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loyl-og-'));
const file = path.join(tmp, 'og.html');
fs.writeFileSync(file, html);

const args = [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${path.join(tmp, 'profile')}`,
  `--window-size=${W},${H}`,
  '--force-device-scale-factor=1',
  '--virtual-time-budget=6000', // let webfonts finish before the capture
  `--screenshot=${OUT}`,
  `file:///${file.replace(/\\/g, '/')}`,
];

const res = spawnSync(chrome, args, { stdio: ['ignore', 'ignore', 'pipe'], timeout: 90000 });
if (!fs.existsSync(OUT)) {
  console.error(`og-gen: chrome failed\n${res.stderr?.toString()}`);
  process.exit(1);
}

const { size } = fs.statSync(OUT);
console.log(`og-gen: wrote ${path.relative(root, OUT)} — ${W}x${H}, ${size} bytes`);
fs.rmSync(tmp, { recursive: true, force: true });

if (size > 8 * 1024 * 1024) {
  console.error('og-gen: og.png is over the 8MB social-card ceiling.');
  process.exit(1);
}
