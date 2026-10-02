/**
 * favicon-gen.mjs — regenerate `frontend/app/favicon.ico` from `frontend/public/icon.svg`.
 *
 * Why this exists: every page console logged a /favicon.ico 404 (CODIN §10). The app
 * ships an SVG icon (`/icon.svg`, linked by layout metadata), but browsers and crawlers
 * still probe /favicon.ico directly. Next.js serves `/favicon.ico` only when the file
 * exists at `app/favicon.ico`, so this script rasterises the one SVG source of truth
 * (Phase 8 decision: one file, no hand-maintained raster set) and packs the PNGs into a
 * multi-resolution ICO — the ICO container simply embeds the PNG payloads.
 *
 * Requires Google Chrome on PATH-known locations (already present for Playwright QA).
 * Run: node scripts/favicon-gen.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SVG = path.join(root, 'frontend', 'public', 'icon.svg');
const OUT = path.join(root, 'frontend', 'app', 'favicon.ico');
const SIZES = [16, 32, 48, 64, 256];

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

const chrome = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!chrome) {
  console.error('favicon-gen: no Chrome/Edge install found (set CHROME_PATH).');
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loyl-favicon-'));
const html = path.join(tmp, 'icon.html');
const svg = fs.readFileSync(SVG, 'utf8');

// The SVG must bleed edge-to-edge (no body margin) and keep transparent corners.
fs.writeFileSync(
  html,
  `<!doctype html><meta charset="utf-8"><style>
     html,body{margin:0;padding:0;width:100%;height:100%;background:transparent;overflow:hidden}
     svg{display:block;width:100%;height:100%}
   </style>${svg}`
);

function render(size) {
  const png = path.join(tmp, `icon-${size}.png`);
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${path.join(tmp, 'profile-' + size)}`,
    '--default-background-color=00000000', // keep the rounded-corner transparency
    `--window-size=${size},${size}`,
    `--screenshot=${png}`,
    `file:///${html.replace(/\\/g, '/')}`,
  ];
  const res = spawnSync(chrome, args, { stdio: ['ignore', 'ignore', 'pipe'], timeout: 60000 });
  if (!fs.existsSync(png)) {
    console.error(`favicon-gen: chrome failed at ${size}px\n${res.stderr?.toString()}`);
    process.exit(1);
  }
  return fs.readFileSync(png);
}

/** Pack PNG payloads into a multi-resolution ICO (ICO entries may embed PNGs). */
function packIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);

  const entries = [];
  let offset = 6 + pngs.length * 16;
  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size; // width (0 = 256)
    entry[1] = size >= 256 ? 0 : size; // height
    entry[2] = 0; // palette colours
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

const pngs = SIZES.map((size) => ({ size, data: render(size) }));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, packIco(pngs));

const total = fs.statSync(OUT).size;
console.log(`favicon-gen: wrote ${path.relative(root, OUT)} — ${SIZES.join('/')}px, ${total} bytes`);
fs.rmSync(tmp, { recursive: true, force: true });
